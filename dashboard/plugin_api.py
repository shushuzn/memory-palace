"""Memory Palace — backend API for agent intelligence analysis."""

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter()

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
DB_PATH = HERMES_HOME / "state.db"
SKILLS_DIR = HERMES_HOME / "skills"


def _get_db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise HTTPException(500, f"Hermes database not found at {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _get_tool_usage(conn: sqlite3.Connection) -> dict[str, int]:
    """Parse tool_calls JSON from messages to build usage counts.

    The state.db schema stores tool names inside a JSON array in the
    tool_calls column (not in a dedicated tool_name column).
    """
    usage: dict[str, int] = {}
    rows = conn.execute(
        "SELECT tool_calls FROM messages WHERE tool_calls IS NOT NULL"
    ).fetchall()
    for row in rows:
        try:
            calls = json.loads(row["tool_calls"])
            for call in calls:
                name = call.get("function", {}).get("name") or call.get("name")
                if name:
                    usage[name] = usage.get(name, 0) + 1
        except Exception:
            pass
    return usage


def _get_compounding_multiplier(sessions: list[dict]) -> float:
    """Estimate overall capability multiplier based on session history."""
    if len(sessions) < 3:
        return 1.0
    sorted_sessions = sorted(sessions, key=lambda s: s["started_at"])
    first_month = sorted_sessions[: len(sorted_sessions) // 3 or 1]
    last_month = sorted_sessions[-len(sorted_sessions) // 3 or 1 :]
    if not first_month or not last_month:
        return 1.0
    first_avg_tools = sum(s.get("tool_call_count", 0) for s in first_month) / len(first_month)
    last_avg_tools = sum(s.get("tool_call_count", 0) for s in last_month) / len(last_month)
    if first_avg_tools == 0:
        return 1.0
    return round(last_avg_tools / first_avg_tools, 1)


# ── Time-Folding Palace Overlay ──────────────────────────────────────────────


@router.get("/palace-overlay")
async def get_palace_overlay() -> dict[str, Any]:
    """Return three palace snapshots overlaid: 30d, 7d, now.

    Each tool node carries:
    - count: current total invocations
    - brightness: normalised 0-1 opacity for rendering
    - trend: 'new' | 'growing' | 'fading' | 'stable'
    - layers: raw counts for each time window
    """
    import traceback
    try:
        conn = _get_db()
    except Exception as e:
        traceback.print_exc()
        raise
    try:
        now_ts = datetime.now().timestamp()

        def _tool_snapshot(
            start_ts: float, end_ts: float
        ) -> dict[str, int]:
            rows = conn.execute(
                """
                SELECT tool_calls FROM messages
                WHERE timestamp BETWEEN ? AND ?
                AND tool_calls IS NOT NULL
                """,
                [start_ts, end_ts],
            ).fetchall()
            counts: dict[str, int] = {}
            for row in rows:
                try:
                    for call in json.loads(row["tool_calls"]):
                        name = call.get("function", {}).get("name") or call.get("name")
                        if name:
                            counts[name] = counts.get(name, 0) + 1
                except Exception:
                    pass
            return counts

        older = _tool_snapshot(now_ts - 30 * 86400, now_ts - 7 * 86400)
        recent = _tool_snapshot(now_ts - 7 * 86400, now_ts)
        current = _get_tool_usage(conn)

        top_current = dict(sorted(current.items(), key=lambda x: -x[1])[:30])
        max_count = max(top_current.values()) or 1

        nodes = []
        for name, cnt in top_current.items():
            older_cnt = older.get(name, 0)
            recent_cnt = recent.get(name, 0)

            if older_cnt == 0 and cnt > 0:
                trend = "new"
            elif recent_cnt > older_cnt:
                trend = "growing"
            elif recent_cnt < older_cnt:
                trend = "fading"
            else:
                trend = "stable"

            nodes.append({
                "id": name,
                "count": cnt,
                "brightness": round(cnt / max_count, 3),
                "trend": trend,
                "layers": {
                    "30d": older_cnt,
                    "7d": recent_cnt,
                    "now": cnt,
                },
            })

        # Edges: co-occurrence within current snapshot only
        session_tools: dict[str, list[str]] = {}
        rows = conn.execute(
            """
            SELECT session_id, tool_calls FROM messages
            WHERE tool_calls IS NOT NULL
            AND timestamp >= ?
            """,
            [now_ts - 7 * 86400],
        ).fetchall()
        for r in rows:
            sid = str(r["session_id"])
            if sid not in session_tools:
                session_tools[sid] = []
            try:
                for call in json.loads(r["tool_calls"]):
                    name = call.get("function", {}).get("name") or call.get("name")
                    if name and name not in session_tools[sid]:
                        session_tools[sid].append(name)
            except Exception:
                pass

        co_occur: dict[tuple[str, str], int] = {}
        for tools in session_tools.values():
            for i, a in enumerate(tools):
                for b in tools[i + 1 :]:
                    if a in top_current and b in top_current:
                        key = tuple(sorted([a, b]))
                        co_occur[key] = co_occur.get(key, 0) + 1

        edges = [
            {"source": k[0], "target": k[1], "value": v}
            for k, v in sorted(co_occur.items(), key=lambda x: -x[1])[:50]
        ]

        return {
            "nodes": nodes,
            "edges": edges,
            "summary": {
                "new_rooms": sum(1 for n in nodes if n["trend"] == "new"),
                "growing": sum(1 for n in nodes if n["trend"] == "growing"),
                "fading": sum(1 for n in nodes if n["trend"] == "fading"),
                "stable": sum(1 for n in nodes if n["trend"] == "stable"),
            },
        }
    finally:
        conn.close()


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get("/stats")
async def get_stats() -> dict[str, Any]:
    """Return high-level memory palace statistics."""
    conn = _get_db()
    try:
        sessions = conn.execute(
            """
            SELECT started_at, tool_call_count, input_tokens, output_tokens,
                   estimated_cost_usd, model, billing_provider, message_count
            FROM sessions ORDER BY started_at ASC
            """
        ).fetchall()

        # Skills from filesystem
        skill_names: list[str] = []
        if SKILLS_DIR.exists():
            for skill_path in SKILLS_DIR.iterdir():
                if skill_path.is_dir() and not skill_path.name.startswith("_"):
                    skill_names.append(skill_path.name)

        tool_usage = _get_tool_usage(conn)
        top_tools = sorted(tool_usage.items(), key=lambda x: -x[1])[:5]
        sessions_list = [dict(r) for r in sessions]
        multiplier = _get_compounding_multiplier(sessions_list)

        return {
            "total_sessions": len(sessions),
            "total_skills": len(skill_names),
            "total_tools": len(tool_usage),
            "skill_list": sorted(skill_names),
            "top_tools": [{"name": n, "count": c} for n, c in top_tools],
            "compounding_multiplier": multiplier,
            "session_count_by_day": _sessions_by_day(sessions_list),
            "tool_call_trend": _tool_call_trend(sessions_list),
        }
    finally:
        conn.close()


@router.get("/skills")
async def get_skill_analysis() -> dict[str, Any]:
    """Analyze skill creation and usage patterns."""
    conn = _get_db()
    try:
        tool_usage = _get_tool_usage(conn)

        skill_data: list[dict[str, Any]] = []
        if SKILLS_DIR.exists():
            for sp in sorted(SKILLS_DIR.iterdir()):
                if not sp.is_dir() or sp.name.startswith("_"):
                    continue
                stat = sp.stat()
                created = stat.st_ctime
                modified = stat.st_mtime
                size_kb = sum(f.stat().st_size for f in sp.rglob("*") if f.is_file()) / 1024
                invocations = tool_usage.get(sp.name, 0)
                skill_data.append(
                    {
                        "name": sp.name,
                        "created": created,
                        "modified": modified,
                        "size_kb": round(size_kb, 1),
                        "invocations": invocations,
                        "age_days": round((datetime.now().timestamp() - created) / 86400, 1),
                        "days_since_modified": round((datetime.now().timestamp() - modified) / 86400, 1),
                    }
                )

        now = datetime.now().timestamp()
        dead_skills = [s for s in skill_data if s["invocations"] == 0]
        latent_skills = [s for s in skill_data if s["invocations"] > 0 and (now - s["modified"]) > 30 * 86400]
        most_used = sorted(skill_data, key=lambda s: -s["invocations"])[:10]

        return {
            "all_skills": skill_data,
            "dead_skills": dead_skills,
            "latent_skills": latent_skills,
            "most_used": most_used,
            "total_skills": len(skill_data),
            "dead_count": len(dead_skills),
            "latent_count": len(latent_skills),
        }
    finally:
        conn.close()


@router.get("/timeline")
async def get_timeline() -> dict[str, Any]:
    """Build the learning timeline from session history."""
    conn = _get_db()
    try:
        rows = conn.execute(
            """
            SELECT id, started_at, ended_at, tool_call_count, input_tokens,
                   output_tokens, estimated_cost_usd, title, end_reason,
                   message_count, model
            FROM sessions
            ORDER BY started_at ASC
            """
        ).fetchall()

        sessions = [dict(r) for r in rows]
        if not sessions:
            return {"milestones": [], "events": []}

        by_month: dict[str, dict[str, Any]] = {}
        for s in sessions:
            dt = datetime.fromtimestamp(s["started_at"], tz=timezone.utc)
            key = f"{dt.year}-{dt.month:02d}"
            if key not in by_month:
                by_month[key] = {
                    "month": key,
                    "session_count": 0,
                    "total_tools": 0,
                    "total_tokens": 0,
                    "total_cost": 0.0,
                    "total_messages": 0,
                    "models_used": set(),
                }
            m = by_month[key]
            m["session_count"] += 1
            m["total_tools"] += s.get("tool_call_count", 0) or 0
            m["total_tokens"] += (s.get("input_tokens", 0) or 0) + (s.get("output_tokens", 0) or 0)
            m["total_cost"] += s.get("estimated_cost_usd", 0.0) or 0.0
            m["total_messages"] += s.get("message_count", 0) or 0
            if s.get("model"):
                m["models_used"].add(s["model"])

        milestones = []
        for key, m in sorted(by_month.items()):
            milestones.append(
                {
                    "month": key,
                    "sessions": m["session_count"],
                    "tools": m["total_tools"],
                    "tokens": m["total_tokens"],
                    "cost_usd": round(m["total_cost"], 4),
                    "models": list(m["models_used"]),
                }
            )

        events = []
        if SKILLS_DIR.exists():
            skill_times: list[tuple[str, float]] = []
            for sp in SKILLS_DIR.iterdir():
                if sp.is_dir() and not sp.name.startswith("_"):
                    skill_times.append((sp.name, sp.stat().st_ctime))
            skill_times.sort(key=lambda x: x[1])
            for i, (name, ts) in enumerate(skill_times):
                if i == 0 or (ts - skill_times[i - 1][1]) > 86400 * 5:
                    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                    events.append(
                        {
                            "type": "skill_created",
                            "date": dt.isoformat(),
                            "month": f"{dt.year}-{dt.month:02d}",
                            "description": f"Skill '{name}' created",
                            "icon": "Sparkles",
                        }
                    )

        high_tool = sorted(sessions, key=lambda s: -(s.get("tool_call_count") or 0))[:3]
        for s in high_tool:
            dt = datetime.fromtimestamp(s["started_at"], tz=timezone.utc)
            events.append(
                {
                    "type": "high_activity",
                    "date": dt.isoformat(),
                    "month": f"{dt.year}-{dt.month:02d}",
                    "description": f"Record session: {s.get('tool_call_count', 0)} tool calls",
                    "icon": "Zap",
                }
            )

        return {"milestones": milestones, "events": sorted(events, key=lambda e: e["date"])}
    finally:
        conn.close()


@router.get("/sessions")
async def get_sessions(
    month: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Return session list, optionally filtered by YYYY-MM month."""
    conn = _get_db()
    try:
        where = ""
        params: list[Any] = []
        if month:
            where = "WHERE strftime('%Y-%m', started_at, 'unixepoch') = ?"
            params.append(month)

        rows = conn.execute(
            f"""
            SELECT id, started_at, ended_at, tool_call_count, input_tokens,
                   output_tokens, estimated_cost_usd, title, end_reason,
                   message_count, model
            FROM sessions
            {where}
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()

        total = conn.execute(
            f"SELECT COUNT(*) FROM sessions {where}", params
        ).fetchone()[0]

        return {
            "sessions": [dict(r) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    finally:
        conn.close()
@router.get("/echo-map")
async def get_echo_map() -> dict[str, Any]:
    """Build directed tool call flow map (Echo Map) for visualization.

    Shows tool chains within sessions as flowing rivers:
    - Nodes: tools, sized by total call count
    - Edges: directed transitions (A→B means A was followed by B in same session)
    - Edge width: transition frequency
    - Flow: river width = total outflow from each node

    Returns three time slices (30d, 7d, now) for time-folded comparison.
    """
    conn = _get_db()
    try:
        now_ts = datetime.now().timestamp()

        def _build_transitions(start_ts: float, end_ts: float) -> tuple[dict[str, int], dict[tuple[str, str], int]]:
            """Return (node_counts, directed_transitions) for a time window."""
            rows = conn.execute(
                """
                SELECT session_id, tool_calls, timestamp FROM messages
                WHERE timestamp BETWEEN ? AND ?
                AND tool_calls IS NOT NULL
                ORDER BY session_id, timestamp
                """,
                [start_ts, end_ts],
            ).fetchall()

            # Group by session and sort by timestamp
            session_messages: dict[str, list[tuple[float, list[str]]]] = {}
            for r in rows:
                sid = str(r["session_id"])
                ts = r["timestamp"]
                if sid not in session_messages:
                    session_messages[sid] = []
                try:
                    calls = json.loads(r["tool_calls"])
                    names = []
                    for call in calls:
                        name = call.get("function", {}).get("name") or call.get("name")
                        if name:
                            names.append(name)
                    if names:
                        session_messages[sid].append((ts, names))
                except Exception:
                    pass

            # Build ordered tool sequence per session, then count directed transitions
            transitions: dict[tuple[str, str], int] = {}
            node_counts: dict[str, int] = {}
            for sid, messages in session_messages.items():
                messages.sort(key=lambda x: x[0])
                all_tools: list[str] = []
                for _, tools in messages:
                    for t in tools:
                        if not all_tools or all_tools[-1] != t:
                            all_tools.append(t)

                for t in all_tools:
                    node_counts[t] = node_counts.get(t, 0) + 1

                for i in range(len(all_tools) - 1):
                    a, b = all_tools[i], all_tools[i + 1]
                    if a != b:
                        key = (a, b)
                        transitions[key] = transitions.get(key, 0) + 1

            return node_counts, transitions

        older_counts, older_trans = _build_transitions(now_ts - 30 * 86400, now_ts - 7 * 86400)
        recent_counts, recent_trans = _build_transitions(now_ts - 7 * 86400, now_ts)
        current_counts, current_trans = _build_transitions(now_ts - 7 * 86400, now_ts)

        # Use current as primary
        top_tools = dict(sorted(current_counts.items(), key=lambda x: -x[1])[:30])
        max_count = max(top_tools.values()) or 1

        # Build directed edges from current transitions
        edges_current = []
        for (src, dst), cnt in current_trans.items():
            if src in top_tools and dst in top_tools:
                edges_current.append({
                    "source": src,
                    "target": dst,
                    "value": cnt,
                    "brightness": round(cnt / max(v for v in current_trans.values() or [1]), 3),
                })

        # Get trend for each node: compare recent vs older transition volume
        node_trends = {}
        for name in top_tools:
            older_out = sum(v for (s, d), v in older_trans.items() if s == name)
            recent_out = sum(v for (s, d), v in recent_trans.items() if s == name)
            older_in = sum(v for (s, d), v in older_trans.items() if d == name)
            recent_in = sum(v for (s, d), v in recent_trans.items() if d == name)

            if older_out == 0 and recent_out > 0:
                node_trends[name] = "new"
            elif recent_out > older_out:
                node_trends[name] = "growing"
            elif recent_out < older_out:
                node_trends[name] = "fading"
            else:
                node_trends[name] = "stable"

        nodes = []
        for name, cnt in top_tools.items():
            nodes.append({
                "id": name,
                "count": cnt,
                "brightness": round(cnt / max_count, 3),
                "trend": node_trends.get(name, "stable"),
                "layers": {
                    "30d": older_counts.get(name, 0),
                    "7d": recent_counts.get(name, 0),
                    "now": cnt,
                },
            })

        return {
            "nodes": nodes,
            "edges": sorted(edges_current, key=lambda x: -x["value"])[:80],
            "summary": {
                "new_rooms": sum(1 for n in nodes if n["trend"] == "new"),
                "growing": sum(1 for n in nodes if n["trend"] == "growing"),
                "fading": sum(1 for n in nodes if n["trend"] == "fading"),
                "stable": sum(1 for n in nodes if n["trend"] == "stable"),
            },
        }
    finally:
        conn.close()


@router.get("/constellation")
async def get_constellation() -> dict[str, Any]:
    """Build skill relationship constellation for visualization."""
    conn = _get_db()
    try:
        # Collect tool names per session from tool_calls JSON
        session_tools: dict[str, list[str]] = {}
        rows = conn.execute(
            "SELECT session_id, tool_calls FROM messages WHERE tool_calls IS NOT NULL"
        ).fetchall()
        for r in rows:
            sid = str(r["session_id"])
            if sid not in session_tools:
                session_tools[sid] = []
            try:
                for call in json.loads(r["tool_calls"]):
                    name = call.get("function", {}).get("name") or call.get("name")
                    if name and name not in session_tools[sid]:
                        session_tools[sid].append(name)
            except Exception:
                pass

        # Build edges (co-occurrence count)
        co_occur: dict[tuple[str, str], int] = {}
        for tools in session_tools.values():
            for i, a in enumerate(tools):
                for b in tools[i + 1 :]:
                    key = tuple(sorted([a, b]))
                    co_occur[key] = co_occur.get(key, 0) + 1

        # Get usage counts
        usage_counts = _get_tool_usage(conn)

        nodes = [
            {"id": name, "val": max(cnt, 1), "count": cnt}
            for name, cnt in sorted(usage_counts.items(), key=lambda x: -x[1])[:30]
        ]

        edges = [
            {"source": k[0], "target": k[1], "value": v}
            for k, v in sorted(co_occur.items(), key=lambda x: -x[1])[:50]
            if k[0] in usage_counts and k[1] in usage_counts
        ]

        return {"nodes": nodes, "edges": edges}
    finally:
        conn.close()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _sessions_by_day(sessions: list[dict]) -> list[dict]:
    by_day: dict[str, int] = {}
    for s in sessions:
        dt = datetime.fromtimestamp(s["started_at"], tz=timezone.utc)
        key = f"{dt.year}-{dt.month:02d}-{dt.day:02d}"
        by_day[key] = by_day.get(key, 0) + 1
    return [{"date": k, "count": v} for k, v in sorted(by_day.items())]


def _tool_call_trend(sessions: list[dict]) -> list[dict]:
    """Monthly average tool calls per session."""
    by_month: dict[str, list[int]] = {}
    for s in sessions:
        dt = datetime.fromtimestamp(s["started_at"], tz=timezone.utc)
        key = f"{dt.year}-{dt.month:02d}"
        by_month.setdefault(key, []).append(s.get("tool_call_count", 0) or 0)
    return [
        {"month": k, "avg_tools": round(sum(v) / len(v), 1), "sessions": len(v)}
        for k, v in sorted(by_month.items())
    ]

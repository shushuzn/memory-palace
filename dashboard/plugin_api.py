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

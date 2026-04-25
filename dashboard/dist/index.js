(function () {
  var SDK = window.__HERMES_PLUGIN_SDK__;
  var React = SDK.React;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;
  var Card = SDK.components.Card;
  var CardHeader = SDK.components.CardHeader;
  var CardTitle = SDK.components.CardTitle;
  var CardContent = SDK.components.CardContent;
  var Badge = SDK.components.Badge;
  var Button = SDK.components.Button;
  var Separator = SDK.components.Separator;
  var cn = SDK.utils.cn;
  var timeAgo = SDK.utils.timeAgo;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function pct(a, b) {
    if (!b) return 0;
    return Math.round((a / b) * 100);
  }

  function fmtCost(n) {
    if (!n) return "$0.00";
    return "$" + parseFloat(n).toFixed(4);
  }

  function fmtNum(n) {
    if (!n) return "0";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  // Simple SVG bar chart (no external deps)
  function MiniBar(_ref) {
    var value = _ref.value, max = _ref.max, color = _ref.color;
    var pct_val = Math.min(100, Math.round((value / (max || 1)) * 100));
    return React.createElement("div", { style: { width: "100%", marginTop: 4 } },
      React.createElement("div", { style: { width: pct_val + "%", height: 6, background: color || "#4dd0e1", borderRadius: 3, transition: "width 0.3s" } })
    );
  }

  // ── Constellation (SVG force layout approximation) ────────────────────────

  function Constellation(_ref2) {
    var nodes = _ref2.nodes, edges = _ref2.edges;
    var svgW = 500, svgH = 300;
    var nodeMap = {};
    nodes.forEach(function (n) {
      var angle = Math.random() * 2 * Math.PI;
      var r = 80 + Math.random() * 80;
      nodeMap[n.id] = { x: svgW / 2 + r * Math.cos(angle), y: svgH / 2 + r * Math.sin(angle), vx: 0, vy: 0 };
    });

    // Simple force step
    for (var step = 0; step < 80; step++) {
      nodes.forEach(function (n) {
        var p = nodeMap[n.id];
        var fx = 0, fy = 0;
        // Center gravity
        fx -= (p.x - svgW / 2) * 0.01;
        fy -= (p.y - svgH / 2) * 0.01;
        // Repulse
        nodes.forEach(function (m) {
          if (n.id === m.id) return;
          var q = nodeMap[m.id];
          var dx = p.x - q.x, dy = p.y - q.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          fx += dx / dist * 2;
          fy += dy / dist * 2;
        });
        // Attract edges
        edges.forEach(function (e) {
          var a = null, b = null;
          if (e.source === n.id) a = nodeMap[e.target];
          if (e.target === n.id) a = nodeMap[e.source];
          if (!a) return;
          var dx = a.x - p.x, dy = a.y - p.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          fx += dx / dist * 0.05 * (e.value || 1);
          fy += dy / dist * 0.05 * (e.value || 1);
        });
        p.vx += fx; p.vy += fy;
        p.vx *= 0.85; p.vy *= 0.85;
        p.x += p.vx; p.y += p.vy;
        p.x = Math.max(20, Math.min(svgW - 20, p.x));
        p.y = Math.max(20, Math.min(svgH - 20, p.y));
      });
    }

    var maxVal = Math.max.apply(Math, nodes.map(function (n) { return n.val; })) || 1;
    var radius = function (n) { return 6 + Math.round((n.val / maxVal) * 18); };

    return React.createElement("svg", { width: "100%", viewBox: "0 0 " + svgW + " " + svgH, style: { maxHeight: 300 } },
      React.createElement("g", { opacity: 0.3 },
        edges.map(function (e, i) {
          var s = nodeMap[e.source], t = nodeMap[e.target];
          if (!s || !t) return null;
          return React.createElement("line", { key: i, x1: s.x, y1: s.y, x2: t.x, y2: t.y, stroke: "#4dd0e1", strokeWidth: Math.max(0.5, Math.min(3, e.value)) });
        })
      ),
      nodes.map(function (n) {
        var p = nodeMap[n.id];
        var r = radius(n);
        return React.createElement("g", { key: n.id, title: n.id + " (" + n.count + " calls)" },
          React.createElement("circle", { cx: p.x, cy: p.y, r: r + 2, fill: "none", stroke: "#4dd0e1", strokeWidth: 1, opacity: 0.5 }),
          React.createElement("circle", { cx: p.x, cy: p.y, r: r, fill: "#4dd0e1", opacity: 0.85 }),
          React.createElement("title", null, n.id + ": " + n.count + " calls"),
          r > 12 && React.createElement("text", { x: p.x, y: p.y + 4, textAnchor: "middle", fontSize: 8, fill: "#0a0a0a", style: { pointerEvents: "none" } },
            n.id.length > 12 ? n.id.slice(0, 10) + "…" : n.id
          )
        );
      })
    );
  }

  // ── Timeline Chart ───────────────────────────────────────────────────────

  function TimelineChart(_ref3) {
    var milestones = _ref3.milestones;
    if (!milestones || milestones.length === 0) {
      return React.createElement("p", { className: "text-sm text-muted-foreground" }, "No session data yet.");
    }
    var maxTools = Math.max.apply(Math, milestones.map(function (m) { return m.tools; })) || 1;
    var maxSessions = Math.max.apply(Math, milestones.map(function (m) { return m.sessions; })) || 1;
    var chartH = 100;

    return React.createElement("div", { style: { width: "100%" } },
      milestones.map(function (m, i) {
        var toolsH = Math.round((m.tools / maxTools) * chartH);
        var sessH = Math.round((m.sessions / maxSessions) * chartH * 0.6);
        return React.createElement("div", { key: m.month, style: { display: "flex", alignItems: "flex-end", gap: 4, flex: 1, minWidth: 0 } },
          React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 1, flex: 1 } },
            React.createElement("div", { style: { display: "flex", alignItems: "flex-end", gap: 2, height: chartH + 10, alignItems: "center" } },
              React.createElement("div", { title: "Sessions: " + m.sessions, style: { width: 8, height: sessH + 4, background: "#6366f1", borderRadius: 2, minHeight: 4 } }),
              React.createElement("div", { title: "Tool calls: " + m.tools, style: { width: 8, height: toolsH, background: "#4dd0e1", borderRadius: 2, minHeight: 4 } })
            ),
            React.createElement("span", { style: { fontSize: 9, color: "#888", whiteSpace: "nowrap" } }, m.month.slice(5))
          )
        );
      })
    );
  }

  // ── Skill Row ────────────────────────────────────────────────────────────

  function SkillRow(_ref4) {
    var skill = _ref4.skill, type = _ref4.type;
    var tagColors = {
      dead: "bg-red-500/20 text-red-400 border-red-500/30",
      latent: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      used: "bg-green-500/20 text-green-400 border-green-500/30",
    };
    var color = type === "dead" ? "#ef5350" : type === "latent" ? "#ffa726" : "#4caf50";
    var label = type === "dead" ? "Dead" : type === "latent" ? "Idle " + skill.days_since_modified + "d" : null;

    return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--color-border)" } },
      React.createElement("div", { style: { flex: 1, minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, skill.name),
        React.createElement("div", { style: { fontSize: 11, color: "#888" } },
          skill.invocation_count ? skill.invocation_count + " calls" : "Never invoked",
          " · ",
          skill.age_days + "d old"
        )
      ),
      label && React.createElement(Badge, { className: tagColors[type], style: { fontSize: 10 } }, label),
      React.createElement(MiniBar, { value: skill.invocation_count || 0, max: 50, color: color })
    );
  }

  // ── Main Page ─────────────────────────────────────────────────────────────

  function MemoryPalace() {
    var _useState = useState({ loading: true, stats: null, skills: null, timeline: null, constellation: null, error: null, activeTab: "overview" }),
      data = _useState[0], setData = _useState[1];

    useEffect(function () {
      Promise.all([
        SDK.fetchJSON("/api/plugins/memory-palace/stats"),
        SDK.fetchJSON("/api/plugins/memory-palace/skills"),
        SDK.fetchJSON("/api/plugins/memory-palace/timeline"),
        SDK.fetchJSON("/api/plugins/memory-palace/constellation"),
      ])
        .then(function (_ref5) {
          var stats = _ref5[0], skills = _ref5[1], timeline = _ref5[2], constellation = _ref5[3];
          setData({ loading: false, stats: stats, skills: skills, timeline: timeline, constellation: constellation, activeTab: "overview", error: null });
        })
        .catch(function (err) {
          setData({ loading: false, stats: null, skills: null, timeline: null, constellation: null, activeTab: "overview", error: String(err) || "Failed to load data" });
        });
    }, []);

    if (data.loading) {
      return React.createElement(Card, null,
        React.createElement(CardContent, { style: { padding: 32, textAlign: "center" } },
          React.createElement("div", { style: { fontSize: 24, marginBottom: 8 } }, "🏛️"),
          React.createElement("p", { className: "text-sm text-muted-foreground" }, "Mapping your agent's mind…")
        )
      );
    }

    if (data.error) {
      return React.createElement(Card, null,
        React.createElement(CardContent, { style: { padding: 32, textAlign: "center" } },
          React.createElement("p", { style: { color: "#ef5350" } }, "Error: " + data.error),
          React.createElement("p", { className: "text-sm text-muted-foreground", style: { marginTop: 8 } },
            "Make sure Hermes is running and has an active session history."
          )
        )
      );
    }

    var stats = data.stats || {};
    var skills = data.skills || {};
    var timeline = data.timeline || {};
    var constellation = data.constellation || {};

    var tabs = [
      { id: "overview", label: "Overview" },
      { id: "skills", label: "Skills" },
      { id: "constellation", label: "Constellation" },
    ];

    return React.createElement("div", { style: { padding: "0 0 32px" } },

      // Header
      React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 } },
        React.createElement("div", null,
          React.createElement("h2", { style: { fontSize: 18, fontWeight: 700, marginBottom: 2 } }, "🏛️ Memory Palace"),
          React.createElement("p", { className: "text-sm text-muted-foreground" },
            "Your agent's compounding intelligence"
          )
        ),
        React.createElement(Badge, { style: { background: "#4dd0e1/20", color: "#4dd0e1", border: "1px solid #4dd0e1/30", fontSize: 11 } },
          stats.total_sessions + " sessions"
        )
      ),

      // Tabs
      React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--color-border)", paddingBottom: 0 } },
        tabs.map(function (tab) {
          var isActive = data.activeTab === tab.id;
          return React.createElement("button", {
            key: tab.id,
            onClick: function () { return setData(function (d) { return Object.assign({}, d, { activeTab: tab.id }); }); },
            style: {
              padding: "6px 14px", background: "none", border: "none", borderBottom: isActive ? "2px solid #4dd0e1" : "2px solid transparent",
              color: isActive ? "#4dd0e1" : "var(--color-muted-foreground)", cursor: "pointer", fontSize: 13, fontWeight: isActive ? 600 : 400,
              marginBottom: -1, transition: "all 0.15s",
            }
          }, tab.label);
        })
      ),

      // ── Overview Tab ────────────────────────────────────────────────────
      data.activeTab === "overview" && React.createElement("div", null,

        // Compounding Hero
        React.createElement(Card, { style: { marginBottom: 16, background: "linear-gradient(135deg, #0a1628 0%, #1a2744 100%)" } },
          React.createElement(CardContent, { style: { padding: 20 } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
              React.createElement("div", { style: { fontSize: 40 } }, "⚡"),
              React.createElement("div", { flex: 1 },
                React.createElement("div", { style: { fontSize: 32, fontWeight: 800, color: "#4dd0e1", lineHeight: 1 } },
                  stats.compounding_multiplier && stats.compounding_multiplier > 1
                    ? stats.compounding_multiplier + "×"
                    : "1.0×",
                  " capable"
                ),
                React.createElement("p", { className: "text-sm", style: { color: "#aaa", marginTop: 4 } },
                  "vs. your first sessions — skill reuse and memory compounding"
                )
              )
            ),
            React.createElement(Separator, { style: { margin: "14px 0" } }),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 } },
              [
                { label: "Sessions", value: stats.total_sessions || 0, icon: "💬" },
                { label: "Skills", value: stats.total_skills || 0, icon: "🧠" },
                { label: "Tools Used", value: stats.total_tools || 0, icon: "🔧" },
                { label: "Top Tool", value: (stats.top_tools || [])[0] ? (stats.top_tools || [])[0].name : "—", icon: "⭐" },
              ].map(function (s) {
                return React.createElement("div", { key: s.label, style: { textAlign: "center" } },
                  React.createElement("div", { style: { fontSize: 20 } }, s.icon),
                  React.createElement("div", { style: { fontSize: 22, fontWeight: 700 } }, s.value),
                  React.createElement("div", { className: "text-xs text-muted-foreground" }, s.label)
                );
              })
            )
          )
        ),

        // Timeline
        React.createElement(Card, { style: { marginBottom: 16 } },
          React.createElement(CardHeader, null,
            React.createElement(CardTitle, null, "📈 Learning Timeline"),
            React.createElement("p", { className: "text-xs text-muted-foreground", style: { marginTop: 2 } }, "Monthly session activity and tool usage")
          ),
          React.createElement(CardContent, null,
            React.createElement("div", { style: { display: "flex", gap: 3, alignItems: "flex-end", marginBottom: 8 } },
              React.createElement("div", { style: { fontSize: 10, color: "#6366f1" } }, "■ Sessions"),
              React.createElement("div", { style: { fontSize: 10, color: "#4dd0e1", marginLeft: 8 } }, "■ Tool calls")
            ),
            React.createElement(TimelineChart, { milestones: timeline.milestones || [] })
          )
        ),

        // Tool call trend
        (stats.tool_call_trend || []).length > 0 && React.createElement(Card, { style: { marginBottom: 16 } },
          React.createElement(CardHeader, null,
            React.createElement(CardTitle, null, "⚙️ Tool Efficiency Trend"),
            React.createElement("p", { className: "text-xs text-muted-foreground", style: { marginTop: 2 } }, "Average tool calls per session, per month")
          ),
          React.createElement(CardContent, null,
            React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "flex-end" } },
              (stats.tool_call_trend || []).map(function (t) {
                var maxAvg = Math.max.apply(Math, (stats.tool_call_trend || []).map(function (x) { return x.avg_tools; })) || 1;
                var h = Math.round((t.avg_tools / maxAvg) * 60) + 4;
                return React.createElement("div", { key: t.month, style: { flex: 1, textAlign: "center" } },
                  React.createElement("div", { style: { fontSize: 10, color: "#888", marginBottom: 2 } }, t.avg_tools),
                  React.createElement("div", { style: { height: h, background: "#4dd0e1", borderRadius: 2, opacity: 0.8 } }),
                  React.createElement("div", { style: { fontSize: 9, color: "#666", marginTop: 2 } }, t.month.slice(5))
                );
              })
            )
          )
        ),

        // Top tools
        (stats.top_tools || []).length > 0 && React.createElement(Card, null,
          React.createElement(CardHeader, null, React.createElement(CardTitle, null, "🔧 Top Tools")),
          React.createElement(CardContent, null,
            (stats.top_tools || []).map(function (t) {
              var maxCnt = ((stats.top_tools || [])[0] || {}).count || 1;
              return React.createElement("div", { key: t.name, style: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--color-border)" } },
                React.createElement("div", { style: { flex: 1, fontSize: 13 } }, t.name),
                React.createElement("div", { style: { fontSize: 12, color: "#888", minWidth: 36, textAlign: "right" } }, t.count),
                React.createElement("div", { style: { width: 80 } }, React.createElement(MiniBar, { value: t.count, max: maxCnt, color: "#4dd0e1" }))
              );
            })
          )
        )
      ),

      // ── Skills Tab ──────────────────────────────────────────────────────
      data.activeTab === "skills" && React.createElement("div", null,

        // Stats row
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 } },
          [
            { label: "Total Skills", value: skills.total_skills || 0, color: "#4dd0e1" },
            { label: "Dead Skills", value: skills.dead_count || 0, color: "#ef5350" },
            { label: "Latent Skills", value: skills.latent_count || 0, color: "#ffa726" },
          ].map(function (s) {
            return React.createElement(Card, { key: s.label },
              React.createElement(CardContent, { style: { padding: 14, textAlign: "center" } },
                React.createElement("div", { style: { fontSize: 24, fontWeight: 800, color: s.color } }, s.value),
                React.createElement("div", { className: "text-xs text-muted-foreground" }, s.label)
              )
            );
          })
        ),

        // Most used
        (skills.most_used || []).length > 0 && React.createElement(Card, { style: { marginBottom: 16 } },
          React.createElement(CardHeader, null, React.createElement(CardTitle, null, "⭐ Most Used Skills")),
          React.createElement(CardContent, null,
            (skills.most_used || []).slice(0, 8).map(function (s) {
              var maxInv = ((skills.most_used || [])[0] || {}).invocations || 1;
              return React.createElement(SkillRow, { key: s.name, skill: Object.assign({}, s, { invocation_count: s.invocations }), type: "used" });
            })
          )
        ),

        // Dead skills
        (skills.dead_skills || []).length > 0 && React.createElement(Card, { style: { marginBottom: 16 } },
          React.createElement(CardHeader, null,
            React.createElement(CardTitle, null, "⚰️ Dead Skills — Never Invoked"),
            React.createElement("p", { className: "text-xs text-muted-foreground", style: { marginTop: 2 } },
              (skills.dead_skills || []).length + " skills created but never used. Consider archiving them."
            )
          ),
          React.createElement(CardContent, null,
            (skills.dead_skills || []).slice(0, 10).map(function (s) {
              return React.createElement(SkillRow, { key: s.name, skill: s, type: "dead" });
            })
          )
        ),

        // Latent skills
        (skills.latent_skills || []).length > 0 && React.createElement(Card, null,
          React.createElement(CardHeader, null,
            React.createElement(CardTitle, null, "💤 Latent Skills — Not Used Lately"),
            React.createElement("p", { className: "text-xs text-muted-foreground", style: { marginTop: 2 } },
              (skills.latent_skills || []).length + " skills not used in 30+ days. Consider reviving or archiving."
            )
          ),
          React.createElement(CardContent, null,
            (skills.latent_skills || []).slice(0, 10).map(function (s) {
              return React.createElement(SkillRow, { key: s.name, skill: s, type: "latent" });
            })
          )
        )
      ),

      // ── Constellation Tab ──────────────────────────────────────────────
      data.activeTab === "constellation" && React.createElement("div", null,
        React.createElement(Card, { style: { marginBottom: 16 } },
          React.createElement(CardHeader, null,
            React.createElement(CardTitle, null, "🪐 Skill Constellation"),
            React.createElement("p", { className: "text-xs text-muted-foreground", style: { marginTop: 2 } },
              "Tools used together in the same session — size = frequency, lines = co-occurrence"
            )
          ),
          React.createElement(CardContent, null,
            (constellation.nodes || []).length > 0
              ? React.createElement(Constellation, { nodes: constellation.nodes || [], edges: constellation.edges || [] })
              : React.createElement("p", { className: "text-sm text-muted-foreground" }, "Not enough data yet. Keep using Hermes!")
          )
        ),

        React.createElement(Card, null,
          React.createElement(CardHeader, null, React.createElement(CardTitle, null, "📊 Connection Stats")),
          React.createElement(CardContent, null,
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 } },
              React.createElement("div", null,
                React.createElement("div", { className: "text-sm text-muted-foreground", style: { marginBottom: 8 } }, "Node count"),
                React.createElement("div", { style: { fontSize: 24, fontWeight: 700, color: "#4dd0e1" } }, (constellation.nodes || []).length)
              ),
              React.createElement("div", null,
                React.createElement("div", { className: "text-sm text-muted-foreground", style: { marginBottom: 8 } }, "Connections"),
                React.createElement("div", { style: { fontSize: 24, fontWeight: 700, color: "#6366f1" } }, (constellation.edges || []).length)
              )
            )
          )
        )
      )
    );
  }

  window.__HERMES_PLUGINS__.register("memory-palace", MemoryPalace);
})();

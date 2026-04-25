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

  // Deterministic seeded RNG (LCG) — constellation layout is stable across renders
  function createRng(seed) { var s = seed; return function rng() { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  function hashCode(str) { var h = 0; for (var i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return Math.abs(h); }

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
    var rng = createRng(hashCode(nodes.map(function (n) { return n.id; }).join(",")));
    var nodeMap = {};
    nodes.forEach(function (n) {
      var angle = rng() * 2 * Math.PI;
      var r = 80 + rng() * 80;
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

  // ── Time-Folded Constellation ────────────────────────────────────────────

  function TimeFoldedConstellation(_ref6) {
    var nodes = _ref6.nodes, edges = _ref6.edges;
    if (!nodes || nodes.length === 0) {
      return React.createElement("div", { style: { padding: 32, textAlign: "center" } },
        React.createElement("p", { className: "text-sm text-muted-foreground" }, "No data yet.")
      );
    }

    var svgW = 600, svgH = 320;
    var nodeMap = {};
    var seed = 42;
    var rng = createRng(seed);

    // Place nodes in a circle (stable layout)
    nodes.forEach(function (n, i) {
      var angle = (i / nodes.length) * 2 * Math.PI;
      var r = svgH / 2 - 50;
      nodeMap[n.id] = {
        x: svgW / 2 + r * Math.cos(angle) + (rng() - 0.5) * 40,
        y: svgH / 2 + r * Math.sin(angle) + (rng() - 0.5) * 40,
        vx: 0, vy: 0,
      };
    });

    // Simple force step (80 iterations)
    for (var step = 0; step < 80; step++) {
      nodes.forEach(function (n) {
        var p = nodeMap[n.id];
        var fx = 0, fy = 0;
        fx -= (p.x - svgW / 2) * 0.01;
        fy -= (p.y - svgH / 2) * 0.01;
        nodes.forEach(function (m) {
          if (n.id === m.id) return;
          var q = nodeMap[m.id];
          var dx = p.x - q.x, dy = p.y - q.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          fx += dx / dist * 2;
          fy += dy / dist * 2;
        });
        edges.forEach(function (e) {
          var a = null;
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

    var maxCount = Math.max.apply(Math, nodes.map(function (n) { return n.count; })) || 1;
    var radius = function (n) { return 6 + Math.round((n.count / maxCount) * 18); };

    var trendColor = function (trend) {
      if (trend === "new") return "#4dd0e1";
      if (trend === "growing") return "#4caf50";
      if (trend === "fading") return "#ffa726";
      return "#9e9e9e";
    };

    return React.createElement("div", null,
      React.createElement("div", { style: { display: "flex", gap: 16, marginBottom: 12, fontSize: 11, color: "#888" } },
        React.createElement("span", null, "Node size = total call count | Edge = co-occurrence in same session"),
        React.createElement("span", { style: { marginLeft: "auto" } },
          "30d: " + (nodes[0] ? nodes[0].layers["30d"] : 0) + " · 7d: " + (nodes[0] ? nodes[0].layers["7d"] : 0) + " · now: " + (nodes[0] ? nodes[0].layers["now"] : 0)
        )
      ),
      React.createElement("svg", { width: "100%", viewBox: "0 0 " + svgW + " " + svgH, style: { maxHeight: 340 } },
        // Edges
        React.createElement("g", { opacity: 0.25 },
          edges.map(function (e, i) {
            var s = nodeMap[e.source], t = nodeMap[e.target];
            if (!s || !t) return null;
            return React.createElement("line", { key: i, x1: s.x, y1: s.y, x2: t.x, y2: t.y, stroke: "#4dd0e1", strokeWidth: Math.max(0.5, Math.min(3, e.value)) });
          })
        ),
        // Nodes
        nodes.map(function (n) {
          var p = nodeMap[n.id];
          var r = radius(n);
          var color = trendColor(n.trend);
          var isDashed = n.trend === "fading";
          return React.createElement("g", { key: n.id, title: n.id + " (" + n.trend + ")" },
            React.createElement("circle", {
              cx: p.x, cy: p.y, r: r + 3,
              fill: "none", stroke: color, strokeWidth: isDashed ? 1.5 : 0,
              strokeDasharray: isDashed ? "4,3" : "none",
              opacity: 0.5
            }),
            React.createElement("circle", {
              cx: p.x, cy: p.y, r: r,
              fill: color, opacity: n.brightness * 0.85 + 0.15,
              style: n.trend === "new" ? { animation: "palace-pulse 2s infinite" } : {}
            }),
            React.createElement("title", null, n.id + " | " + n.trend + " | 30d:" + n.layers["30d"] + " 7d:" + n.layers["7d"] + " now:" + n.layers["now"]),
            r > 10 && React.createElement("text", { x: p.x, y: p.y + 4, textAnchor: "middle", fontSize: 7, fill: "#0a0a0a", style: { pointerEvents: "none" } },
              n.id.length > 10 ? n.id.slice(0, 8) + "…" : n.id
            )
          );
        })
      ),
      React.createElement("style", null, "@keyframes palace-pulse { 0%,100%{opacity:0.85} 50%{opacity:0.3} }")
    );
  }

  // ── Echo Map Flow ───────────────────────────────────────────────────────

  function EchoMapFlow(_ref7) {
    var nodes = _ref7.nodes, edges = _ref7.edges;
    if (!nodes || nodes.length === 0) {
      return React.createElement("div", { style: { padding: 32, textAlign: "center" } },
        React.createElement("p", { className: "text-sm text-muted-foreground" }, "No data yet.")
      );
    }

    var svgW = 600, svgH = 340;
    var nodeMap = {};
    var seed = 7;
    var rng = createRng(seed);

    // Place nodes using force simulation
    nodes.forEach(function (n, i) {
      var angle = (i / nodes.length) * 2 * Math.PI;
      var r = svgH / 2 - 60;
      nodeMap[n.id] = {
        x: svgW / 2 + r * Math.cos(angle) + (rng() - 0.5) * 60,
        y: svgH / 2 + r * Math.sin(angle) + (rng() - 0.5) * 60,
        vx: 0, vy: 0,
      };
    });

    // Force simulation
    for (var step = 0; step < 100; step++) {
      nodes.forEach(function (n) {
        var p = nodeMap[n.id];
        var fx = 0, fy = 0;
        // Center gravity
        fx -= (p.x - svgW / 2) * 0.008;
        fy -= (p.y - svgH / 2) * 0.008;
        // Repulsion between nodes
        nodes.forEach(function (m) {
          if (n.id === m.id) return;
          var q = nodeMap[m.id];
          var dx = p.x - q.x, dy = p.y - q.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          fx += dx / dist * 3;
          fy += dy / dist * 3;
        });
        // Edge attraction (stronger for directed flow)
        edges.forEach(function (e) {
          var s = null, t = null;
          if (e.source === n.id) { s = nodeMap[n.id]; t = nodeMap[e.target]; }
          if (e.target === n.id) { s = nodeMap[n.id]; t = nodeMap[e.source]; }
          if (!s || !t) return;
          var dx = t.x - s.x, dy = t.y - s.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          // Attract toward target direction (flow along direction)
          fx += dx / dist * 0.04 * (e.value || 1) * 0.1;
          fy += dy / dist * 0.04 * (e.value || 1) * 0.1;
        });
        p.vx += fx; p.vy += fy;
        p.vx *= 0.82; p.vy *= 0.82;
        p.x += p.vx; p.y += p.vy;
        p.x = Math.max(20, Math.min(svgW - 20, p.x));
        p.y = Math.max(20, Math.min(svgH - 20, p.y));
      });
    }

    var maxCount = Math.max.apply(Math, nodes.map(function (n) { return n.count; })) || 1;
    var radius = function (n) { return 5 + Math.round((n.count / maxCount) * 20); };

    var trendColor = function (trend) {
      if (trend === "new") return "#4dd0e1";
      if (trend === "growing") return "#4caf50";
      if (trend === "fading") return "#ffa726";
      return "#9e9e9e";
    };

    // Compute max edge value for width scaling
    var maxEdge = Math.max.apply(Math, edges.map(function (e) { return e.value; })) || 1;

    return React.createElement("div", null,
      React.createElement("div", { style: { display: "flex", gap: 16, marginBottom: 10, fontSize: 11, color: "#888" } },
        React.createElement("span", null, "\uD83C\uDF0A Echo Map: directed tool flow | river width = transition count"),
        React.createElement("span", { style: { marginLeft: "auto" } },
          "Top flow: " + (edges[0] ? edges[0].source + " \u2192 " + edges[0].target + " (" + edges[0].value + "x)" : "none")
        )
      ),
      React.createElement("svg", { width: "100%", viewBox: "0 0 " + svgW + " " + svgH, style: { maxHeight: 380 } },
        // Directed edges with arrow markers
        React.createElement("defs", null,
          edges.slice(0, 1).map(function (e, i) {
            return React.createElement("marker", {
              key: i,
              id: "arrowhead",
              markerWidth: 6, markerHeight: 6,
              refX: 6, refY: 3, orient: "auto",
            },
              React.createElement("polygon", { points: "0 0, 6 3, 0 6", fill: "#4dd0e1", opacity: 0.5 })
            );
          })
        ),
        // Edges
        React.createElement("g", { opacity: 0.35 },
          edges.map(function (e, i) {
            var s = nodeMap[e.source], t = nodeMap[e.target];
            if (!s || !t) return null;
            var dx = t.x - s.x, dy = t.y - s.y;
            var dist = Math.sqrt(dx * dx + dy * dy) || 1;
            var mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
            // Slight curve perpendicular to direction
            var perpX = -dy / dist * 8 * Math.log1p(e.value) * 0.05;
            var perpY = dx / dist * 8 * Math.log1p(e.value) * 0.05;
            var cpx = mx + perpX, cpy = my + perpY;
            var w = 0.5 + 3 * (e.value / maxEdge);
            return React.createElement("g", { key: i },
              React.createElement("path", {
                d: "M " + s.x + "," + s.y + " Q " + cpx + "," + cpy + " " + t.x + "," + t.y,
                fill: "none",
                stroke: "#4dd0e1",
                strokeWidth: w,
                opacity: 0.4 + 0.5 * (e.value / maxEdge),
                markerEnd: "url(#arrowhead)",
              }),
              e.value > 5 && React.createElement("text", {
                x: cpx, y: cpy - 4,
                textAnchor: "middle", fontSize: 7, fill: "#4dd0e1", opacity: 0.7,
              }, e.value)
            );
          })
        ),
        // Nodes
        nodes.map(function (n) {
          var p = nodeMap[n.id];
          var r = radius(n);
          var color = trendColor(n.trend);
          var isDashed = n.trend === "fading";
          // Compute total outflow
          var outflow = edges.filter(function (e) { return e.source === n.id; }).reduce(function (s, e) { return s + e.value; }, 0);
          return React.createElement("g", { key: n.id, title: n.id + " \u2192 " + n.trend },
            React.createElement("circle", {
              cx: p.x, cy: p.y, r: r + 4,
              fill: "none", stroke: color, strokeWidth: isDashed ? 1.5 : 0,
              strokeDasharray: isDashed ? "4,3" : "none",
              opacity: 0.35
            }),
            React.createElement("circle", {
              cx: p.x, cy: p.y, r: r,
              fill: color, opacity: n.brightness * 0.8 + 0.2,
              style: n.trend === "new" ? { animation: "palace-pulse 2s infinite" } : {}
            }),
            React.createElement("title", null, n.id + " | outflow:" + outflow + " | " + n.trend),
            r > 9 && React.createElement("text", {
              x: p.x, y: p.y + 3,
              textAnchor: "middle", fontSize: 6.5, fill: "#0a0a0a", style: { pointerEvents: "none" }
            }, n.id.length > 9 ? n.id.slice(0, 7) + "\u2026" : n.id)
          );
        })
      ),
      React.createElement("style", null, "@keyframes palace-pulse { 0%,100%{opacity:0.85} 50%{opacity:0.3} }")
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

  // ── Timeline Tab ───────────────────────────────────────────────────────

  function TimelineTab(_ref5) {
    var timeline = _ref5.timeline;
    var milestones = timeline.milestones || [];
    var events = timeline.events || [];

    var _useState2 = useState({}),
      expandedMonths = _useState2[0],
      setExpandedMonths = _useState2[1];
    var _useState3 = useState({}),
      sessionData = _useState3[0],
      setSessionData = _useState3[1];
    var _useState4 = useState({}),
      sessionLoading = _useState4[0],
      setSessionLoading = _useState4[1];

    if (milestones.length === 0) {
      return React.createElement(Card, null,
        React.createElement(CardContent, { style: { padding: 32, textAlign: "center" } },
          React.createElement("p", { className: "text-sm text-muted-foreground" }, "No timeline data yet. Sessions will appear here as you work.")
        )
      );
    }

    // Build event lookup: month → events
    var eventsByMonth = {};
    events.forEach(function (e) {
      if (!eventsByMonth[e.month]) eventsByMonth[e.month] = [];
      eventsByMonth[e.month].push(e);
    });

    var iconMap = { Sparkles: "✨", Zap: "⚡", default: "📌" };
    var getIcon = function (icon) { return iconMap[icon] || iconMap.default; };

    function toggleMonth(month) {
      var isExpanded = expandedMonths[month];
      setExpandedMonths(function (prev) {
        var next = Object.assign({}, prev);
        next[month] = !isExpanded;
        return next;
      });
      if (!isExpanded && !sessionData[month]) {
        setSessionLoading(function (prev) { return Object.assign({}, prev, { [month]: true }); });
        SDK.fetchJSON("/api/plugins/memory-palace/sessions?month=" + month)
          .then(function (res) {
            setSessionData(function (prev) { return Object.assign({}, prev, { [month]: res.sessions }); });
            setSessionLoading(function (prev) { return Object.assign({}, prev, { [month]: false }); });
          })
          .catch(function () {
            setSessionLoading(function (prev) { return Object.assign({}, prev, { [month]: false }); });
          });
      }
    }

    function fmtDuration(started_at, ended_at) {
      if (!ended_at || !started_at) return "—";
      var mins = Math.round((ended_at - started_at) / 60);
      if (mins < 60) return mins + "m";
      return Math.round(mins / 60) + "h " + (mins % 60) + "m";
    }

    var totalCost = milestones.reduce(function (s, m) { return s + (m.cost_usd || 0); }, 0);
    var totalTools = milestones.reduce(function (s, m) { return s + m.tools; }, 0);
    var totalTokens = milestones.reduce(function (s, m) { return s + m.tokens; }, 0);
    var totalSessions = milestones.reduce(function (s, m) { return s + m.sessions; }, 0);
    var maxSessions = Math.max.apply(Math, milestones.map(function (x) { return x.sessions; })) || 1;

    return React.createElement("div", null,

      // Summary bar
      React.createElement(Card, { style: { marginBottom: 16, background: "linear-gradient(135deg, #0d1f1a 0%, #1a2e24 100%)" } },
        React.createElement(CardContent, { style: { padding: 16 } },
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, textAlign: "center" } },
            [
              { label: "Months Active", value: milestones.length, icon: "📅" },
              { label: "Total Sessions", value: totalSessions, icon: "💬" },
              { label: "Tool Calls", value: totalTools, icon: "🔧" },
              { label: "Total Cost", value: fmtCost(totalCost), icon: "💰" },
            ].map(function (s) {
              return React.createElement("div", { key: s.label },
                React.createElement("div", { style: { fontSize: 18 } }, s.icon),
                React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "#4dd0e1" } }, s.value),
                React.createElement("div", { className: "text-xs text-muted-foreground" }, s.label)
              );
            })
          )
        )
      ),

      // Month list
      milestones.slice().reverse().map(function (m) {
        var monthEvents = eventsByMonth[m.month] || [];
        var isExpanded = expandedMonths[m.month];
        var isTopMonth = m.sessions === maxSessions;
        var sessions = sessionData[m.month] || [];
        var isLoading = sessionLoading[m.month];

        return React.createElement("div", { key: m.month, style: { position: "relative", marginBottom: 0 } },

          // Connector line
          React.createElement("div", { style: { position: "absolute", left: 19, top: 36, bottom: 0, width: 1, background: "var(--color-border)" } }),

          // Month header row (clickable to expand)
          React.createElement(Card, {
            style: {
              marginBottom: 6,
              borderLeft: isTopMonth ? "3px solid #4dd0e1" : "3px solid var(--color-border)",
              cursor: "pointer",
            },
            onClick: function () { return toggleMonth(m.month); }
          },
            React.createElement(CardContent, { style: { padding: "12px 16px" } },
              React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
                React.createElement("div", { style: { width: 40, height: 40, borderRadius: "50%", background: isTopMonth ? "#4dd0e1/20" : "var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, fontWeight: 600, color: isTopMonth ? "#4dd0e1" : "var(--color-muted-foreground)" } },
                  m.month.slice(5) || m.month
                ),
                React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                  React.createElement("div", { style: { fontSize: 14, fontWeight: 600 } }, m.month, isTopMonth && React.createElement("span", { style: { fontSize: 10, marginLeft: 6, color: "#4dd0e1" } }, "★ peak")),
                  React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } },
                    m.sessions + " sessions · " + m.tools + " tools · " + m.tokens.toLocaleString() + " tokens"
                  )
                ),
                React.createElement("div", { style: { display: "flex", gap: 6, flexShrink: 0, alignItems: "center" } },
                  React.createElement(Badge, { style: { background: "#6366f1/20", color: "#6366f1", fontSize: 10 } }, m.sessions + " sessions"),
                  m.cost_usd > 0 && React.createElement(Badge, { style: { background: "#4dd0e1/20", color: "#4dd0e1", fontSize: 10 } }, fmtCost(m.cost_usd)),
                  React.createElement("span", { style: { fontSize: 12, color: "#666", marginLeft: 4 } }, isExpanded ? "▲" : "▼")
                )
              )
            )
          ),

          // Expanded: events + sessions
          isExpanded && React.createElement("div", { style: { marginLeft: 48, marginBottom: 8 } },

            // Events
            monthEvents.length > 0 && React.createElement("div", { style: { marginBottom: 8 } },
              monthEvents.map(function (e, i) {
                return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "var(--color-card)", borderRadius: 6, marginBottom: 4, border: "1px solid var(--color-border)" } },
                  React.createElement("span", { style: { fontSize: 14 } }, getIcon(e.icon)),
                  React.createElement("span", { style: { fontSize: 12, color: "var(--color-muted-foreground)" } }, e.description)
                );
              })
            ),

            // Session rows
            isLoading
              ? React.createElement("div", { style: { padding: "8px 12px", fontSize: 12, color: "#888" } }, "Loading sessions…")
              : sessions.length > 0
                ? React.createElement("div", null,
                    React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" } }, "Sessions"),
                    sessions.map(function (s, i) {
                      return React.createElement("div", { key: s.id || i, style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--color-card)", borderRadius: 6, marginBottom: 3, border: "1px solid var(--color-border)", fontSize: 12 } },
                        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                          React.createElement("div", { style: { fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.title || "Untitled"),
                          React.createElement("div", { style: { color: "#666", fontSize: 11 } },
                            (s.model || "—") + " · " + (s.message_count || 0) + " msgs · " + fmtDuration(s.started_at, s.ended_at)
                          )
                        ),
                        React.createElement(Badge, { style: { background: "#4dd0e1/15", color: "#4dd0e1", fontSize: 10 } }, (s.tool_call_count || 0) + " tools"),
                        s.estimated_cost_usd > 0 && React.createElement(Badge, { style: { background: "#6366f1/15", color: "#6366f1", fontSize: 10 } }, fmtCost(s.estimated_cost_usd))
                      );
                    })
                  )
                : null
          )
        );
      })
    );
  }

  // ── Main Page ─────────────────────────────────────────────────────────────

  function MemoryPalace() {
    var _useState = useState({ loading: true, stats: null, skills: null, timeline: null, constellation: null, palaceOverlay: null, echoMap: null, error: null, activeTab: "overview" }),
      data = _useState[0], setData = _useState[1];

    useEffect(function () {
      Promise.all([
        SDK.fetchJSON("/api/plugins/memory-palace/stats"),
        SDK.fetchJSON("/api/plugins/memory-palace/skills"),
        SDK.fetchJSON("/api/plugins/memory-palace/timeline"),
        SDK.fetchJSON("/api/plugins/memory-palace/constellation"),
        SDK.fetchJSON("/api/plugins/memory-palace/palace-overlay"),
        SDK.fetchJSON("/api/plugins/memory-palace/echo-map"),
      ])
        .then(function (_ref5) {
          var stats = _ref5[0], skills = _ref5[1], timeline = _ref5[2], constellation = _ref5[3], palaceOverlay = _ref5[4], echoMap = _ref5[5];
          setData({ loading: false, stats: stats, skills: skills, timeline: timeline, constellation: constellation, palaceOverlay: palaceOverlay, echoMap: echoMap, activeTab: "overview", error: null });
        })
        .catch(function (err) {
          setData({ loading: false, stats: null, skills: null, timeline: null, constellation: null, palaceOverlay: null, echoMap: null, activeTab: "overview", error: String(err) || "Failed to load data" });
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
    var palaceOverlay = data.palaceOverlay || {};
    var echoMap = data.echoMap || {};

    var tabs = [
      { id: "overview", label: "Overview" },
      { id: "skills", label: "Skills" },
      { id: "timeline", label: "Timeline" },
      { id: "constellation", label: "Constellation" },
      { id: "echo", label: "🌊 Echo" },
      { id: "palace", label: "🏛️ Palace" },
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

        // Chronicle of the Palace
        React.createElement(ChronicleMode, null),

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

      // ── Palace Tab (Time-Folding Overlay) ─────────────────────────────
      data.activeTab === "palace" && React.createElement("div", null,

        // Summary row
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 } },
          [
            { label: "New Rooms", value: palaceOverlay.summary ? palaceOverlay.summary.new_rooms : 0, color: "#4dd0e1" },
            { label: "Growing", value: palaceOverlay.summary ? palaceOverlay.summary.growing : 0, color: "#4caf50" },
            { label: "Fading", value: palaceOverlay.summary ? palaceOverlay.summary.fading : 0, color: "#ffa726" },
            { label: "Stable", value: palaceOverlay.summary ? palaceOverlay.summary.stable : 0, color: "#9e9e9e" },
          ].map(function (s) {
            return React.createElement(Card, { key: s.label },
              React.createElement(CardContent, { style: { padding: 14, textAlign: "center" } },
                React.createElement("div", { style: { fontSize: 28, fontWeight: 800, color: s.color } }, s.value),
                React.createElement("div", { className: "text-xs text-muted-foreground" }, s.label)
              )
            );
          })
        ),

        // Legend
        React.createElement(Card, { style: { marginBottom: 16 } },
          React.createElement(CardContent, { style: { padding: "12px 16px" } },
            React.createElement("div", { style: { display: "flex", gap: 20, fontSize: 12, flexWrap: "wrap" } },
              [
                { label: "🆕 New rooms", color: "#4dd0e1", style: "pulse" },
                { label: "📈 Growing", color: "#4caf50", style: "solid" },
                { label: "📉 Fading", color: "#ffa726", style: "dashed" },
                { label: "⚪ Stable", color: "#9e9e9e", style: "solid" },
              ].map(function (l) {
                return React.createElement("div", { key: l.label, style: { display: "flex", alignItems: "center", gap: 6 } },
                  React.createElement("div", { style: { width: 10, height: 10, borderRadius: "50%", background: l.color } }),
                  React.createElement("span", { style: { color: "#888" } }, l.label)
                );
              })
            )
          )
        ),

        // Time-folding constellation
        palaceOverlay.nodes && palaceOverlay.nodes.length > 0 &&
          React.createElement(Card, null,
            React.createElement(CardHeader, null,
              React.createElement(CardTitle, null, "⏱️ Time-Folded Constellation"),
              React.createElement("p", { className: "text-xs text-muted-foreground", style: { marginTop: 2 } },
                "Three agent timelines overlaid: brightness = current power"
              )
            ),
            React.createElement(CardContent, null,
              React.createElement(TimeFoldedConstellation, { nodes: palaceOverlay.nodes, edges: palaceOverlay.edges })
            )
          ),

        !palaceOverlay.nodes &&
          React.createElement(Card, null,
            React.createElement(CardContent, { style: { padding: 32, textAlign: "center" } },
              React.createElement("p", { className: "text-sm text-muted-foreground" }, "Not enough data to build palace overlay yet.")
            )
          )
      ),

      // ── Echo Tab (Tool Chain Flow) ────────────────────────────────────
      data.activeTab === "echo" && React.createElement("div", null,

        echoMap.nodes && echoMap.nodes.length > 0 &&
          React.createElement(Card, null,
            React.createElement(CardHeader, null,
              React.createElement(CardTitle, null, "🌊 Echo Map — Tool Chain Flow"),
              React.createElement("p", { className: "text-xs text-muted-foreground", style: { marginTop: 2 } },
                "Directed rivers showing A\u2192B tool transitions within sessions — width = frequency"
              )
            ),
            React.createElement(CardContent, null,
              React.createElement(EchoMapFlow, { nodes: echoMap.nodes, edges: echoMap.edges })
            )
          ),

        (!echoMap.nodes || echoMap.nodes.length === 0) &&
          React.createElement(Card, null,
            React.createElement(CardContent, { style: { padding: 32, textAlign: "center" } },
              React.createElement("p", { className: "text-sm text-muted-foreground" }, "No echo data yet — keep using your agent!")
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

      // ── Timeline Tab ──────────────────────────────────────────────────────
      data.activeTab === "timeline" && React.createElement(TimelineTab, { timeline: timeline }),

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

  // ── ChronicleMode: Ancient Scroll Chapters ─────────────────────────

  function ChronicleMode() {
    var _useState2 = useState({ loading: true, data: null, error: null, expanded: false });
    var state = _useState2[0], setState = _useState2[1];

    useEffect(function () {
      SDK.fetchJSON("/api/plugins/memory-palace/chronicle?limit=15")
        .then(function (d) { return setState({ loading: false, data: d, error: null }); })
        .catch(function (e) { return setState({ loading: false, data: null, error: String(e) }); });
    }, []);

    if (state.loading) {
      return React.createElement(Card, { style: { marginBottom: 16, border: "1px solid rgba(217, 170, 110, 0.25)", background: "linear-gradient(180deg, rgba(40, 30, 15, 0.6) 0%, rgba(25, 18, 8, 0.95) 100%)" } },
        React.createElement(CardContent, { style: { padding: 24, textAlign: "center" } },
          React.createElement("div", { style: { fontSize: 24, marginBottom: 8 } }, "📜"),
          React.createElement("div", { style: { color: "#d9a96e", fontSize: 12, fontStyle: "italic" } }, "Unrolling the ancient scrolls...")
        )
      );
    }

    if (state.error) {
      return React.createElement(Card, { style: { marginBottom: 16 } },
        React.createElement(CardContent, { style: { padding: 16, textAlign: "center", color: "rgba(255,255,255,0.4)" } },
          "Chronicles lost to time: " + state.error
        )
      );
    }

    var data = state.data || {};
    var chronicles = data.chronicles || [];

    if (chronicles.length === 0) {
      return React.createElement(Card, { style: { marginBottom: 16, border: "1px solid rgba(217, 170, 110, 0.25)" } },
        React.createElement(CardContent, { style: { padding: 24, textAlign: "center" } },
          React.createElement("div", { style: { fontSize: 20, marginBottom: 8 } }, "📜"),
          React.createElement("div", { style: { color: "rgba(255,255,255,0.4)", fontStyle: "italic" } }, "No chapters written yet")
        )
      );
    }

    var sepia = "#d4a574";
    var sepiaLight = "#e8c9a0";
    var typeColors = {
      quiet_contemplation: "rgba(100, 120, 140, 0.6)",
      brief_encounter: "rgba(120, 160, 120, 0.6)",
      journey: "rgba(180, 160, 100, 0.6)",
      epic: "rgba(180, 130, 60, 0.6)",
      legendary: "rgba(200, 160, 50, 0.7)",
    };

    var firstChapter = chronicles[0] || null;
    var restChapters = chronicles.slice(1);

    return React.createElement(Card, {
      style: {
        marginBottom: 16,
        border: "1px solid rgba(217, 170, 110, 0.3)",
        background: "linear-gradient(180deg, rgba(45, 32, 15, 0.7) 0%, rgba(30, 20, 8, 0.95) 100%)",
        boxShadow: "inset 0 0 60px rgba(139, 105, 20, 0.1), 0 4px 20px rgba(0,0,0,0.4)",
      }
    },
      React.createElement("div", { style: { padding: "12px 16px 8px", borderBottom: "1px solid rgba(217, 170, 110, 0.15)" } },
        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            React.createElement("span", { style: { fontSize: 20 } }, "📜"),
            React.createElement("div", null,
              React.createElement("div", { style: { fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", color: sepiaLight, textTransform: "uppercase" } }, "Chronicle of the Palace"),
              React.createElement("div", { style: { fontSize: 10, color: "rgba(217, 170, 110, 0.6)" } },
                (data.era_start || "?") + " \u2192 " + (data.era_end || "?") + " \u2022 " + (data.total_chapters || chronicles.length) + " chapters"
              )
            )
          ),
          restChapters.length > 0 && React.createElement("button", {
            onClick: function () { return setState(function (s) { return Object.assign({}, s, { expanded: !s.expanded }); }); },
            style: {
              padding: "4px 10px",
              background: "rgba(217, 170, 110, 0.1)",
              border: "1px solid rgba(217, 170, 110, 0.25)",
              borderRadius: 6,
              color: sepiaLight,
              fontSize: 10,
              cursor: "pointer",
            }
          }, state.expanded ? "\u25B2 Hide" : "\u25BC " + restChapters.length + " more")
        )
      ),
      React.createElement(CardContent, { style: { padding: "8px 16px 16px" } },
        React.createElement("div", { style: { textAlign: "center", marginBottom: 12, color: sepia, opacity: 0.5, fontSize: 10, letterSpacing: "0.3em" } },
          "\u2736 \u2736 \u2736"
        ),
        firstChapter && React.createElement("div", {
          style: {
            position: "relative",
            padding: "10px 12px",
            marginBottom: 0,
            background: "linear-gradient(135deg, rgba(217, 170, 110, 0.12) 0%, rgba(217, 170, 110, 0.04) 100%)",
            borderRadius: 6,
            border: "1px solid rgba(217, 170, 110, 0.3)",
            boxShadow: "0 2px 12px rgba(217, 170, 110, 0.15)",
          }
        },
          React.createElement("div", {
            style: {
              position: "absolute",
              left: -8,
              top: "50%",
              transform: "translateY(-50%)",
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #8b6914 0%, #5a4510 100%)",
              border: "2px solid " + sepia,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 700,
              color: sepiaLight,
              boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
            }
          }, firstChapter.chapter),
          React.createElement("div", { style: { paddingLeft: 24 } },
            React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 } },
              React.createElement("div", { style: { flex: 1 } },
                React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: sepiaLight, lineHeight: 1.3, marginBottom: 2 } }, firstChapter.title),
                React.createElement("div", { style: { fontSize: 10, color: "rgba(217, 170, 110, 0.5)", fontStyle: "italic" } },
                  (firstChapter.date_display || "") + " \u2022 " + (firstChapter.epithet || "")
                )
              ),
              React.createElement("div", {
                style: {
                  padding: "2px 8px",
                  background: typeColors[firstChapter.chapter_type] || typeColors.journey,
                  borderRadius: 10,
                  fontSize: 9,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.9)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  whiteSpace: "nowrap",
                }
              }, firstChapter.chapter_type === "legendary" ? "\uD83C\uDFC6 " + firstChapter.chapter_type : firstChapter.chapter_type)
            ),
            React.createElement("div", {
              style: { display: "flex", gap: 12, marginTop: 6, fontSize: 10, color: "rgba(217, 170, 110, 0.55)" }
            },
              React.createElement("span", null, "\u2694\uFE0F " + (firstChapter.tool_calls || 0) + " tools"),
              React.createElement("span", null, "\u23F1 " + (firstChapter.duration_mins || 0) + "m"),
              firstChapter.tokens > 0 && React.createElement("span", null, "\uD83D\uDCDD " + fmtNum(firstChapter.tokens) + " tokens"),
              React.createElement("span", { style: { fontStyle: "italic" } }, firstChapter.model || "")
            )
          )
        ),
        !state.expanded && restChapters.length > 0 && React.createElement("div", {
          style: { textAlign: "center", padding: "8px", color: "rgba(217, 170, 110, 0.4)", fontSize: 10, fontStyle: "italic" }
        }, "... " + restChapters.length + " earlier chapters"),
        state.expanded && restChapters.map(function (c) {
          return React.createElement("div", {
            key: c.chapter,
            style: {
              position: "relative",
              padding: "10px 12px",
              marginTop: 8,
              background: "rgba(30, 20, 8, 0.4)",
              borderRadius: 6,
              border: "1px solid rgba(217, 170, 110, 0.1)",
            }
          },
            React.createElement("div", {
              style: {
                position: "absolute",
                left: -8,
                top: "50%",
                transform: "translateY(-50%)",
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #8b6914 0%, #5a4510 100%)",
                border: "2px solid " + sepia,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 700,
                color: sepiaLight,
                boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
              }
            }, c.chapter),
            React.createElement("div", { style: { paddingLeft: 24 } },
              React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 } },
                React.createElement("div", { style: { flex: 1 } },
                  React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: "rgba(232, 201, 160, 0.85)", lineHeight: 1.3, marginBottom: 2 } }, c.title),
                  React.createElement("div", { style: { fontSize: 10, color: "rgba(217, 170, 110, 0.5)", fontStyle: "italic" } },
                    (c.date_display || "") + " \u2022 " + (c.epithet || "")
                  )
                ),
                React.createElement("div", {
                  style: {
                    padding: "2px 8px",
                    background: typeColors[c.chapter_type] || typeColors.journey,
                    borderRadius: 10,
                    fontSize: 9,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.9)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    whiteSpace: "nowrap",
                  }
                }, c.chapter_type === "legendary" ? "\uD83C\uDFC6 " + c.chapter_type : c.chapter_type)
              ),
              React.createElement("div", {
                style: { display: "flex", gap: 12, marginTop: 6, fontSize: 10, color: "rgba(217, 170, 110, 0.55)" }
              },
                React.createElement("span", null, "\u2694\uFE0F " + (c.tool_calls || 0) + " tools"),
                React.createElement("span", null, "\u23F1 " + (c.duration_mins || 0) + "m"),
                c.tokens > 0 && React.createElement("span", null, "\uD83D\uDCDD " + fmtNum(c.tokens) + " tokens"),
                React.createElement("span", { style: { fontStyle: "italic" } }, c.model || "")
              )
            )
          );
        }),
        React.createElement("div", { style: { textAlign: "center", marginTop: 12, color: sepia, opacity: 0.4, fontSize: 10 } },
          "\u2736 \uD83D\uDCDC \u2736"
        )
      )
    );
  }

  window.__HERMES_PLUGINS__.register("memory-palace", MemoryPalace);
})();

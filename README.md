# Memory Palace

**Hermes Agent Dashboard Plugin** — Visualize your agent's compounding intelligence.

See your agent grow over time: skill accumulation, tool usage patterns, and capability milestones — all in a single dashboard tab.

## Features

### Overview Tab
- **Compounding Multiplier** — How many times more capable is your agent today vs. your first sessions
- **Learning Timeline** — Monthly session activity and tool call volume
- **Tool Efficiency Trend** — Average tool calls per session, month over month
- **Top Tools** — Your most-used tools ranked

### Skills Tab
- **Most Used Skills** — Ranked by invocation count
- **Dead Skills** — Created but never invoked (opportunity to prune)
- **Latent Skills** — Not used in 30+ days (consider reviving or archiving)

### Constellation Tab
- **Skill Constellation** — Force-directed graph of tool co-occurrence. Node size = call frequency. Lines = tools used together in the same session.

## Installation

```bash
# Copy plugin to Hermes
cp -r memory-palace ~/.hermes/plugins/

# Rescan plugins (no restart needed)
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan

# Open dashboard
hermes dashboard
```

Then navigate to the **Memory Palace** tab (appears after Skills).

## How It Works

Memory Palace reads from Hermes's local database (`~/.hermes/hermes.db`) and skill filesystem (`~/.hermes/skills/`) to build:

- Session history analysis (tool counts, token usage, timestamps)
- Skill inventory (creation dates, invocation counts, file sizes)
- Tool co-occurrence graph (which tools fire together)

All analysis runs locally — no data leaves your machine.

## Requirements

- Hermes Agent v0.10+ with active session history
- Dashboard plugin system enabled

## License

MIT

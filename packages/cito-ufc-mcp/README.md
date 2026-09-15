# cito-ufc-mcp

**Read-only MCP server for UFC and MMA fight data** — fighters, fight cards, bout and round statistics, rankings, betting odds and live fight-night state.

Purpose-built for **ChatGPT, Claude, Cursor, Cline, Windsurf** and any other MCP host. Nine focused tools, one sport.

```bash
npx cito-ufc-mcp
```

> **Free API key — 500 calls/month, no credit card:** <https://citoapi.com/signup/>

---

## Why a separate UFC server

Most sports MCP servers are broad: dozens of tools across many leagues. That makes tool selection ambiguous for the model and metadata review hard for the host.

This server is deliberately narrow — **nine read-only tools for one sport**, each with a precise description, a declared input schema, a declared output schema, and correct annotations. That design is easier for a model to use correctly and it satisfies host review requirements (see [Host review](#host-review-readiness)).

---

## Install

```bash
# Claude Code / CLI
claude mcp add cito-ufc -- npx -y cito-ufc-mcp
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cito-ufc": {
      "command": "npx",
      "args": ["-y", "cito-ufc-mcp"],
      "env": { "CITO_API_KEY": "your-key" }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`) and **Cline/Windsurf** use the same shape.

Set `CITO_API_KEY` in the environment. It is read at runtime and never hardcoded, logged, or returned in a response.

---

## Tools

| Tool | Answers |
|---|---|
| `ufc_search` | "Resolve *Makhachev* to a slug" |
| `ufc_fighter` | "Who is Islam Makhachev — record, reach, gym, country?" |
| `ufc_fighter_stats` | "What are his striking and grappling rates?" |
| `ufc_fighter_fights` | "Who did he last fight and what happened?" |
| `ufc_events` | "What's the next UFC card?" |
| `ufc_fight_card` | "What are the bouts on UFC 331?" |
| `ufc_rankings` | "Who is ranked #1 at lightweight?" |
| `ufc_odds` | "What are the odds on this fight?" |
| `ufc_live` | "What round is the current fight in?" |

### Suggested flow

```
ufc_search "Makhachev"
   └─> ufc_fighter islam-makhachev        (profile, record, physicals)
       └─> ufc_fighter_stats …            (career rates and splits)
       └─> ufc_fighter_fights …           (recent results)

ufc_events scope=upcoming
   └─> ufc_fight_card cryptocom-ufc-331   (full bout list, card order)
       └─> ufc_odds eventIdOrSlug=…       (markets by bookmaker)
       └─> ufc_live boutId=…              (in-round state while it's live)
```

---

## Example conversations

> **"Who is fighting on the next UFC card and what are the odds?"**

The model calls `ufc_events scope=upcoming`, takes the first slug, calls `ufc_fight_card`, then `ufc_odds` for that card. It gets both corners, weight class, title-bout flag, and any markets that exist.

> **"How does Makhachev's takedown defence compare to the division?"**

`ufc_search` → `ufc_fighter_stats` returns `takedownDefense` plus the strike breakdowns by target and position that most APIs don't expose.

> **"What round is the main event in right now?"**

`ufc_live boutId=…` returns the current round, clock, status and per-corner strike and takedown counts.

---

## Design guarantees

**Read-only.** No tool creates, updates or deletes anything — including the webhook endpoints the underlying API supports. Every tool advertises `readOnlyHint: true` and `destructiveHint: false`, and that is literally true of the code.

**Sanitized responses.** Every payload is filtered before it reaches the model. Internal scraper metadata, cache bookkeeping, validation blocks and live-worker diagnostics are stripped — field names like `scrapeMeta`, `cacheKey`, `dataAvailability`, `llmValidation` and `workerHostHint` never leave the process. What you get is fight data, not our plumbing.

**openWorldHint: true.** These tools reach a live public API.

**Honest errors.** A missing fighter returns a clean typed error with the upstream status, not a stack trace. Empty odds are reported as empty — a normal coverage state for third-party market data, not a failure.

---

## Host review readiness

For hosts that review submissions (OpenAI's plugin directory, Anthropic's connector directory), this server ships with:

| Requirement | Status |
|---|---|
| `readOnlyHint` / `openWorldHint` / `destructiveHint` on every tool | ✅ all 9 |
| Input schema on every tool | ✅ |
| Output schema on every tool | ✅ |
| Substantive tool descriptions | ✅ |
| No debug payloads, internal identifiers or secrets in responses | ✅ enforced in `client.ts` |
| Read-only surface (no destructive tools to mislabel) | ✅ |
| Public production HTTPS endpoint | ✅ `api.citoapi.com` |
| Deterministic, self-contained test cases | ✅ see `smoke.mjs` |

---

## Data coverage

| Data | Notes |
|---|---|
| Fighters | 3,300+ profiles with records, physicals, gym, country, headshot |
| Events | 800+ events back to UFC 1 (1993), plus Contender Series |
| Bouts | 9,000+ bouts with results, method, round, time |
| Round statistics | 41,000+ round rows: strikes by target and position, takedowns, control time |
| Rankings | Media panel and Meta boards, 12 divisions each |
| Odds | Moneyline and other markets, multi-bookmaker, where coverage exists |
| Live | In-round round, clock, strikes and takedowns over WebSocket/SSE |

**Not covered:** judges' scorecards, multi-promotion (PFL/BKFC/RIZIN), rankings history. We say so plainly rather than implying otherwise.

---

## Development

```bash
npm install
npm run build
node smoke.mjs        # end-to-end: handshake, tool metadata, live calls, sanitization
```

`smoke.mjs` reads `CITO_API_KEY` from the environment or a nearby `.env.local`.

---

## License

MIT. Independent client for the Cito API. Not affiliated with, endorsed by, or licensed by the UFC, Zuffa, TKO Group or any promotion. Odds data is third-party market data for research, media and display — not for betting settlement.

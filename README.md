# cito-ufc-kit

**Everything you need to build a UFC app in an afternoon.**

Official SDKs, runnable starter templates, an MCP server for AI agents, container recipes and datasets — all built on the [Cito UFC API](https://citoapi.com/ufc-api/), with a **free tier of 500 calls/month and no credit card**.

```bash
# Get a free key first: https://citoapi.com/signup/
export CITO_API_KEY="your-key"

git clone https://github.com/achillesscriptsvip/cito-ufc-kit
cd cito-ufc-kit/templates/live-fight-night
npm install && npm run dev
```

---

## What's in here

| Package | What it is |
|---|---|
| [`packages/cito-ufc-js`](./packages/cito-ufc-js) | Typed TypeScript SDK — ESM + CJS, zero deps |
| [`packages/cito-ufc-mcp`](./packages/cito-ufc-mcp) | Read-only MCP server for ChatGPT, Claude, Cursor, Cline |

| Template | What it builds |
|---|---|
| [`templates/live-fight-night`](./templates/live-fight-night) | Live fight-night dashboard over WebSocket — round clock, strikes, takedowns |
| [`templates/discord-bot`](./templates/discord-bot) | Posts the next card, then live updates, to a Discord webhook |

| Extra | What it is |
|---|---|
| [`docker`](./docker) | Dockerfile and compose recipe for a self-hosted demo |
| [`postman`](./postman) | Postman collection and environment |
| [`datasets`](./datasets) | Scripts that generate UFC round-stat and Contender Series prospect datasets |

---

## Quick look

```ts
import { UfcClient } from "cito-ufc";

const ufc = new UfcClient({ apiKey: process.env.CITO_API_KEY! });

const event = await ufc.nextEvent();
const card = await ufc.fightCard(event!.slug);

for (const bout of card) {
  const [red, blue] = bout.fighters ?? [];
  console.log(`${red?.fighterName} vs ${blue?.fighterName}`);
}
```

```python
from ufcapi import UFC

ufc = UFC()                      # reads CITO_API_KEY
print(ufc.next_event().title)
print(ufc.last_fight("islam-makhachev").summary)
# Islam Makhachev beat Ian Machado Garry (Decision - Unanimous R5 5:00)
```

```bash
# AI agents
npx cito-ufc-mcp
```

---

## Why this exists

Most sports data APIs give you a REST endpoint and wish you luck. This kit is the other half: the SDKs, the templates and the agent tooling so that the first thing you build actually works.

Three capabilities you won't find together anywhere else in MMA data:

- **Live WebSocket streaming** — in-round round, clock, strikes and takedowns pushed to you, not polled.
- **An MCP server** — so ChatGPT, Claude and Cursor can answer fight questions directly.
- **Betting odds alongside fight stats** — one key for the fight and the line.

---

## Getting a key

1. Go to **<https://citoapi.com/signup/>**
2. Get a key instantly — 500 calls/month, no credit card
3. `export CITO_API_KEY="..."`

The free tier covers every endpoint. Paid plans add volume, WebSockets and history depth.

---

## Using these templates commercially

Yes — that's the point. The SDKs are MIT. The templates are MIT. Build your product, ship it, charge for it.

Attribution is appreciated but not required; a link to <https://ufcapi.dev/> is always welcome.

---

## Data coverage

Fighters (3,300+ profiles), events (800+ back to UFC 1 in 1993), bouts (9,000+ with results), round statistics (41,000+ rows with strikes by target and position), rankings (media and meta boards, 12 divisions), odds (multi-bookmaker where coverage exists), and live in-round state.

**Not covered:** judges' scorecards, multi-promotion (PFL/BKFC/RIZIN), rankings history. We'd rather say so than imply otherwise.

---

## Contributing

Issues and PRs welcome. If a template is broken or a type is wrong, open an issue — real bug reports get fixed fast.

---

## License

MIT. This is an independent kit. Not affiliated with, endorsed by, or licensed by the UFC, Zuffa, TKO Group or any promotion. Odds data is third-party market data for research, media and display — not for betting settlement.

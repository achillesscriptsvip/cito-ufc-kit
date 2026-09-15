# UFC Discord bot

Post the next UFC card to your Discord server, then follow it live round by round.

Built on the [Cito UFC API](https://citoapi.com/ufc-api/). **No Discord library required** — Discord webhooks are plain HTTP POSTs, so this is one dependency (`cito-ufc`) and runs anywhere Node 18 runs.

> **Free API key — 500 calls/month, no credit card:** <https://citoapi.com/signup/>

---

## Setup

**1. Create a Discord webhook**

In Discord: **Channel settings → Integrations → Webhooks → New Webhook**, then copy the URL.

**2. Configure**

Create `.env.local` in this folder:

```bash
CITO_API_KEY=your-cito-key
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

**3. Install and run**

```bash
npm install

npm run card      # post the upcoming card once
npm run live      # follow a live card and post round updates
npm start         # same as: node bot.mjs card
```

---

## Modes

| Command | What it does |
|---|---|
| `node bot.mjs card` | Posts the next card, split into main card and prelims, with 🏆 on title fights |
| `node bot.mjs results` | Posts the most recently completed card with results |
| `node bot.mjs live` | Watches for a card going live, then posts round-by-round strike and takedown updates |

`live` polls the live-state endpoint every 15 seconds and only posts when the round or clock changes, so a slow round produces one message, not twenty.

---

## Running it on a schedule

Simplest approach — cron on any box, or a scheduled GitHub Action:

```yaml
# .github/workflows/ufc-card.yml
on:
  schedule:
    - cron: "0 14 * * 3"   # Wednesdays, 14:00 UTC
jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
        working-directory: templates/discord-bot
      - run: node bot.mjs card
        working-directory: templates/discord-bot
        env:
          CITO_API_KEY: ${{ secrets.CITO_API_KEY }}
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

Run the card post on Wednesdays during Contender Series season (the show airs Tuesdays) and on Mondays for numbered cards.

---

## Customising

**Post to a different channel** — just change the webhook URL. Create one webhook per channel and call `post()` with it.

**Change what's shown** — the embed is assembled in `postCard()`. Add odds with:

```js
const odds = await ufc.eventOdds(event.slug);
// odds.markets -> market.name, market.outcomes[].decimalOdds
```

**Only numbered cards** — filter `events` on `event.slug.startsWith("ufc-")`.

**Ping a role** — add to the payload:

```js
content: "<@&ROLE_ID>",
```

---

## Notes

- Discord rate-limits webhooks to roughly 5 requests per 2 seconds per webhook. The `post()` helper paces itself.
- Embeds cap at 10 fields and 1024 characters per field; the card splitter slices defensively.
- Never commit `.env.local`. It is gitignored.

---

## License

MIT. Independent template for the Cito UFC API. Not affiliated with, endorsed by, or licensed by the UFC, Zuffa, TKO Group or any promotion.

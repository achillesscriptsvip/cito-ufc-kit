# cito-ufc

**Typed TypeScript client for the Cito UFC API** — fighters, events, bout and round statistics, rankings, betting odds, and **live fight-night WebSocket streaming**.

```bash
npm install cito-ufc
```

```ts
import { UfcClient } from "cito-ufc";

const ufc = new UfcClient({ apiKey: process.env.CITO_API_KEY! });

const event = await ufc.nextEvent();
console.log(event?.title, event?.startsAt);

const fighter = await ufc.fighter("islam-makhachev");
console.log(fighter.name, fighter.recordText, fighter.division);
```

> **Free API key — 500 calls/month, no credit card:** <https://citoapi.com/signup/>

Ships as both ESM (`import`) and CommonJS (`require`), with full type declarations. **Zero runtime dependencies.** Node 18+, browsers, Deno, Bun.

---

## Quickstart

### The next card

```ts
const event = await ufc.nextEvent();
const card = await ufc.fightCard(event!.slug);

for (const bout of card) {
  const [red, blue] = bout.fighters ?? [];
  console.log(`${bout.cardSection ?? ""} ${red?.fighterName} vs ${blue?.fighterName}`);
}
```

### Results and round-by-round statistics

```ts
const [latest] = await ufc.recentEvents(1);
const card = await ufc.fightCard(latest.slug);

for (const bout of card) {
  if (bout.status !== "completed") continue;
  console.log(`${bout.method} R${bout.resultRound} ${bout.resultTime}`);
}

// Round-by-round striking and grappling
const withStats = card.find((b) => b.hasStats);
if (withStats) {
  for (const row of await ufc.boutRounds(withStats.id)) {
    console.log(
      `R${row.round} ${row.fighterSlug}: ` +
        `${row.sigStrikesLanded}/${row.sigStrikesAttempted} sig strikes, ` +
        `${row.takedownsLanded} takedowns, ${row.controlTimeSec}s control`,
    );
  }
}
```

### Career statistics

```ts
const stats = await ufc.fighterStats("islam-makhachev");

console.log(stats.sigStrikesLandedPerMin);        // "2.27"
console.log(stats.takedownDefense);               // "0.91"
console.log(stats.sigStrikesByTarget?.head.percent);   // 0.7

for (const [key, split] of Object.entries(stats.winsByMethod ?? {})) {
  console.log(`${split.label}: ${split.count}`);
}
```

### Fight history

```ts
const fights = await ufc.fighterFights("islam-makhachev");
for (const f of fights.slice(0, 5)) {
  console.log(f.event?.title, "|", f.outcome, "vs", f.opponent?.name, `(${f.bout?.method})`);
}

const last = await ufc.lastFight("islam-makhachev");
console.log(last?.outcome, last?.opponent?.name, last?.bout?.resultRound);
```

### Rankings

```ts
for (const row of await ufc.rankings({ system: "media", division: "lightweight" })) {
  console.log(row.rankText, row.fighterName);
}
```

`system: "meta"` is the algorithmic board (usually Mondays), `"media"` is the media panel (usually Tuesdays).

### Betting odds

```ts
const odds = await ufc.boutOdds("13126");

for (const market of odds.markets ?? []) {
  for (const outcome of market.outcomes ?? []) {
    console.log(market.name, outcome.name, outcome.decimalOdds);
  }
}
```

An empty `markets` array is a **documented coverage state** for third-party market data, not an error. Odds are for research, media and display — not for betting settlement.

### Search

```ts
const { fighters, events } = await ufc.search("makhachev");
```

---

## Live fight night

An in-round push feed instead of a polling loop:

```ts
for await (const state of ufc.liveStream({ eventSlug: "ufc-331" })) {
  const red = state.liveStats?.red?.sigStrikes ?? 0;
  const blue = state.liveStats?.blue?.sigStrikes ?? 0;
  console.log(`R${state.currentRound} ${state.currentTime}  red=${red} blue=${blue}`);
}
```

Single bout:

```ts
for await (const state of ufc.liveStream({ boutId: "ufc-13126" })) {
  // ...
}
```

Polling fallback:

```ts
const state = await ufc.liveState("ufc-13126");
console.log(state.status, state.currentRound, state.currentTime);
```

Requires a global `WebSocket` — Node 22+, or any browser, Deno or Bun.

---

## Pagination

```ts
for await (const fighter of ufc.iterFighters({ maxItems: 200 })) {
  console.log(fighter.slug);
}
```

---

## Errors

Every failure throws a subclass of `CitoApiError` carrying the API's own `code` and `requestId`.

```ts
import { CitoNotFoundError, CitoRateLimitError, CitoApiError } from "cito-ufc";

try {
  await ufc.fighter("not-real");
} catch (err) {
  if (err instanceof CitoNotFoundError) {
    console.log("no such fighter", err.requestId);
  } else if (err instanceof CitoRateLimitError) {
    console.log(`retry in ${err.retryAfter}s`);
  } else if (err instanceof CitoApiError) {
    console.log(err.status, err.code, err.message);
  }
}
```

Rate-limit headers from the last response are always available:

```ts
console.log(ufc.lastRateLimit);
```

---

## Configuration

| Option | Default | Notes |
|---|---|---|
| `apiKey` | `$CITO_API_KEY`, `$UFCAPI_KEY` | required |
| `baseUrl` | `https://api.citoapi.com/api/v1` | override for testing |
| `wsUrl` | `wss://api.citoapi.com/api/v1/ufc/live/ws` | |
| `timeoutMs` | `30000` | |
| `maxRetries` | `3` | retries on 429 and 5xx |
| `fetch` | global `fetch` | bring your own |

Keep keys **server-side**. Never ship a production key in a browser bundle.

---

## Raw payloads

Every response is the API's own shape, so nothing is hidden. Each object also keeps the untouched original:

```ts
const fighter = await ufc.fighter("islam-makhachev");
console.log(fighter.raw?.ufcStatsId);
```

---

## Coverage

| Method | Endpoint |
|---|---|
| `fighters()`, `iterFighters()` | `GET /ufc/fighters` |
| `fighter(slug)` | `GET /ufc/fighters/{slug}` |
| `fighterStats(slug)` | `GET /ufc/fighters/{slug}/stats` |
| `fighterFights(slug)`, `lastFight(slug)` | `GET /ufc/fighters/{slug}/fights` |
| `events()`, `upcomingEvents()`, `recentEvents()`, `nextEvent()` | `GET /ufc/events`, `/upcoming`, `/recent` |
| `event(idOrSlug)`, `fightCard(idOrSlug)` | `GET /ufc/events/{id}`, `/bouts` |
| `bouts()`, `bout(id)` | `GET /ufc/bouts`, `/bouts/{id}` |
| `boutStats(id)`, `boutRounds(id)` | `GET /ufc/bouts/{id}/stats`, `/rounds` |
| `eventOdds(id)`, `boutOdds(id)` | `GET /ufc/events/{id}/odds`, `/bouts/{id}/odds` |
| `rankings()`, `champions()` | `GET /ufc/rankings/...` |
| `liveState(id)`, `liveStream()`, `liveHealth()` | `GET /ufc/live/...`, `wss://.../live/ws` |
| `search(q)` | `GET /ufc/search` |

Full reference: <https://citoapi.com/docs/api/ufc/>

---

## License

MIT. Independent client for the Cito API. Not affiliated with, endorsed by, or licensed by the UFC, Zuffa, TKO Group or any promotion.

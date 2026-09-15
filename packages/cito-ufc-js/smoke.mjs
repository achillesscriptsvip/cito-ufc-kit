/**
 * Smoke test for cito-ufc (TypeScript SDK).
 *
 * Exercises the built ESM output against the live API and asserts the typed
 * behaviour. Reads CITO_API_KEY from the environment or ../../../../.env.local.
 *
 * Run:  node smoke.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UfcClient } from "./dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadKey() {
  if (process.env.CITO_API_KEY) return process.env.CITO_API_KEY.trim();
  try {
    const text = readFileSync(resolve(here, "..", "..", "..", "..", ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*CITO_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
  return null;
}

const key = loadKey();
if (!key) {
  console.error("no CITO_API_KEY found");
  process.exit(1);
}
console.log(`key loaded: yes (length ${key.length}, prefix ${key.slice(0, 4)}...)`);

const ufc = new UfcClient({ apiKey: key });

let pass = 0;
let failed = 0;

async function check(label, fn) {
  try {
    const detail = await fn();
    pass += 1;
    console.log(`  PASS  ${label}${detail !== undefined ? `: ${detail}` : ""}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}: ${err.message}`);
  }
}

console.log("\n--- read endpoints ---");

await check("fighter()", async () => {
  const f = await ufc.fighter("islam-makhachev");
  if (f.name !== "Islam Makhachev") throw new Error(`unexpected name ${f.name}`);
  return `${f.name} ${f.recordText} reach=${f.reachInches}`;
});

await check("fighterStats()", async () => {
  const s = await ufc.fighterStats("islam-makhachev");
  return `spm=${s.sigStrikesLandedPerMin} tdDef=${s.takedownDefense}`;
});

await check("lastFight()", async () => {
  const f = await ufc.lastFight("islam-makhachev");
  if (!f) throw new Error("no fight returned");
  return `${f.opponent?.name} by ${f.bout?.method}`;
});

await check("nextEvent()", async () => {
  const e = await ufc.nextEvent();
  if (!e) throw new Error("no upcoming event");
  return `${e.title} @ ${e.startsAt}`;
});

await check("fightCard()", async () => {
  const e = await ufc.nextEvent();
  const card = await ufc.fightCard(e.slug);
  const main = card[0];
  return `${card.length} bouts, main=${main?.fighters?.map((f) => f.fighterName).join(" vs ")}`;
});

await check("rankings()", async () => {
  const rows = await ufc.rankings({ system: "media", division: "lightweight" });
  return `${rows.length} rows, top=${rows[0]?.fighterName}`;
});

await check("champions()", async () => {
  const c = await ufc.champions();
  return `${c.length} champions`;
});

await check("search()", async () => {
  const r = await ufc.search("makhachev");
  return `${r.fighters?.length ?? 0} fighters, ${r.events?.length ?? 0} events`;
});

await check("boutRounds()", async () => {
  const recent = await ufc.recentEvents(1);
  const card = await ufc.fightCard(recent[0].slug);
  const withStats = card.find((b) => b.hasStats);
  if (!withStats) return "no stats on latest card";
  const rows = await ufc.boutRounds(withStats.id);
  return `${rows.length} round rows`;
});

await check("eventOdds() (empty is not an error)", async () => {
  const e = await ufc.nextEvent();
  const o = await ufc.eventOdds(e.slug);
  return `markets=${o.markets?.length ?? 0}`;
});

console.log("\n--- pagination ---");

await check("iterFighters(maxItems=3)", async () => {
  const slugs = [];
  for await (const f of ufc.iterFighters({ maxItems: 3 })) slugs.push(f.slug);
  if (slugs.length !== 3) throw new Error(`expected 3, got ${slugs.length}`);
  return slugs.join(", ");
});

console.log("\n--- error handling ---");

await check("404 raises CitoNotFoundError", async () => {
  try {
    await ufc.fighter("definitely-not-a-real-fighter-xyz");
  } catch (err) {
    if (err.name === "CitoNotFoundError" && err.status === 404) return err.name;
    throw new Error(`wrong error: ${err.name} ${err.status}`);
  }
  throw new Error("did not throw");
});

await check("missing key throws CitoApiError", async () => {
  const saved = process.env.CITO_API_KEY;
  delete process.env.CITO_API_KEY;
  try {
    new UfcClient({ apiKey: undefined, fetch: globalThis.fetch });
  } catch (err) {
    if (err.name === "CitoApiError") return err.name;
    throw new Error(`wrong error ${err.name}`);
  } finally {
    if (saved) process.env.CITO_API_KEY = saved;
  }
  throw new Error("did not throw");
});

console.log("");
if (failed) {
  console.log(`RESULT: ${failed} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`RESULT: all ${pass} checks passed`);

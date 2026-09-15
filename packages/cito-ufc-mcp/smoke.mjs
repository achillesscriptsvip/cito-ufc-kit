/**
 * End-to-end smoke test for cito-ufc-mcp.
 *
 * Spawns the built server over real MCP stdio, performs the handshake, lists
 * tools, asserts the host-review requirements (annotations, schemas), calls a
 * real tool against the live API, and asserts responses are sanitized.
 *
 * Run:  node smoke.mjs
 * Reads CITO_API_KEY from the environment or from ../../../../.env.local.
 * The key is never printed.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadKey() {
  if (process.env.CITO_API_KEY) return process.env.CITO_API_KEY.trim();
  const envPath = resolve(here, "..", "..", "..", "..", ".env.local");
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*CITO_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through */
  }
  return null;
}

const key = loadKey();
if (!key) {
  console.error("no CITO_API_KEY found (env or .env.local)");
  process.exit(1);
}
console.log(`key loaded: yes (length ${key.length}, prefix ${key.slice(0, 4)}...)`);

let pass = 0;
let failCount = 0;
const check = (label, condition, detail = "") => {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    failCount += 1;
    console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
};

const child = spawn(process.execPath, [resolve(here, "dist", "index.js")], {
  env: { ...process.env, CITO_API_KEY: key },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

child.stderr.on("data", (d) => {
  const s = d.toString().trim();
  if (s && !s.includes("ready on stdio")) console.log(`  [server] ${s}`);
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolvePromise(msg);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

const call = async (name, args) => {
  const res = await rpc("tools/call", { name, arguments: args });
  const text = res.result?.content?.[0]?.text ?? "";
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { raw: res, text, parsed, isError: res.result?.isError === true };
};

const die = (msg) => {
  console.error(msg);
  child.kill();
  process.exit(1);
};

try {
  // ---- handshake -------------------------------------------------------- //
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1.0.0" },
  });
  check("initialize handshake", init.result?.serverInfo?.name === "cito-ufc", init.result?.serverInfo?.name);
  notify("notifications/initialized", {});

  // ---- tools/list ------------------------------------------------------- //
  const list = await rpc("tools/list", {});
  const tools = list.result?.tools ?? [];
  check("tools listed", tools.length > 0, `${tools.length} tools`);

  const names = tools.map((t) => t.name);
  console.log(`  tools: ${names.join(", ")}`);

  // Host-review requirement: every tool has all three annotations correct.
  const missingAnno = tools.filter(
    (t) =>
      t.annotations?.readOnlyHint !== true ||
      t.annotations?.openWorldHint !== true ||
      t.annotations?.destructiveHint !== false,
  );
  check(
    "every tool has readOnly/openWorld/destructive annotations",
    missingAnno.length === 0,
    missingAnno.length ? `missing on: ${missingAnno.map((t) => t.name).join(", ")}` : "all 3 correct on all tools",
  );

  const noDesc = tools.filter((t) => !t.description || t.description.length < 30);
  check("every tool has a substantive description", noDesc.length === 0, noDesc.map((t) => t.name).join(", ") || "ok");

  const noSchema = tools.filter((t) => !t.inputSchema || Object.keys(t.inputSchema.properties ?? {}).length === 0);
  check("every tool has an input schema", noSchema.length === 0, noSchema.map((t) => t.name).join(", ") || "ok");

  const noOut = tools.filter((t) => !t.outputSchema);
  check("every tool declares an output schema", noOut.length === 0, noOut.map((t) => t.name).join(", ") || "ok");

  check("tool count is focused (<= 12)", tools.length <= 12, `${tools.length}`);

  // ---- search ----------------------------------------------------------- //
  console.log("\n--- live tool calls ---");
  const search = await call("ufc_search", { query: "makhachev" });
  check("ufc_search", !search.isError && search.parsed != null, `${search.parsed?.fighters?.length ?? 0} fighters`);

  // ---- fighter ---------------------------------------------------------- //
  const fighter = await call("ufc_fighter", { slug: "islam-makhachev" });
  check("ufc_fighter", !fighter.isError && fighter.parsed?.name === "Islam Makhachev", fighter.parsed?.name);

  // ---- stats ------------------------------------------------------------ //
  const stats = await call("ufc_fighter_stats", { slug: "islam-makhachev" });
  check("ufc_fighter_stats", !stats.isError && stats.parsed != null, `td_def=${stats.parsed?.takedownDefense}`);

  // ---- history ---------------------------------------------------------- //
  const fights = await call("ufc_fighter_fights", { slug: "islam-makhachev", limit: 3 });
  const rows = Array.isArray(fights.parsed) ? fights.parsed : [];
  check("ufc_fighter_fights", !fights.isError && rows.length > 0, `${rows.length} rows, first opponent=${rows[0]?.opponent?.name}`);

  // ---- events ----------------------------------------------------------- //
  const events = await call("ufc_events", { scope: "upcoming", limit: 3 });
  const evs = Array.isArray(events.parsed) ? events.parsed : [];
  check("ufc_events(upcoming)", !events.isError && evs.length > 0, `${evs.length} upcoming`);

  // ---- card ------------------------------------------------------------- //
  const slug = evs[0]?.slug;
  const card = await call("ufc_fight_card", { eventIdOrSlug: slug });
  const bouts = Array.isArray(card.parsed) ? card.parsed : [];
  check("ufc_fight_card", !card.isError && bouts.length > 0, `${bouts.length} bouts on ${slug}`);

  // ---- rankings --------------------------------------------------------- //
  const ranks = await call("ufc_rankings", { division: "lightweight", system: "media" });
  const rrows = Array.isArray(ranks.parsed) ? ranks.parsed : [];
  check("ufc_rankings", !ranks.isError && rrows.length > 0, `${rrows.length} rows, top=${rrows[0]?.fighterName}`);

  // ---- odds ------------------------------------------------------------- //
  const odds = await call("ufc_odds", { eventIdOrSlug: slug, bookmaker: "all" });
  check("ufc_odds (empty coverage is not an error)", !odds.isError, `markets=${odds.parsed?.markets?.length ?? 0}`);

  // ---- live ------------------------------------------------------------- //
  const live = await call("ufc_live", { scope: "events" });
  check("ufc_live(events)", !live.isError, "ok");

  // ---- sanitization ----------------------------------------------------- //
  console.log("\n--- sanitization (host-review requirement) ---");
  const forbidden = [
    "scrapeMeta",
    "ios-impersonate",
    "emptyCardHeal",
    "llmValidation",
    "workerHostHint",
    "cacheKey",
    "dataAvailability",
    "strategy",
  ];
  const allText = [search.text, fighter.text, stats.text, fights.text, events.text, card.text, ranks.text, odds.text, live.text].join("\n");
  const leaked = forbidden.filter((f) => allText.includes(f));
  check(
    "no internal/debug fields in any tool response",
    leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(", ")}` : "clean across all 9 calls",
  );

  // ---- typed error path ------------------------------------------------- //
  const bad = await call("ufc_fighter", { slug: "definitely-not-a-real-fighter-xyz" });
  check("unknown slug returns a clean typed error", bad.isError === true, bad.text.split("\n")[0].slice(0, 80));
} catch (err) {
  die(`smoke test crashed: ${err.message}`);
} finally {
  child.kill();
}

console.log("");
if (failCount) {
  console.log(`RESULT: ${failCount} check(s) failed, ${pass} passed`);
  process.exit(1);
}
console.log(`RESULT: all ${pass} checks passed`);

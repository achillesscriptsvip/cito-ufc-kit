#!/usr/bin/env node
/**
 * cito-ufc-mcp — read-only MCP server for UFC and MMA fight data.
 *
 * Design notes (these matter for host review and for model accuracy):
 *
 *  - **Deliberately narrow.** Eight tools, one sport. A large multi-sport server
 *    with dozens of overlapping tools makes tool selection ambiguous and fails
 *    metadata review. Focus beats breadth here.
 *  - **Read-only.** No tool mutates state, so every tool advertises
 *    readOnlyHint: true, destructiveHint: false.
 *  - **openWorldHint: true** on every tool — they reach a live public API.
 *  - **Output schemas** are declared so hosts and models know the shape.
 *  - **Sanitized responses** (see client.ts) — no debug payloads, no scraper
 *    internals, no internal identifiers.
 *
 * Free API key (500 calls/month, no card): https://citoapi.com/signup/
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CitoApiError, CitoClient } from "./client.js";

/** Every tool reaches a public API over the open internet. */
const READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const;

const SIGNUP = "Get a free API key (500 calls/month, no card) at https://citoapi.com/signup/";

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data },
  };
}

function fail(err: unknown) {
  const message =
    err instanceof CitoApiError
      ? `${err.message}${err.status ? ` (HTTP ${err.status})` : ""}${
          err.code ? ` [${err.code}]` : ""
        }`
      : (err as Error).message;
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${message}\n\n${SIGNUP}` }],
  };
}

export function createServer(client: CitoClient): McpServer {
  const server = new McpServer({
    name: "cito-ufc",
    version: "1.0.0",
    description:
      "UFC and MMA fight data: fighters, fight cards, bout and round statistics, " +
      "rankings, betting odds and live fight-night state.",
  });

  // 1 ────────────────────────────────────────────────────────── search ── //
  server.registerTool(
    "ufc_search",
    {
      title: "Search UFC fighters and events",
      description:
        "Resolve a name to the slug needed by the other tools. Use this first " +
        "whenever you have a fighter or event name but not its slug — for " +
        "example 'Makhachev' or 'UFC 331'.",
      inputSchema: {
        query: z.string().min(2).describe("Fighter or event name, e.g. 'Makhachev' or 'UFC 331'"),
      },
      outputSchema: {
        fighters: z.array(z.record(z.unknown())).optional(),
        events: z.array(z.record(z.unknown())).optional(),
        result: z.unknown().optional(),
      },
      annotations: { ...READ_ONLY, title: "Search UFC fighters and events" },
    },
    async ({ query }) => {
      try {
        return ok(await client.search(query));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // 2 ───────────────────────────────────────────────────────── fighter ── //
  server.registerTool(
    "ufc_fighter",
    {
      title: "Get a UFC fighter profile",
      description:
        "Profile for one fighter: record, division, champion status, physical " +
        "attributes (height, reach, leg reach, stance, weight), gym, country " +
        "and headshot URL. Requires a fighter slug.",
      inputSchema: {
        slug: z
          .string()
          .describe("Fighter slug from ufc_search, e.g. 'islam-makhachev'"),
      },
      outputSchema: { result: z.unknown() },
      annotations: { ...READ_ONLY, title: "Get a UFC fighter profile" },
    },
    async ({ slug }) => {
      try {
        return ok(await client.fighter(slug));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // 3 ──────────────────────────────────────────────── fighter stats ── //
  server.registerTool(
    "ufc_fighter_stats",
    {
      title: "Get a UFC fighter's career statistics",
      description:
        "Career striking and grappling rates for one fighter: significant " +
        "strikes landed/absorbed per minute, striking accuracy and defence, " +
        "takedown average and defence, submission average, knockdown average, " +
        "and strike breakdowns by target (head/body/leg) and position " +
        "(standing/clinch/ground), plus the win-by-method split.",
      inputSchema: {
        slug: z.string().describe("Fighter slug, e.g. 'islam-makhachev'"),
      },
      outputSchema: { result: z.unknown() },
      annotations: { ...READ_ONLY, title: "Get a UFC fighter's career statistics" },
    },
    async ({ slug }) => {
      try {
        return ok(await client.fighterStats(slug));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // 4 ──────────────────────────────────────────── fighter fight history ── //
  server.registerTool(
    "ufc_fighter_fights",
    {
      title: "Get a UFC fighter's fight history",
      description:
        "Completed bouts for one fighter, newest first. Each row carries the " +
        "opponent, the event, and the result (outcome, method, round, time). " +
        "Use this to answer 'who did X last fight and what happened'.",
      inputSchema: {
        slug: z.string().describe("Fighter slug, e.g. 'islam-makhachev'"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("How many recent fights to return (default 10)"),
      },
      outputSchema: { result: z.unknown() },
      annotations: { ...READ_ONLY, title: "Get a UFC fighter's fight history" },
    },
    async ({ slug, limit }) => {
      try {
        return ok(await client.fighterFights(slug, limit));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // 5 ───────────────────────────────────────────────────────── events ── //
  server.registerTool(
    "ufc_events",
    {
      title: "List UFC events",
      description:
        "Upcoming cards, recent completed cards, or the full archive. Use " +
        "scope='upcoming' for 'what's the next UFC card', scope='recent' for " +
        "the newest results.",
      inputSchema: {
        scope: z
          .enum(["upcoming", "recent", "all"])
          .default("upcoming")
          .describe("Which events to list"),
        limit: z.number().int().min(1).max(50).default(10).describe("How many events"),
      },
      outputSchema: { result: z.unknown() },
      annotations: { ...READ_ONLY, title: "List UFC events" },
    },
    async ({ scope, limit }) => {
      try {
        if (scope === "upcoming") return ok(await client.upcomingEvents(limit));
        if (scope === "recent") return ok(await client.recentEvents(limit));
        return ok(await client.events(1, limit));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // 6 ───────────────────────────────────────────────────── fight card ── //
  server.registerTool(
    "ufc_fight_card",
    {
      title: "Get a UFC event's fight card",
      description:
        "The full bout list for one event in card order — main event first, " +
        "then the rest of the main card, prelims and early prelims. Each bout " +
        "carries both corners, weight class, title-bout flag and, once " +
        "completed, the result (winner, method, round, time). This is the tool " +
        "for 'what is the card for UFC 331'.",
      inputSchema: {
        eventIdOrSlug: z
          .string()
          .describe("Event slug from ufc_events or ufc_search, e.g. 'cryptocom-ufc-331'"),
      },
      outputSchema: { result: z.unknown() },
      annotations: { ...READ_ONLY, title: "Get a UFC event's fight card" },
    },
    async ({ eventIdOrSlug }) => {
      try {
        return ok(await client.eventBouts(eventIdOrSlug));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // 7 ─────────────────────────────────────────────────────── rankings ── //
  server.registerTool(
    "ufc_rankings",
    {
      title: "Get UFC divisional rankings",
      description:
        "Current rankings for one division, or every division if none is " +
        "given. Two boards exist: 'media' (the media panel, usually updated " +
        "Tuesdays) and 'meta' (algorithmic, usually Mondays). Champions appear " +
        "with rankText 'C'.",
      inputSchema: {
        division: z
          .string()
          .optional()
          .describe(
            "Division slug such as 'lightweight', 'heavyweight', 'flyweight', " +
              "'womens-strawweight', or 'pound-for-pound'. Omit for all divisions.",
          ),
        system: z
          .enum(["media", "meta"])
          .default("media")
          .describe("Which ranking board to read"),
      },
      outputSchema: { result: z.unknown() },
      annotations: { ...READ_ONLY, title: "Get UFC divisional rankings" },
    },
    async ({ division, system }) => {
      try {
        return ok(await client.rankings(system, division));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // 8 ─────────────────────────────────────────────────────────── odds ── //
  server.registerTool(
    "ufc_odds",
    {
      title: "Get UFC betting odds",
      description:
        "Moneyline and other markets for a bout or an entire card, by " +
        "bookmaker. An empty result is a normal coverage state for third-party " +
        "market data, not an error. Odds are for research, media and display " +
        "only — not for betting settlement.",
      inputSchema: {
        boutId: z
          .string()
          .optional()
          .describe("Bout id, for a single fight. Provide this or eventIdOrSlug."),
        eventIdOrSlug: z
          .string()
          .optional()
          .describe("Event slug, for a whole card. Provide this or boutId."),
        bookmaker: z
          .string()
          .default("all")
          .describe("Bookmaker filter, e.g. 'all', 'draftkings', 'fanduel'"),
      },
      outputSchema: { result: z.unknown() },
      annotations: { ...READ_ONLY, title: "Get UFC betting odds" },
    },
    async ({ boutId, eventIdOrSlug, bookmaker }) => {
      try {
        if (boutId) return ok(await client.boutOdds(boutId, bookmaker));
        if (eventIdOrSlug) return ok(await client.eventOdds(eventIdOrSlug, bookmaker));
        return {
          isError: true,
          content: [
            { type: "text" as const, text: "Provide either boutId or eventIdOrSlug." },
          ],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );

  // 9 ─────────────────────────────────────────────────────────── live ── //
  server.registerTool(
    "ufc_live",
    {
      title: "Get live UFC fight state",
      description:
        "Current in-round state for a bout that is happening now: round, clock, " +
        "status and per-corner strike and takedown counts. Use scope='events' " +
        "to discover which events are live. Outside a live card this returns " +
        "little or nothing, which is expected.",
      inputSchema: {
        boutId: z.string().optional().describe("Bout id, e.g. 'ufc-13126'"),
        scope: z
          .enum(["bout", "events"])
          .default("bout")
          .describe("'bout' for one fight's state, 'events' to list live events"),
      },
      outputSchema: { result: z.unknown() },
      annotations: { ...READ_ONLY, title: "Get live UFC fight state" },
    },
    async ({ boutId, scope }) => {
      try {
        if (scope === "events") return ok(await client.liveEvents());
        if (!boutId) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: "Provide boutId, or use scope='events'." },
            ],
          };
        }
        return ok(await client.liveState(boutId));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  let client: CitoClient;
  try {
    client = new CitoClient();
  } catch (err) {
    console.error(`[cito-ufc-mcp] ${(err as Error).message}`);
    process.exit(1);
  }

  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[cito-ufc-mcp] ready on stdio");
}

// Only auto-start when executed directly, so tests can import createServer.
const isDirectRun =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.ts"));

if (isDirectRun) {
  main().catch((err) => {
    console.error("[cito-ufc-mcp] fatal:", err);
    process.exit(1);
  });
}

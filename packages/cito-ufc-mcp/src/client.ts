/**
 * Cito UFC API client for the MCP server.
 *
 * Two responsibilities:
 *   1. Talk to the API with a key from the environment (never a literal).
 *   2. **Sanitize every response before it reaches the model.**
 *
 * Sanitization is a hard requirement, not a nicety. MCP tool responses must not
 * carry debug payloads, internal identifiers or scraper internals — OpenAI's
 * submission review explicitly rejects on this, and it also leaks operational
 * detail to anyone who points a client at the server.
 */

const DEFAULT_BASE = "https://api.citoapi.com/api/v1";

/**
 * Field names that must never leave this process.
 *
 * These are internal bookkeeping, scraper diagnostics, cache housekeeping or
 * provenance internals. Nothing here is useful to a model answering a user's
 * question about a fight.
 */
const STRIP_KEYS = new Set<string>([
  // scraper / cache internals
  "scrapeMeta",
  "cacheKey",
  "sourceIds",
  "dataAvailability",
  "emptyCardHeal",
  "dataFreshness",
  "freshnessStatus",
  "dataAgeHours",
  "dataSource",
  "lastSyncedAt",
  "createdAt",
  "syncedAt",
  "oldestSyncedAt",
  "dataId",
  "strategy",
  "fetchedAt",
  // internal quality/validation blocks
  "llmValidation",
  "dataQuality",
  "htmlSnapshotFile",
  "lastGoodSnapshotDate",
  "autoCorrected",
  "autoCorrectedDivisions",
  "fallbackDivisions",
  // live-worker internals
  "workerHostHint",
  "workerAlive",
  "workerStarted",
  "workerProcessStarted",
  "freshestHeartbeatLagSeconds",
  "emptyReason",
  "degradedReason",
  "cardPollInFlight",
  "lastPollCompletedAt",
  "adaptiveBackoffMs",
  "homepageWeAreLive",
  "redis_configured",
  "redis_ready",
  "redis_subscriber_ready",
  "pollIntervalMs",
  "currentLiveFmid",
  "nextCandidateFmid",
  "stickyEmptyClock",
  "degraded_sticky_clock",
  "nextConfirmReasons",
  "transitionedFromLive",
  "armedNext",
  "samples",
  "fightmetric",
  "activeTracking",
  "nextArmedBout",
  // provenance payloads that carry the above
  "raw",
  "jsonLd",
  "bioFields",
  "heroStats",
  "profileStatText",
  "ufcStatsAggregate",
  "sourceUrl",
  "profileUrl",
  "warning",
  "issue",
  // per-request noise
  "requestId",
]);

/** Keep these even though they look internal — they are user-meaningful. */
const KEEP_KEYS = new Set<string>(["status", "state", "source"]);

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v, depth + 1)).filter((v) => v !== undefined);
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!KEEP_KEYS.has(k) && STRIP_KEYS.has(k)) continue;
      const cleaned = sanitizeValue(v, depth + 1);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }

  return value;
}

/** Strip internal fields from any API payload. */
export function sanitize<T>(payload: T): T {
  return sanitizeValue(payload) as T;
}

export class CitoApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CitoApiError";
  }
}

export interface CitoClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class CitoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CitoClientOptions = {}) {
    const key =
      options.apiKey ?? process.env.CITO_API_KEY ?? process.env.UFCAPI_KEY ?? "";
    if (!key) {
      throw new CitoApiError(
        "No API key. Set CITO_API_KEY in the environment. " +
          "Get a free key (500 calls/month, no card) at https://citoapi.com/signup/",
      );
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? process.env.CITO_API_BASE_URL ?? DEFAULT_BASE).replace(
      /\/+$/,
      "",
    );
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: {
          "x-api-key": this.apiKey,
          accept: "application/json",
          "user-agent": "cito-ufc-mcp/1.0.0",
        },
        signal: controller.signal,
      });
    } catch (err) {
      throw new CitoApiError(`Request failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!res.ok) {
      const b = body as Record<string, unknown> | null;
      const e = (b?.error ?? {}) as Record<string, unknown>;
      throw new CitoApiError(
        String(e.message ?? b?.message ?? `HTTP ${res.status}`),
        res.status,
        e.code ? String(e.code) : undefined,
      );
    }

    const envelope = body as Record<string, unknown> | null;
    const data =
      envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : body;

    return sanitize(data) as T;
  }

  // ---- fighters ---------------------------------------------------------- //

  search(query: string) {
    return this.request<Record<string, unknown>>("/ufc/search", { q: query });
  }

  fighters(page: number, limit: number, division?: string) {
    return this.request<unknown[]>("/ufc/fighters", { page, limit, division });
  }

  fighter(slug: string) {
    return this.request<Record<string, unknown>>(`/ufc/fighters/${encodeURIComponent(slug)}`);
  }

  fighterStats(slug: string) {
    return this.request<Record<string, unknown>>(
      `/ufc/fighters/${encodeURIComponent(slug)}/stats`,
    );
  }

  fighterFights(slug: string, limit: number) {
    return this.request<unknown[]>(`/ufc/fighters/${encodeURIComponent(slug)}/fights`, { limit });
  }

  // ---- events ------------------------------------------------------------ //

  events(page: number, limit: number, hasStats?: boolean) {
    return this.request<unknown[]>("/ufc/events", { page, limit, hasStats });
  }

  upcomingEvents(limit: number) {
    return this.request<unknown[]>("/ufc/events/upcoming", { limit });
  }

  recentEvents(limit: number) {
    return this.request<unknown[]>("/ufc/events/recent", { limit });
  }

  event(idOrSlug: string) {
    return this.request<Record<string, unknown>>(
      `/ufc/events/${encodeURIComponent(idOrSlug)}`,
    );
  }

  eventBouts(idOrSlug: string) {
    return this.request<unknown[]>(`/ufc/events/${encodeURIComponent(idOrSlug)}/bouts`);
  }

  // ---- bouts ------------------------------------------------------------- //

  bout(id: string) {
    return this.request<Record<string, unknown>>(`/ufc/bouts/${encodeURIComponent(id)}`);
  }

  boutStats(id: string, round?: number) {
    return this.request<unknown[]>(`/ufc/bouts/${encodeURIComponent(id)}/stats`, { round });
  }

  boutRounds(id: string, round?: number) {
    return this.request<unknown[]>(`/ufc/bouts/${encodeURIComponent(id)}/rounds`, { round });
  }

  // ---- rankings ---------------------------------------------------------- //

  rankings(system: string, division?: string) {
    const path = division
      ? `/ufc/rankings/${system}/${encodeURIComponent(division)}`
      : `/ufc/rankings/${system}`;
    return this.request<unknown[]>(path);
  }

  // ---- odds -------------------------------------------------------------- //

  eventOdds(idOrSlug: string, bookmaker: string) {
    return this.request<Record<string, unknown>>(
      `/ufc/events/${encodeURIComponent(idOrSlug)}/odds`,
      { bookmaker },
    );
  }

  boutOdds(boutId: string, bookmaker: string) {
    return this.request<Record<string, unknown>>(
      `/ufc/bouts/${encodeURIComponent(boutId)}/odds`,
      { bookmaker },
    );
  }

  // ---- live -------------------------------------------------------------- //

  liveState(boutId: string) {
    return this.request<Record<string, unknown>>(
      `/ufc/live/${encodeURIComponent(boutId)}/state`,
    );
  }

  liveBout(boutId: string) {
    return this.request<Record<string, unknown>>(`/ufc/live/${encodeURIComponent(boutId)}`);
  }

  liveEvents() {
    return this.request<unknown[]>("/ufc/live/events");
  }
}

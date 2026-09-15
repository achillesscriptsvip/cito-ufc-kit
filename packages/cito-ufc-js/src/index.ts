/**
 * cito-ufc — typed client for the Cito UFC API.
 *
 * ```ts
 * import { UfcClient } from "cito-ufc";
 *
 * const ufc = new UfcClient({ apiKey: process.env.CITO_API_KEY! });
 *
 * const event = await ufc.nextEvent();
 * console.log(event.title, event.startsAt);
 *
 * const fighter = await ufc.fighter("islam-makhachev");
 * console.log(fighter.name, fighter.recordText);
 * ```
 *
 * Free API key (500 calls/month, no card): https://citoapi.com/signup/
 */

import {
  CitoApiError,
  CitoAuthError,
  CitoNotFoundError,
  CitoRateLimitError,
  type Bout,
  type Event,
  type EventDetail,
  type Fighter,
  type FighterFight,
  type FighterStats,
  type ListMeta,
  type LiveState,
  type Odds,
  type RankingEntry,
  type RoundStats,
  type SearchResults,
} from "./types.js";

export * from "./types.js";

const DEFAULT_BASE = "https://api.citoapi.com/api/v1";
const DEFAULT_WS = "wss://api.citoapi.com/api/v1/ufc/live/ws";
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface UfcClientOptions {
  apiKey?: string;
  baseUrl?: string;
  wsUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

interface Envelope<T> {
  data?: T;
  meta?: ListMeta;
  success?: boolean;
  message?: string;
  code?: string;
}

export class UfcClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly _fetch: typeof fetch;

  /** Rate-limit headers from the most recent response. */
  lastRateLimit: Record<string, string> = {};

  constructor(options: UfcClientOptions = {}) {
    const key =
      options.apiKey ??
      (typeof process !== "undefined"
        ? process.env?.CITO_API_KEY ?? process.env?.UFCAPI_KEY
        : undefined);

    if (!key) {
      throw new CitoApiError(
        "No API key. Pass apiKey or set CITO_API_KEY. " +
          "Get a free key at https://citoapi.com/signup/",
      );
    }

    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.wsUrl = options.wsUrl ?? DEFAULT_WS;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this._fetch = options.fetch ?? globalThis.fetch;

    if (!this._fetch) {
      throw new CitoApiError("No fetch implementation. Node 18+ or a fetch polyfill is required.");
    }
  }

  // ---- transport ------------------------------------------------------- //

  private async request<T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<{ data: T; meta: ListMeta }> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }

    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let res: Response;
      try {
        res = await this._fetch(url.toString(), {
          headers: {
            "x-api-key": this.apiKey,
            accept: "application/json",
            "user-agent": "cito-ufc-js/1.0.0",
          },
          signal: controller.signal,
        });
      } catch (err) {
        lastErr = err;
        clearTimeout(timer);
        if (attempt >= this.maxRetries) {
          throw new CitoApiError(`Request failed: ${(err as Error).message}`);
        }
        await sleep(backoff(attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }

      this.captureRateLimit(res);

      let body: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      if (res.ok) {
        const env = (body ?? {}) as Envelope<T>;
        const data = env && typeof env === "object" && "data" in env ? (env.data as T) : (body as T);
        return { data, meta: env?.meta ?? {} };
      }

      if (RETRY_STATUS.has(res.status) && attempt < this.maxRetries) {
        const wait = retryAfterSeconds(res) ?? backoff(attempt);
        await sleep(wait);
        continue;
      }

      throw buildError(res, body);
    }

    throw new CitoApiError(`Request failed after retries: ${String(lastErr)}`);
  }

  private captureRateLimit(res: Response): void {
    const out: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k.startsWith("x-ratelimit") || k.startsWith("ratelimit") || k === "retry-after") {
        out[k] = value;
      }
    });
    if (Object.keys(out).length) this.lastRateLimit = out;
  }

  // ---- fighters -------------------------------------------------------- //

  /** A page of the fighter directory. */
  async fighters(opts: { page?: number; limit?: number; division?: string } = {}): Promise<Fighter[]> {
    const { data } = await this.request<Fighter[]>("/ufc/fighters", {
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
      division: opts.division,
    });
    return data ?? [];
  }

  /** Walk every page of fighters. */
  async *iterFighters(opts: { limit?: number; maxItems?: number } = {}): AsyncGenerator<Fighter> {
    yield* this.paginate<Fighter>("/ufc/fighters", opts.limit ?? 100, opts.maxItems);
  }

  /** One fighter by slug. */
  async fighter(slug: string): Promise<Fighter> {
    return (await this.request<Fighter>(`/ufc/fighters/${encodeURIComponent(slug)}`)).data;
  }

  /** Career striking and grappling rates. */
  async fighterStats(slug: string): Promise<FighterStats> {
    return (await this.request<FighterStats>(`/ufc/fighters/${encodeURIComponent(slug)}/stats`)).data;
  }

  /** Full fight history, newest first. */
  async fighterFights(slug: string): Promise<FighterFight[]> {
    return (await this.request<FighterFight[]>(`/ufc/fighters/${encodeURIComponent(slug)}/fights`))
      .data ?? [];
  }

  /** The most recent bout, or null. */
  async lastFight(slug: string): Promise<FighterFight | null> {
    const fights = await this.fighterFights(slug);
    return fights[0] ?? null;
  }

  // ---- events ---------------------------------------------------------- //

  async events(opts: { page?: number; limit?: number; hasStats?: boolean } = {}): Promise<Event[]> {
    const { data } = await this.request<Event[]>("/ufc/events", {
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
      hasStats: opts.hasStats,
    });
    return data ?? [];
  }

  async upcomingEvents(limit = 20): Promise<Event[]> {
    return (await this.request<Event[]>("/ufc/events/upcoming", { limit })).data ?? [];
  }

  async recentEvents(limit = 20): Promise<Event[]> {
    return (await this.request<Event[]>("/ufc/events/recent", { limit })).data ?? [];
  }

  /** The next scheduled card, or null. */
  async nextEvent(): Promise<Event | null> {
    const evs = await this.upcomingEvents(1);
    return evs[0] ?? null;
  }

  /** One event with its card. */
  async event(idOrSlug: string): Promise<EventDetail> {
    return (await this.request<EventDetail>(`/ufc/events/${encodeURIComponent(idOrSlug)}`)).data;
  }

  /** The fight card in card order (main event first). */
  async fightCard(idOrSlug: string): Promise<Bout[]> {
    return (await this.request<Bout[]>(`/ufc/events/${encodeURIComponent(idOrSlug)}/bouts`)).data ?? [];
  }

  // ---- bouts ----------------------------------------------------------- //

  async bouts(opts: { page?: number; limit?: number; hasStats?: boolean } = {}): Promise<Bout[]> {
    const { data } = await this.request<Bout[]>("/ufc/bouts", {
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
      hasStats: opts.hasStats,
    });
    return data ?? [];
  }

  async bout(id: string): Promise<Bout> {
    return (await this.request<Bout>(`/ufc/bouts/${encodeURIComponent(id)}`)).data;
  }

  async boutStats(id: string, round?: number): Promise<RoundStats[]> {
    return (await this.request<RoundStats[]>(`/ufc/bouts/${encodeURIComponent(id)}/stats`, { round }))
      .data ?? [];
  }

  async boutRounds(id: string, round?: number): Promise<RoundStats[]> {
    return (await this.request<RoundStats[]>(`/ufc/bouts/${encodeURIComponent(id)}/rounds`, { round }))
      .data ?? [];
  }

  // ---- odds ------------------------------------------------------------ //

  /**
   * Odds for one bout. An empty `markets` array is a normal coverage state for
   * third-party market data, not an error.
   */
  async boutOdds(boutId: string, bookmaker = "all"): Promise<Odds> {
    return (await this.request<Odds>(`/ufc/bouts/${encodeURIComponent(boutId)}/odds`, { bookmaker }))
      .data;
  }

  async eventOdds(idOrSlug: string, bookmaker = "all"): Promise<Odds> {
    return (
      await this.request<Odds>(`/ufc/events/${encodeURIComponent(idOrSlug)}/odds`, { bookmaker })
    ).data;
  }

  // ---- rankings -------------------------------------------------------- //

  /**
   * Division rankings.
   * @param system "media" (media panel, usually Tuesdays) or "meta" (algorithmic, Mondays)
   * @param division slug such as "lightweight"; omit for all divisions
   */
  async rankings(opts: { system?: "media" | "meta"; division?: string } = {}): Promise<RankingEntry[]> {
    const system = opts.system ?? "media";
    const path = opts.division
      ? `/ufc/rankings/${system}/${encodeURIComponent(opts.division)}`
      : `/ufc/rankings/${system}`;
    return (await this.request<RankingEntry[]>(path)).data ?? [];
  }

  /** Current champion in every division. */
  async champions(): Promise<RankingEntry[]> {
    const rows = await this.rankings({ system: "media" });
    return rows.filter((r) => r.isChampion);
  }

  // ---- live ------------------------------------------------------------ //

  /** Compact current state of a live bout — the polling endpoint. */
  async liveState(boutId: string): Promise<LiveState> {
    return (await this.request<LiveState>(`/ufc/live/${encodeURIComponent(boutId)}/state`)).data;
  }

  async liveHealth(): Promise<globalThis.Record<string, unknown>> {
    return (await this.request<globalThis.Record<string, unknown>>("/ufc/live/health")).data;
  }

  /**
   * Stream live fight updates over the WebSocket — an in-round push feed rather
   * than a polling loop.
   *
   * Requires a global `WebSocket` (Node 22+, browsers, Deno, Bun).
   *
   * ```ts
   * for await (const state of ufc.liveStream({ eventSlug: "ufc-331" })) {
   *   console.log(state.currentRound, state.currentTime);
   * }
   * ```
   */
  async *liveStream(
    opts: { boutId?: string; eventSlug?: string; maxFrames?: number },
  ): AsyncGenerator<LiveState> {
    const rooms: string[] = [];
    if (opts.boutId) rooms.push(`bout:${opts.boutId}`);
    if (opts.eventSlug) rooms.push(`event:${opts.eventSlug}`);
    if (!rooms.length) throw new CitoApiError("Pass boutId or eventSlug.");

    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) {
      throw new CitoApiError("No global WebSocket. Node 22+, a browser, Deno or Bun is required.");
    }

    const url = `${this.wsUrl}?api_key=${encodeURIComponent(this.apiKey)}`;
    const socket = new WS(url);
    const queue: LiveState[] = [];
    let notify: (() => void) | null = null;
    let closed = false;
    let failure: Error | null = null;

    const wake = () => {
      if (notify) {
        const n = notify;
        notify = null;
        n();
      }
    };

    socket.addEventListener("message", (ev: MessageEvent) => {
      let frame: LiveState;
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as LiveState;
      } catch {
        return;
      }
      if (frame && (frame.type === "ready" || frame.type === "subscribed" || frame.type === "pong")) {
        return;
      }
      queue.push(frame);
      wake();
    });
    socket.addEventListener("error", () => {
      failure = new CitoApiError("Live WebSocket error.");
      wake();
    });
    socket.addEventListener("close", () => {
      closed = true;
      wake();
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.send(JSON.stringify({ action: "subscribe", rooms }));
        resolve();
      };
      if (socket.readyState === 1) onOpen();
      else {
        socket.addEventListener("open", onOpen);
        socket.addEventListener("error", () => reject(new CitoApiError("Live WebSocket failed to open.")));
      }
    });

    let seen = 0;
    try {
      while (true) {
        if (queue.length) {
          const item = queue.shift() as LiveState;
          yield item;
          seen += 1;
          if (opts.maxFrames !== undefined && seen >= opts.maxFrames) return;
          continue;
        }
        if (failure) throw failure;
        if (closed) return;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
  }

  // ---- search ---------------------------------------------------------- //

  /** Resolve a name to a slug. */
  async search(query: string): Promise<SearchResults> {
    const { data } = await this.request<SearchResults | SearchResults["fighters"]>("/ufc/search", {
      q: query,
    });
    if (Array.isArray(data)) {
      const fighters = data.filter((r) => r && typeof r === "object" && "record" in r) as Fighter[];
      const events = data.filter((r) => r && typeof r === "object" && "startsAt" in r) as Event[];
      return { fighters, events };
    }
    return (data as SearchResults) ?? {};
  }

  // ---- pagination ------------------------------------------------------ //

  private async *paginate<T>(path: string, limit: number, maxItems?: number): AsyncGenerator<T> {
    let page = 1;
    let yielded = 0;

    while (true) {
      const { data, meta } = await this.request<T[]>(path, { page, limit });
      const rows = data ?? [];
      if (!rows.length) return;

      for (const row of rows) {
        yield row;
        yielded += 1;
        if (maxItems !== undefined && yielded >= maxItems) return;
      }

      if (!hasNext(meta, rows.length, limit)) return;
      page += 1;
    }
  }
}

// ---- helpers ------------------------------------------------------------ //

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt + Math.random() * 250, 30_000);
}

function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(n * 1000, 60_000) : null;
}

function buildError(res: Response, body: unknown): CitoApiError {
  const b = (body ?? {}) as globalThis.Record<string, unknown>;
  const e = (b.error ?? {}) as globalThis.Record<string, unknown>;
  const message = String(e.message ?? b.message ?? `HTTP ${res.status}`);
  const code = e.code ? String(e.code) : undefined;
  const requestId = (e.request_id ?? b.requestId ?? res.headers.get("x-request-id")) as
    | string
    | undefined;
  const opts = { status: res.status, code, requestId, payload: body };

  if (res.status === 401 || res.status === 403) return new CitoAuthError(message, opts);
  if (res.status === 404) return new CitoNotFoundError(message, opts);
  if (res.status === 429) {
    const ra = res.headers.get("retry-after");
    return new CitoRateLimitError(message, opts, ra ? Number(ra) : undefined);
  }
  return new CitoApiError(message, opts);
}

function hasNext(meta: ListMeta, rowCount: number, limit: number): boolean {
  if (!meta) return rowCount >= limit;
  if (typeof meta.hasNextPage === "boolean") return meta.hasNextPage;
  if (typeof meta.hasMore === "boolean") return meta.hasMore;
  if (meta.pagination) {
    if (typeof meta.pagination.has_more === "boolean") return meta.pagination.has_more;
    if (meta.pagination.next_cursor) return true;
  }
  if (typeof meta.page === "number" && typeof meta.totalPages === "number") {
    return meta.page < meta.totalPages;
  }
  return rowCount >= limit;
}

/** Convenience factory. */
export function ufc(options: UfcClientOptions = {}): UfcClient {
  return new UfcClient(options);
}

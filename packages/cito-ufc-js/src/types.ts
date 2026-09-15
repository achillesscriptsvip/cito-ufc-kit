/**
 * Types for the Cito UFC API.
 *
 * Field names mirror the API's own JSON so you can always drop to the raw
 * payload. Every type carries the original object on `raw`, so nothing the API
 * returns is ever lost — a new field upstream cannot break your build.
 */

/** A win/loss/draw/no-contest record. */
export interface FightRecord {
  wins?: number | null;
  losses?: number | null;
  draws?: number | null;
  no_contest?: number | null;
  noContest?: number | null;
  text?: string | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface StrikeSplit {
  label?: string | null;
  count?: number | null;
  percent?: number | null;
}

export interface Fighter {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  division?: string | null;
  status?: string | null;
  isActive?: boolean | null;
  championStatus?: string | null;
  country?: string | null;
  placeOfBirth?: string | null;
  trainsAt?: string | null;
  fightingStyle?: string | null;
  age?: number | null;
  heightInches?: string | null;
  weightLbs?: string | null;
  reachInches?: string | null;
  legReachInches?: string | null;
  stance?: string | null;
  octagonDebut?: string | null;
  record?: FightRecord | null;
  recordText?: string | null;
  headshotUrl?: string | null;
  imageUrl?: string | null;
  bodyImageUrl?: string | null;
  proxiedImageUrl?: string | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface FighterStats {
  fighterSlug?: string | null;
  source?: string | null;
  strikingAccuracy?: string | null;
  significantStrikesLanded?: number | null;
  significantStrikesAttempted?: number | null;
  takedownAccuracy?: string | null;
  takedownsLanded?: number | null;
  takedownsAttempted?: number | null;
  sigStrikesLandedPerMin?: string | null;
  sigStrikesAbsorbedPerMin?: string | null;
  takedownAvgPer15Min?: string | null;
  submissionAvgPer15Min?: string | null;
  sigStrikeDefense?: string | null;
  takedownDefense?: string | null;
  knockdownAvg?: string | null;
  averageFightTimeSeconds?: number | null;
  sigStrikesByPosition?: globalThis.Record<string, StrikeSplit> | null;
  sigStrikesByTarget?: globalThis.Record<string, StrikeSplit> | null;
  winsByMethod?: globalThis.Record<string, StrikeSplit> | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface Event {
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  shortTitle?: string | null;
  status?: string | null;
  startsAt?: string | null;
  venue?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  locationText?: string | null;
  imageUrl?: string | null;
  hasStats?: boolean | null;
  eventDate?: string | null;
  eventDateLabel?: string | null;
  eventWeekday?: string | null;
  eventTimeZone?: string | null;
  venueTimeZone?: string | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface BoutFighter {
  id?: string | null;
  fighterId?: string | null;
  fighterSlug?: string | null;
  fighterName?: string | null;
  corner?: string | null;
  outcome?: string | null;
  rankText?: string | null;
  country?: string | null;
  flag?: string | null;
  championStatus?: string | null;
  imageUrl?: string | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface Bout {
  id?: string | null;
  eventSlug?: string | null;
  weightClass?: string | null;
  cardSection?: string | null;
  cardPosition?: string | null;
  boutOrder?: number | null;
  status?: string | null;
  titleBout?: boolean | null;
  isCancelled?: boolean | null;
  winnerFighterSlug?: string | null;
  method?: string | null;
  resultRound?: number | null;
  resultTime?: string | null;
  referee?: string | null;
  hasStats?: boolean | null;
  fighters?: BoutFighter[] | null;
  odds?: unknown;
  raw?: globalThis.Record<string, unknown>;
}

export interface EventDetail extends Event {
  bouts?: Bout[] | null;
  fights?: Bout[] | null;
}

/** One row of a fighter's fight history (flattened shape). */
export interface FighterFight {
  fighterSlug?: string | null;
  fighterName?: string | null;
  championStatus?: string | null;
  corner?: string | null;
  outcome?: string | null;
  opponent?: BoutFighter | null;
  event?: Event | null;
  bout?: Bout | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface RoundStats {
  fighterId?: string | null;
  fighterSlug?: string | null;
  round?: number | null;
  fighterPosition?: string | null;
  knockdowns?: number | null;
  sigStrikesLanded?: number | null;
  sigStrikesAttempted?: number | null;
  totalStrikesLanded?: number | null;
  totalStrikesAttempted?: number | null;
  takedownsLanded?: number | null;
  takedownsAttempted?: number | null;
  submissionAttempts?: number | null;
  reversals?: number | null;
  controlTimeSec?: number | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface RankingEntry {
  id?: string | null;
  system?: string | null;
  division?: string | null;
  normalizedDivision?: string | null;
  rank?: number | null;
  rankText?: string | null;
  rankChange?: number | null;
  fighterSlug?: string | null;
  fighterName?: string | null;
  isChampion?: boolean | null;
  championStatus?: string | null;
  country?: string | null;
  flag?: string | null;
  imageUrl?: string | null;
  fighter?: Fighter | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface OddsOutcome {
  name?: string | null;
  bookmaker?: string | null;
  price?: number | null;
  americanOdds?: number | null;
  decimalOdds?: number | null;
  impliedProbability?: number | null;
}

export interface OddsMarket {
  key?: string | null;
  name?: string | null;
  outcomes?: OddsOutcome[] | null;
}

export interface Odds {
  boutId?: string | null;
  markets?: OddsMarket[] | null;
  bookmaker?: string | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface LiveStats {
  sigStrikes?: number | null;
  significantStrikes?: number | null;
  takedowns?: number | null;
  takedownsLanded?: number | null;
}

export interface LiveState {
  type?: string | null;
  boutId?: string | null;
  eventSlug?: string | null;
  status?: string | null;
  currentRound?: number | null;
  currentTime?: string | null;
  lagSeconds?: number | null;
  liveStats?: globalThis.Record<string, LiveStats> | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface SearchResults {
  fighters?: Fighter[] | null;
  events?: Event[] | null;
  raw?: globalThis.Record<string, unknown>;
}

export interface ListMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasMore?: boolean;
  pagination?: { has_more?: boolean; next_cursor?: string | null };
}

/** Error thrown for any API failure. Carries the API's own code and request id. */
export class CitoApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly payload?: unknown;

  constructor(
    message: string,
    opts: { status?: number; code?: string; requestId?: string; payload?: unknown } = {},
  ) {
    super(message);
    this.name = "CitoApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.payload = opts.payload;
  }
}

export class CitoAuthError extends CitoApiError {
  constructor(message: string, opts: ConstructorParameters<typeof CitoApiError>[1] = {}) {
    super(message, opts);
    this.name = "CitoAuthError";
  }
}

export class CitoNotFoundError extends CitoApiError {
  constructor(message: string, opts: ConstructorParameters<typeof CitoApiError>[1] = {}) {
    super(message, opts);
    this.name = "CitoNotFoundError";
  }
}

export class CitoRateLimitError extends CitoApiError {
  readonly retryAfter?: number;
  constructor(
    message: string,
    opts: ConstructorParameters<typeof CitoApiError>[1] = {},
    retryAfter?: number,
  ) {
    super(message, opts);
    this.name = "CitoRateLimitError";
    this.retryAfter = retryAfter;
  }
}

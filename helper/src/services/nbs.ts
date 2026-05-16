import type { AccountQuotaCard, QuotaWindow } from '../domain/index.js';

const USEFUL_CUTOFF_PCT = 10;
const SECONDARY_WEIGHT = 1 / 3;
const MIN_HOURS_CLAMP = 0.25;
const OPENED_BOOST = 1.05;
const STALE_CONFIDENCE = 0.5;

export type WindowKind = 'five_hour' | 'weekly';

export function windowKind(window: QuotaWindow): WindowKind | null {
  const id = window.id.toLowerCase();
  const name = window.providerWindowName.toLowerCase();
  if (
    id.includes('5h') ||
    id.includes('5-hour') ||
    id.includes('5_hour') ||
    name.includes('5h') ||
    name.includes('5-hour') ||
    name.includes('5 hour')
  )
    return 'five_hour';
  if (
    id.includes('weekly') ||
    id.includes('week') ||
    name.includes('weekly') ||
    name.includes('week')
  )
    return 'weekly';
  return null;
}

function findWindow(card: AccountQuotaCard, kind: WindowKind): QuotaWindow | null {
  return card.windows.find((w) => windowKind(w) === kind) ?? null;
}

export function remainingPct(usedPercentage: number | null): number {
  if (usedPercentage === null) return 100;
  return Math.max(0, 100 - usedPercentage);
}

export function hoursUntil(resetAt: string | null, nowMs: number): number | null {
  if (!resetAt) return null;
  const resetMs = Date.parse(resetAt);
  if (Number.isNaN(resetMs)) return null;
  return (resetMs - nowMs) / 3_600_000;
}

export function dataConfidence(card: AccountQuotaCard): number {
  if (card.status === 'fresh') return 1.0;
  if (card.status === 'stale') return STALE_CONFIDENCE;
  return 0;
}

export function computeNBS(card: AccountQuotaCard, nowMs: number): number {
  const confidence = dataConfidence(card);
  if (confidence === 0) return 0;

  const fiveHourWin = findWindow(card, 'five_hour');
  const weeklyWin = findWindow(card, 'weekly');

  const fiveHourRemainingPct = fiveHourWin ? remainingPct(fiveHourWin.usedPercentage) : 100;
  const weeklyRemainingPct = weeklyWin ? remainingPct(weeklyWin.usedPercentage) : 100;

  // Exhausted: 0% 5h (when a 5h window exists) or 0% weekly
  if (fiveHourWin && fiveHourRemainingPct === 0) return 0;
  if (weeklyRemainingPct === 0) return 0;

  // Best-before pressure: weekly expiry urgency
  let bestBeforePressure = 0;
  if (weeklyWin) {
    const weeklyHours = hoursUntil(weeklyWin.resetAt, nowMs);
    if (weeklyHours !== null && weeklyHours > 0) {
      bestBeforePressure = weeklyRemainingPct / Math.max(weeklyHours, MIN_HOURS_CLAMP);
    }
  }

  // Opened-window pressure: 5h expiry urgency.
  // Zero when remaining = 100% — nothing has been consumed yet in this window,
  // so there is nothing to lose by letting the timer tick.
  let openedWindowPressure = 0;
  const isOpened = fiveHourWin?.resetAt !== null && fiveHourWin?.resetAt !== undefined;
  if (fiveHourWin && isOpened && fiveHourRemainingPct < 100) {
    const fiveHourHours = hoursUntil(fiveHourWin.resetAt, nowMs);
    if (fiveHourHours !== null && fiveHourHours > 0) {
      openedWindowPressure = fiveHourRemainingPct / Math.max(fiveHourHours, MIN_HOURS_CLAMP);
    }
  }

  const dominant = Math.max(bestBeforePressure, openedWindowPressure);
  const secondary = Math.min(bestBeforePressure, openedWindowPressure);
  let urgency = dominant + SECONDARY_WEIGHT * secondary;

  // Multiplicative boost rather than a pure tiebreaker: applies to total urgency so that
  // opened accounts with comparable weekly pressure consistently edge out unopened ones,
  // without being strong enough to override a materially higher best-before gap (spec section 8.1).
  if (isOpened) urgency *= OPENED_BOOST;

  const usefulness = Math.min(1, fiveHourRemainingPct / USEFUL_CUTOFF_PCT);

  return urgency * usefulness * confidence;
}

export function compareForTiebreak(
  a: { card: AccountQuotaCard; nbs: number },
  b: { card: AccountQuotaCard; nbs: number }
): number {
  if (a.nbs !== b.nbs) return b.nbs - a.nbs;

  const aOpened = findWindow(a.card, 'five_hour')?.resetAt != null;
  const bOpened = findWindow(b.card, 'five_hour')?.resetAt != null;
  if (aOpened !== bOpened) return aOpened ? -1 : 1;

  const aFiveHourRem = remainingPct(findWindow(a.card, 'five_hour')?.usedPercentage ?? null);
  const bFiveHourRem = remainingPct(findWindow(b.card, 'five_hour')?.usedPercentage ?? null);
  if (aFiveHourRem !== bFiveHourRem) return bFiveHourRem - aFiveHourRem;

  return a.card.email < b.card.email ? -1 : a.card.email > b.card.email ? 1 : 0;
}

function isExhaustedAccount(card: AccountQuotaCard): boolean {
  const fiveHourWin = findWindow(card, 'five_hour');
  const weeklyWin = findWindow(card, 'weekly');
  if (fiveHourWin && remainingPct(fiveHourWin.usedPercentage) === 0) return true;
  if (weeklyWin && remainingPct(weeklyWin.usedPercentage) === 0) return true;
  return false;
}

function isFreshReserveAccount(card: AccountQuotaCard): boolean {
  const fiveHourWin = findWindow(card, 'five_hour');
  if (!fiveHourWin) return true;
  return remainingPct(fiveHourWin.usedPercentage) >= 100 && fiveHourWin.resetAt == null;
}

// TSD Section 11.3: fallback sort when all accounts in a provider group score zero.
// Order: fresh reserves first → nearest known weekly reset → stable configured display order.
function compareForFallback(nowMs: number): (a: AccountQuotaCard, b: AccountQuotaCard) => number {
  return (a, b) => {
    const aFresh = isFreshReserveAccount(a);
    const bFresh = isFreshReserveAccount(b);
    if (aFresh !== bFresh) return aFresh ? -1 : 1;

    const aResetAt = findWindow(a, 'weekly')?.resetAt ?? null;
    const bResetAt = findWindow(b, 'weekly')?.resetAt ?? null;
    if (aResetAt !== null || bResetAt !== null) {
      if (aResetAt === null) return 1;
      if (bResetAt === null) return -1;
      const aDist = Math.abs(Date.parse(aResetAt) - nowMs);
      const bDist = Math.abs(Date.parse(bResetAt) - nowMs);
      if (!Number.isNaN(aDist) && !Number.isNaN(bDist) && aDist !== bDist) return aDist - bDist;
    }

    return a.displayOrder - b.displayOrder;
  };
}

export function assignNoBrainerScores(
  cards: AccountQuotaCard[],
  generatedAt: string
): AccountQuotaCard[] {
  const nowMs = Date.parse(generatedAt);
  const safeNowMs = Number.isNaN(nowMs) ? Date.now() : nowMs;

  const scored = cards.map((card) => ({ card, nbs: computeNBS(card, safeNowMs) }));

  const byProvider = new Map<string, typeof scored>();
  for (const entry of scored) {
    const group = byProvider.get(entry.card.provider) ?? [];
    group.push(entry);
    byProvider.set(entry.card.provider, group);
  }

  const rankMap = new Map<AccountQuotaCard, number | null>();

  for (const group of byProvider.values()) {
    const rankable = group.filter((e) => e.nbs > 0).sort(compareForTiebreak);
    const unrankable = group.filter((e) => e.nbs === 0);

    if (rankable.length > 0) {
      rankable.forEach((entry, i) => rankMap.set(entry.card, i + 1));
      unrankable.forEach((entry) => rankMap.set(entry.card, null));
    } else {
      // TSD Section 11.3: all accounts score zero — still provide a recommendation
      const fallbackRankable = unrankable
        .filter((e) => dataConfidence(e.card) > 0 && !isExhaustedAccount(e.card))
        .map((e) => e.card)
        .sort(compareForFallback(safeNowMs));
      const fallbackExcluded = unrankable.filter(
        (e) => dataConfidence(e.card) === 0 || isExhaustedAccount(e.card)
      );
      fallbackRankable.forEach((card, i) => rankMap.set(card, i + 1));
      fallbackExcluded.forEach((entry) => rankMap.set(entry.card, null));
    }
  }

  return cards.map((card) => ({ ...card, selectionRank: rankMap.get(card) ?? null }));
}

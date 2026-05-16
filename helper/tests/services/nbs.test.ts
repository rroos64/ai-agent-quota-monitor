// Provenance: docs/test-traceability.md — NBS ranking area
import { describe, expect, it } from 'vitest';
import {
  assignNoBrainerScores,
  computeNBS,
  compareForTiebreak,
  windowKind,
  remainingPct,
  hoursUntil,
  dataConfidence
} from '../../src/services/nbs.js';
import type { AccountQuotaCard } from '../../src/domain/index.js';

// Traceability: BR-042 No-Brainer Score; TS: TSD NBS formula and food-expiry analogy; NBS spec behavioural examples (section 12).

const NOW = '2026-05-09T12:00:00.000Z';
const IN_2H = '2026-05-09T14:00:00.000Z';
const IN_3H = '2026-05-09T15:00:00.000Z';
const IN_4H = '2026-05-09T16:00:00.000Z';
const IN_30MIN = '2026-05-09T12:30:00.000Z';
const TOMORROW = '2026-05-10T12:00:00.000Z';
const IN_20_DAYS = '2026-05-29T12:00:00.000Z';
const IN_30_DAYS = '2026-06-08T12:00:00.000Z';

function makeCard(
  overrides: Omit<Partial<AccountQuotaCard>, 'windows'> & {
    fiveHourUsedPct?: number | null;
    fiveHourResetAt?: string | null;
    weeklyUsedPct?: number | null;
    weeklyResetAt?: string | null;
  }
): AccountQuotaCard {
  const { fiveHourUsedPct, fiveHourResetAt, weeklyUsedPct, weeklyResetAt, ...rest } = overrides;

  const windows: AccountQuotaCard['windows'] = [];
  if (fiveHourUsedPct !== undefined) {
    windows.push({
      id: 'codex:5h',
      providerWindowName: '5-hour limit',
      usedPercentage: fiveHourUsedPct,
      resetAt: fiveHourResetAt ?? null,
      resetInText: null,
      status: 'fresh'
    });
  }
  if (weeklyUsedPct !== undefined) {
    windows.push({
      id: 'codex:weekly',
      providerWindowName: 'Weekly limit',
      usedPercentage: weeklyUsedPct,
      resetAt: weeklyResetAt ?? null,
      resetInText: null,
      status: 'fresh'
    });
  }

  return {
    provider: 'codex',
    email: 'test@example.com',
    displayOrder: 0,
    status: 'fresh',
    windows,
    lastSuccessfulRefreshAt: NOW,
    lastAttemptedRefreshAt: NOW,
    stale: false,
    ...rest
  };
}

function ranks(cards: AccountQuotaCard[]): { email: string; rank: number | null | undefined }[] {
  const result = assignNoBrainerScores(cards, NOW);
  return result.map((c) => ({ email: c.email, rank: c.selectionRank }));
}

// Spec example 12.1: opened account beats fresh reserve (same weekly urgency)
it('opened account with decaying 5h window outranks a fresh reserve with the same weekly date', () => {
  const opened = makeCard({
    email: 'opened@example.com',
    fiveHourUsedPct: 40, // 60% remaining
    fiveHourResetAt: IN_2H,
    weeklyUsedPct: 0, // 100% remaining
    weeklyResetAt: IN_20_DAYS
  });
  const reserve = makeCard({
    email: 'reserve@example.com',
    fiveHourUsedPct: 0, // 100% remaining
    fiveHourResetAt: null, // unopened — no 5h clock
    weeklyUsedPct: 0,
    weeklyResetAt: IN_20_DAYS
  });
  const result = ranks([opened, reserve]);
  const openedRank = result.find((r) => r.email === 'opened@example.com')?.rank;
  const reserveRank = result.find((r) => r.email === 'reserve@example.com')?.rank;
  expect(openedRank).toBe(1);
  expect(reserveRank).toBe(2);
});

// Spec example 12.2: unopened weekly-urgent account beats opened long-dated account
it('unopened account with urgent weekly best-before outranks an opened account whose weekly reset is far away', () => {
  const openedLongDate = makeCard({
    email: 'opened-long@example.com',
    fiveHourUsedPct: 0, // 100% remaining — freshly opened, nothing consumed
    fiveHourResetAt: IN_4H,
    weeklyUsedPct: 0,
    weeklyResetAt: IN_30_DAYS
  });
  const weeklyUrgent = makeCard({
    email: 'weekly-urgent@example.com',
    fiveHourUsedPct: 0, // 100% remaining — unopened
    fiveHourResetAt: null,
    weeklyUsedPct: 0,
    weeklyResetAt: TOMORROW
  });
  const result = ranks([openedLongDate, weeklyUrgent]);
  const urgentRank = result.find((r) => r.email === 'weekly-urgent@example.com')?.rank;
  const longRank = result.find((r) => r.email === 'opened-long@example.com')?.rank;
  expect(urgentRank).toBe(1);
  expect(longRank).toBe(2);
});

// Spec example 12.3: nearly-empty account is penalised in favour of a healthier opened account
it('account with 4% 5h remaining is penalised and ranks below an account with 40% remaining', () => {
  const nearlyEmpty = makeCard({
    email: 'nearly-empty@example.com',
    fiveHourUsedPct: 96, // 4% remaining
    fiveHourResetAt: IN_30MIN,
    weeklyUsedPct: 0,
    weeklyResetAt: IN_20_DAYS
  });
  const healthy = makeCard({
    email: 'healthy@example.com',
    fiveHourUsedPct: 60, // 40% remaining
    fiveHourResetAt: IN_3H,
    weeklyUsedPct: 0,
    weeklyResetAt: IN_20_DAYS
  });
  const result = ranks([nearlyEmpty, healthy]);
  const healthyRank = result.find((r) => r.email === 'healthy@example.com')?.rank;
  const emptyRank = result.find((r) => r.email === 'nearly-empty@example.com')?.rank;
  expect(healthyRank).toBe(1);
  expect(emptyRank).toBe(2);
});

// Spec example 12.4: below 10% is not automatically forbidden — urgent weekly waste risk can still win
it('account below 10% 5h remaining may still outrank a fresh reserve when weekly waste risk is high', () => {
  const lowButUrgent = makeCard({
    email: 'low-but-urgent@example.com',
    fiveHourUsedPct: 92, // 8% remaining
    fiveHourResetAt: IN_30MIN, // also resetting soon
    weeklyUsedPct: 20, // 80% remaining
    weeklyResetAt: IN_30MIN // weekly resets in 30 min — massive waste risk
  });
  const freshReserve = makeCard({
    email: 'fresh-reserve@example.com',
    fiveHourUsedPct: 0, // 100% remaining
    fiveHourResetAt: null,
    weeklyUsedPct: 0, // 100% remaining
    weeklyResetAt: IN_20_DAYS
  });
  const result = ranks([lowButUrgent, freshReserve]);
  const urgentRank = result.find((r) => r.email === 'low-but-urgent@example.com')?.rank;
  const reserveRank = result.find((r) => r.email === 'fresh-reserve@example.com')?.rank;
  expect(urgentRank).toBe(1);
  expect(reserveRank).toBe(2);
});

// Spec example 12.5: exhausted (0% 5h remaining) account receives no rank
it('account with 0% 5h remaining is exhausted and receives no rank', () => {
  const exhausted = makeCard({
    email: 'exhausted@example.com',
    fiveHourUsedPct: 100, // 0% remaining
    fiveHourResetAt: IN_2H,
    weeklyUsedPct: 20, // 80% weekly remaining
    weeklyResetAt: IN_20_DAYS
  });
  const usable = makeCard({
    email: 'usable@example.com',
    fiveHourUsedPct: 60, // 40% remaining
    fiveHourResetAt: IN_3H,
    weeklyUsedPct: 20,
    weeklyResetAt: IN_20_DAYS
  });
  const result = ranks([exhausted, usable]);
  expect(result.find((r) => r.email === 'exhausted@example.com')?.rank).toBeNull();
  expect(result.find((r) => r.email === 'usable@example.com')?.rank).toBe(1);
});

// Spec example 12.6: 5h appears full but weekly is 0% — treated as exhausted
it('account with full 5h bucket but 0% weekly remaining is exhausted', () => {
  const weeklyExhausted = makeCard({
    email: 'weekly-exhausted@example.com',
    fiveHourUsedPct: 0, // 100% 5h remaining — looks fresh
    fiveHourResetAt: IN_2H,
    weeklyUsedPct: 100, // 0% weekly remaining
    weeklyResetAt: IN_20_DAYS
  });
  const partiallyUsable = makeCard({
    email: 'partial@example.com',
    fiveHourUsedPct: 85, // 15% remaining
    fiveHourResetAt: IN_2H,
    weeklyUsedPct: 80, // 20% weekly remaining
    weeklyResetAt: IN_20_DAYS
  });
  const result = ranks([weeklyExhausted, partiallyUsable]);
  expect(result.find((r) => r.email === 'weekly-exhausted@example.com')?.rank).toBeNull();
  expect(result.find((r) => r.email === 'partial@example.com')?.rank).toBe(1);
});

describe('all-zero fallback ranking', () => {
  // TSD Section 11.3: when all accounts in a provider group score zero, the system
  // should still provide a ranked recommendation using a fallback decision order.

  it('assigns null rank to all accounts when all score zero and all are exhausted', () => {
    const fiveHourExhausted = makeCard({
      email: 'fh-exhausted@x.com',
      fiveHourUsedPct: 100, // 0% remaining — exhausted
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 20,
      weeklyResetAt: IN_20_DAYS
    });
    const weeklyExhausted = makeCard({
      email: 'wk-exhausted@x.com',
      fiveHourUsedPct: 0,
      fiveHourResetAt: null,
      weeklyUsedPct: 100, // 0% remaining — exhausted
      weeklyResetAt: IN_20_DAYS
    });
    const result = assignNoBrainerScores([fiveHourExhausted, weeklyExhausted], NOW);
    expect(result.find((c) => c.email === 'fh-exhausted@x.com')?.selectionRank).toBeNull();
    expect(result.find((c) => c.email === 'wk-exhausted@x.com')?.selectionRank).toBeNull();
  });

  it('ranks fresh reserve accounts above non-fresh-reserve zero-scoring accounts', () => {
    // No weekly reset date → no best-before pressure → both score zero
    const freshReserve = makeCard({
      email: 'reserve@x.com',
      fiveHourUsedPct: 0, // 100% remaining, not started
      fiveHourResetAt: null,
      weeklyUsedPct: 0,
      weeklyResetAt: null
    });
    const openedNoDate = makeCard({
      email: 'opened@x.com',
      fiveHourUsedPct: 50, // 50% remaining — partially consumed, but no reset time known
      fiveHourResetAt: null,
      weeklyUsedPct: 0,
      weeklyResetAt: null
    });
    const result = assignNoBrainerScores([openedNoDate, freshReserve], NOW);
    expect(result.find((c) => c.email === 'reserve@x.com')?.selectionRank).toBe(1);
    expect(result.find((c) => c.email === 'opened@x.com')?.selectionRank).toBe(2);
  });

  it('prefers account with known weekly reset date over account without one', () => {
    // Past weekly reset: reset already happened but data has not been refreshed.
    // hoursUntil(PAST) < 0 → bestBeforePressure = 0 → NBS = 0; not exhausted.
    const PAST_1H = '2026-05-09T11:00:00.000Z';
    const withResetDate = makeCard({
      email: 'with-date@x.com',
      weeklyUsedPct: 20, // 80% remaining — not exhausted
      weeklyResetAt: PAST_1H
    });
    const withoutResetDate = makeCard({
      email: 'no-date@x.com',
      weeklyUsedPct: 20,
      weeklyResetAt: null
    });
    const result = assignNoBrainerScores([withoutResetDate, withResetDate], NOW);
    expect(result.find((c) => c.email === 'with-date@x.com')?.selectionRank).toBe(1);
    expect(result.find((c) => c.email === 'no-date@x.com')?.selectionRank).toBe(2);
  });

  it('falls back to stable configured display order when no other signal differs', () => {
    const first = makeCard({
      email: 'first@x.com',
      displayOrder: 0,
      weeklyUsedPct: 20,
      weeklyResetAt: null
    });
    const second = makeCard({
      email: 'second@x.com',
      displayOrder: 1,
      weeklyUsedPct: 20,
      weeklyResetAt: null
    });
    const result = assignNoBrainerScores([second, first], NOW);
    expect(result.find((c) => c.email === 'first@x.com')?.selectionRank).toBe(1);
    expect(result.find((c) => c.email === 'second@x.com')?.selectionRank).toBe(2);
  });

  it('assigns null rank to unavailable accounts even when all other accounts score zero', () => {
    const unavailable = makeCard({
      email: 'unavailable@x.com',
      status: 'unavailable',
      fiveHourUsedPct: 0,
      fiveHourResetAt: null,
      weeklyUsedPct: 20,
      weeklyResetAt: null
    });
    const reserve = makeCard({
      email: 'reserve@x.com',
      fiveHourUsedPct: 0,
      fiveHourResetAt: null,
      weeklyUsedPct: 20,
      weeklyResetAt: null
    });
    const result = assignNoBrainerScores([unavailable, reserve], NOW);
    expect(result.find((c) => c.email === 'unavailable@x.com')?.selectionRank).toBeNull();
    expect(result.find((c) => c.email === 'reserve@x.com')?.selectionRank).toBe(1);
  });

  it('does not apply fallback when at least one account in the group scores above zero', () => {
    const scoring = makeCard({
      email: 'scoring@x.com',
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    const zeroScorer = makeCard({
      email: 'zero@x.com',
      fiveHourUsedPct: 0,
      fiveHourResetAt: null,
      weeklyUsedPct: 0,
      weeklyResetAt: null
    });
    const result = assignNoBrainerScores([scoring, zeroScorer], NOW);
    expect(result.find((c) => c.email === 'scoring@x.com')?.selectionRank).toBe(1);
    expect(result.find((c) => c.email === 'zero@x.com')?.selectionRank).toBeNull();
  });
});

describe('rank assignment', () => {
  it('assigns null rank to all exhausted accounts and numbers start at 1', () => {
    const a = makeCard({
      email: 'a@x.com',
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: TOMORROW
    });
    const b = makeCard({
      email: 'b@x.com',
      fiveHourUsedPct: 100,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: TOMORROW
    });
    const result = assignNoBrainerScores([a, b], NOW);
    const aCard = result.find((c) => c.email === 'a@x.com');
    const bCard = result.find((c) => c.email === 'b@x.com');
    expect(aCard?.selectionRank).toBe(1);
    expect(bCard?.selectionRank).toBeNull();
  });

  it('resets rank numbers per provider group', () => {
    const codex1 = makeCard({
      email: 'c1@x.com',
      provider: 'codex',
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: TOMORROW
    });
    const codex2 = makeCard({
      email: 'c2@x.com',
      provider: 'codex',
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_3H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    const claude1 = {
      ...makeCard({
        email: 'cl1@x.com',
        fiveHourUsedPct: 50,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: TOMORROW
      }),
      provider: 'claude-code' as const
    };
    const result = assignNoBrainerScores([codex1, codex2, claude1], NOW);
    const c1 = result.find((c) => c.email === 'c1@x.com');
    const c2 = result.find((c) => c.email === 'c2@x.com');
    const cl1 = result.find((c) => c.email === 'cl1@x.com');
    expect(c1?.selectionRank).toBe(1);
    expect(c2?.selectionRank).toBe(2);
    expect(cl1?.selectionRank).toBe(1); // restarts at 1 for claude-code group
  });

  it('stale accounts receive reduced confidence and rank below equivalent fresh accounts', () => {
    const fresh = makeCard({
      email: 'fresh@x.com',
      status: 'fresh',
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: TOMORROW
    });
    const stale = makeCard({
      email: 'stale@x.com',
      status: 'stale',
      stale: true,
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: TOMORROW
    });
    const result = assignNoBrainerScores([stale, fresh], NOW);
    expect(result.find((c) => c.email === 'fresh@x.com')?.selectionRank).toBe(1);
    expect(result.find((c) => c.email === 'stale@x.com')?.selectionRank).toBe(2);
  });

  it('unavailable accounts receive no rank', () => {
    const unavailable = makeCard({
      email: 'unavailable@x.com',
      status: 'unavailable',
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: TOMORROW
    });
    const result = assignNoBrainerScores([unavailable], NOW);
    expect(result[0]?.selectionRank).toBeNull();
  });
});

// ─── Unit-level helper tests ───────────────────────────────────────────────────

describe('windowKind', () => {
  function win(id: string, name: string) {
    return {
      id,
      providerWindowName: name,
      usedPercentage: 0,
      resetAt: null,
      resetInText: null,
      status: 'fresh' as const
    };
  }

  it('classifies 5-hour windows by id', () => {
    expect(windowKind(win('codex:5h', 'Limit'))).toBe('five_hour');
    expect(windowKind(win('codex:5-hour', 'Limit'))).toBe('five_hour');
    expect(windowKind(win('codex:5_hour', 'Limit'))).toBe('five_hour');
  });

  it('classifies 5-hour windows by name when id does not match', () => {
    expect(windowKind(win('unknown', '5 hour limit'))).toBe('five_hour');
    expect(windowKind(win('unknown', '5-hour usage'))).toBe('five_hour');
    expect(windowKind(win('unknown', '5h usage'))).toBe('five_hour');
  });

  it('classifies weekly windows by id and by name', () => {
    expect(windowKind(win('codex:weekly', 'Limit'))).toBe('weekly');
    expect(windowKind(win('codex:week', 'Limit'))).toBe('weekly');
    expect(windowKind(win('unknown', 'Weekly limit'))).toBe('weekly');
    expect(windowKind(win('unknown', 'week usage'))).toBe('weekly');
  });

  it('returns null for unrecognised window ids and names', () => {
    expect(windowKind(win('daily', 'Daily limit'))).toBeNull();
    expect(windowKind(win('monthly', 'Monthly usage'))).toBeNull();
  });

  it('is case-insensitive for both id and name', () => {
    expect(windowKind(win('WEEKLY', 'Limit'))).toBe('weekly');
    expect(windowKind(win('5H', 'Limit'))).toBe('five_hour');
    expect(windowKind(win('unknown', 'WEEKLY LIMIT'))).toBe('weekly');
  });
});

describe('remainingPct', () => {
  it('returns 100 for null usedPercentage (nothing consumed)', () => {
    expect(remainingPct(null)).toBe(100);
  });

  it('converts used percentage to remaining percentage', () => {
    expect(remainingPct(0)).toBe(100);
    expect(remainingPct(50)).toBe(50);
    expect(remainingPct(75)).toBe(25);
    expect(remainingPct(100)).toBe(0);
  });

  it('clamps to zero when usedPercentage exceeds 100', () => {
    expect(remainingPct(110)).toBe(0);
  });
});

describe('hoursUntil', () => {
  const NOW_MS = Date.parse(NOW);

  it('returns null for null resetAt', () => {
    expect(hoursUntil(null, NOW_MS)).toBeNull();
  });

  it('returns null for an invalid date string', () => {
    expect(hoursUntil('not-a-date', NOW_MS)).toBeNull();
    expect(hoursUntil('', NOW_MS)).toBeNull();
  });

  it('returns positive hours for a future reset time', () => {
    expect(hoursUntil(IN_2H, NOW_MS)).toBe(2);
    expect(hoursUntil(IN_4H, NOW_MS)).toBe(4);
    expect(hoursUntil(IN_30MIN, NOW_MS)).toBeCloseTo(0.5, 5);
  });

  it('returns negative hours for a past reset time', () => {
    const ONE_HOUR_AGO = '2026-05-09T11:00:00.000Z';
    expect(hoursUntil(ONE_HOUR_AGO, NOW_MS)).toBe(-1);
  });
});

describe('dataConfidence', () => {
  it('returns 1.0 for fresh status', () => {
    expect(dataConfidence(makeCard({ status: 'fresh' }))).toBe(1.0);
  });

  it('returns 0.5 for stale status', () => {
    expect(dataConfidence(makeCard({ status: 'stale', stale: true }))).toBe(0.5);
  });

  it('returns 0 for unavailable, config_error, and other statuses', () => {
    expect(dataConfidence(makeCard({ status: 'unavailable' }))).toBe(0);
    expect(dataConfidence(makeCard({ status: 'config_error' }))).toBe(0);
    expect(dataConfidence(makeCard({ status: 'auth_required' }))).toBe(0);
  });
});

describe('computeNBS', () => {
  const NOW_MS = Date.parse(NOW);

  it('returns 0 when confidence is 0 (unavailable account)', () => {
    const card = makeCard({
      status: 'unavailable',
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    expect(computeNBS(card, NOW_MS)).toBe(0);
  });

  it('returns 0 when the 5-hour window is exhausted (0% remaining)', () => {
    const card = makeCard({
      fiveHourUsedPct: 100,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    expect(computeNBS(card, NOW_MS)).toBe(0);
  });

  it('returns 0 when the weekly window is exhausted (0% remaining)', () => {
    const card = makeCard({
      fiveHourUsedPct: 0,
      fiveHourResetAt: null,
      weeklyUsedPct: 100,
      weeklyResetAt: IN_20_DAYS
    });
    expect(computeNBS(card, NOW_MS)).toBe(0);
  });

  it('returns 0 when neither window provides any pressure (no reset dates known)', () => {
    const card = makeCard({ weeklyUsedPct: 0, weeklyResetAt: null });
    expect(computeNBS(card, NOW_MS)).toBe(0);
  });

  it('returns a positive score for an account with both windows and known reset dates', () => {
    const card = makeCard({
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    expect(computeNBS(card, NOW_MS)).toBeGreaterThan(0);
  });

  it('stale account scores exactly half the equivalent fresh account', () => {
    const fresh = makeCard({
      status: 'fresh',
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    const stale = makeCard({
      status: 'stale',
      stale: true,
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    expect(computeNBS(stale, NOW_MS)).toBeCloseTo(computeNBS(fresh, NOW_MS) * 0.5, 10);
  });

  it('opened account scores higher than a fresh reserve with the same weekly data', () => {
    const opened = makeCard({
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    const reserve = makeCard({ weeklyUsedPct: 0, weeklyResetAt: IN_20_DAYS });
    expect(computeNBS(opened, NOW_MS)).toBeGreaterThan(computeNBS(reserve, NOW_MS));
  });
});

describe('compareForTiebreak', () => {
  function entry(card: AccountQuotaCard, nbs: number) {
    return { card, nbs };
  }

  it('ranks the entry with higher NBS first', () => {
    const a = entry(
      makeCard({
        email: 'a@x.com',
        fiveHourUsedPct: 50,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      10
    );
    const b = entry(
      makeCard({
        email: 'b@x.com',
        fiveHourUsedPct: 50,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      5
    );
    expect(compareForTiebreak(a, b)).toBeLessThan(0);
    expect(compareForTiebreak(b, a)).toBeGreaterThan(0);
  });

  it('at equal NBS, opened account ranks above unopened account', () => {
    const opened = entry(
      makeCard({
        fiveHourUsedPct: 50,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      5
    );
    const unopened = entry(
      makeCard({
        fiveHourUsedPct: 50,
        fiveHourResetAt: null,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      5
    );
    expect(compareForTiebreak(opened, unopened)).toBeLessThan(0);
    expect(compareForTiebreak(unopened, opened)).toBeGreaterThan(0);
  });

  it('at equal NBS and opened status, higher 5h remaining ranks first', () => {
    const more = entry(
      makeCard({
        email: 'a@x.com',
        fiveHourUsedPct: 30,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      5
    ); // 70% remaining
    const less = entry(
      makeCard({
        email: 'b@x.com',
        fiveHourUsedPct: 80,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      5
    ); // 20% remaining
    expect(compareForTiebreak(more, less)).toBeLessThan(0);
  });

  it('at equal NBS, opened, and 5h remaining, earlier email sorts first', () => {
    const aaa = entry(
      makeCard({
        email: 'aaa@x.com',
        fiveHourUsedPct: 50,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      5
    );
    const bbb = entry(
      makeCard({
        email: 'bbb@x.com',
        fiveHourUsedPct: 50,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      5
    );
    expect(compareForTiebreak(aaa, bbb)).toBeLessThan(0);
    expect(compareForTiebreak(bbb, aaa)).toBeGreaterThan(0);
  });

  it('returns 0 for identical entries', () => {
    const a = entry(
      makeCard({
        email: 'same@x.com',
        fiveHourUsedPct: 50,
        fiveHourResetAt: IN_2H,
        weeklyUsedPct: 0,
        weeklyResetAt: IN_20_DAYS
      }),
      5
    );
    expect(compareForTiebreak(a, a)).toBe(0);
  });
});

describe('assignNoBrainerScores edge cases', () => {
  it('does not throw when generatedAt is an invalid date string, returning one result per input', () => {
    const card = makeCard({
      fiveHourUsedPct: 50,
      fiveHourResetAt: IN_2H,
      weeklyUsedPct: 0,
      weeklyResetAt: IN_20_DAYS
    });
    expect(() => assignNoBrainerScores([card], '')).not.toThrow();
    expect(() => assignNoBrainerScores([card], 'not-a-date')).not.toThrow();
    expect(assignNoBrainerScores([card], '').length).toBe(1);
    expect(assignNoBrainerScores([card], 'not-a-date').length).toBe(1);
  });
});

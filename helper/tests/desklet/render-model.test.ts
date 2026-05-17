// Provenance: docs/test-traceability.md — Desklet model area
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type RenderModelApi = {
  DEFAULT_POLL_COMMAND: string;
  DEFAULT_POLL_INTERVAL_SECONDS: number;
  DEFAULT_SETUP_COMMAND: string;
  PROGRESS_TRACK_WIDTH_PX: number;
  buildDeskletConfig(value: unknown): {
    pollCommand: string;
    pollIntervalSeconds: number;
    setupCommand: string;
  };
  buildRenderModel(value: unknown): {
    state: string;
    message: string | null;
    groups: {
      provider: string;
      summary: {
        windows: {
          title: string | null;
          usedPercentage: number;
          remainingText: string;
          progressFillPixels: number;
          progressFillColor: string;
        }[];
      };
      accounts: {
        email: string;
        status: string;
        statusClass: string;
        stale: boolean;
        errorHint: string | null;
        selectionRank: number | null;
        selectionRankUncertain: boolean;
        pollIntervalText: string | null;
        windows: {
          id: string;
          usedPercentage: number | null;
          percentageClass: string;
          progressText: string;
          hint: string | null;
          resetAt: string | null;
          progressFillPixels: number;
          progressFillColor: string;
        }[];
      }[];
    }[];
  };
  percentageClass(value: number | null): string;
  progressText(value: number | null): string;
  providerDisplayName(providerId: string): string;
};

const require = createRequire(import.meta.url);
const renderModel = require(
  resolve(import.meta.dirname, '../../../desklet/renderModel.js')
) as RenderModelApi;

// Traceability: BR: passive Cinnamon desklet display, BR-042 recommended account order, and BR-044 per-account poll back-off visibility; AC: missing/malformed/empty/grouped quota rendering, selectionRank passthrough from latest.json, and backend poll countdown display; TS: TSD desklet boundary, latest.json rendering, selection-rank render model, and progressive back-off addendum. NBS scoring covered by helper/tests/services/nbs.test.ts.
describe('desklet render model', () => {
  it('provides default desklet poll/setup configuration safely', () => {
    expect(renderModel.DEFAULT_POLL_COMMAND).toBe('aiqm poll --json');
    expect(renderModel.DEFAULT_POLL_INTERVAL_SECONDS).toBe(300);
    expect(renderModel.DEFAULT_SETUP_COMMAND).toBe('aiqm-setup-terminal');
    expect(renderModel.buildDeskletConfig({})).toEqual({
      pollCommand: 'aiqm poll --json',
      pollIntervalSeconds: 300,
      setupCommand: 'aiqm-setup-terminal'
    });
    expect(
      renderModel.buildDeskletConfig({
        pollCommand: 'custom poll',
        pollIntervalSeconds: 60,
        setupCommand: 'custom setup'
      })
    ).toEqual({
      pollCommand: 'custom poll',
      pollIntervalSeconds: 60,
      setupCommand: 'custom setup'
    });
    expect(renderModel.buildDeskletConfig({ pollIntervalSeconds: -1 })).toMatchObject({
      pollIntervalSeconds: 300
    });
  });

  it('renders missing or malformed latest state defensively', () => {
    expect(renderModel.buildRenderModel(null)).toMatchObject({
      state: 'malformed',
      message: 'Quota state unavailable. Run: aiqm diagnose',
      groups: []
    });
    expect(renderModel.buildRenderModel({ schemaVersion: '1' })).toMatchObject({
      state: 'malformed'
    });
  });

  it('renders empty latest state with an empty message', () => {
    expect(
      renderModel.buildRenderModel({
        schemaVersion: '1',
        generatedAt: '2026-05-09T12:00:00Z',
        accounts: []
      })
    ).toMatchObject({
      state: 'empty',
      message: 'No accounts configured. Run: aiqm setup',
      groups: []
    });
  });

  it('groups and sorts accounts by provider, display order, and email', () => {
    const model = renderModel.buildRenderModel({
      schemaVersion: '1',
      generatedAt: '2026-05-09T12:00:00Z',
      accounts: [
        {
          provider: 'fake',
          email: 'b@example.com',
          displayOrder: 2,
          status: 'fresh',
          stale: false,
          windows: []
        },
        {
          provider: 'codex',
          email: 'z@example.com',
          displayOrder: 0,
          status: 'stale',
          stale: true,
          windows: []
        },
        {
          provider: 'fake',
          email: 'a@example.com',
          displayOrder: 1,
          status: 'provider_error',
          stale: false,
          windows: []
        }
      ]
    });

    expect(model.groups.map((group) => group.provider)).toEqual(['codex', 'fake']);
    expect(model.groups[1]?.accounts.map((account) => account.email)).toEqual([
      'a@example.com',
      'b@example.com'
    ]);
    expect(model.groups[0]?.accounts[0]?.statusClass).toBe('aiqm-status-stale');
    expect(model.groups[1]?.accounts[0]?.statusClass).toBe('aiqm-status-error');
  });

  it('keeps stale and error hints visible in the render model', () => {
    const model = renderModel.buildRenderModel({
      schemaVersion: '1',
      generatedAt: '2026-05-09T12:00:00Z',
      accounts: [
        {
          provider: 'fake',
          email: 'stale@example.com',
          displayOrder: 0,
          status: 'stale',
          stale: true,
          errorHint: 'Last poll failed',
          windows: [
            {
              id: 'weekly',
              providerWindowName: 'Weekly',
              usedPercentage: 42,
              resetInText: 'resets in 2h',
              status: 'stale',
              hint: 'Window hint'
            }
          ]
        }
      ]
    });

    const account = model.groups[0]?.accounts[0];
    expect(account).toMatchObject({ stale: true, errorHint: 'Last poll failed' });
    expect(account.windows.at(0)).toMatchObject({
      hint: 'Window hint',
      progressText: '58% remaining',
      remainingText: '58% remaining',
      progressFillWidth: 58,
      progressFillPixels: 153,
      progressFillColor: '#22c55e'
    });
  });

  it('passes selectionRank from latest.json through to account render objects', () => {
    // NBS scoring is computed by the helper polling service and stored in latest.json.
    // The desklet render model reads and forwards it without recomputing.
    const model = renderModel.buildRenderModel({
      schemaVersion: '1',
      generatedAt: '2026-05-09T12:00:00.000Z',
      accounts: [
        {
          provider: 'codex',
          email: 'rank1@example.com',
          displayOrder: 0,
          status: 'fresh',
          stale: false,
          selectionRank: 1,
          windows: []
        },
        {
          provider: 'codex',
          email: 'rank2@example.com',
          displayOrder: 1,
          status: 'fresh',
          stale: false,
          selectionRank: 2,
          windows: []
        },
        {
          provider: 'codex',
          email: 'unranked@example.com',
          displayOrder: 2,
          status: 'fresh',
          stale: false,
          selectionRank: null,
          windows: []
        },
        {
          provider: 'claude-code',
          email: 'claude-rank1@example.com',
          displayOrder: 3,
          status: 'fresh',
          stale: false,
          selectionRank: 1,
          windows: []
        }
      ]
    });

    const codexAccounts = model.groups.find((g) => g.provider === 'codex')?.accounts ?? [];
    expect(codexAccounts.map((a) => [a.email, a.selectionRank])).toEqual([
      ['rank1@example.com', 1],
      ['rank2@example.com', 2],
      ['unranked@example.com', null]
    ]);

    const claudeAccounts = model.groups.find((g) => g.provider === 'claude-code')?.accounts ?? [];
    expect(claudeAccounts.map((a) => [a.email, a.selectionRank])).toEqual([
      ['claude-rank1@example.com', 1]
    ]);
  });

  it('sets selectionRankUncertain true only for stale accounts that have a rank (BR-042-AC-013)', () => {
    // TSD Section 11.4: stale ranked accounts should show a data-uncertainty indicator.
    const model = renderModel.buildRenderModel({
      schemaVersion: '1',
      generatedAt: '2026-05-09T12:00:00.000Z',
      accounts: [
        {
          provider: 'codex',
          email: 'fresh-ranked@example.com',
          displayOrder: 0,
          status: 'fresh',
          stale: false,
          selectionRank: 1,
          windows: []
        },
        {
          provider: 'codex',
          email: 'stale-ranked@example.com',
          displayOrder: 1,
          status: 'stale',
          stale: true,
          selectionRank: 2,
          windows: []
        },
        {
          provider: 'codex',
          email: 'stale-unranked@example.com',
          displayOrder: 2,
          status: 'stale',
          stale: true,
          selectionRank: null,
          windows: []
        }
      ]
    });
    const accounts = model.groups.find((g) => g.provider === 'codex')?.accounts ?? [];
    expect(
      accounts.find((a) => a.email === 'fresh-ranked@example.com')?.selectionRankUncertain
    ).toBe(false);
    expect(
      accounts.find((a) => a.email === 'stale-ranked@example.com')?.selectionRankUncertain
    ).toBe(true);
    expect(
      accounts.find((a) => a.email === 'stale-unranked@example.com')?.selectionRankUncertain
    ).toBe(false);
  });

  // Traceability: BR-044 per-account progressive back-off visibility; AC: desklet renders nextPollEligibleAt as a countdown plus effective interval, marks due/overdue accounts, and hides malformed timing data; TS: TSD Current Implementation Addendum — Progressive back-off algorithm and Desklet sections.
  it('formats backend poll countdown plus effective interval on account render objects', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00.000Z'));
    try {
      const model = renderModel.buildRenderModel({
        schemaVersion: '1',
        generatedAt: '2026-05-09T12:00:00.000Z',
        accounts: [
          {
            provider: 'codex',
            email: 'soon@example.com',
            displayOrder: 0,
            status: 'fresh',
            stale: false,
            effectivePollIntervalSeconds: 1800,
            nextPollEligibleAt: '2026-05-09T12:12:00.000Z',
            windows: []
          },
          {
            provider: 'codex',
            email: 'long@example.com',
            displayOrder: 1,
            status: 'fresh',
            stale: false,
            effectivePollIntervalSeconds: 9000,
            nextPollEligibleAt: '2026-05-09T14:05:00.000Z',
            windows: []
          }
        ]
      });

      const accounts = model.groups.find((g) => g.provider === 'codex')?.accounts ?? [];
      expect(accounts.map((a) => [a.email, a.pollIntervalText])).toEqual([
        ['soon@example.com', '↻ 12m left / 30m'],
        ['long@example.com', '↻ 2h 5m left / 2h 30m']
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows backend poll timing as due when the account is eligible now or overdue', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00.000Z'));
    try {
      const model = renderModel.buildRenderModel({
        schemaVersion: '1',
        generatedAt: '2026-05-09T12:00:00.000Z',
        accounts: [
          {
            provider: 'codex',
            email: 'due@example.com',
            displayOrder: 0,
            status: 'fresh',
            stale: false,
            effectivePollIntervalSeconds: 60,
            nextPollEligibleAt: '2026-05-09T11:59:00.000Z',
            windows: []
          }
        ]
      });

      expect(model.groups[0]?.accounts[0]?.pollIntervalText).toBe('↻ due / 1m');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides backend poll timing when timestamp or interval data is missing or malformed', () => {
    const model = renderModel.buildRenderModel({
      schemaVersion: '1',
      generatedAt: '2026-05-09T12:00:00.000Z',
      accounts: [
        {
          provider: 'codex',
          email: 'missing-date@example.com',
          displayOrder: 0,
          status: 'fresh',
          stale: false,
          effectivePollIntervalSeconds: 60,
          windows: []
        },
        {
          provider: 'codex',
          email: 'bad-date@example.com',
          displayOrder: 1,
          status: 'fresh',
          stale: false,
          effectivePollIntervalSeconds: 60,
          nextPollEligibleAt: 'not-a-date',
          windows: []
        },
        {
          provider: 'codex',
          email: 'missing-interval@example.com',
          displayOrder: 2,
          status: 'fresh',
          stale: false,
          nextPollEligibleAt: '2026-05-09T12:01:00.000Z',
          windows: []
        }
      ]
    });

    const accounts = model.groups.find((g) => g.provider === 'codex')?.accounts ?? [];
    expect(accounts.map((a) => a.pollIntervalText)).toEqual([null, null, null]);
  });

  it('builds remaining progress text for quota windows', () => {
    expect(renderModel.progressText(null)).toBe('unknown remaining');
    expect(renderModel.progressText(Number.NaN)).toBe('unknown remaining');
    expect(renderModel.progressText(0)).toBe('100% remaining');
    expect(renderModel.progressText(42)).toBe('58% remaining');
    expect(renderModel.progressText(100)).toBe('0% remaining');
  });

  it('exposes pixel-locked progress fill values for Cinnamon rendering', () => {
    expect(renderModel.PROGRESS_TRACK_WIDTH_PX).toBe(264);
    const model = renderModel.buildRenderModel({
      schemaVersion: '1',
      generatedAt: '2026-05-09T12:00:00Z',
      accounts: [
        {
          provider: 'fake',
          email: 'progress@example.com',
          displayOrder: 0,
          status: 'fresh',
          stale: false,
          windows: [
            { id: 'ok', providerWindowName: 'OK', usedPercentage: 10, status: 'fresh' },
            { id: 'warning', providerWindowName: 'Warning', usedPercentage: 50, status: 'fresh' },
            {
              id: 'critical',
              providerWindowName: 'Critical',
              usedPercentage: 100,
              status: 'fresh'
            },
            { id: 'unknown', providerWindowName: 'Unknown', usedPercentage: null, status: 'fresh' }
          ]
        }
      ]
    });

    expect(
      model.groups[0]?.accounts[0]?.windows.map((window) => [
        window.progressFillPixels,
        window.progressFillColor
      ])
    ).toEqual([
      [238, '#22c55e'],
      [132, '#f7c948'],
      [1, '#ef4444'],
      [1, '#9ca3af']
    ]);
  });

  it('assigns spec threshold classes to quota windows', () => {
    expect(renderModel.percentageClass(null)).toBe('aiqm-quota-unknown');
    expect(renderModel.percentageClass(Number.NaN)).toBe('aiqm-quota-unknown');
    expect(renderModel.percentageClass(49)).toBe('aiqm-quota-ok');
    expect(renderModel.percentageClass(50)).toBe('aiqm-quota-warning');
    expect(renderModel.percentageClass(74)).toBe('aiqm-quota-warning');
    expect(renderModel.percentageClass(75)).toBe('aiqm-quota-critical');
    expect(renderModel.percentageClass(100)).toBe('aiqm-quota-critical');
  });

  it('providerDisplayName returns human-readable labels for known providers and capitalises unknown ones', () => {
    expect(renderModel.providerDisplayName('codex')).toBe('Codex');
    expect(renderModel.providerDisplayName('claude-code')).toBe('Claude Code');
    expect(renderModel.providerDisplayName('antigravity')).toBe('Antigravity');
    expect(renderModel.providerDisplayName('someNewProvider')).toBe('SomeNewProvider');
    expect(renderModel.providerDisplayName('')).toBe('Unknown');
  });

  it('window detection parity: summary recognises canonical Codex and Claude Code window IDs', () => {
    // Verifies that renderModel.js fiveHourWindow/weeklyWindow classify the same canonical
    // window IDs that nbs.ts windowKind uses, so both implementations stay in sync.
    const model = renderModel.buildRenderModel({
      schemaVersion: '1',
      generatedAt: '2026-05-09T12:00:00Z',
      accounts: [
        {
          provider: 'codex',
          email: 'parity@example.com',
          displayOrder: 0,
          status: 'fresh',
          stale: false,
          windows: [
            {
              id: 'codex:5h',
              providerWindowName: '5 Hour Limit',
              usedPercentage: 30,
              status: 'fresh'
            },
            {
              id: 'codex:weekly',
              providerWindowName: 'Weekly Limit',
              usedPercentage: 20,
              status: 'fresh'
            }
          ]
        },
        {
          provider: 'claude-code',
          email: 'parity2@example.com',
          displayOrder: 0,
          status: 'fresh',
          stale: false,
          windows: [
            {
              id: 'claude-code:5h',
              providerWindowName: '5 Hour Limit',
              usedPercentage: 40,
              status: 'fresh'
            },
            {
              id: 'claude-code:weekly',
              providerWindowName: 'Weekly Limit',
              usedPercentage: 50,
              status: 'fresh'
            }
          ]
        }
      ]
    });

    const codexSummary = model.groups.find((g) => g.provider === 'codex')?.summary;
    const claudeSummary = model.groups.find((g) => g.provider === 'claude-code')?.summary;

    // Both windows recognised — summary has exactly 2 entries (5h and weekly)
    expect(codexSummary?.windows).toHaveLength(2);
    expect(claudeSummary?.windows).toHaveLength(2);

    // Values match the single account's values (average of one)
    expect(codexSummary?.windows[0]?.usedPercentage).toBe(30);
    expect(codexSummary?.windows[1]?.usedPercentage).toBe(20);
    expect(claudeSummary?.windows[0]?.usedPercentage).toBe(40);
    expect(claudeSummary?.windows[1]?.usedPercentage).toBe(50);
  });

  it('excludes exhausted accounts from the provider summary average', () => {
    // Exhausted account (100% used) must not drag down the summary for a healthy account.
    const model = renderModel.buildRenderModel({
      schemaVersion: '1',
      generatedAt: '2026-05-09T12:00:00.000Z',
      accounts: [
        {
          provider: 'codex',
          email: 'healthy@example.com',
          displayOrder: 0,
          status: 'fresh',
          stale: false,
          selectionRank: 1,
          windows: [
            {
              id: 'codex:5h',
              providerWindowName: '5 hour limit',
              usedPercentage: 40,
              resetAt: null,
              resetInText: null,
              status: 'fresh'
            }
          ]
        },
        {
          provider: 'codex',
          email: 'exhausted@example.com',
          displayOrder: 1,
          status: 'fresh',
          stale: false,
          selectionRank: null,
          windows: [
            {
              id: 'codex:5h',
              providerWindowName: '5 hour limit',
              usedPercentage: 100,
              resetAt: null,
              resetInText: null,
              status: 'fresh'
            }
          ]
        }
      ]
    });

    const summary = model.groups.find((g) => g.provider === 'codex')?.summary;
    // With the exhausted account excluded, the average should equal the healthy account's value (40).
    // Without the fix, the average would be (40 + 100) / 2 = 70.
    expect(summary?.windows[0]?.usedPercentage).toBe(40);
  });
});

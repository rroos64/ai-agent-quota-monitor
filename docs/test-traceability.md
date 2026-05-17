# Test Traceability and Provenance

AIQM tests use traceability comments in test files to connect implementation coverage to requirements, acceptance criteria, and technical specifications.

## Current requirement anchors

- BR-001 account add/setup: TUI and setup action tests.
- BR-002 provider authentication: Codex auth harness/actions and setup TUI tests.
- BR-003 email validation: polling-service email-mismatch scenario; fake-provider-contract email-mismatch test.
- BR-004 secure local storage: storage, provider profile, token, and security tests.
- BR-005 account delete/logout/re-login: account command tests and TUI setup action coverage.
- BR-006 reset all local data: `helper/tests/cli/` reset command tests.
- BR-007/008/012 desklet display: desklet render-model tests.
- BR-009 email display: desklet render-model tests (email field on account render object).
- BR-010 provider window names: desklet render-model tests (providerWindowName passthrough and windowTitle formatting).
- BR-011 account-level quota: desklet render-model and polling-service tests (account cards carry window-level not model-level data).
- BR-013 reset time display: desklet render-model tests (resetInText passthrough, null handling).
- BR-014 low-usage state: desklet render-model tests (green fill colour and aiqm-quota-ok class at < 50% used).
- BR-015 medium-usage state: desklet render-model tests (amber fill colour and aiqm-quota-warning class at 50–74% used).
- BR-016 high-usage state: desklet render-model tests (red fill colour and aiqm-quota-critical class at ≥ 75% used).
- BR-017 provider visual identity: desklet render-model tests (accounts grouped by provider, provider field on group object).
- BR-018 no desktop notifications: no notification code path exists; verified by code review and absence of Cinnamon notification API usage.
- BR-019 refresh: polling service tests and systemd installer validation.
- BR-020 asynchronous refresh: polling-service concurrency test (`polls accounts concurrently while preserving deterministic order`).
- BR-021 no manual refresh: no manual-refresh button exists in desklet or TUI; verified by code review.
- BR-022 offline behaviour: polling-service stale-merge tests (offline/auth-required scenarios mark cards as stale).
- BR-023 battery behaviour: no battery-specific code path exists; polling timer runs unconditionally; verified by code review.
- BR-024 stale after one failed update: polling-service stale-merge tests (`keeps previous quota visible as stale when a later poll…`).
- BR-025 last known values: polling-service stale-merge tests (windows retained in stale card).
- BR-026 stale display: desklet render-model tests (`aiqm-status-stale` class and `stale: true` passthrough).
- BR-027 error hints: polling-service errorHint tests; desklet render-model `errorHint` passthrough test.
- BR-028 provider failure isolation: polling-service concurrency test (`isolates one concurrent account failure without blocking successful accounts`).
- BR-029 quota history: polling-service history-writer tests (`records history entries for successful polls`).
- BR-030 history retention: history-writer storage tests (append-only writes; reset-command removes file).
- BR-031 local logs: security tests (logger redaction, log file growth bound).
- BR-032 LMDE/Cinnamon desklet: desklet render-model tests exercise the JavaScript render model loaded by the Cinnamon desklet; full Cinnamon runtime is not testable in CI.
- BR-033 Node.js dependency: documented runtime requirement; verified by CI Node.js LTS matrix.
- BR-034 terminal setup: documented installation requirement; verified by install.md and setup command non-JSON output test.
- BR-035 no root requirement: no root privilege checks exist in code; verified by code review.
- BR-036 auto-detection: Codex adapter tests cover auto-detection of AIQM-owned Codex profile paths.
- BR-037 passive monitor only: provider adapter tests assert no agent-session or prompt commands are issued during quota fetch; BR-043-AC-004 also covers this for Claude Code.
- BR-038 no account switching: no account-switching code path exists; verified by code review.
- BR-039 no account rotation: no rotation code path exists; verified by code review.
- BR-040 no quota-consuming refresh: provider adapter tests assert fetch methods do not issue model prompts; BR-043-AC-004 covers Claude Code specifically.
- BR-041 no billing management: no billing API calls exist in codebase; verified by code review.
- BR-042 No-Brainer Score: `helper/tests/services/nbs.test.ts` (behavioural examples, rank assignment, all-zero fallback) and desklet render-model tests (selectionRank passthrough, selectionRankUncertain for stale-ranked accounts).
- BR-043 Claude Code provider: multiple test files — see Claude Code provider traceability section below.
- BR-044 per-account progressive poll back-off: polling-service back-off tests — see Progressive back-off coverage section below.
- BR-045 AIQM-owned Codex account sessions: Codex auth harness tests, provider-profile store tests, and TUI Codex auth action tests.
- BR-046 account management TUI: `helper/tests/tui/setup-actions.test.ts` and `helper/tests/cli/setup-command.test.ts`.
- BR-047 reliable background refresh: systemd installer validation and polling-service latest-state writer tests.
- BR-048 Codex quota semantics: `helper/tests/providers/` Codex parser and adapter tests (rate-limit window handling, credits field ignored).
- BR-049 compact desklet UX: desklet render-model grouping, provider summary, and selectionRank tests.
- Security requirements: redaction, secret leak, logger, diagnose/reset tests.
- Boundary contracts: JSON Schema/Zod parity tests.

## Test groups

| Area | Files | Provenance |
| --- | --- | --- |
| Domain contracts | `helper/tests/domain`, `helper/tests/validation`, `helper/tests/contract` | BRD domain/status/storage acceptance criteria; TSD domain and v1 contracts |
| Storage | `helper/tests/storage` | App path, atomic write, config/latest/history/token/profile store boundaries |
| Providers | `helper/tests/providers` | Fake provider, Codex parser/transport/auth harness, Claude Code parser/adapter/auth actions, provider command safety |
| Polling | `helper/tests/services/polling-service.test.ts` | latest-state writer, stale merge, history writes, per-provider poll cooldown skips, concurrent isolation |
| NBS ranking | `helper/tests/services/nbs.test.ts` | No-Brainer Score behavioural examples, rank assignment, stale confidence, per-provider restart |
| Setup/TUI | `helper/tests/tui`, `helper/tests/cli/setup-command.test.ts` | setup action safety, Codex auth action orchestration, Claude auth actions, non-interactive setup model |
| CLI | `helper/tests/cli` | account/status/poll/diagnose/reset command behaviour, claude-statusline-dump |
| Security | `helper/tests/security` | no secret leakage, redaction, diagnostics logging |
| Desklet model | `helper/tests/desklet` | display-safe rendering model consumed by Cinnamon desklet |

## Current implementation notes for tests

- Tests must not require real Codex credentials, Cinnamon runtime, or live provider network calls.
- Codex live probing remains hidden/opt-in only.
- Fixtures under `fixtures/providers/codex` are redacted examples.
- `temp/` files are not test fixtures and should not be committed.
- Test traces should refer to this doc plus BRD/TSD sections where practical.
- BRs that describe an absence of a feature (BR-018, BR-021, BR-023, BR-035, BR-038, BR-039, BR-041) are verified by code review and the absence of the relevant API calls or code paths; they do not require dedicated test cases.

## Recent provenance updates

The current development slice includes:

- AIQM-owned Codex browser login.
- Codex app-server quota transport using `account/rateLimits/read`.
- Background `systemd --user` polling timer.
- Desklet collapsible provider sections contracted by default; concertina behaviour (at most one open at a time).
- TUI account management: add, edit name, reorder, logout-keep-account, delete, re-login.
- Metadata-only edits do not perform live provider polls.
- Re-login relies on a single `pollAll()` verification path.
- Logger file growth is bounded.
- BR numbering: original BR-022/026 retained in section 6; implementation-alignment requirements renumbered to BR-045/049.

## No-Brainer Score coverage

`helper/tests/services/nbs.test.ts` covers BR-042 / TSD No-Brainer Score (section 12) at two levels:

**Integration level** (through `assignNoBrainerScores`): six behavioural examples from TSD section 12; rank-assignment tests (null rank for unavailable accounts, restart per provider group, stale confidence reduction); all-zero fallback tests for BR-042-AC-009–AC-012 (TSD section 11.3).

**Unit level** (direct function exports): `windowKind` — id/name classification, case-insensitivity, null fallback; `remainingPct` — null input, boundary values (0/50/100/110), clamping; `hoursUntil` — null, invalid date, future/past timestamps; `dataConfidence` — fresh (1.0), stale (0.5), unavailable/other (0); `computeNBS` — zero cases (confidence=0, 5h exhausted, weekly exhausted, no pressure), positive score, stale halving, opened vs reserve; `compareForTiebreak` — NBS ordering, opened preference, 5h remaining tiebreak, email alphabetical, self-equality; `assignNoBrainerScores` — invalid `generatedAt` does not throw.

**Desklet render-model level**: `selectionRank` passthrough from `latest.json`; `selectionRankUncertain: true` for stale-ranked accounts (BR-042-AC-013, TSD section 11.4); `providerDisplayName` for known providers and generic capitalisation fallback; provider summary excludes exhausted windows from average.

## Window detection parity coverage

`helper/tests/desklet/render-model.test.ts` ("window detection parity") verifies that `fiveHourWindow`/`weeklyWindow` in `renderModel.js` correctly classify the canonical window IDs used by both Codex (`codex:5h`, `codex:weekly`) and Claude Code (`claude-code:5h`, `claude-code:weekly`). This catches drift between the JavaScript render model and the TypeScript `windowKind` function in `nbs.ts` if either is updated without updating the other.

## Antigravity provider skeleton coverage

`helper/tests/providers/provider-skeletons.test.ts` covers the Antigravity skeleton (BACK-001):
- Adapter exports `providerId: 'antigravity'` and `providerName: 'Antigravity'` and rejects all operations as `ProviderNotImplementedError`.
- `ProviderCapabilitiesService.get('antigravity')` returns `{ implemented: false, usable: false, status: 'not_implemented' }`.

Full Antigravity provider test coverage (adapter boundary, parser, auth actions) is deferred until the implementation spike is complete.

## Progress bar colour regression coverage

Desklet render-model tests verify pixel-locked progress fill widths and explicit fill colours for ok, warning, critical, and unknown quota states so Cinnamon rendering regressions are caught before install. These cover BR-014, BR-015, and BR-016 acceptance criteria.

## Poll liveness regression coverage

Codex transport tests cover timeout cleanup by asserting that live app-server child processes are signalled when a transport attempt fails. Installer validation covers presence and regeneration of the user poll units.

## Progressive back-off coverage

Polling-service tests cover BR-044 by verifying:

- Account-specific poll interval overrides are applied independently from provider defaults.
- `effectivePollIntervalSeconds` doubles when successful quota data is unchanged.
- Reset-time (`resetAt`) drift alone does not count as quota data change.
- Fresh unchanged accounts use their effective interval for skip decisions, not only the config min.
- A thrown provider error doubles the interval.
- Error/non-fresh accounts use their stored effective interval for skip decisions and cap normal doubling at the configured max.
- Provider `not-before` and `retry-after` values become the next effective interval even when larger than the configured max.

## Claude Code provider traceability

- BR-043 / BR-043-AC-001..004: `helper/tests/providers/claude-code-parser.test.ts` verifies redacted auth-status parsing, future quota-window normalisation, auth-required mapping, reached-limit mapping, and malformed-shape rejection using fixtures in `fixtures/providers/claude-code/`.

- BR-043 adapter boundary: `helper/tests/providers/claude-code-adapter.test.ts` covers spike-required setup, required AIQM-owned Claude config directory, auth-status validation through a safe stub transport, quota normalisation through an injected read-only stub transport, and safe failure when OAuth credentials are unavailable.

- BR-043 Claude profile isolation: `helper/tests/cli/claude-profile-import.test.ts` and provider-profile store tests cover AIQM-owned Claude config import, private permissions, and symlink rejection.

- BR-043 Claude auth actions: `helper/tests/tui/claude-auth-actions.test.ts` covers browser-login start with isolated `CLAUDE_CONFIG_DIR`, safe process serialisation, status polling, cancellation, and setup submission through the shared account-add path.

- BR-043 Claude setup TUI entry: setup command wiring and typecheck/CI cover the TUI action integration for `(a) Claude`; action behaviour remains covered by `helper/tests/tui/claude-auth-actions.test.ts`.

- BR-043 Claude quota source: `helper/tests/providers/claude-code-parser.test.ts` covers Anthropic's unofficial OAuth usage response shape and verifies that `utilization` is treated as percentage used. `helper/tests/providers/claude-statusline-snapshot.test.ts` and `helper/tests/cli/claude-statusline-dump.test.ts` cover passive statusLine extraction, normalised snapshot persistence, compact status-line output, and raw-secret exclusion.

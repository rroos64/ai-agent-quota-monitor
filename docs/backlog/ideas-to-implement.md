# Ideas to Implement

---

## BACK-001 — Google Antigravity provider implementation

**Priority:** High (v1 scope per BRD section 5.1)
**Category:** Provider integration

Google Antigravity is listed as a v1 in-scope provider in BRD section 5.1 and BR-001 provider selection. The domain type `ProviderId` already includes `'antigravity'`. Skeleton implemented — 2026-05-16.

**Skeleton complete (2026-05-16):**
- `helper/src/providers/antigravity/antigravity-provider-adapter.ts` — `AntigravityProviderAdapter extends AbstractProviderAdapter`; all ops (`authenticate`, `validateAccount`, `fetchQuota`) throw `ProviderNotImplementedError`.
- `helper/src/providers/antigravity/index.ts` — re-exports adapter.
- `helper/src/providers/index.ts` — exports antigravity.
- `helper/src/providers/poll-defaults.ts` — placeholder entry added (`min: 300s, max: 3600s, ratio: 2`); update when API rate-limit behaviour is known.
- `helper/tests/providers/provider-skeletons.test.ts` — two new tests: adapter exports correct id/name and rejects all ops as `ProviderNotImplementedError`; capabilities service returns `not_implemented` for antigravity.

**Remaining work before Antigravity is usable:**
1. **Authentication**: AIQM-owned browser login with isolated profile directory (`providers/antigravity/<email>/antigravity-home`). Follows BR-002 and the AIQM-owned session model.
2. **`fetchQuota`**: Identify and implement the Antigravity quota endpoint. Document whether it is official or unofficial (KR-002 risk pattern).
3. **`normaliseQuota`**: Map Antigravity quota window names and usage fields to `ProviderQuotaResult` and `AccountQuotaCard`.
4. **Parser contracts**: Commit redacted fixture files under `fixtures/providers/antigravity/`. No live credentials in fixtures.
5. **Test coverage**: Adapter boundary tests, parser tests, auth harness/action tests. All must pass without live credentials (CI constraint from test-traceability.md).
6. **BRD ACs**: Write acceptance criteria for Antigravity-specific behaviour under existing BR structure.
7. **test-traceability.md**: Add traceability rows for all new Antigravity ACs.
8. **Poll defaults**: Update placeholder in `poll-defaults.ts` once API rate-limit behaviour is known.
9. **Desklet icon**: Add `icons/antigravity.png` following the existing icon pattern.
10. **NBS**: Verify 5h/weekly window detection handles Antigravity window IDs once window names are known.
11. **Bootstrap**: Register `AntigravityProviderAdapter` in `bootstrap.ts` only once the adapter is usable.

---

## BACK-002 — Live Claude usage data retrieval with freshness-first source hierarchy

**Priority:** High (extends BR-042 No-Brainer Score and BR-043 Claude Code provider)
**Category:** Provider enhancement / data quality

### Problem

The current Claude Code provider (`helper/src/providers/claude-code/`) retrieves quota via a single path: Anthropic's unofficial OAuth usage endpoint, called on every polling pass that is not skipped by back-off. There is no mechanism to prefer a fresher already-available local source over a live API call, no structured source confidence model, and no multi-source fallback hierarchy. This means the No-Brainer Score receives quota data of mixed freshness with no signal about how much to trust it.

The plan in `temp/claude_live_usage_plan.md` specifies the correct long-term architecture.

### Target architecture

All source-specific complexity lives inside usage provider adapters. The ranking engine consumes only normalised snapshots. It never reads files, extension caches, or APIs directly.

```text
Usage source
  -> ClaudeUsageProvider (adapter)
  -> NormalisedUsageSnapshot
  -> No-Brainer Score
```

Each polling pass must follow a freshness-first strategy:

1. Check alternate/local sources (VS Code extension cache, earlier collector output, any trusted local snapshot).
2. If a newer valid snapshot exists, use it and skip the API call.
3. Only call the unofficial API if no newer valid alternate source exists, the source is configured, and back-off allows it.
4. On API failure or rate-limit, retain the best available snapshot and update back-off state.

### Required output shape — `NormalisedUsageSnapshot`

Every usage adapter must return this shape (or a structured failure):

| Field | Meaning |
|---|---|
| `accountId` | Stable internal account identifier |
| `accountLabel` | Human-readable label (e.g. "Claude Personal") |
| `provider` | `"claude-code"` |
| `observedAt` | ISO timestamp when the data was collected |
| `source` | Origin: `claude-usage-endpoint`, `vscode-extension-cache`, `local-estimate`, etc. |
| `sourceConfidence` | `high` / `medium` / `low` |
| `fiveHourRemainingPct` | Remaining quota in the 5-hour window, as a percentage |
| `fiveHourResetAt` | Absolute reset time for the 5-hour window, if known |
| `weeklyRemainingPct` | Remaining quota in the weekly window, as a percentage |
| `weeklyResetAt` | Absolute reset time for the weekly window, if known |
| `warnings` | Compact human-readable notes about stale, partial, inferred, or degraded data |
| `rawMetadataReference` | Optional pointer to debug data, not shown in UI by default |

A source is **valid** for replacing the stored snapshot only if: it maps to the same configured account; it contains enough fields for ranking; it is not marked failed or partial; its `observedAt` is trustworthy; and its `sourceConfidence` meets the minimum accepted level.

A source is **newer** only if `source.observedAt > storedSnapshot.observedAt`.

### Source priority hierarchy

Sources are evaluated in order on each polling pass. The first source that yields a newer valid snapshot wins; the API is not called.

| Priority | Source | Confidence | Notes |
|---|---|---|---|
| A | Any already-available local/alternate source (newest) | medium–high | VS Code extension cache, authenticated web-page extraction cache, trusted collector output |
| B | Unofficial API — Anthropic OAuth usage endpoint | high | Fallback only; must respect back-off |
| C | Authenticated Claude.ai web usage page | medium–high | DOM extraction; brittle selectors |
| D | VS Code extension local state | medium | Explicit remaining pct + reset times required; low if stale |
| E | Claude Code local credentials + usage query | medium | Unofficial; strict security handling required |
| F | Local JSONL/transcript estimates | low (for live quota) | Last resort; do not use as primary NBS input |

Sources C–F are implementation options for Source A on a given machine. The adapter discovery phase (Phase 1) determines which are available.

### Data quality and confidence model

`sourceConfidence` must be set honestly:

- `high` — direct live API or authenticated page, recently fetched.
- `medium` — trusted extension cache, recently updated and containing explicit fields.
- `low` — inferred, stale, partially parsed, or transcript-derived.

Freshness tags on snapshots:

- `fresh` — observed recently enough for ranking (goal: < 2 minutes).
- `stale` — older than the configured freshness threshold.
- `unknown` — no reliable `observedAt`.

The No-Brainer Score must degrade low-confidence or stale snapshots rather than treating them as equivalent to known-good data (BR-042-AC-008).

### API back-off state (per account)

| Field | Meaning |
|---|---|
| `lastAttemptAt` | When the last API call was made |
| `lastSuccessAt` | When the last successful API call returned |
| `failureCount` | Consecutive failure count |
| `backoffUntil` | Do not call the API before this timestamp |
| `lastFailureReason` | Last failure code (rate-limit, auth-failed, parse-failed, etc.) |

Back-off triggers: rate-limit responses, authentication failures, repeated network failures, repeated parse failures, unexpected response shapes.

The app must not call the unofficial API while `backoffUntil` is in the future during normal background polling. Manual forced refresh now exists in the CLI/TUI and is an explicit user risk acceptance path; any future Claude source-specific hard back-off must decide whether it is stricter than the current generic force override and document that boundary.

### Security requirements

This feature reads sensitive local Claude credential material. The following are always sensitive:

```text
Claude session keys and OAuth tokens
Organisation IDs
Cookies
Transcript contents and project paths
Prompt and response logs
```

Rules:
- Never log credentials or raw tokens.
- Never expose credentials in the UI or in log files.
- Never send credentials to third-party services.
- Keep raw debug dumps opt-in only (behind `--debug` or equivalent).
- Redact sensitive fields before writing anything to `latest.json`, `history.log`, or any log file.
- Store only what is necessary for ranking; do not copy credential material into plain-text app files unless unavoidable and user-accepted.
- Separate credential material, usage snapshots, and debug metadata at the data model level.

These extend the existing rules in `docs/security.md` and the AIQM-owned credential isolation model (BR-043).

### Multi-account handling

The system must not assume a single Claude local session represents all accounts.

Each configured account needs: internal account ID, display label, source configuration, credential/session reference, last successful observation, last failed observation, and confidence level.

If multiple browser profiles or VS Code profiles are in use, each profile may need a separate source configuration entry.

### Structured failure codes

Adapters must return structured failures rather than throwing unhandled exceptions:

```text
not_configured, not_logged_in, credentials_expired, network_failed,
rate_limited, selector_failed, extension_cache_missing, state_stale,
parse_failed, unsupported_account_type
```

A failure must not crash ranking. Accounts with no usable live data should still appear (if configured) with low confidence or unknown state.

### Implementation phases

**Phase 1 — Discovery tool**

Build an `aiqm diagnose --claude-sources` (or equivalent) command that discovers available Claude usage sources on the local machine without exposing sensitive data.

Output must answer: which Claude-related sources exist; which contain likely usage data and reset times; which are fresh; which appear to contain credentials.

Success criteria: the app can identify which source route is most promising on the user's machine.

**Phase 2 — Normalised provider interface**

Define the `NormalisedUsageSnapshot` type (Zod schema + TypeScript type) and the adapter contract (`ClaudeUsageProvider` interface). Write a mock adapter that returns a fixture snapshot.

Success criteria: the ranking engine can consume a mock Claude usage snapshot through the contract without knowing its origin.

**Phase 3 — Alternate-source adapter**

Implement the most promising alternate/local source found during Phase 1. Start with the VS Code extension cache if it already contains explicit remaining percentages, reset times, account identity, and a trustworthy `observedAt`.

Success criteria: the app detects a newer valid local snapshot and uses it without making an unofficial API call.

**Phase 4 — Backoff-aware API adapter**

Implement the unofficial API adapter (`claude-usage-endpoint`) as a fallback-only source. Wire back-off state per account.

Success criteria: the app calls the API only when no newer valid alternate source exists and back-off allows it; success/failure metadata is stored per account.

**Phase 5 — Polling orchestration**

Implement the source-selection logic for each polling pass inside the polling service or a dedicated `ClaudeUsageOrchestrator`.

Success criteria: every polling pass checks alternate/local sources first; a newer valid alternate snapshot prevents an API call; API back-off is respected; the best available snapshot is retained when refresh fails.

**Phase 6 — Multi-account support**

Allow multiple Claude accounts or browser profiles to be configured under the Claude Code provider.

Success criteria: the app can display separate live usage snapshots for multiple Claude accounts, each with independent back-off state.

**Phase 7 — Confidence-aware ranking integration**

Feed `NormalisedUsageSnapshot` snapshots into the No-Brainer Score. Verify the scorer applies correct confidence degradation.

Success criteria: known-good live data outranks stale inferred data; exhausted weekly accounts do not rank; unopened weekly-urgent accounts can rank above opened long-dated accounts (existing BR-042 ACs verified end-to-end with live-shaped snapshots).

### Remaining work checklist

1. **Phase 1**: Build discovery diagnostic command; identify which sources exist on the local machine; document findings before writing any adapter.
2. **Phase 2**: Define `NormalisedUsageSnapshot` Zod schema and `ClaudeUsageProvider` interface; add to boundary contracts in `docs/boundary-contracts.md`; write mock adapter for use in tests.
3. **Phase 3**: Implement highest-priority alternate-source adapter from Phase 1 findings.
4. **Phase 4**: Implement backoff-aware unofficial API adapter; wire per-account back-off state into provider storage.
5. **Phase 5**: Implement `ClaudeUsageOrchestrator` source-selection logic; update polling service to call it; add orchestration tests covering freshness-first priority and back-off paths.
6. **Phase 6**: Extend account model to support multiple Claude browser profiles; update TUI setup flow; update NBS per-provider rank restart.
7. **Phase 7**: Wire normalised snapshots into NBS; add confidence degradation tests; verify BR-042-AC-001 through AC-013 hold end-to-end.
8. **BRD ACs**: Write new acceptance criteria under BR-043 for source priority, back-off, structured failures, and multi-account handling; or add a new BR if the scope warrants it.
9. **test-traceability.md**: Add traceability rows for all new ACs and phases once written.
10. **Security review**: Confirm no credential material appears in `latest.json`, logs, fixtures, or diagnostic output.
11. **Fixtures**: Commit redacted fixture files for each new source adapter under `fixtures/providers/claude-code/`; no live credentials in fixtures (BR-043-AC-001).
12. **CI**: All new tests must pass without live Claude credentials, real VS Code state, or network access (CI constraint from `docs/test-traceability.md`).

### References

- `temp/claude_live_usage_plan.md` — source plan document (do not commit; gitignored)
- `docs/ai-agent-quota-monitor-brd.md` — BR-042 (No-Brainer Score), BR-043 (Claude Code provider)
- `docs/ai-agent-quota-monitor-tsd.md` — NBS section 12, Claude Code adapter sections
- `docs/boundary-contracts.md` — existing snapshot/latest.json contracts
- `docs/security.md` — credential isolation and redaction rules
- `docs/test-traceability.md` — BR-042 and BR-043 traceability rows
- `helper/src/providers/claude-code/` — current Claude Code adapter (starting point)
- `helper/src/services/nbs.ts` — No-Brainer Score (consumer of snapshots)

---

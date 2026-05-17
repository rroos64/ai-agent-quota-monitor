# AIQM Boundary Contracts

This document records the current implementation boundaries.

## Desklet ↔ helper boundary

The Cinnamon desklet is passive and consumes only `latest.json`.

```text
~/.local/share/ai-agent-quota-monitor/latest.json
```

The desklet may launch setup through `aiqm-setup-terminal`, but it must not read config, tokens, profile auth homes, logs, history, or raw provider payloads.

## Polling boundary

Production polling is scheduled by a user systemd timer:

```text
aiqm-poll.timer → aiqm-poll.service → ~/.local/bin/aiqm poll --json
```

The desklet watches the latest-state directory and re-renders when `latest.json` is atomically replaced.

## Provider boundary

Provider-specific auth and quota logic lives in the helper provider layer.

Codex production quota transport:

```text
codex app-server --listen ws://127.0.0.1:<port>
account/rateLimits/read
```

Only the read method above is allowlisted for quota polling.

Codex binary resolution order:

1. `AIQM_CODEX_BIN`
2. `CODEX_BIN`
3. `PATH`
4. next to the active Node executable
5. `codex` fallback

## Account/session boundary

AIQM owns Codex account profiles independently from the user's normal Codex CLI login.

```text
providers/codex/<email>/codex-home/auth.json
```

Setup actions:

- add: creates account + AIQM-owned Codex session
- logout: removes session/auth file but keeps account configured
- delete: removes account from config and profile data
- re-login: replaces session for an existing configured account
- reorder/name edit: metadata-only; no live provider poll

## State contracts

Contracts are under `contracts/v1/` and mirrored by Zod schemas.

- `config.schema.json`: configured accounts and helper settings; `refreshIntervalMinutes` is positive integer; optional `settings.providerPollIntervalSeconds` sets provider default minimum poll intervals; optional `settings.providerPollMaxIntervalSeconds` sets provider default maximum progressive back-off intervals. An individual account may override those defaults in `providerConfig` with `pollIntervalSeconds`/`minPollIntervalSeconds` and `pollMaxIntervalSeconds`/`maxPollIntervalSeconds`.
- `latest-state.schema.json`: display-safe desklet contract. Each `accountQuotaCard` carries optional `effectivePollIntervalSeconds` (positive integer) and optional `nextPollEligibleAt` (ISO date-time or null). Together they tell the desklet the current back-off interval and the next real backend poll time for that account. They are not in the required array; absence is treated as unknown display timing, with the helper falling back to configured polling defaults internally.
- `history-entry.schema.json`: display-safe append-only quota history rows.
- `token-record.schema.json`: token store contract for providers that use token references.

## Secret boundary

No contract consumed by the desklet may contain provider secrets, raw auth files, auth URLs, cookies, tokens, device codes, or raw provider frames.

## Helper-computed ranking boundary

`selectionRank` is computed by the polling helper (No-Brainer Score) and persisted in `latest.json` as an optional integer field on each `accountQuotaCard`. The desklet reads and displays it; it does not recompute the rank.

Ranking is scoped per provider group (rank numbers restart per group). The score combines weekly best-before pressure (quota about to reset unused) and 5-hour opened-window pressure (account already opened and ticking), weighted by usefulness and data confidence. Exhausted accounts (0% 5-hour or 0% weekly) receive no rank. Stale data reduces confidence but does not automatically remove the rank.

The `latest-state.schema.json` `accountQuotaCard` definition includes `selectionRank` as an optional positive integer. Absence is treated as no rank (same as `null`).

## Poll liveness boundary

Provider transports must not be allowed to keep `aiqm poll --json` alive indefinitely. Production systemd units enforce a 45-second service watchdog, and provider child processes must be terminated after each attempt.

## Claude Code provider boundary

Claude Code polling must use an AIQM-owned `providerConfig.claudeConfigDir`. Allowed metadata commands are non-consuming commands such as `claude --version` and `claude auth status`. Credential-bearing `~/.claude` files and raw CLI/debug output are outside the display boundary.

Claude Code quota polling uses Anthropic's unofficial OAuth usage endpoint (`GET /api/oauth/usage`, beta `oauth-2025-04-20`) with the AIQM-owned Claude OAuth access token. This endpoint is not documented or guaranteed by Anthropic and could change, stop working, or be removed at any time. The transport must remain isolated behind the provider adapter and fail safely to provider-unavailable/stale state.

The OAuth usage response reports `utilization` as percentage used. AIQM stores this as `usedPercentage`; display/render-model code derives available quota as `100 - usedPercentage`.

Claude Code statusLine quota snapshots remain supported as a local passive boundary. The dump command must persist only normalised window fields and must not store raw statusLine input.

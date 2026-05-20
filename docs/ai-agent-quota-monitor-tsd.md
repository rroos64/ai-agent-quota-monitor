# Technical Specification Document

## AI Agent Quota Monitor

| Field | Detail |
|---|---|
| **Document Reference** | TSD-001 |
| **Version** | Draft v0.1 |
| **Date** | 2026-05-09 |
| **Status** | Draft |
| **Product / Project** | AI Agent Quota Monitor |
| **Owner** | Riaan Roos |
| **Related BRD** | docs/ai-agent-quota-monitor-brd.md |
| **Related ARCH** | docs/ai-agent-quota-monitor-architecture-notes.md |
| **Signoff** | |
| **Signoff Date** | |

---

# 1. Purpose

This TSD defines the technical design for the AI Agent Quota Monitor.

It translates the BRD and architecture direction into implementation-level contracts, module responsibilities, local storage structures, CLI commands, TUI behaviour and provider integration interfaces.

The key design goal is to make provider integration easy to extend by defining:

1. A common `ProviderAdapter` interface.
2. An `AbstractProviderAdapter` base class.
3. Shared domain models for accounts, quota windows and provider results.
4. A normalised state contract consumed by the Cinnamon desklet.

---

# 2. Technical Overview

The application has three main parts:

```text
Cinnamon Desklet
  Passive desktop display.
  Reads latest.json.
  Does not know provider internals.

Node Helper Core
  Owns provider auth, polling, normalisation, storage, diagnostics and history.

Node TUI and CLI
  TUI provides setup/authentication UX.
  CLI provides scriptable commands for polling, status and diagnostics.
```

The architecture uses file-based local state for v1. The helper writes normalised quota data to `latest.json`; the desklet reads that file and renders cards.

---

# 3. Runtime and Tooling

## 3.1 Runtime

| Area | Choice |
|---|---|
| Helper runtime | Node.js LTS |
| Helper language | TypeScript |
| Desklet language | Cinnamon JavaScript |
| TUI | Ink |
| CLI command routing | Commander |
| Prompt helper | `@inquirer/prompts` or Enquirer where useful |
| Runtime validation | Zod |
| Tests | Vitest |
| Contract validation | Zod and/or JSON Schema generated from Zod |
| Formatting | Prettier |
| Linting | ESLint |

## 3.2 Important Runtime Boundary

Cinnamon desklet JavaScript is not Node.js.

The desklet must not import helper TypeScript modules or Node packages. Communication between the desklet and helper is through local files and, where needed, scriptable helper commands.

---

# 4. Repository Structure

```text
ai-agent-quota-monitor/
├── desklet/
│   ├── metadata.json
│   ├── desklet.js
│   ├── stylesheet.css
│   ├── settings-schema.json
│   └── icons/
│
├── helper/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── cli/
│       │   ├── index.ts
│       │   └── commands/
│       │       ├── setup.ts
│       │       ├── poll.ts
│       │       ├── status.ts
│       │       ├── account.ts
│       │       ├── diagnose.ts
│       │       └── reset.ts
│       │
│       ├── tui/
│       │   ├── App.tsx
│       │   ├── screens/
│       │   │   ├── HomeScreen.tsx
│       │   │   ├── AddAccountScreen.tsx
│       │   │   ├── AccountListScreen.tsx
│       │   │   ├── TestConnectionScreen.tsx
│       │   │   ├── StoragePathsScreen.tsx
│       │   │   └── ResetDataScreen.tsx
│       │   └── components/
│       │       ├── ProviderBadge.tsx
│       │       ├── StatusPill.tsx
│       │       ├── AccountRow.tsx
│       │       └── ErrorHint.tsx
│       │
│       ├── domain/
│       │   ├── account.ts
│       │   ├── provider.ts
│       │   ├── quota.ts
│       │   ├── status.ts
│       │   └── errors.ts
│       │
│       ├── services/
│       │   ├── account-service.ts
│       │   ├── auth-service.ts
│       │   ├── quota-service.ts
│       │   ├── polling-service.ts
│       │   └── diagnostics-service.ts
│       │
│       ├── providers/
│       │   ├── base/
│       │   │   ├── provider-adapter.ts
│       │   │   ├── abstract-provider-adapter.ts
│       │   │   └── provider-errors.ts
│       │   ├── fake/
│       │   ├── antigravity/
│       │   ├── claude-code/
│       │   └── codex/
│       │
│       ├── storage/
│       │   ├── app-paths.ts
│       │   ├── config-store.ts
│       │   ├── token-store.ts
│       │   ├── latest-state-store.ts
│       │   ├── history-writer.ts
│       │   └── atomic-write.ts
│       │
│       ├── diagnostics/
│       │   ├── logger.ts
│       │   └── redact.ts
│       │
│       └── validation/
│           ├── config.schema.ts
│           ├── latest-state.schema.ts
│           ├── token-record.schema.ts
│           └── history-entry.schema.ts
│
├── contracts/
│   └── v1/
│       ├── latest-state.schema.json
│       ├── config.schema.json
│       ├── token-record.schema.json
│       └── history-entry.schema.json
│
├── docs/
│   ├── ai-agent-quota-monitor-brd.md
│   ├── ai-agent-quota-monitor-tsd.md
│   ├── ai-agent-quota-monitor-architecture-notes.md
│   ├── no-brainer-score-tsd.md
│   ├── boundary-contracts.md
│   ├── test-traceability.md
│   ├── install.md
│   ├── security.md
│   ├── release-checklist.md
│   ├── backlog/
│   │   └── ideas-to-implement.md
│   └── defects/
│       └── defects.md
│
└── README.md
    (tests live in helper/tests/)
```

---

# 5. Domain Model

## 5.1 Provider Identifier

```ts
export type ProviderId =
  | "fake"
  | "antigravity"
  | "claude-code"
  | "codex";
```

`fake` is included for test and development use. It must not be shown as a production provider unless a development/debug mode is enabled.

## 5.2 Account Status

```ts
export type AccountStatus =
  | "fresh"
  | "stale"
  | "unavailable"
  | "auth_required"
  | "offline"
  | "provider_error"
  | "config_error";
```

## 5.3 Configured Account

```ts
export type ConfiguredAccount = {
  id: string;
  provider: ProviderId;
  email: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};
```

`id` must be stable and unique.

Recommended format:

```text
<provider>:<normalised-email>
```

Example:

```text
codex:dev@example.com
```

## 5.4 Quota Window

```ts
export type QuotaWindow = {
  id: string;
  providerWindowName: string;
  usedPercentage: number | null;
  resetAt: string | null;
  resetInText: string | null;
  status: AccountStatus;
  hint?: string | null;
};
```

Rules:

1. `usedPercentage` must be between `0` and `100` where known.
2. `usedPercentage` is `null` when the value is unavailable.
3. `resetAt` must be ISO 8601 where known.
4. `resetInText` is generated by the helper for display convenience.
5. The desklet may display `resetInText` directly.

## 5.5 Account Quota Card

```ts
export type AccountQuotaCard = {
  provider: ProviderId;
  email: string;
  displayOrder: number;
  status: AccountStatus;
  windows: QuotaWindow[];
  lastSuccessfulRefreshAt: string | null;
  lastAttemptedRefreshAt: string | null;
  stale: boolean;
  errorHint?: string | null;
  effectivePollIntervalSeconds?: number;
};
```

## 5.6 Latest State

```ts
export type LatestState = {
  schemaVersion: "1";
  generatedAt: string;
  accounts: AccountQuotaCard[];
};
```

This is the primary contract consumed by the desklet.

---

# 6. Provider Adapter Design

## 6.1 Design Goal

The provider adapter layer makes it easy to add or change providers without changing the desklet, TUI screens, CLI commands or storage layer.

Each provider is isolated behind a common interface and may extend the shared abstract base class.

The application should be able to add a fourth provider later by creating a new adapter that implements the same contract.

## 6.2 Provider Adapter Interface

```ts
export interface ProviderAdapter {
  readonly providerId: ProviderId;
  readonly providerName: string;

  authenticate(input: AuthInput): Promise<AuthResult>;

  validateAccount(
    tokenRef: TokenRef,
    expectedEmail: string
  ): Promise<AccountValidationResult>;

  fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult>;

  normaliseQuota(
    account: ConfiguredAccount,
    result: ProviderQuotaResult
  ): Promise<AccountQuotaCard>;

  diagnose?(account: ConfiguredAccount): Promise<ProviderDiagnosticResult>;
}
```

### Required Behaviour

1. `authenticate` starts or coordinates the provider authentication flow.
2. `validateAccount` confirms the authenticated provider account matches the expected email address.
3. `fetchQuota` gets provider quota data for a configured account.
4. `normaliseQuota` converts provider data into the common `AccountQuotaCard` shape.
5. `diagnose` is optional and may return provider-specific diagnostic information.

## 6.3 Abstract Provider Adapter

Concrete providers should extend `AbstractProviderAdapter` unless there is a strong reason not to.

```ts
export abstract class AbstractProviderAdapter implements ProviderAdapter {
  abstract readonly providerId: ProviderId;
  abstract readonly providerName: string;

  protected constructor(
    protected readonly tokenStore: TokenStore,
    protected readonly logger: Logger,
    protected readonly clock: Clock
  ) {}

  abstract authenticate(input: AuthInput): Promise<AuthResult>;

  abstract validateAccount(
    tokenRef: TokenRef,
    expectedEmail: string
  ): Promise<AccountValidationResult>;

  abstract fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult>;

  async normaliseQuota(
    account: ConfiguredAccount,
    result: ProviderQuotaResult
  ): Promise<AccountQuotaCard> {
    const windows = result.windows.map((window) => ({
      id: window.id,
      providerWindowName: window.providerWindowName,
      usedPercentage: this.normalisePercentage(window.usedPercentage),
      resetAt: window.resetAt,
      resetInText: this.formatResetInText(window.resetAt),
      status: result.status,
      hint: window.hint ?? null,
    }));

    return {
      provider: account.provider,
      email: account.email,
      displayOrder: account.displayOrder,
      status: result.status,
      windows,
      lastSuccessfulRefreshAt:
        result.status === "fresh" ? this.clock.nowIso() : null,
      lastAttemptedRefreshAt: this.clock.nowIso(),
      stale: result.status === "stale",
      errorHint: result.errorHint ?? null,
    };
  }

  protected normalisePercentage(value: number | null): number | null {
    if (value === null) return null;
    if (Number.isNaN(value)) return null;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  protected formatResetInText(resetAt: string | null): string | null {
    if (!resetAt) return null;

    const now = this.clock.now();
    const reset = new Date(resetAt);
    const diffMs = reset.getTime() - now.getTime();

    if (Number.isNaN(reset.getTime())) return null;
    if (diffMs <= 0) return "resets now";

    const totalMinutes = Math.ceil(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `resets in ${days}d ${hours}h`;
    if (hours > 0) return `resets in ${hours}h ${minutes}m`;
    return `resets in ${minutes}m`;
  }

  protected mapErrorToStatus(error: unknown): AccountStatus {
    if (error instanceof AuthRequiredError) return "auth_required";
    if (error instanceof OfflineError) return "offline";
    if (error instanceof ConfigError) return "config_error";
    return "provider_error";
  }
}
```

## 6.4 Why Both Interface and Abstract Class

The interface defines the contract every provider must satisfy.

The abstract class provides reusable behaviour that should be consistent across providers.

This gives two benefits:

1. Provider adapters can be tested against the interface.
2. Shared logic such as percentage clamping, reset text formatting, error mapping and logging can be implemented once.

A provider may implement `ProviderAdapter` directly only when it genuinely cannot use the shared base class.

## 6.5 Provider Adapter Registry

The helper must use a provider registry rather than hardcoding provider classes throughout the app.

```ts
export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.providerId)) {
      throw new Error(`Provider already registered: ${adapter.providerId}`);
    }
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new Error(`Unknown provider: ${providerId}`);
    return adapter;
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
```

## 6.6 Provider Quota Result

Provider adapters return this internal result from `fetchQuota` before it is normalised.

```ts
export type ProviderQuotaResult = {
  provider: ProviderId;
  accountEmail: string;
  fetchedAt: string;
  status: AccountStatus;
  windows: ProviderQuotaWindowResult[];
  errorHint?: string | null;
  rawMetadata?: Record<string, unknown>;
};

export type ProviderQuotaWindowResult = {
  id: string;
  providerWindowName: string;
  usedPercentage: number | null;
  resetAt: string | null;
  hint?: string | null;
};
```

Rules:

1. `rawMetadata` must not contain tokens, cookies or secrets.
2. `rawMetadata` must not be written to `latest.json`.
3. `rawMetadata` may be used for diagnostics only after redaction.

---

# 7. Provider-Specific Modules

## 7.1 Fake Provider

The fake provider is required for development and architecture validation.

Purpose:

1. Prove storage, polling, normalisation and desklet rendering before real provider work.
2. Support deterministic tests.
3. Allow the TUI and CLI to be tested without external provider access.

The fake provider must support:

1. Successful quota response.
2. Auth required response.
3. Provider error response.
4. Stale-state simulation.
5. Malformed response simulation for tests.

## 7.2 Antigravity Provider

The Antigravity adapter must be implemented in:

```text
helper/src/providers/antigravity/
```

The adapter must isolate any unstable or unofficial provider endpoint calls in clearly named modules.

Suggested structure:

```text
antigravity/
  adapter.ts
  auth.ts
  quota.ts
  normalise.ts
  unstable-api.ts
```

## 7.3 Claude Code Provider

The Claude Code adapter must be implemented in:

```text
helper/src/providers/claude-code/
```

The adapter must support Claude Code plan quota only.

Claude API usage is out of scope for v1.

Suggested structure:

```text
claude-code/
  adapter.ts
  auth.ts
  quota.ts
  normalise.ts
  local-session.ts
```

## 7.4 Codex Provider

The Codex adapter must be implemented in:

```text
helper/src/providers/codex/
```

The adapter must support ChatGPT plan-included Codex quota only.

OpenAI API-key usage is out of scope for v1.

Suggested structure:

```text
codex/
  adapter.ts
  auth.ts
  quota.ts
  normalise.ts
  unstable-api.ts
```

---

# 8. Auth Model

## 8.1 Auth Input

```ts
export type AuthInput = {
  provider: ProviderId;
  expectedEmail: string;
  interactive: boolean;
};
```

## 8.2 Auth Result

```ts
export type AuthResult = {
  provider: ProviderId;
  email: string;
  tokenRef: TokenRef;
  authenticatedAt: string;
};
```

## 8.3 Token Reference

```ts
export type TokenRef = {
  accountId: string;
  provider: ProviderId;
};
```

The rest of the app should pass token references, not raw tokens.

## 8.4 Token Record

```ts
export type TokenRecord = {
  schemaVersion: "1";
  accountId: string;
  provider: ProviderId;
  email: string;
  createdAt: string;
  updatedAt: string;
  tokenType: string;
  tokenPayload: Record<string, unknown>;
};
```

Rules:

1. `tokenPayload` is provider-specific.
2. `tokenPayload` is sensitive.
3. `tokenPayload` must never be logged.
4. `tokenPayload` must never be written to `latest.json`.
5. `tokens.json` must be git-ignored.
6. `tokens.json` should be written with `0600` permissions where supported.

## 8.5 Account Validation Result

```ts
export type AccountValidationResult = {
  provider: ProviderId;
  expectedEmail: string;
  actualEmail: string | null;
  matches: boolean;
  canReadQuota: boolean;
  hint?: string | null;
};
```

An account must not be saved as valid when `matches` is false.

---

# 9. Storage Specification

## 9.1 Storage Paths

All v1 data is stored under the user profile.

```text
~/.local/share/ai-agent-quota-monitor/
  config.json
  tokens.json
  latest.json
  history.log
  logs/
    aiqm.log

~/.cache/ai-agent-quota-monitor/
  provider-cache/
```

## 9.2 Config Store

`config.json` stores configured accounts.

```ts
export type AppConfig = {
  schemaVersion: "1";
  accounts: ConfiguredAccount[];
  settings: {
    refreshIntervalMinutes: number;
    setupCommand?: string;
    providerPollIntervalSeconds?: Partial<Record<ProviderId, number>>;
    providerPollMaxIntervalSeconds?: Partial<Record<ProviderId, number>>;
  };
};
```

Rules:

1. Accounts are ordered by `displayOrder` within each provider section.
2. Provider and email combination must be unique.
3. `refreshIntervalMinutes` is a positive integer retained for configuration compatibility.
4. `providerPollIntervalSeconds` is optional and overrides the minimum per-provider poll interval. Codebase defaults (Codex 60 s, Claude Code 1800 s) are defined in `helper/src/providers/poll-defaults.ts`.
5. `providerPollMaxIntervalSeconds` is optional and overrides the maximum per-provider poll interval. Codebase defaults (Codex 1800 s, Claude Code 7200 s) are defined in `poll-defaults.ts`. The backoff ratio (Codex 2.0, Claude Code 1.167) is only configurable in `poll-defaults.ts`.
6. Config must be validated before use.

## 9.3 Token Store

`tokens.json` stores token records.

```ts
export type TokenFile = {
  schemaVersion: "1";
  tokens: TokenRecord[];
};
```

Rules:

1. Token records are looked up by `accountId`.
2. Token writes must avoid logging raw tokens.
3. The token store must be behind the `TokenStore` interface.
4. Future keyring storage must not require provider adapter changes.

## 9.4 Latest State Store

`latest.json` stores normalised display-safe quota state.

```ts
export type LatestState = {
  schemaVersion: "1";
  generatedAt: string;
  accounts: AccountQuotaCard[];
};
```

Rules:

1. `latest.json` must never include tokens.
2. `latest.json` must never include cookies.
3. `latest.json` must never include raw auth responses.
4. `latest.json` must be written atomically.
5. The desklet must tolerate missing or malformed `latest.json`.

## 9.5 History Store

`history.log` uses JSON Lines.

```ts
export type HistoryEntry = {
  schemaVersion: "1";
  timestamp: string;
  provider: ProviderId;
  email: string;
  quotaWindow: string;
  usedPercentage: number | null;
  resetAt: string | null;
  status: AccountStatus;
};
```

Rules:

1. Each line is one JSON object.
2. One history entry is written per quota window per successful refresh.
3. History is retained forever unless reset all local data is used or the user manually deletes the file.
4. History must not contain tokens.

## 9.6 Atomic Writes

`latest.json`, `config.json` and `tokens.json` must be written atomically.

Required approach:

```text
1. Write to temporary file in the same directory.
2. Flush where practical.
3. Rename the temporary file over the target file.
```

---

# 10. Polling and Stale-State Logic

## 10.1 Polling Service

The polling service loads configured accounts and polls providers asynchronously.

```ts
export class PollingService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly latestStateStore: LatestStateStore,
    private readonly historyWriter: HistoryWriter,
    private readonly providerRegistry: ProviderRegistry,
    private readonly logger: Logger,
    private readonly clock: Clock
  ) {}

  async pollAll(options: PollAllOptions = {}): Promise<PollSummary> {
    // implementation detail
  }
}

export type PollTarget =
  | { kind: 'all' }
  | { kind: 'account'; provider: ProviderId; email: string };

export type PollAllOptions = {
  force?: boolean;
  target?: PollTarget;
};
```

## 10.2 Polling Rules

1. All account polling runs asynchronously.
2. One failed provider must not block other providers.
3. One failed account must not block other accounts for the same provider.
4. The previous quota value must be retained when a refresh fails and previous data exists.
5. An account becomes stale after one failed update.
6. If no previous data exists, the account is shown as unavailable.
7. `pollAll()` with no options is normal polling and retains the existing skip/back-off behaviour.
8. `pollAll({ force: true })` bypasses local eligibility checks for selected accounts during that run only.
9. Targeted polling selects only the configured account matching provider + normalised email; if it is missing, the service raises a clear configuration error.
10. A targeted run preserves non-selected latest-state cards for still-configured accounts, then recomputes No-Brainer ranks over the full card set.
11. History is appended only for successful, actually-polled accounts; skipped accounts and non-selected accounts do not add history entries.
12. After a forced attempt, interval/back-off computation is identical to a normal attempted poll, including provider `not-before` and `retry-after` handling.

## 10.3 Stale-State Merge

When an account refresh fails:

```text
If previous account data exists:
  keep previous windows
  set account status to stale or mapped failure status
  set stale = true
  update lastAttemptedRefreshAt
  keep lastSuccessfulRefreshAt unchanged
  add errorHint

If no previous account data exists:
  create account card with status unavailable/auth_required/provider_error
  windows = []
  stale = false
  add errorHint
```

---

# 11. CLI Specification

## 11.1 Command List

```bash
aiqm setup
aiqm poll [--json] [--force] [--provider <provider> --email <email> | --account <provider:email>]
aiqm status --json
aiqm account list [--json]
aiqm account delete --provider <provider> --email <email>
aiqm diagnose [--json]
aiqm reset --all
```

## 11.2 `aiqm setup`

Purpose:

```text
Launch the TUI setup and authentication experience.
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | TUI exited normally |
| 1 | Setup failed |
| 2 | Config or storage error |

## 11.3 `aiqm poll`

Purpose:

```text
Fetch quota for configured accounts and update latest.json and history.log.
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Poll completed, with at least one success or no accounts configured |
| 1 | All configured accounts failed |
| 2 | Config invalid |
| 3 | Storage unavailable |
| 4 | Unexpected error |

Options:

| Option | Meaning |
|---|---|
| `--json` | Print display-safe JSON containing `summary` and `latestStateFile`. |
| `--force` | Bypass local poll interval/back-off skip checks for selected accounts in this run. |
| `--provider <provider> --email <email>` | Target one configured account by provider and email. Targeting without `--force` still obeys skip rules. |
| `--account <provider:email>` | Shorthand target for one configured account. Mutually exclusive with `--provider`/`--email`. |

Examples:

```bash
aiqm poll --force
aiqm poll --json --force
aiqm poll --force --provider codex --email user@example.com
aiqm poll --force --account codex:user@example.com
```

Validation rules: `--email` requires `--provider`; `--provider` requires `--email`; `--account` cannot be combined with either field; unknown providers fail before polling.

`--json` output should include a summary, not raw tokens or raw provider responses. The current summary includes `generatedAt`, `accountsConfigured`, `accountsPolled`, `successes`, `failures`, `skipped`, `staleMerged`, `historyEntriesWritten`, and per-account summaries. It is CLI output, not a persisted v1 storage contract.

## 11.4 `aiqm status --json`

Purpose:

```text
Print the current latest.json state.
```

Rules:

1. Must not trigger provider polling.
2. Must return display-safe state only.
3. Must handle missing `latest.json` gracefully.

## 11.5 `aiqm account list`

Purpose:

```text
List configured accounts.
```

Rules:

1. Must not print tokens.
2. Must support JSON output.

## 11.6 `aiqm account delete`

Purpose:

```text
Delete a configured account.
```

Rules:

1. Remove the account from `config.json`.
2. Remove the account token from `tokens.json`.
3. Remove the account from `latest.json` on next poll or immediately if practical.
4. Do not delete existing quota history.

## 11.7 `aiqm diagnose`

Purpose:

```text
Show local setup, provider integration and storage health.
```

Must check:

1. Config file readability.
2. Token file readability.
3. Token file permissions where supported.
4. Latest state validity.
5. Provider adapter registration.
6. Common provider path detection.
7. Redaction of sensitive values.

## 11.8 `aiqm reset --all`

Purpose:

```text
Delete all local application data.
```

Rules:

1. Delete config.
2. Delete tokens.
3. Delete latest state.
4. Delete history.
5. Delete logs if selected by implementation.
6. Recreate required empty directories if needed.

---

# 12. TUI Specification

## 12.1 TUI Entry Point

```bash
aiqm setup
```

## 12.2 TUI Screens

| Screen | Purpose |
|---|---|
| Home | Show provider/account summary and available actions |
| Add Account | Select provider and enter email |
| Authenticate Account | Guide through provider sign-in and 2FA |
| Validate Account | Confirm email match and quota readability |
| Account List | Show configured accounts |
| Delete Account | Delete an account |
| Test Connection | Run quota access test for one or all accounts |
| Storage Paths | Show config, token, latest, history and log paths |
| Reset Data | Confirm and run reset all local data |
| Diagnostics | Show health checks and hints |

## 12.3 Home Screen Requirements

The home screen must show:

1. Provider names.
2. Number of accounts per provider.
3. Provider status summary.
4. Actions list.

Example:

```text
AI Agent Quota Monitor Setup

Providers
  ✓ Antigravity    2 accounts
  ✓ Claude Code    1 account
  ! Codex          1 account needs re-auth

Actions
  Add account
  Delete account
  Test connection
  Show storage paths
  Reset all local data
  Exit
```

## 12.4 Add Account Flow

Required steps:

1. Select provider.
2. Enter email address.
3. Validate email shape.
4. Check provider/email is not already configured.
5. Start authentication.
6. Complete provider sign-in and 2FA where required.
7. Validate authenticated email.
8. Test quota readability.
9. Save account and token.
10. Show success or clear failure hint.

## 12.5 TUI Error Handling

TUI error messages must be user-readable.

Examples:

```text
Authentication may have expired. Please sign in again.
The authenticated account does not match the email you entered.
Quota could not be read from this provider. The provider integration may have changed.
The token file could not be written. Check local file permissions.
```

The TUI must not display raw tokens.

---

# 13. Desklet Specification

## 13.1 Desklet Input

The desklet reads:

```text
~/.local/share/ai-agent-quota-monitor/latest.json
```

## 13.2 Desklet Responsibilities

The desklet must:

1. Load `latest.json`.
2. Validate enough of the shape to render safely.
3. Group accounts by provider.
4. Sort accounts by `displayOrder` within each provider.
5. Render quota windows as progress bars.
6. Apply colour states:
   - Below 50 percent: green.
   - 50 percent to below 75 percent: orange.
   - 75 percent and above: red.
7. Show stale and error hints.
8. Show a safe empty state when no accounts exist.
9. Show a safe unavailable state when `latest.json` is missing or malformed.

## 13.3 Desklet Empty State

When no accounts are configured:

```text
No accounts configured.
Run: aiqm setup
```

## 13.4 Desklet State File Error

When `latest.json` is missing or malformed:

```text
Quota state unavailable.
Run: aiqm diagnose
```

## 13.5 Launching Setup

The desklet may open setup by launching a configured terminal command.

Default:

```bash
x-terminal-emulator -e aiqm setup
```

Fallback terminal commands may include:

```text
x-terminal-emulator
gnome-terminal
konsole
xfce4-terminal
xterm
```

---

# 14. Logging and Redaction

## 14.1 Log File

```text
~/.local/share/ai-agent-quota-monitor/logs/aiqm.log
```

## 14.2 Logging Rules

Logs may include:

1. Provider ID.
2. Account email.
3. Operation name.
4. Status.
5. Sanitised error messages.

Logs must not include:

1. Raw tokens.
2. Refresh tokens.
3. Session cookies.
4. Provider auth headers.
5. Raw auth responses.

## 14.3 Redaction Utility

All diagnostic and log output must pass through a redaction utility before being written.

```ts
export function redact(value: unknown): unknown;
```

The redaction utility must recursively mask keys matching patterns such as:

```text
token
access_token
refresh_token
authorization
cookie
session
secret
api_key
```

---

# 15. Error Classes

Use typed errors so providers can map failure states consistently.

```ts
export class AuthRequiredError extends Error {}
export class OfflineError extends Error {}
export class ProviderUnavailableError extends Error {}
export class ProviderShapeChangedError extends Error {}
export class ConfigError extends Error {}
export class StorageError extends Error {}
```

Provider adapters should throw typed errors where possible. The polling service maps them to user-visible status and hints.

---

# 16. Contracts and Validation

## 16.1 Required Contracts

```text
contracts/v1/config.schema.json
contracts/v1/latest-state.schema.json
contracts/v1/token-record.schema.json
contracts/v1/history-entry.schema.json
```

## 16.2 Validation Rules

1. `config.json` must be validated before polling.
2. `tokens.json` must be validated before use.
3. `latest.json` must be validated before the helper returns status.
4. The desklet must be defensive and not crash if validation fails.
5. History entries must be validated before append where practical.

---

# 17. Testing Strategy

## 17.1 Priority Tests

The first implementation must prioritise:

1. Provider adapter interface tests.
2. Abstract provider adapter tests.
3. Normalisation tests.
4. Token redaction tests.
5. Config store tests.
6. Token store tests.
7. Atomic write tests.
8. Polling stale-state tests.
9. History writer tests.
10. CLI command tests.
11. TUI flow tests using service stubs.
12. Desklet rendering smoke tests.

## 17.2 Fake Provider Tests

The fake provider must be used to prove the full internal flow before real providers are implemented.

Minimum fake provider scenarios:

1. Successful quota fetch.
2. Auth required.
3. Provider unavailable.
4. Malformed provider result.
5. Multiple quota windows.
6. Reset time formatting.

## 17.3 Provider Adapter Contract Tests

Every real provider adapter must pass shared provider contract tests.

Shared tests must verify:

1. Adapter exposes a valid `providerId`.
2. Adapter returns a valid quota result shape.
3. Adapter normalises quota into a valid account card.
4. Adapter does not expose tokens in quota results.
5. Adapter maps known provider failures to typed errors or statuses.

## 17.4 TUI Tests

TUI tests should use service stubs rather than real provider calls.

Test focus:

1. Correct screens are shown.
2. Provider and email are captured.
3. Duplicate account is rejected.
4. Email mismatch is shown clearly.
5. Success path saves account through service layer.
6. Raw tokens are never displayed.

## 17.5 Desklet Tests

The desklet should have lightweight rendering tests where practical.

Test focus:

1. Empty state.
2. Missing/malformed `latest.json` state.
3. Provider grouping.
4. Account ordering.
5. Green/orange/red progress states.
6. Stale note display.

---

# 18. Implementation Sequence

## Slice 1: Skeleton and Contracts

1. Create repository structure.
2. Create helper TypeScript package.
3. Add domain types.
4. Add Zod schemas.
5. Add local storage paths.
6. Add config/latest/history/token stores.
7. Add `aiqm status --json` against `latest.json`.

## Slice 2: Provider Interface and Fake Provider

1. Implement `ProviderAdapter` interface.
2. Implement `AbstractProviderAdapter`.
3. Implement provider registry.
4. Implement fake provider.
5. Add shared provider adapter tests.
6. Add fake provider polling tests.

## Slice 3: Polling and State Flow

1. Implement polling service.
2. Implement stale-state merge.
3. Implement atomic latest-state write.
4. Implement history writer.
5. Implement `aiqm poll`.

## Slice 4: TUI Setup Shell

1. Implement `aiqm setup`.
2. Build home screen.
3. Build add account flow using fake provider.
4. Build account list.
5. Build delete account.
6. Build storage paths screen.
7. Build reset all data screen.

## Slice 5: Desklet Display

1. Create Cinnamon desklet skeleton.
2. Read `latest.json`.
3. Render empty and unavailable states.
4. Render fake provider quota cards.
5. Apply provider grouping and colour thresholds.
6. Add setup launch command.

## Slice 6: First Real Provider

1. Choose first provider.
2. Implement auth flow.
3. Validate email.
4. Fetch quota.
5. Normalise provider result.
6. Add fixtures.
7. Add adapter tests.
8. Add smoke test guidance.

## Slice 7: Remaining Providers

1. Implement second provider adapter.
2. Implement third provider adapter.
3. Extract common code only after duplication is visible.

## Slice 8: Hardening

1. Add diagnose command.
2. Add redaction tests.
3. Add malformed file handling.
4. Add offline handling.
5. Add timeout handling.
6. Add file permission checks.
7. Add packaging and install script.

---

# 19. Open Technical Decisions

## OTD-001: First Real Provider

Decision required:

```text
Which provider should be implemented first after the fake provider?
```

Recommendation:

```text
Start with Codex or Antigravity, depending on which quota source is easiest to verify manually.
```

## OTD-002: Desklet Poll Trigger

Decision required:

```text
Should the desklet invoke aiqm poll every five minutes, or should a scheduler write latest.json independently?
```

Recommendation:

```text
Desklet invokes aiqm poll for v1.
```

## OTD-003: Provider Raw Metadata

Decision required:

```text
Should provider adapters expose redacted raw metadata for diagnostics?
```

Recommendation:

```text
Allow redacted raw metadata in memory and diagnose output only. Do not write raw provider responses to latest.json.
```

## OTD-004: Contract Format

Decision required:

```text
Should contracts be maintained as Zod schemas only, JSON Schema only, or both?
```

Recommendation:

```text
Use Zod as source of truth in code and generate JSON Schema for documented contracts where practical.
```

---

# 20. Non-Functional Requirements

## 20.1 Performance

1. Polling must not block the desklet UI.
2. Provider account polling must run asynchronously.
3. The desklet must remain responsive even when `aiqm poll` fails or hangs.
4. Provider calls should use timeouts.

## 20.2 Reliability

1. Missing config must not crash the helper.
2. Missing latest state must not crash the desklet.
3. Malformed local files must produce safe errors.
4. A single provider failure must not stop other providers.
5. A single account failure must not stop other accounts.

## 20.3 Security

1. Token storage in JSON is accepted for v1 but treated as sensitive.
2. Token file permissions should be restrictive where supported.
3. Tokens must never be logged.
4. Tokens must never appear in desklet state.
5. Reset all local data must remove tokens.

## 20.4 Maintainability

1. Provider-specific logic must stay inside provider adapter modules.
2. Shared provider behaviour must live in the abstract base adapter or service layer.
3. The desklet must not know provider internals.
4. The TUI must not own business logic.
5. Tests must use the fake provider for deterministic internal flows.

---

# 21. Ready for Implementation Checklist

Before coding starts, confirm:

1. First implementation slice is fake provider, not a real provider.
2. Storage paths are accepted.
3. `latest.json` contract is accepted.
4. `config.json` contract is accepted.
5. `tokens.json` contract is accepted.
6. JSON Lines is accepted for history.
7. CLI command contract is accepted.
8. TUI screen list is accepted.
9. Desklet empty/error states are accepted.
10. Provider interface and abstract class design are accepted.
11. First real provider choice is made.


---

# Current Implementation Addendum — 2026-05-14

## Runtime refresh

Production refresh is now owned by user `systemd` units installed by `scripts/aiqm-local.sh`:

```text
~/.config/systemd/user/aiqm-poll.service
~/.config/systemd/user/aiqm-poll.timer
```

The service executes `~/.local/bin/aiqm poll --json`. The timer defaults to 60 seconds. This background path is non-forced: `aiqm poll` applies per-provider minimum intervals and per-account progressive back-off before calling provider usage endpoints.

### Progressive back-off algorithm

Each `AccountQuotaCard` in `latest.json` carries optional `effectivePollIntervalSeconds` — the interval the polling service will honour before re-polling that account. It also carries optional `nextPollEligibleAt`, the computed time at which that account becomes eligible for the next real backend poll. On each run:

1. Read `effectivePollIntervalSeconds` from the previous card (fall back to account `providerConfig.pollIntervalSeconds` / `minPollIntervalSeconds`, then provider `settings.providerPollIntervalSeconds`, if absent).
2. Skip the account if `now - lastAttemptedRefreshAt < effectivePollIntervalSeconds`.
3. After a poll attempt, compute the next interval:
   - **Success with data change** (`usedPercentage`, window status, or window set differs): reset to that account's min. `resetAt` drift alone is ignored because some providers report rolling reset timestamps that move on every fetch.
   - **Success with no data change**: multiply the current interval by the provider's backoff ratio, capped at that account's max (`providerConfig.pollMaxIntervalSeconds` / `maxPollIntervalSeconds`, then provider `settings.providerPollMaxIntervalSeconds`, then `poll-defaults.ts`).
   - **Error or non-fresh status**: multiply the current interval by the provider's backoff ratio, capped at that account's max, unless the provider returned `not-before` or `retry-after`; provider wait instructions are honoured even when they are larger than the configured max. `not-before` takes precedence over `retry-after`.

Poll boundaries are set at provider level in `helper/src/providers/poll-defaults.ts` but tracked independently per account. Two accounts from the same provider can have different effective intervals at the same time. Defaults: Codex min 60 s / max 1800 s / ratio 2.0; Claude Code min 1800 s / max 7200 s / ratio 1.167. The timer fires every 60 seconds; accounts inside their effective interval are skipped and their previous card is preserved in `latest.json`.

`nextPollEligibleAt` is derived from `lastAttemptedRefreshAt + effectivePollIntervalSeconds`. The desklet may display it as a local countdown but must not use it to drive provider polling.

Manual force (`aiqm poll --force` or the setup TUI force-refresh actions) skips step 2 for the selected account set only. It does not clear stored intervals, does not disable future back-off, and does not override provider wait instructions when computing the next interval after the attempted poll.

## Codex transport

Codex quota polling uses a live Codex app-server WebSocket transport. Only `account/rateLimits/read` is sent. The transport captures child stderr, handles child `error` events, retries startup to reduce port race failures, and resolves the Codex binary from `AIQM_CODEX_BIN`, `CODEX_BIN`, `PATH`, or the active Node binary directory.

Codex credits are retained only as raw safe metadata. `credits.hasCredits` does not determine quota status. `rateLimitReachedType` remains status-affecting.

## Setup TUI

The setup TUI command model is:

```text
Home: (o) Codex, (a) Claude, (e)dit, (d)elete, (l)ogout, (r)efresh selected, refres(h)-all, (q)uit, ↑/↓ select
Edit: (n)ame (o)rder (r)e-login (l)ogout (b)ack
```

Order editing uses ↑/↓ live movement and Enter to save. Metadata-only edits do not poll providers. Re-login updates the existing account's provider profile and verifies via targeted forced polling so prior back-off cannot skip the validation attempt. Logout removes auth/session state but keeps the account configured. Delete removes account/profile state.

Home force-refresh commands call setup action wrappers rather than provider code directly:

- `r` / `refresh`: confirm and run `pollAll({ force: true, target: { kind: 'account', provider, email } })` for the selected account.
- `h` / `refresh-all`: confirm and run `pollAll({ force: true, target: { kind: 'all' } })`.

The TUI displays concise success/failure/skipped counts and warns that repeated forced refreshes can hit provider rate limits. If no accounts are configured, refresh commands show a friendly message and make no provider call.

## Desklet

The desklet renders:

- header card with Setup button and update timestamp
- collapsible provider sections, contracted by default; concertina behaviour (at most one open at a time)
- one compact translucent account tile per account
- provider pill per tile
- both Codex windows inside each tile
- reset timing and backend poll timing in the bottom row of each expanded account tile, with poll timing shown as `↻ time left / interval`
- muted progress track with exact pixel-locked fill width

The desklet remains Node-free and reads only `latest.json`.

## Logging

Diagnostics logging is redacted and bounded. When the log reaches the configured size cap, it is truncated before appending the next line.

## Config contract

`settings.refreshIntervalMinutes` is now any positive integer in v1, not a literal 5. The production poll cadence is currently controlled by the systemd timer installed by the local installer.

## No-Brainer Score and selection order pill

The polling helper computes an optional `selectionRank` integer per account (1 = best choice) and persists it in `latest.json`. Ranking is scoped per provider group. The Cinnamon desklet reads the pre-computed rank and displays it as a small pill next to the provider pill on each account tile; the desklet does not recompute the rank.

### Food-expiry analogy

Weekly quota reset = best-before date. Quota that reaches its weekly reset unused is wasted, whether the account has been opened or not.

5-hour quota reset = the smell test after opening. Once an account is opened (active 5-hour window), its short-term quota is already ticking down. Use opened accounts before fresh reserves when the weekly urgency is similar.

### No-Brainer Score formula

```text
NBS = urgency × usefulness × data_confidence
```

**Best-before pressure** (weekly expiry urgency, applies to any account):

```text
best_before_pressure = weekly_remaining% / hours_until_weekly_reset
```

**Opened-window pressure** (5-hour expiry urgency, applies only when the 5-hour window is active AND remaining% < 100%):

```text
opened_window_pressure = five_hour_remaining% / hours_until_5_hour_reset
```

An account with 5-hour remaining = 100% has not started consuming this window; there is nothing to lose yet, so opened-window pressure is zero even if a 5-hour reset time is present.

**Urgency** combines both pressures using dominant + secondary weighting:

```text
urgency = dominant_pressure + (1/3) × secondary_pressure
```

Where `dominant_pressure` = the larger of the two, and `secondary_pressure` = the smaller. A small boost (≈ 5%) is applied for accounts that are opened (active 5-hour window present), as a tie-breaker favouring "use opened stock first."

**Usefulness** penalises nearly-empty accounts:

```text
usefulness = min(1, five_hour_remaining% / 10)
```

Accounts above 10% five-hour remaining have full usefulness. Below 10% the score is proportionally reduced. 0% remaining → `NBS = 0` (not ranked).

**Data confidence** reduces scores for uncertain data:

```text
fresh data  → 1.0
stale data  → 0.5
unavailable / error → 0 (not ranked)
```

A reset-time clamp (minimum ~15 minutes) prevents extreme scores immediately before a reset.

### Exhausted accounts

An account is exhausted and receives no rank when:

```text
5-hour remaining = 0%
OR
weekly remaining = 0%   (including the case where 5-hour appears full but weekly is 0%)
```

### Ranking within a provider group

Accounts are sorted descending by NBS. Ties are broken by: (1) opened account preferred, (2) higher weekly pressure, (3) higher five-hour remaining%, (4) email for determinism. Rank numbers restart per provider group.

## Cinnamon progress fill rendering note

Progress bars expose both percentage and pixel fill values in the desklet render model. The Cinnamon desklet applies a fixed `234px` track width and inline fill width/background colour so Cinnamon's CSS engine preserves visible ok/warning/critical/unknown fill colours.

## Poll watchdog and child-process cleanup

The installed `aiqm-poll.service` uses `TimeoutStartSec=45s` and `KillMode=control-group` so a stuck provider poll cannot block future timer runs indefinitely. The local installer stops any currently active poll service before reinstalling/restarting the units.

Codex app-server child processes are terminated and awaited after each live transport attempt. On timeout/failure AIQM sends `SIGTERM`, escalates to `SIGKILL`, and returns a provider-unavailable result instead of leaving the poll process active forever.

## Claude Code implementation slice

### CLAUDE-DISCOVERY-001: passive Anthropic/Claude CLI validation

The first Claude Code slice validates only non-consuming CLI contracts:

```text
claude --version
claude auth status
```

`claude auth status` has been observed to emit JSON with `loggedIn`, `authMethod`, `apiProvider`, `email`, `orgId`, `orgName`, and `subscriptionType`. The committed fixture redacts account-specific values and is used only for identity/subscription parsing. It is not a quota source.

### CLAUDE-PARSER-001: quota parser target contract

`helper/src/providers/claude-code/claude-code-parser.ts` defines parser contracts for:

- `parseClaudeCodeAuthStatusResponse()`
- `parseClaudeCodeQuotaResponse()`

The quota parser accepts both normalised read-only window responses (`limits`/`rateLimits`/`windows`) and Anthropic's unofficial OAuth usage response (`five_hour`/`seven_day`). The OAuth usage endpoint reports `utilization` as percentage used; AIQM stores it as `usedPercentage`, and display code derives available quota as `100 - usedPercentage`. The endpoint is not documented or guaranteed by Anthropic and could change, stop working, or be removed at any time.

### CLAUDE-ADAPTER-001: registered adapter with OAuth usage quota transport

`ClaudeCodeProviderAdapter` is now registered in the provider registry and has the same typed provider boundary as Codex: account validation and quota fetch are transport-driven and testable with stubs. The default quota transport uses Anthropic's unofficial OAuth usage endpoint with the AIQM-owned Claude OAuth access token and fails safely if credentials or the endpoint are unavailable. Claude accounts require `providerConfig.claudeConfigDir` so AIQM keeps Claude sessions under app-owned config directories instead of relying on the user's normal `~/.claude` state.

### CLAUDE-PROFILE-001: AIQM-owned Claude config imports

Claude Code account records use `providerConfig.claudeConfigDir`, which points to an AIQM-owned copy under provider profile storage. `ProviderProfileStore.importClaudeConfigDir()` copies a source config directory into `providers/claude-code/<email>/claude-config`, rejects symlinks, and applies private file permissions where supported. This mirrors Codex profile isolation while keeping Claude credentials under AIQM-owned storage.

### CLAUDE-AUTH-001: AIQM-owned Claude browser-login service

`ClaudeAuthService` starts `claude auth login --claudeai --email <email>` with `CLAUDE_CONFIG_DIR` pointing at AIQM-owned provider profile storage. The service exposes safe TUI actions for start, status polling via `claude auth status`, cancellation, and setup submission. Returned process objects redact their output during JSON serialisation so auth URLs/codes cannot leak through action results.

### CLAUDE-TUI-001: setup TUI entry point

The setup TUI now exposes Claude Code add flow from the home screen with `(a) Claude`. The flow collects email/display name, starts the isolated Claude browser login service, supports status/save/cancel controls, and submits through the shared Claude account-add path. Saving validates auth and configures the account for background OAuth usage polling.

### CLAUDE-QUOTA-001: passive statusLine quota bridge

Claude Code quota can still be read from local snapshots produced by Claude Code's `statusLine` hook. AIQM installs a `statusLine` command in the AIQM-owned Claude config directory:

```text
aiqm claude-statusline-dump --email <email> --claude-config-dir <dir>
```

Claude Code invokes this command with JSON on stdin. AIQM extracts `rate_limits.five_hour` and `rate_limits.seven_day`, writes `aiqm-quota-snapshot.json` in the same Claude config directory, and prints a compact status line back to Claude Code. This is retained as a passive fallback/local evidence mechanism; production background polling now uses the unofficial OAuth usage endpoint and never starts a Claude prompt just to check quota.

### CLAUDE-QUOTA-002: unofficial OAuth usage endpoint

AIQM calls `GET https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20` and the AIQM-owned Claude OAuth access token from `.credentials.json`. The endpoint returns 5-hour and 7-day `utilization` values as percentage used. AIQM stores these as `usedPercentage`; desklet/render-model code subtracts from 100 when showing available quota. This endpoint is unofficial and may change, fail, or be removed by Anthropic without notice, so the transport is isolated and errors must degrade to stale/unavailable provider state.

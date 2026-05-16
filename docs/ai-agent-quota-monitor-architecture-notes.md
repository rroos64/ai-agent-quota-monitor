# AI Agent Quota Monitor Architecture Notes

## Working Architecture Direction

The preferred architecture is a thin Cinnamon desklet with a local Node helper. The Node helper exposes two interfaces:

1. A scriptable CLI for polling, status output and automation.
2. A TUI for human setup and authentication.

The Cinnamon desklet remains a passive display surface. It consumes normalised quota state and must not contain provider-specific authentication, polling or quota parsing logic.

---

# 1. Architectural Principle

The main architecture rule is:

```text
The desklet may only consume normalised quota state. It may not call provider APIs directly.
```

This keeps the desktop UI simple, testable and insulated from provider-specific implementation details.

---

# 2. High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│ Cinnamon Desklet                             │
│                                              │
│ - reads latest.json                          │
│ - displays provider sections                 │
│ - displays account quota cards               │
│ - applies visual quota states                │
│ - opens setup entry point                    │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│ Node Helper Core                             │
│                                              │
│ - provider adapters                          │
│ - auth orchestration                         │
│ - token store                                │
│ - quota polling                              │
│ - normalisation                              │
│ - latest-state writer                        │
│ - history writer                             │
│ - logging and diagnostics                    │
└───────────────┬──────────────────────────────┘
                │
      ┌─────────┴─────────┐
      ▼                   ▼
┌──────────────┐   ┌──────────────┐
│ TUI Setup    │   │ Scriptable CLI │
│ aiqm setup   │   │ aiqm poll      │
│              │   │ aiqm status    │
└──────────────┘   └──────────────┘
```

---

# 3. Component Responsibilities

## 3.1 Cinnamon Desklet

The desklet is responsible for:

1. Rendering the desktop quota view.
2. Grouping accounts by provider.
3. Showing account cards in configured order.
4. Displaying provider names and account email addresses.
5. Displaying quota windows, used percentages and progress bars.
6. Applying green, orange and red visual states.
7. Showing stale and error notes.
8. Opening the setup entry point.
9. Reading normalised quota state from `latest.json`.

The desklet must not:

1. Store provider tokens directly.
2. Know provider endpoint details.
3. Perform provider authentication.
4. Refresh provider tokens.
5. Parse provider-specific quota responses.
6. Write quota history directly.
7. Make provider API calls directly.

## 3.2 Node Helper Core

The Node helper core is responsible for:

1. Account configuration.
2. Provider authentication orchestration.
3. Token storage.
4. Provider quota polling.
5. Provider-specific adapters.
6. Quota normalisation.
7. Retry and timeout handling.
8. Offline and failure handling.
9. Latest-state writing.
10. History writing.
11. Local diagnostic logging.
12. Resetting local data.
13. Supporting both the TUI and scriptable CLI interfaces.

## 3.3 Scriptable CLI

The scriptable CLI is used by the desklet, automation and debugging workflows.

Suggested commands:

```bash
aiqm poll
aiqm status --json
aiqm account list --json
aiqm account delete --provider codex --email user@example.com
aiqm reset --all
aiqm diagnose
```

The scriptable CLI must not depend on the TUI.

## 3.4 TUI Setup

The TUI is the human setup and authentication experience.

Suggested entry point:

```bash
aiqm setup
```

The TUI is responsible for:

1. Adding accounts.
2. Starting provider authentication.
3. Guiding the user through provider sign-in and 2FA.
4. Validating that the authenticated account matches the entered email address.
5. Testing provider quota access.
6. Showing configured accounts.
7. Deleting accounts.
8. Showing token and data storage paths.
9. Running connection tests.
10. Showing provider integration health.
11. Resetting all local data.

The TUI must not contain provider-specific business logic. It calls the same service layer used by the CLI.

---

# 4. Dependency Direction

Dependency direction must remain strict:

```text
tui → services → providers/storage/domain
cli → services → providers/storage/domain
desklet → latest.json only
```

The TUI and CLI are interfaces. They must not own business logic.

---

# 5. Provider Adapter Layer

Each provider has its own adapter.

```text
src/providers/
  antigravity/
    adapter.ts
    auth.ts
    quota.ts
    normalise.ts

  claude-code/
    adapter.ts
    auth.ts
    quota.ts
    normalise.ts

  codex/
    adapter.ts
    auth.ts
    quota.ts
    normalise.ts
```

Each provider adapter exposes the same contract:

```ts
interface ProviderAdapter {
  providerId: ProviderId;
  authenticate(input: AuthInput): Promise<AuthResult>;
  validateAccount(tokenRef: TokenRef, expectedEmail: string): Promise<AccountValidationResult>;
  fetchQuota(account: ConfiguredAccount): Promise<ProviderQuotaResult>;
}
```

Provider-specific or unofficial endpoints must be isolated behind the adapter. The rest of the application must not depend on provider-specific response shapes.

---

# 6. Normalised Domain Model

Provider data is converted into a normalised internal model before it reaches the desklet.

Suggested model:

```ts
type ProviderId = "antigravity" | "claude-code" | "codex";

type QuotaWindow = {
  id: string;
  providerWindowName: string;
  usedPercentage: number | null;
  resetAt: string | null;
  resetInText: string | null;
  status: "fresh" | "stale" | "unavailable" | "auth_required" | "error";
  hint?: string;
};

type AccountQuotaCard = {
  provider: ProviderId;
  email: string;
  displayOrder: number;
  windows: QuotaWindow[];
  lastSuccessfulRefreshAt: string | null;
  lastAttemptedRefreshAt: string | null;
  stale: boolean;
  errorHint?: string;
};
```

The desklet should consume this shape and avoid doing provider-specific translation.

---

# 7. Local Storage

For v1, storage is file-based.

Recommended locations:

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

| File | Purpose |
|---|---|
| `config.json` | Configured accounts, provider, email and display order |
| `tokens.json` | Provider auth tokens, accepted v1 security risk |
| `latest.json` | Last normalised quota state for the desklet |
| `history.log` | Append-only quota history |
| `logs/aiqm.log` | Local diagnostic logs |

## 7.1 Token Store Boundary

Provider adapters must not read or write token files directly. They must use a token store abstraction.

```ts
interface TokenStore {
  get(accountId: string): Promise<TokenRecord | null>;
  set(accountId: string, token: TokenRecord): Promise<void>;
  delete(accountId: string): Promise<void>;
}
```

v1 implementation:

```text
JsonFileTokenStore
```

Future implementation:

```text
KeyringTokenStore
```

This allows v1 to use JSON token storage while keeping the architecture ready for a safer storage mechanism later.

## 7.2 File Permissions

The token file should be created with restrictive permissions where supported:

```text
0600
```

This does not make JSON token storage fully secure, but it reduces accidental exposure.

---

# 8. History Format

Although the BRD says a simple text file, JSON Lines is recommended because it is still plain text but easier to parse later.

Recommended format:

```json
{"timestamp":"2026-05-09T12:00:00+02:00","provider":"codex","email":"me@example.com","quotaWindow":"5-hour","usedPercentage":42,"resetAt":"2026-05-09T14:10:00+02:00","status":"fresh"}
```

Each successful quota update writes one history entry per quota window.

---

# 9. Data Flow

## 9.1 Normal Refresh

```text
1. Desklet timer fires every 5 minutes.
2. Desklet invokes aiqm poll, or reads state after helper execution.
3. Helper loads config.json.
4. Helper loads tokens.json through TokenStore.
5. Helper starts provider/account polling asynchronously.
6. Each provider adapter fetches quota.
7. Raw provider result is normalised.
8. latest.json is updated atomically.
9. history.log receives append-only entries.
10. Desklet reads latest.json.
11. Desklet redraws account cards.
```

## 9.2 Failed Refresh With Previous Data

```text
1. Adapter fails for one account.
2. Helper keeps previous quota values for that account.
3. Account status becomes stale.
4. Error hint is added.
5. Other accounts continue refreshing.
6. latest.json is updated with mixed fresh and stale state.
```

## 9.3 First-Time Failure

```text
1. Account is configured.
2. First quota fetch fails.
3. No previous quota exists.
4. Card shows quota unavailable.
5. Hint explains the likely issue.
```

---

# 10. Atomic State Writes

The desklet must not read half-written JSON.

`latest.json` should be written atomically:

```text
1. Write latest.tmp.json.
2. Flush where practical.
3. Rename latest.tmp.json to latest.json.
```

The desklet should tolerate missing, malformed or temporarily unavailable state files by showing a safe unavailable state rather than crashing.

---

# 11. TUI Architecture

## 11.1 TUI Purpose

The TUI is used for guided setup and authentication.

It should provide a better experience than raw commands while still using the same service layer as the scriptable CLI.

## 11.2 Suggested TUI Screens

```text
tui/
  App.tsx
  screens/
    HomeScreen.tsx
    AddAccountScreen.tsx
    AccountListScreen.tsx
    TestConnectionScreen.tsx
    StoragePathsScreen.tsx
    ResetDataScreen.tsx
  components/
    ProviderBadge.tsx
    StatusPill.tsx
    AccountRow.tsx
    ErrorHint.tsx
```

## 11.3 Example Home Screen

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

## 11.4 Example Add Account Flow

```text
Add Account

Provider:
  Antigravity
  Claude Code
  Codex

Email:
  dev@example.com

Authentication:
  Opening provider sign-in flow...
  Complete 2FA in browser/device flow if prompted.

Validation:
  ✓ Authenticated account matches dev@example.com
  ✓ Quota can be read
  ✓ Account saved
```

---

# 12. TUI Technology Recommendation

Recommended stack:

```text
commander       CLI command routing
ink             TUI screens
@inquirer/prompts or enquirer   focused prompts where simpler than Ink
zod             runtime validation of config/latest state
```

## 12.1 Rationale

Ink is a good fit for a proper screen-style TUI because it gives the setup UI a component model.

Commander is suitable for scriptable command routing.

Inquirer or Enquirer can be used for simple prompts where a full Ink screen would be overkill.

Zod gives runtime validation for local JSON files and provider-normalised data.

---

# 13. Launching Setup From the Desklet

The desklet may open the TUI by launching a terminal command.

Example:

```bash
x-terminal-emulator -e aiqm setup
```

Terminal emulator availability varies, so the setup command should be configurable.

Possible fallback terminal commands:

```text
x-terminal-emulator
gnome-terminal
konsole
xfce4-terminal
xterm
```

The desklet should not require the TUI to be running during normal quota display.

---

# 14. Proposed Repository Structure

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
│       │   ├── commands/
│       │   │   ├── setup.ts
│       │   │   ├── account-add.ts
│       │   │   ├── account-delete.ts
│       │   │   ├── poll.ts
│       │   │   ├── status.ts
│       │   │   └── reset.ts
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
│       ├── services/
│       │   ├── account-service.ts
│       │   ├── auth-service.ts
│       │   ├── quota-service.ts
│       │   ├── polling-service.ts
│       │   └── diagnostics-service.ts
│       │
│       ├── domain/
│       │   ├── quota.ts
│       │   ├── account.ts
│       │   ├── provider.ts
│       │   └── status.ts
│       │
│       ├── providers/
│       │   ├── antigravity/
│       │   ├── claude-code/
│       │   └── codex/
│       │
│       ├── storage/
│       │   ├── config-store.ts
│       │   ├── token-store.ts
│       │   ├── latest-state-store.ts
│       │   └── history-writer.ts
│       │
│       ├── polling/
│       │   ├── poller.ts
│       │   ├── scheduler.ts
│       │   └── timeout.ts
│       │
│       ├── diagnostics/
│       │   ├── logger.ts
│       │   └── redact.ts
│       │
│       └── contracts/
│           ├── latest-state.schema.json
│           └── provider-adapter.d.ts
│
├── contracts/
│   └── v1/
│       ├── latest-state.schema.json
│       ├── config.schema.json
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

# 15. Architectural Decisions

## ADR-001: Use a Node Helper Instead of Provider Logic in the Desklet

Status: Accepted for v1.

Decision:

```text
Provider authentication, polling, normalisation and storage belong in the Node helper, not the Cinnamon desklet.
```

Reason:

```text
The desklet should remain a passive display layer. Provider integrations are volatile, harder to test and more security-sensitive than rendering quota cards.
```

## ADR-002: Store v1 Tokens in JSON

Status: Accepted as a v1 risk.

Decision:

```text
Authentication tokens are stored in a local JSON file for v1.
```

Reason:

```text
This supports the personal-use v1 quickly.
```

Mitigation:

```text
Use a TokenStore abstraction, restrict file permissions where possible, document the risk, git-ignore token files and plan migration to a keyring-backed store.
```

## ADR-003: Use File-Based State Instead of a Local Daemon

Status: Accepted for v1.

Decision:

```text
The helper writes normalised latest state to latest.json. The desklet reads that file.
```

Reason:

```text
A daemon would add install, lifecycle and security complexity too early.
```

Future trigger:

```text
Consider a daemon if multiple frontends, live updates, tray integration or frequent polling make file-based state awkward.
```

## ADR-004: Use Normalised Latest State as the UI Contract

Status: Accepted for v1.

Decision:

```text
The desklet consumes normalised state only.
```

Reason:

```text
The UI should not know provider-specific response shapes.
```

## ADR-005: Use JSON Lines for History

Status: Recommended.

Decision:

```text
Use JSON Lines for the history text file.
```

Reason:

```text
JSONL is still simple text, but easier to parse, validate and extend than pipe-delimited text.
```

## ADR-006: Use a Node TUI for Setup and Authentication

Status: Accepted for v1.

Decision:

```text
Use a Node TUI for account setup, provider authentication and diagnostics.
```

Reason:

```text
Provider auth and multi-account setup are too awkward for Cinnamon settings alone. A TUI gives the user a guided setup flow while keeping the desklet passive and simple.
```

Constraints:

```text
The TUI must not be required for scheduled polling.
The TUI must not contain provider-specific business logic.
The TUI must call the same service layer as the scriptable CLI.
The desklet must continue to work from latest.json even when the TUI is closed.
```

---

# 16. Testing Priorities

The highest-risk areas are provider parsing and state handling, not the visual desklet shell.

Test priority:

```text
1. Normalisation tests
2. Provider adapter contract tests
3. Token redaction tests
4. Stale-state transition tests
5. Atomic latest-state write tests
6. History writer tests
7. CLI command tests
8. TUI flow tests using service stubs
9. Desklet rendering smoke tests
```

Provider auth flows should not be over-tested through brittle E2E tests. Stub provider boundaries for automated tests and use explicit smoke tests for real provider integration.

---

# 17. Security Posture

v1 is convenient, not fully secure.

Required controls from day one:

```text
tokens.json is git-ignored
logs redact tokens
history does not include tokens
latest.json does not include tokens
debug mode must not dump raw auth responses
reset all local data deletes tokens
documentation says tokens.json is sensitive
token file permissions are restricted where supported
```

---

# 18. Session Temporary Artifacts

Implementation plans created during assistant/session work, such as `temp/implementation-plan.md`, are session-bound temporary artifacts.

They are working notes for the current local session only and must not be committed to git or pushed to a remote repository.

`temp/` must remain ignored in `.gitignore`.

---

# 19. Open Architecture Questions

1. Should the desklet invoke `aiqm poll` every five minutes, or should a separate scheduler write `latest.json` while the desklet only reads it?
2. Should setup use a pure terminal TUI only for v1, or should a later local browser UI be planned now?
3. Should provider adapters expose raw provider metadata for diagnostics, or should all raw response data stay out of local files by default?
4. Should unofficial provider endpoints be wrapped in clearly named `unstable-*` modules?
5. Should the first v1 implementation include only one provider adapter end to end before adding the other two?

Recommended answers:

```text
Desklet-triggered polling for v1.
Terminal TUI only for v1.
Display-safe latest state only.
Unofficial endpoints isolated in clearly named unstable integration modules.
Build one provider adapter end to end first, then generalise carefully.
```


---

# Current Architecture Decisions — 2026-05-14

## ADR-007: Use user systemd timer for production polling

The desklet timer alone was not reliable because Cinnamon's environment can differ from the user's shell. Production install now creates `aiqm-poll.timer` and `aiqm-poll.service`. The desklet remains a passive renderer watching `latest.json`.

## ADR-008: AIQM-owned Codex profiles

AIQM stores Codex sessions under app-owned provider profile directories and does not rely on the user's normal Codex CLI login. This makes account management independent and enables multiple accounts.

## ADR-009: Codex credits ignored for quota status

The monitor tracks Codex plan quota windows. OpenAI credit fields in `account/rateLimits/read` are not the user's intended quota signal and no longer make accounts unavailable by themselves.

## ADR-010: TUI owns account management

The setup TUI is the account management surface. It supports add, edit name, reorder, logout-keep-account, delete, and re-login. The desklet only launches the TUI and renders state.

## ADR-011: Collapsible provider sections in desklet

Provider sections are collapsible and contracted by default; clicking a header expands it and collapses any other open section (concertina). This keeps the desktop glanceable while allowing many account tiles.

## ADR-012: Selection rank is computed by the helper NBS service and stored in latest.json

The recommended account-use order (No-Brainer Score) is computed by `helper/src/services/nbs.ts` after each poll, stored in `latest.json` as `selectionRank` and `selectionRankUncertain` per account, and read passively by the desklet render model. The desklet does not compute or recompute NBS — it displays whatever rank the helper wrote. Rank numbers restart per provider group (Codex, Claude Code, and future providers are ranked independently). Accounts whose 5-hour or weekly quota is fully depleted are excluded from ranking. When all accounts in a group score zero (no urgency pressure), a fallback ranking order is applied: fresh reserves first, then accounts with a known weekly reset date, then stable configured display order. Stale ranked accounts carry `selectionRankUncertain: true` so the desklet can show an uncertainty indicator on the rank pill.

## ADR-013: Claude Code starts with passive validation and parser contracts

Claude Code is implemented with the same boundary discipline used for Codex. The provider uses AIQM-owned Claude config directories, redacted Anthropic/Claude CLI discovery evidence, parser contracts, and isolated quota transports. Production polling must not execute Claude prompts, agent sessions, remote control, reviews, or any command that could consume Claude Code quota.

## ADR-014: Claude Code adapter uses unofficial OAuth usage transport

Claude Code has a registered adapter and transport boundary. The adapter validates auth status via `claude auth status` and fetches quota through Anthropic's unofficial OAuth usage endpoint using AIQM-owned Claude OAuth credentials. The endpoint is not documented or guaranteed by Anthropic and could change, stop working, or be removed at any time, so the transport is isolated and must fail safely to stale/unavailable provider state.

## ADR-015: AIQM-owned Claude config directories

Claude Code must not depend on the user's normal `~/.claude` state as its production source. The account-add boundary now imports a Claude config directory into app-owned provider profile storage and records only the managed `claudeConfigDir` path in config.

## ADR-016: Claude auth uses CLI browser login with isolated config dir

Claude Code login is started through the official `claude auth login` browser flow while overriding `CLAUDE_CONFIG_DIR` to AIQM-owned storage. This mirrors Codex profile isolation and avoids relying on the user's normal `~/.claude` session. Quota polling uses the AIQM-owned credentials from that isolated config directory.

## ADR-018: Per-account progressive back-off for polling

Polling applies a doubling back-off per account when quota data is unchanged or when polling returns an error/non-fresh result. The effective interval for each account is stored in `latest.json` as `effectivePollIntervalSeconds` so back-off persists across timer runs without a separate state file. A fresh poll that detects changed quota percentages or reset times resets the account to the configured provider minimum. This keeps active accounts responsive while letting idle or failing accounts settle at longer intervals. The `providerPollIntervalSeconds` config key is the provider default minimum; `providerPollMaxIntervalSeconds` is the provider default back-off ceiling. Individual accounts can override those defaults in `providerConfig` with `pollIntervalSeconds`/`minPollIntervalSeconds` and `pollMaxIntervalSeconds`/`maxPollIntervalSeconds`. Provider defaults (from `PROVIDER_POLL_DEFAULTS` in `poll-defaults.ts`): Codex min 60 s / max 1800 s / ratio 2.0; Claude Code min 1800 s / max 7200 s / ratio 1.167; Antigravity placeholder min 300 s / max 3600 s / ratio 2.0 (update when API behaviour is known).

## ADR-017: Claude Code statusLine snapshots retained as passive fallback

Claude Code exposes current rate-limit windows to `statusLine` commands while Claude Code is already running. AIQM retains that passive channel as a local snapshot/fallback mechanism. Background quota polling now uses the unofficial OAuth usage endpoint instead, so users can compare Claude accounts before launching Claude Code. AIQM still never sends model prompts solely to check quota.

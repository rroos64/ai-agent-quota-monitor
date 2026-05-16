# Security Notes

## Sensitive local files

Credential-bearing AIQM data lives under:

```text
~/.local/share/ai-agent-quota-monitor/providers/codex/<email>/codex-home/auth.json
```

This file is created by AIQM-owned Codex browser login and contains Codex session tokens. Treat the whole `providers/codex/**/codex-home` tree as secret local state.

`config.json` can contain `providerConfig.codexHome`; this is operational metadata pointing at credential-bearing state and should not be pasted into public logs unless necessary and reviewed.

## Provider/session boundary

AIQM production setup does not import or depend on the user's normal `~/.codex` login. It stores isolated AIQM-owned Codex profiles in the app data directory.

Current quota polling still launches the Codex CLI app-server internally against those AIQM-owned profiles and only uses the allowlisted read method:

```text
account/rateLimits/read
```

Unsafe Codex operations such as agent sessions, review, exec, remote control, or arbitrary app-server messages are not part of production polling.

## Display-safe state

The desklet consumes only:

```text
latest.json
```

`latest.json` is normalised display state and must not contain tokens, cookies, auth URLs, device codes, provider raw frames, or full provider auth files.

The desklet must not read:

- `config.json`
- token stores
- provider profile auth files
- history/log files
- raw provider responses

## Logs and diagnostics

Diagnostics are JSONL and recursively redact sensitive keys. The log file is capped/truncated to avoid unbounded growth.

Validation errors include safe issue paths/codes, but not raw file content or sensitive key values.

Do not paste logs without checking for secrets first.

## Setup TUI safety

The setup TUI may start browser login, re-login, logout, delete, and reorder flows.

- `logout` removes auth/session state but keeps the account configured.
- `delete` removes the account from AIQM.
- `re-login` replaces an existing AIQM-owned Codex session via browser login.
- `q` during active Codex waiting cancels the auth process before returning/exiting.

## Fixtures and tests

Fixtures must be redacted. Tests must not require real provider credentials, a real Cinnamon runtime, or live Codex network access unless explicitly hidden behind opt-in live probe flags.

## Never commit

- `temp/` session artifacts unless intentionally requested
- Codex auth homes
- `auth.json`
- raw provider frames
- auth URLs/device codes
- token/cookie-bearing logs
- real account secrets

## Derived display-only ranking

The recommended account order pill is derived locally from display-safe `latest.json` weekly and 5-hour quota windows. Ranking is scoped per provider group, is not persisted to provider config, and does not require additional provider data or secrets.

## Claude Code credentials and discovery

Claude Code local credentials such as `~/.claude/.credentials.json`, keychain-derived tokens, debug logs, and unredacted `claude auth status` output are sensitive. The Claude implementation slice may commit only redacted fixture/evidence files. Production polling must not run Claude prompts, reviews, remote control, or other quota-consuming commands.

AIQM-owned Claude Code profile directories under `providers/claude-code/<email>/claude-config` are credential-bearing local state. They must be treated like Codex auth homes and never committed, pasted, or exposed through desklet state.

Claude auth action results redact spawned login process output during JSON serialisation because the CLI may print browser URLs or one-time codes.

Claude quota polling uses OAuth access tokens stored in AIQM-owned Claude config directories to call Anthropic's unofficial OAuth usage endpoint. The endpoint is not documented or guaranteed by Anthropic and could change, stop working, or be removed at any time. AIQM must never log or display OAuth tokens or raw credential files.

Claude statusLine input may contain session metadata. AIQM persists only normalised quota-window fields in `aiqm-quota-snapshot.json` and must not store raw statusLine JSON.

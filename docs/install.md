# Install and Local Run Guide

AIQM installs a local helper CLI, a Cinnamon desklet, a setup terminal launcher, and a user `systemd` timer for quota refresh.

## Prerequisites

- Linux desktop; Cinnamon is required for the desklet.
- Node.js/npm for building the helper.
- Codex CLI available to the user. AIQM owns its own Codex login/session data, but current quota transport still launches `codex app-server`.
- `systemctl --user` for the production background poll timer.

## Install

From a clone:

```bash
npm install
scripts/aiqm-local.sh install
```

Install and immediately launch setup:

```bash
scripts/aiqm-local.sh install --launch-setup
```

The installer creates:

```text
~/.local/bin/aiqm
~/.local/bin/aiqm-setup-terminal
~/.local/share/cinnamon/desklets/ai-agent-quota-monitor@local
~/.config/systemd/user/aiqm-poll.service
~/.config/systemd/user/aiqm-poll.timer
~/.local/share/ai-agent-quota-monitor/
~/.cache/ai-agent-quota-monitor/
```

It creates no sample accounts and no dummy quota data.

## Add and manage Codex accounts

Launch setup:

```bash
aiqm setup
```

or click **Setup** on the desklet.

The setup launcher opens a terminal with a centered fixed geometry and closes automatically when the TUI exits successfully.

Home commands:

```text
(o) Codex  add Codex/OpenAI account
(a) Claude add Claude/Anthropic account
(e)dit      edit selected account
(d)elete    delete selected account
(l)ogout    remove auth/session but keep selected account listed
(q)uit      exit
↑/↓         select account
```

Edit commands:

```text
(n)ame      edit display name
(o)rder     reorder with ↑/↓, Enter saves, Esc/b cancels
(r)e-login  run browser login again for an existing Codex account
(l)ogout    log out but keep account
(b)ack      home
```

Add/re-login uses AIQM-owned browser OAuth and writes credentials to:

```text
~/.local/share/ai-agent-quota-monitor/providers/codex/<email>/codex-home/auth.json
```

It does not use your normal `~/.codex` login as production source.

## Desklet behaviour

The desklet is passive. It reads:

```text
~/.local/share/ai-agent-quota-monitor/latest.json
```

It renders compact translucent account cards, grouped by collapsible provider sections that are contracted by default. Clicking a provider header expands it and collapses any other open section. Each account card contains both Codex quota windows.

Reliable refresh is done by:

```text
aiqm-poll.timer → aiqm poll --json → latest.json → desklet re-render
```

Default timer interval: 60 seconds. The helper applies per-provider minimum intervals and per-account progressive back-off:

- **Min interval** (`settings.providerPollIntervalSeconds`): the shortest time between polls for an account. Defaults:

```json
{
  "codex": 60,
  "claude-code": 600
}
```

- **Max interval** (`settings.providerPollMaxIntervalSeconds`): the longest time between polls for an account. Defaults:

```json
{
  "codex": 900,
  "claude-code": 900
}
```

Fresh accounts reset to their provider minimum when quota percentages change. Accounts whose quota data remains unchanged, or whose polling returns an error/non-fresh status, double their effective interval up to the configured max. If a provider returns `retry-after`, AIQM honours that value even when it is larger than the configured max. The minimum accepted value for either setting is 30 seconds. The timer can wake every 60 seconds; accounts still inside their effective interval are skipped and their previous `latest.json` card is preserved.

The installer ensures the min defaults exist in `~/.local/share/ai-agent-quota-monitor/config.json` under `settings.providerPollIntervalSeconds` without overwriting custom values. Individual accounts can override the provider defaults in their account `providerConfig` with `pollIntervalSeconds`/`minPollIntervalSeconds` and `pollMaxIntervalSeconds`/`maxPollIntervalSeconds`.

Check timer state:

```bash
systemctl --user status aiqm-poll.timer
```

## Uninstall

Preserve app data:

```bash
scripts/aiqm-local.sh uninstall
```

Purge app data/cache as well:

```bash
scripts/aiqm-local.sh uninstall --purge-data
```

Uninstall disables/removes the user poll timer, removes `~/.local/bin/aiqm`, removes the setup launcher, and removes the installed desklet. Data is preserved unless `--purge-data` is provided.

## Development commands

```bash
npm run ci
npm run validate:dev-flow
```

Fake-provider non-interactive setup for tests/dev:

```bash
aiqm setup --provider fake --email dev@example.com --scenario success --poll --json
```

## Security notes

Never commit or share `providers/codex/**/codex-home/auth.json`, raw provider responses, auth URLs, tokens, cookies, device codes, or logs containing provider output.

## Recommended order pill

Desklet account tiles can show a small numbered pill next to the provider pill. The number indicates which account AIQM recommends using first within that provider group, based on weekly quota remaining divided by hours until the weekly reset. Accounts with depleted 5-hour quota are excluded even when weekly quota remains. Rank numbers restart per provider, and the pill uses the same subdued style as the provider pill.

## Poll watchdog

The installed user service has a 45-second start timeout and kills the whole service control group if a provider poll hangs. Re-running `scripts/aiqm-local.sh install` stops any currently stuck `aiqm-poll.service`, reinstalls the units, and starts a fresh poll.

## Claude Code status

Claude Code is enabled as a production polling provider through AIQM-owned Claude config directories.

Interactive setup exposes a Claude Code entry point with `(a) Claude` for the isolated browser-login flow. Claude account records store `providerConfig.claudeConfigDir` under AIQM provider profile storage; do not point tests or fixtures at real `~/.claude` unless performing a deliberate local smoke check, and never commit imported Claude credentials.

Claude Code quota polling uses Anthropic's unofficial OAuth usage endpoint (`GET https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20`). This endpoint is not documented or guaranteed by Anthropic and could change, stop working, or be removed at any time. The endpoint returns `utilization` as percentage used; AIQM stores that as `usedPercentage`, and display code derives available quota as `100 - usedPercentage`.

AIQM still installs the passive Claude `statusLine` hook as a secondary local snapshot mechanism, but background quota polling no longer requires Claude Code to be running.

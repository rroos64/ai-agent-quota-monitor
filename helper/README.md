# AIQM Helper

The helper owns setup, account management, provider polling, normalization, local storage, history, and diagnostics. The Cinnamon desklet consumes only normalized `latest.json` output.

## Commands

```bash
aiqm setup
aiqm poll --json
aiqm status --json
aiqm account list --json
aiqm account delete --provider codex --email user@example.com --json
aiqm diagnose --json
aiqm reset --all --json
```

## Setup TUI

`aiqm setup` is the production account management UI.

Home keys:

```text
(o) Codex  Codex/OpenAI browser login for a new account
(a) Claude Claude/Anthropic browser login for a new account
(e)dit      manage selected account
(d)elete    remove selected account from AIQM
(l)ogout    remove auth/session but keep selected account
(q)uit      exit
↑/↓         select account
```

Edit keys:

```text
(n)ame      display name
(o)rder     reorder with arrow keys
(r)e-login  replace Codex auth/session
(l)ogout    sign out but keep account
(b)ack      home
```

## Codex provider

Codex setup uses AIQM-owned browser OAuth and stores credentials in app-owned provider profile storage. Polling currently launches Codex app-server against that profile and reads only `account/rateLimits/read`.

AIQM displays Codex plan quota windows and intentionally ignores OpenAI credits state for quota status.

## Fake provider

Fake-provider setup remains available for development and CI:

```bash
aiqm setup --provider fake --email dev@example.com --scenario success --poll --json
```

Fake reset times are future-relative to the injected/test clock.

## Tests

Run from repository root:

```bash
npm run ci
npm run validate:dev-flow
```

## Claude Code provider

Claude Code production polling uses Anthropic's unofficial OAuth usage endpoint (`GET /api/oauth/usage`) with AIQM-owned Claude OAuth credentials. The endpoint could change, stop working, or be removed by Anthropic at any time. Do not run Claude prompts or quota-consuming commands from polling code.

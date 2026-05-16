# Claude Code Provider Fixtures

Redacted Claude Code provider-shaped fixtures used by parser and provider-boundary tests.

Files:

- `auth-status.redacted.example.json` — redacted shape observed from `claude auth status`.
- `quota-success.redacted.example.json` — normalized read-only quota-window shape.
- `oauth-usage-success.redacted.example.json` — redacted response shape from Anthropic's unofficial `GET /api/oauth/usage` endpoint. The `utilization` fields are percentages used; AIQM stores them as `usedPercentage`, and display code derives remaining quota as `100 - usedPercentage`.
- `passive-discovery-evidence.redacted.example.json` — safe discovery summary; no tokens, raw credentials, or unredacted email/org values.

Do not store raw provider output, `~/.claude/.credentials.json`, OAuth tokens, keychain values, debug logs, or unredacted account data here.

# Claude Code Provider

Claude Code is supported through AIQM-owned Claude config directories and Claude OAuth subscription credentials.

Quota polling uses Anthropic's unofficial OAuth usage endpoint:

```text
GET https://api.anthropic.com/api/oauth/usage
anthropic-beta: oauth-2025-04-20
```

This endpoint is not documented or guaranteed by Anthropic. It could change, stop working, or be removed at any time. The provider adapter keeps this call isolated behind the Claude quota transport so failures degrade to provider-unavailable/stale account state instead of breaking the rest of AIQM.

Current implementation:

- redacted passive discovery evidence from `claude --version` and `claude auth status`
- auth-status parser contract for identity/subscription metadata
- unofficial OAuth usage parser for `five_hour` and `seven_day` utilization fields
- passive statusLine snapshot parser retained as a fallback/test boundary
- fixtures under `fixtures/providers/claude-code/`

The OAuth usage response reports percentage used (`utilization`). AIQM stores that as `usedPercentage`; desklet/display code derives quota available as `100 - usedPercentage`.

Do not run prompts, agent sessions, remote control, reviews, or any command that can consume Claude Code model quota from production polling.

Current adapter boundary:

- registered provider adapter
- `providerConfig.claudeConfigDir` required for Claude accounts
- auth status transport can run `claude auth status` with `CLAUDE_CONFIG_DIR`
- default quota transport reads `.credentials.json` from the AIQM-owned Claude config and calls the unofficial OAuth usage endpoint

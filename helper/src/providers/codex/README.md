# Codex Provider

Codex is the primary local provider integration. Accounts use AIQM-owned browser login and app-owned Codex profile directories. Quota polling currently uses the Codex app-server rate-limit source against those AIQM-owned profiles.

User setup is available through:

```bash
aiqm setup
```

The hidden `codex-live-probe` command remains for development diagnostics only and is not shown in public CLI help.

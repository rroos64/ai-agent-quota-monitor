# Release Checklist

## Automated checks

Run from the repository root:

```bash
npm run ci
npm run validate:dev-flow
```

The development-flow validation script uses temporary `AIQM_DATA_DIR` and `AIQM_CACHE_DIR` directories only. It builds the helper, runs setup/poll/status/account/diagnose/reset flows with the credential-free fake provider, verifies display-safe state files, checks for obvious secret leakage strings, and cleans up its temporary directory.

## Required checks

- [ ] `npm run ci` passes.
- [ ] `npm run validate:dev-flow` passes.
- [ ] No external credentials, real provider credentials, or secrets are required for CI/dev validation.
- [ ] No Cinnamon runtime is required for helper validation.
- [ ] `latest.json` contains normalised display state only.
- [ ] `history.log` contains JSONL display-safe history only.
- [ ] CLI output does not include `tokenPayload`, `rawMetadata`, or `SECRET_SENTINEL_DO_NOT_LEAK`.
- [ ] Local AIQM data and imported provider profiles are treated as sensitive and are not committed, logged, or copied into fixtures.
- [ ] `reset --all` removes helper-managed config/token/latest/history/log files under configured app paths.
- [ ] Public install docs point to the `install.sh` one-liner as the primary install path.

## Manual desklet smoke

- [ ] Run the one-liner installer (`bash <(curl -fsSL .../install.sh)`) or `scripts/aiqm-local.sh install` from a clone.
- [ ] Reload Cinnamon manually if needed and add **AI Agent Quota Monitor** from Desklets settings.
- [ ] Run `aiqm setup` and add a Codex account, or use a credential-free fake account for display-only development smoke.
- [ ] Confirm the desklet renders account data from `latest.json`.
- [ ] Confirm the desklet poll action can run the configured poll command.
- [ ] Confirm the desklet setup action launches the configured setup command.
- [ ] Confirm missing/invalid state does not expose secrets and does not crash the desktop session.

## Security checks

See [Security Notes](security.md).

- [ ] No raw provider outputs are committed.
- [ ] No token, cookie, auth header, session value, auth URL, or Codex home content appears in docs, fixtures, or logs.
- [ ] Provider-shaped fixtures are redacted.
- [ ] Local session artifacts are not committed.

## Version bump and tagging

See [Releasing AIQM](releasing.md) for the full version bump guide.

- [ ] `package.json` `version` field updated to the new version.
- [ ] Version bump committed on its own (`chore: bump version to vX.Y.Z`).
- [ ] Release tagged: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`.
- [ ] Branch and tag pushed: `git push origin main && git push origin vX.Y.Z`.
- [ ] GitHub Release created from the tag with release notes.

## Related docs

- [Releasing AIQM](releasing.md)
- [Install and Local Run Guide](install.md)
- [Security Notes](security.md)

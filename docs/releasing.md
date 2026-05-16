# Releasing AIQM

AIQM uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

GitHub releases are the distribution mechanism. There is no package registry. The `install.sh` at the repo root is the user-facing entry point; it downloads and re-runs `scripts/aiqm-local.sh` with `--repo-url` baked in.

---

## Version bump guide

| Bump | When |
|------|------|
| `PATCH` | Bug fixes, provider adjustments, security patches, documentation changes that do not alter the install flow or any contract |
| `MINOR` | New provider support, new user-visible features, non-breaking config additions |
| `MAJOR` | Breaking changes to the install flow, `config.json` shape, `latest.json` contract, `aiqm` CLI interface, or Cinnamon desklet API |

When in doubt, `MINOR` is safer than `MAJOR`. Reserve `MAJOR` for changes that require existing users to take action after upgrade.

---

## Release steps

### 1. Complete the release checklist

Work through [release-checklist.md](release-checklist.md) before tagging.

```bash
npm run ci
npm run validate:dev-flow
```

All automated checks must pass. Manual desklet smoke and security checks must be completed.

### 2. Bump the version in `package.json`

```json
"version": "1.2.3"
```

Commit the bump on its own:

```bash
git add package.json
git commit -m "chore: bump version to v1.2.3"
```

### 3. Tag the release

```bash
git tag -a v1.2.3 -m "Release v1.2.3"
```

Use the same version string as `package.json`, prefixed with `v`.

### 4. Push branch and tag

```bash
git push origin main
git push origin v1.2.3
```

### 5. GitHub Release is created automatically

Pushing the tag triggers `.github/workflows/release.yml`, which creates the GitHub Release via `softprops/action-gh-release`. No manual web UI step required.

The generated release body includes the pinned install one-liner and a link to the commit log for that tag. If you need to add release notes (breaking changes, provider behaviour changes), edit the release on GitHub after it is created.

---

## Install URLs

The default one-liner always installs from `main`:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/rroos64/ai-agent-quota-monitor/main/install.sh)
```

Users can pin to a specific release two ways:

**Environment variable (fetches `install.sh` from `main`, checks out the tag):**

```bash
AIQM_REF=v1.2.3 bash <(curl -fsSL https://raw.githubusercontent.com/rroos64/ai-agent-quota-monitor/main/install.sh)
```

**Pinned URL (fetches `install.sh` directly from the release tag):**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/rroos64/ai-agent-quota-monitor/v1.2.3/install.sh)
```

The pinned URL is the most stable option: it resolves to the exact `install.sh` and `aiqm-local.sh` that existed at that tag, and will not change after the fact.

---

## Related docs

- [Release Checklist](release-checklist.md)
- [Install and Local Run Guide](install.md)
- [Security Notes](security.md)

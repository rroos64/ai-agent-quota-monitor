# Contributing to AI Agent Quota Monitor

AIQM welcomes contributions, including AI-assisted ones.

It does **not** welcome mystery meat code, drive-by slop, or agent output nobody understands.

This project is small, local, security-sensitive and provider-fragile. That means we value clear thinking, tight tests, boring boundaries and changes that can be explained in plain English.

The human does the thinking. The tools may help with the typing.

---

## The short version

Before you write code:

1. Explain the expected outcome in plain language.
2. Explain how you will validate that the outcome was reached.
3. Update the relevant requirement, acceptance criteria, technical notes, boundary contract or traceability document.
4. Write the failing test.
5. Make it pass.
6. Refactor without changing behaviour.
7. Run the checks.
8. Review the code like you are responsible for it, because you are.

If you cannot explain what should happen in non-technical terms, you do not understand the problem yet.

If you cannot explain how you will prove that it happened, you are also not ready to write the code.

That is not bureaucracy. That is how effective, small, high-functioning teams have always worked. It matters more now because AI coding tools can produce a lot of confident rubbish very quickly.

---

## Project documents

This repo keeps product intent and test traceability in plain text documents.

The main documents are:

```text
docs/ai-agent-quota-monitor-brd.md
docs/ai-agent-quota-monitor-tsd.md
docs/ai-agent-quota-monitor-architecture-notes.md
docs/boundary-contracts.md
docs/test-traceability.md
docs/security.md
docs/install.md
docs/release-checklist.md
docs/releasing.md
docs/backlog/ideas-to-implement.md
docs/defects/defects.md
```

If your change affects behaviour, provider handling, storage shape, security posture, install flow, quota interpretation, account ranking, polling, or desklet output, update the relevant document **before** implementation.

No code first, archaeology later. That way lies madness.

---

## Plain-English rule

Every behaviour change must be expressible in this form:

```text
When <situation happens>,
AIQM should <observable outcome>,
so that <user/business reason>.
```

Example:

```text
When a Claude account has not produced fresh quota data recently,
AIQM should keep showing the last known values and mark the account as stale,
so that the user can still make a decision without being misled into thinking the data is fresh.
```

If you cannot write that sentence, stop. You are not ready to code.

---

## Validation rule

Every behaviour change must also have a plain-English validation statement:

```text
I will know this works when <observable proof>.
```

Example:

```text
I will know this works when a test feeds the poller a stale Claude snapshot and the generated latest.json keeps the previous quota windows, marks the account stale, and includes a stale hint.
```

That validation statement should lead directly to one or more tests.

---

## Test-first workflow

For behaviour changes, use red/green/refactor:

```text
Red     write the failing test first
Green   write the smallest useful implementation
Refactor clean up without changing behaviour
```

This project prefers test-first work because the hard parts are not pretty UI pixels. The hard parts are provider changes, stale state, local auth, ranking logic, cooldowns, file safety and not leaking secrets.

Write tests before implementation for:

- quota parsing
- stale-state behaviour
- account cooldown behaviour
- provider polling decisions
- ranking logic
- config and state file handling
- install/uninstall behaviour where practical
- security redaction
- boundary contracts
- provider fixtures
- regression fixes

For visual-only changes, still describe the outcome first. Add tests where practical. Screenshots are useful, but screenshots are not a substitute for testing actual behaviour.

---

## Requirement and traceability updates

Before coding, update the appropriate provenance trail.

Use the smallest relevant document, but do not skip the thinking step.

| Change type | Update before coding |
|---|---|
| New user-visible behaviour | BRD and/or backlog item, then `docs/test-traceability.md` |
| Changed acceptance behaviour | BRD and `docs/test-traceability.md` |
| Provider behaviour | TSD, boundary contracts if applicable, fixtures, traceability |
| State file shape | `docs/boundary-contracts.md`, contracts under `contracts/v1/`, tests |
| Security-sensitive change | `docs/security.md`, tests, traceability |
| Install/update change | `docs/install.md`, `docs/release-checklist.md`, `docs/releasing.md` if relevant |
| Defect fix | `docs/defects/defects.md`, regression test, traceability |
| Architecture boundary change | architecture document and boundary contracts |

No exceptions for code changes. If it changes behaviour, document the expected behaviour first.

For typo-only documentation changes, the document change is the work. Do not invent ceremony for that, but do not sneak behaviour changes in under the word “docs”.

---

## AI-assisted coding is welcome

AI-assisted coding is allowed and expected.

Clunker coding is welcome **only** when it is preceded by human thinking and followed by human review.

That means:

- you may use AI agents, autocomplete, code generators or local coding assistants
- you must understand the change before opening a PR
- you must review generated code manually
- you must remove dead, speculative or over-engineered output
- you must ensure tests prove the intended behaviour
- you must not submit code merely because an agent produced it confidently

Agent-only contributions are allowed for now, but we will keep an eye on sloppification. If the project starts receiving low-quality generated PRs, this policy will become stricter.

If you submit the change, you own it.

---

## SOLID, but do not be weird about it

We want clean code. We want clear boundaries. We want changes to be easy.

We also do not want ten layers of abstraction wrapped around three lines of useful behaviour.

Use SOLID principles where they help:

- keep provider-specific behaviour inside provider modules
- keep desklet rendering separate from provider polling
- keep state file contracts clear
- keep config, polling, ranking and redaction logic testable
- prefer small units with boring names
- depend on clear boundaries, not accidental implementation details

Do **not** use SOLID as an excuse to create abstraction soup.

Good code here is boring, readable and hard to misuse.

---

## Boundary contracts matter

AIQM depends on local files and provider responses. That makes boundaries important.

If you change any of these, update the contract and tests:

```text
contracts/v1/config.schema.json
contracts/v1/latest-state.schema.json
contracts/v1/history-entry.schema.json
contracts/v1/token-record.schema.json
docs/boundary-contracts.md
```

The desklet should only consume display-safe state.

It must not read provider auth files, raw provider frames, tokens, cookies, logs or internal config details.

If your change blurs that boundary, expect pushback.

---

## Provider integration rules

Provider integrations are fragile. Treat them that way.

Any provider integration change should include, where practical:

- a redacted success fixture
- a redacted auth failure fixture
- a redacted rate-limit or cooldown fixture
- a malformed or unexpected response fixture
- tests proving the parser and normaliser behaviour
- a note explaining whether the endpoint is official or unofficial

Never commit raw provider frames that contain credentials, cookies, auth URLs, bearer tokens, session data, device codes or account secrets.

If the endpoint is unofficial, say so clearly. Do not pretend brittle integrations are stable.

---

## Security rules

This project touches provider sessions and local account data. Be careful.

Do not commit or paste:

- provider auth files
- tokens
- cookies
- auth URLs
- device codes
- Codex auth homes
- Claude credentials
- raw provider frames
- logs containing raw provider output

Security-sensitive changes must update `docs/security.md` and include tests where practical.

The desklet must remain passive. It should read normalised quota state only.

---

## Required checks

Before opening a PR, run:

```bash
npm run ci
npm run validate:dev-flow
```

These checks are required unless the change is documentation-only and clearly cannot affect code, build, tests, contracts or packaging.

If a check cannot be run, say so in the PR and explain why.

Do not hide failing checks. Fix them or call them out.

---

## Pull request expectations

A good PR should answer these questions without making the reviewer go hunting:

1. What user-visible outcome changed?
2. Why was the change needed?
3. Which BRD, AC, technical spec, defect, backlog item or contract does it relate to?
4. How was the outcome validated?
5. What tests were added or changed?
6. What risks remain?
7. Did AI assistance generate any significant part of the change?
8. Did a human review the generated output?

Small PRs are better than heroic PRs.

If your PR changes unrelated things, split it.

---

## What not to submit

Do not submit:

- unreviewed AI output
- code without a clear expected outcome
- behaviour changes without updated provenance
- provider parsing without fixtures
- security-sensitive changes without security notes
- huge rewrites with no migration path
- abstraction for imaginary future problems
- tests that only prove mocks were called
- snapshots that bless broken behaviour
- changes that make the desklet responsible for provider secrets

If the change is clever but hard to explain, it is probably not clever enough.

---

## Good first contributions

Useful first contributions include:

- improving setup wording in the TUI
- improving README or install docs
- adding missing tests for existing behaviour
- adding redacted provider fixtures
- improving stale/error messages
- fixing desklet display bugs
- improving local install/uninstall checks
- documenting known provider failure modes
- improving security documentation

If you are unsure where to start, look at:

```text
docs/backlog/ideas-to-implement.md
docs/defects/defects.md
```

---

## Development setup

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run ci
npm run validate:dev-flow
```

Install locally for manual testing:

```bash
scripts/aiqm-local.sh install --launch-setup
```

Uninstall but keep data:

```bash
scripts/aiqm-local.sh uninstall
```

Uninstall and remove local AIQM data:

```bash
scripts/aiqm-local.sh uninstall --purge-data
```

Use purge carefully. It removes local AIQM state and provider session data managed by AIQM.

---

## Licence

By contributing to this project, you agree that your contribution will be licensed under the MIT Licence.

See [LICENSE](LICENSE).

---

## Issue and pull request templates

GitHub templates live in `.github/`:

```text
.github/pull_request_template.md         — PR checklist (plain-English outcome, validation plan, related docs, AI assistance, security)
.github/ISSUE_TEMPLATE/bug_report.yml    — structured bug report (provider, environment, redacted logs)
.github/ISSUE_TEMPLATE/feature_request.yml — feature proposal (plain-English outcome, validation plan, related docs, layer)
```

The feature request template uses the same plain-English outcome and validation plan vocabulary as the sections above. Use them.

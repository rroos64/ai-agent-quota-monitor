# Business Requirements Document

## AI Agent Quota Monitor

| Field | Detail |
|---|---|
| **Document Reference** | BRD-001 |
| **Version** | Draft v1.2 |
| **Date** | 2026-05-09 |
| **Status** | Draft |
| **Product / Project** | AI Agent Quota Monitor |
| **Owner** | Riaan Roos |
| **Related ARCH** | docs/ai-agent-quota-monitor-architecture-notes.md |
| **Signoff** | |
| **Signoff Date** | |

---

# 1. Document Governance

## 1.1 Purpose of this BRD

This BRD defines the business problem, scope, business requirements and acceptance criteria for the AI Agent Quota Monitor.

The document is written in business and user language. Technical design, implementation detail, provider integration design and test implementation belong in the project’s technical and test artefacts.

## 1.2 Ways of Working Alignment

Contributing and traceability conventions are documented in `CONTRIBUTING.md` and `docs/test-traceability.md`.

The following rules apply:

1. Every business requirement must have at least one directly linked acceptance criterion.
2. Acceptance criteria must use the format `BR-###-AC-###`.
3. Acceptance criteria must sit directly under the requirement they verify.
4. Every test written for this product must trace back to a requirement and acceptance criterion in the test provenance document.
5. A feature is not complete until its acceptance criteria are represented in the test provenance document and verified by the agreed test layers.
6. Any change to a business requirement or acceptance criterion triggers a test-impact review before implementation work begins.
7. Deprecated or changed acceptance criteria must not be silently removed from test traceability records.

## 1.3 Requirement Change Control

A change to this BRD includes any of the following:

1. Adding a new business requirement.
2. Removing a business requirement.
3. Changing requirement wording in a way that changes expected behaviour.
4. Adding, removing or changing an acceptance criterion.
5. Changing a threshold, boundary, provider scope or user-visible behaviour.

When one of these changes occurs, a test-impact review must be completed before implementation starts.

Cosmetic wording, typo fixes or formatting-only changes do not trigger a test-impact review.

---

# 2. Business Context

## 2.1 Business Problem

The user regularly works with AI coding agents from multiple service providers and across multiple accounts. Each provider exposes quota information differently, usually inside its own dashboard, IDE, CLI session or account settings.

Checking each account manually is slow and disruptive. The user may begin a coding session without knowing that an account is close to its quota limit, which can interrupt work halfway through an agent task.

The business need is a local desktop monitor that makes quota usage visible at a glance.

## 2.2 Business Goals

1. Allow the user to see quota usage across multiple Antigravity, Claude Code and Codex accounts without logging into each provider separately.
2. Help the user avoid starting heavy coding-agent work on an account that is close to quota exhaustion.
3. Provide a simple, readable desktop view using account cards grouped by provider.
4. Keep the product read-only and passive.
5. Support personal use first, while keeping the design suitable for wider publication later.

## 2.3 Success Criteria

The first version is successful when the user can glance at the LMDE desktop and know which configured Antigravity, Claude Code or Codex account still has enough quota available for a heavy AI-agent coding session.

---

# 3. Scope

## 3.1 In Scope

The first version includes:

1. LMDE/Cinnamon desklet.
2. Support for multiple accounts per provider.
3. Support for the following provider quota types:
   - Google Antigravity account quota.
   - Claude Code plan quota.
   - OpenAI Codex ChatGPT plan-included quota.
4. Account setup screen.
5. Provider authentication through each provider’s normal sign-in flow, including 2FA where required.
6. Local token storage in a JSON file.
7. Account-level quota display.
8. Provider quota window names where available.
9. Used quota percentage shown as a progress bar.
10. Reset time shown as a relative local time.
11. Automatic refresh every five minutes.
12. Asynchronous refresh calls across providers and accounts.
13. Stale-state handling after one failed update.
14. Basic local quota history stored in a text file.
15. Local logs.
16. Ability to delete configured accounts.
17. Ability to reset all local data.
18. Auto-detection of installed tools and common local provider paths where possible.

## 3.2 Out of Scope

The first version does not include:

1. Claude API usage monitoring.
2. OpenAI API key usage monitoring.
3. Model-level quota display.
4. Automatic account switching.
5. Automatic account rotation.
6. Best-account recommendation.
7. Desktop notifications.
8. Manual refresh button.
9. Privacy mode or email masking.
10. Account reordering.
11. Quota history charts.
12. Subscription management.
13. Credit top-ups or billing management.
14. Team or organisation reporting.
15. Root/admin installation requirement.

---

# 4. Users

## 4.1 Primary User

A solo developer who uses AI coding agents heavily and switches between multiple provider accounts to manage quota availability.

## 4.2 User Need

The user needs to know, before starting work, which account still has sufficient quota available.

---

# 5. Provider Scope

## 5.1 Google Antigravity

The desklet must support Antigravity account quota for configured Google accounts.

## 5.2 Claude Code

The desklet must support Claude Code plan quota only. Claude API usage is excluded from v1.

## 5.3 OpenAI Codex

The desklet must support ChatGPT plan-included Codex quota. OpenAI API-key usage is excluded from v1.

---

# 6. Business Requirements and Acceptance Criteria

## 6.1 Account Management

### BR-001: Add Provider Account

The user must be able to add an account for a supported provider from the setup screen.

The setup flow must allow the user to select the provider, enter the account email address and start the provider’s normal authentication flow.

#### Acceptance Criteria

**BR-001-AC-001: Add a supported provider account**

Given I am on the setup screen  
When I add a supported provider account  
Then I can select the provider  
And I can enter the account email address  
And I can start the provider’s normal authentication flow

**BR-001-AC-002: Show newly added account immediately**

Given I add a new account in setup  
When the account is saved  
Then the account appears in the desklet view immediately  
And if quota has not yet been fetched, the account card shows quota unavailable

### BR-002: Provider Authentication

The desklet must use each provider’s normal interactive sign-in flow, including 2FA where the provider requires it.

The desklet must store the resulting authentication token locally so the account can be refreshed without requiring the user to sign in every time.

#### Acceptance Criteria

**BR-002-AC-001: Complete provider authentication**

Given I am adding a provider account  
When the provider requires interactive authentication  
Then I can complete the provider’s normal sign-in flow  
And I can complete provider 2FA where required  
And the account is saved only after authentication succeeds

**BR-002-AC-002: Reuse stored authentication**

Given an account has been authenticated successfully  
When the desklet performs a later quota refresh  
Then the desklet can use the stored authentication token  
And I am not required to sign in again for every refresh

### BR-003: Email Validation

The desklet must validate that the authenticated account matches the email address entered by the user.

If the authenticated account does not match the entered email address, the desklet must not silently save the account as valid.

#### Acceptance Criteria

**BR-003-AC-001: Validate authenticated email address**

Given I enter an email address during account setup  
When provider authentication completes  
Then the desklet validates that the authenticated account matches the entered email address  
And if the email does not match, the account is not saved as a valid account  
And the setup screen shows a clear mismatch message

### BR-004: Token Storage

For v1, provider tokens are stored in a local JSON file.

The setup screen must show where the token file is stored.

The product must treat JSON token storage as a known security risk and make this clear in documentation.

#### Acceptance Criteria

**BR-004-AC-001: Store authentication token locally**

Given provider authentication succeeds  
When the account is saved  
Then the resulting authentication token is stored in a local JSON file

**BR-004-AC-002: Show token storage location**

Given I open the setup screen  
When local authentication storage is configured  
Then I can see the local JSON token file location  
And I can understand that this file contains sensitive provider tokens

**BR-004-AC-003: Document JSON token risk**

Given I read the product documentation  
When token storage is described  
Then the documentation clearly states that JSON token storage is a v1 security risk

### BR-005: Delete Account

The user must be able to delete a configured account from the setup screen.

Deleting an account removes it from the desklet view and stops future refreshes for that account.

Deleting an account must not delete existing quota history for that account.

#### Acceptance Criteria

**BR-005-AC-001: Delete configured account**

Given an account is configured  
When I delete the account from setup  
Then the account is removed from the desklet view  
And it is no longer refreshed  
And existing quota history for that account is not deleted

### BR-006: Reset All Local Data

The user must be able to reset all local desklet data.

This removes configured accounts, stored tokens, latest quota values and local quota history.

#### Acceptance Criteria

**BR-006-AC-001: Reset local data**

Given local desklet data exists  
When I choose reset all local data  
Then configured accounts are removed  
And stored tokens are removed  
And latest quota values are removed  
And quota history is removed

## 6.2 Display Requirements

### BR-007: Combined Provider View

The desklet must display all configured accounts in one combined desktop view.

Accounts must be grouped by provider.

Accounts within each provider group must be shown in the order they were added.

#### Acceptance Criteria

**BR-007-AC-001: Group accounts by provider**

Given I have configured accounts for multiple supported providers  
When the desklet loads  
Then all configured accounts are shown in one combined view  
And accounts are grouped by provider  
And accounts within each provider group are shown in the order they were added

### BR-008: Account Cards

Each configured account must be displayed as a simple card.

Each card must show:

1. Provider name.
2. Account email address.
3. Available provider quota windows.
4. Used percentage for each quota window.
5. Progress bar for each quota window.
6. Relative reset time for each quota window.
7. Stale or error note where applicable.
8. Short setup or error hint where applicable.

#### Acceptance Criteria

**BR-008-AC-001: Display account card content**

Given a configured account is shown in the desklet  
When the account card is displayed  
Then the card shows the provider name  
And the account email address  
And available provider quota windows  
And used percentage for each quota window  
And a progress bar for each quota window  
And relative reset time for each quota window where available

**BR-008-AC-002: Display card status notes**

Given an account has stale quota data or quota cannot be fetched  
When the account card is displayed  
Then the card shows the relevant stale or error note  
And the card shows a short setup or error hint where applicable

### BR-009: Email Display

The desklet must show the real account email address on each card.

Email masking and privacy mode are not required in v1.

#### Acceptance Criteria

**BR-009-AC-001: Show real email address**

Given an account has been configured with an email address  
When the account card is displayed  
Then the real email address is shown on the card  
And the email address is not masked in v1

### BR-010: Provider Window Names

The desklet must display quota window names using provider terminology where available.

The desklet must not force all providers into generic names if the provider exposes a more accurate name.

#### Acceptance Criteria

**BR-010-AC-001: Use provider quota window terminology**

Given a provider returns a quota window name  
When the quota window is displayed  
Then the desklet shows the provider’s quota window name where available  
And the desklet does not replace it with a less accurate generic name

### BR-011: Account-Level Quota

The desklet must show account-level quota only.

Model-level quota is not required in v1.

#### Acceptance Criteria

**BR-011-AC-001: Display account-level quota only**

Given quota data is available for an account  
When the account card is displayed  
Then the quota shown represents account-level usage  
And the card does not show model-level quota in v1

### BR-012: Progress Bar Display

Each quota window must be shown as a progress bar with the used percentage displayed.

The display is based on used quota, not remaining quota.

#### Acceptance Criteria

**BR-012-AC-001: Show used percentage as progress bar**

Given quota data is available for a quota window  
When the quota window is displayed  
Then the used percentage is displayed as a progress bar  
And the used percentage value is displayed beside or within the progress bar

**BR-012-AC-002: Use used quota as the display basis**

Given a provider returns quota usage data  
When the desklet displays the quota window  
Then the progress bar represents used quota  
And it does not use remaining quota as the primary display value

### BR-013: Reset Time Display

Reset time must be shown as relative local time.

Examples:

- resets in 42m
- resets in 2h 14m
- resets in 3d 4h

The desklet must use the LMDE system timezone.

#### Acceptance Criteria

**BR-013-AC-001: Show reset time as relative local time**

Given a provider returns a quota reset time  
When the reset time is shown on the account card  
Then the reset time is converted to the LMDE system timezone  
And it is displayed as a relative time

**BR-013-AC-002: Hide reset time when unavailable**

Given a provider does not return a reset time for a quota window  
When the account card is displayed  
Then the desklet does not show an incorrect reset time  
And the card may show that the reset time is unavailable

## 6.3 Visual State Requirements

### BR-014: Low-Usage State

Quota below 50% used must use the low-usage visual state.

#### Acceptance Criteria

**BR-014-AC-001: Show low-usage state**

Given a quota window is below 50% used  
When the account card is displayed  
Then the quota indicator uses the low-usage visual state  
And the progress bar is shown in green

### BR-015: Medium-Usage State

Quota from 50% used up to below 75% used must use the medium-usage visual state.

#### Acceptance Criteria

**BR-015-AC-001: Show medium-usage state**

Given a quota window is 50% or higher and below 75% used  
When the account card is displayed  
Then the quota indicator uses the medium-usage visual state  
And the progress bar is shown in orange

### BR-016: High-Usage State

Quota at 75% used or above must use the high-usage visual state.

#### Acceptance Criteria

**BR-016-AC-001: Show high-usage state**

Given a quota window is 75% used or higher  
When the account card is displayed  
Then the quota indicator uses the high-usage visual state  
And the progress bar is shown in red

### BR-017: Provider Visual Identity

The desklet should use consistent provider icons and colours.

Provider sections may use different visual boundaries by vendor.

#### Acceptance Criteria

**BR-017-AC-001: Show consistent provider identity**

Given accounts are grouped by provider  
When the desklet displays provider sections  
Then each provider section uses a consistent provider icon or label  
And each provider section uses consistent provider styling

**BR-017-AC-002: Distinguish provider sections visually**

Given more than one provider has configured accounts  
When the desklet displays the account list  
Then the user can visually distinguish one provider section from another

### BR-018: No Desktop Notifications

The desklet must not show desktop notifications in v1.

Warnings are visual changes on the account cards only.

#### Acceptance Criteria

**BR-018-AC-001: Do not show desktop notifications**

Given an account reaches a warning or high-usage state  
When the account card is displayed  
Then the warning is shown visually on the card only  
And no desktop notification is shown

## 6.4 Refresh Requirements

### BR-019: Automatic Refresh

The desklet must refresh quota information every five minutes.

#### Acceptance Criteria

**BR-019-AC-001: Refresh every five minutes**

Given the desklet is running  
When five minutes have passed since the last refresh cycle  
Then the desklet starts a new refresh cycle automatically

### BR-020: Asynchronous Refresh

Quota checks for providers and accounts must run asynchronously.

A slow or failed account refresh must not block refreshes for other accounts.

#### Acceptance Criteria

**BR-020-AC-001: Refresh accounts asynchronously**

Given multiple provider accounts are configured  
When a refresh cycle starts  
Then account refreshes run asynchronously  
And a slow or failed account refresh does not block other accounts from refreshing

### BR-021: No Manual Refresh

A manual refresh button is not required in v1.

#### Acceptance Criteria

**BR-021-AC-001: Exclude manual refresh control**

Given I view the v1 desklet  
When I interact with the desklet or setup screen  
Then there is no manual refresh button  
And quota refresh is controlled by the automatic five-minute refresh cycle

### BR-022: Offline Behaviour

When the machine is offline, refresh failures must be handled silently.

The desklet must keep showing last known quota values where available.

#### Acceptance Criteria

**BR-022-AC-001: Handle offline refresh silently**

Given the machine is offline  
When the desklet attempts a scheduled refresh  
Then no desktop notification is shown  
And available last known values remain visible  
And affected account cards are marked as stale where previous data exists

### BR-023: Battery Behaviour

The desklet must continue refreshing while the machine is on battery.

#### Acceptance Criteria

**BR-023-AC-001: Continue refreshing on battery**

Given the machine is running on battery power  
When the five-minute refresh interval is reached  
Then the desklet starts the scheduled refresh cycle  
And quota refresh is not paused because the machine is on battery

## 6.5 Stale and Error Handling Requirements

### BR-024: Stale After One Failed Update

If an account has existing quota data and the next scheduled refresh fails, the account card must be marked as stale after that failed update.

#### Acceptance Criteria

**BR-024-AC-001: Mark account stale after one failed update**

Given an account has previous quota data  
When the next scheduled refresh for that account fails  
Then the account card is marked as stale after that failed update

### BR-025: Last Known Values

When an account refresh fails, the desklet must continue showing the previous quota values where available.

#### Acceptance Criteria

**BR-025-AC-001: Keep last known quota values**

Given an account has previous quota data  
When the next refresh for that account fails  
Then the previous quota values remain visible on the account card

### BR-026: Stale Display

The normal card does not need to show last updated time while data is fresh.

When data is stale, the card must show a stale note and how old the data is.

#### Acceptance Criteria

**BR-026-AC-001: Hide update age while fresh**

Given an account has fresh quota data  
When the account card is displayed  
Then the card does not need to show the last updated time

**BR-026-AC-002: Show stale age when stale**

Given an account card is stale  
When the account card is displayed  
Then the card shows a stale note  
And the card shows how old the stale data is

### BR-027: Error Hints

When quota data is unavailable or stale, the desklet must show a short hint that helps the user understand the likely issue.

Examples:

- authentication may have expired
- quota endpoint unavailable
- no quota data available yet
- complete account authentication in setup

#### Acceptance Criteria

**BR-027-AC-001: Show helpful stale or error hint**

Given quota data is unavailable or stale for an account  
When the account card is displayed  
Then the card shows a short hint explaining the likely issue

### BR-028: Provider Failure Isolation

If one provider fails, the rest of the desklet must continue working.

If one account fails, other accounts for the same provider must still refresh where possible.

#### Acceptance Criteria

**BR-028-AC-001: Isolate provider failures**

Given one provider quota refresh fails  
When other providers can still be refreshed  
Then the desklet continues to refresh and display those other providers  
And the failed provider accounts show stale or unavailable status as appropriate

**BR-028-AC-002: Isolate account failures**

Given one account refresh fails  
When other accounts for the same provider can still be refreshed  
Then the desklet continues to refresh those other accounts  
And the failed account shows stale or unavailable status as appropriate

## 6.6 History and Logging Requirements

### BR-029: Quota History

The desklet must write quota history to a simple local text file.

The history file must store:

- timestamp
- provider
- email
- quota window
- used percentage
- reset time
- status

#### Acceptance Criteria

**BR-029-AC-001: Write quota history entry**

Given a quota refresh succeeds  
When quota values are updated  
Then a history entry is written to the local text file  
And the entry includes timestamp, provider, email, quota window, used percentage, reset time and status

### BR-030: History Retention

Quota history is kept forever unless the user resets all local data or manually deletes the history file.

#### Acceptance Criteria

**BR-030-AC-001: Keep quota history forever**

Given quota history exists  
When normal refresh cycles continue  
Then old history entries are not automatically deleted

**BR-030-AC-002: Remove history during full reset**

Given quota history exists  
When I choose reset all local data  
Then quota history is removed as part of the reset

### BR-031: Local Logs

The desklet may write local logs.

Logs may include email addresses.

Logs must not include provider passwords.

#### Acceptance Criteria

**BR-031-AC-001: Write local logs**

Given the desklet performs setup, authentication or refresh activity  
When a relevant event occurs  
Then the desklet may write the event to local logs

**BR-031-AC-002: Exclude provider passwords from logs**

Given local logs are written  
When log entries are stored  
Then provider passwords are not written to the logs

**BR-031-AC-003: Allow email addresses in logs**

Given local logs are written  
When an event relates to a configured account  
Then the account email address may be included in the local log entry

## 6.7 Installation and Runtime Requirements

### BR-032: LMDE/Cinnamon Desklet

The product must run as an LMDE/Cinnamon desklet.

#### Acceptance Criteria

**BR-032-AC-001: Run as Cinnamon desklet**

Given the desklet is installed on LMDE with Cinnamon  
When the user adds the desklet to the desktop  
Then the quota monitor runs as a Cinnamon desklet  
And the account cards are displayed on the desktop

### BR-033: Node.js Dependency

Node.js is acceptable as a v1 dependency.

#### Acceptance Criteria

**BR-033-AC-001: Use Node.js as accepted runtime dependency**

Given v1 is installed  
When runtime dependencies are checked  
Then Node.js may be required for provider polling or supporting scripts  
And the installation instructions identify Node.js as a dependency

### BR-034: Terminal Setup

Terminal setup steps are acceptable in v1.

#### Acceptance Criteria

**BR-034-AC-001: Support terminal-based setup**

Given I am installing v1  
When setup requires terminal commands  
Then the installation instructions provide the required commands  
And terminal-based setup is considered acceptable for v1

### BR-035: No Root Requirement

The desklet must work without root or admin privileges.

#### Acceptance Criteria

**BR-035-AC-001: Work without root privileges**

Given the desklet is installed for the current user  
When the desklet runs normally  
Then it does not require root or admin privileges

### BR-036: Auto-Detection

The desklet should auto-detect installed tools and common provider profile paths where possible.

#### Acceptance Criteria

**BR-036-AC-001: Auto-detect local tools and paths**

Given supported provider tools or profile paths exist on the machine  
When I open the setup screen  
Then the desklet attempts to detect them  
And detected paths are shown as setup assistance

## 6.8 Safety and Boundary Requirements

### BR-037: Passive Monitor Only

The desklet must be a passive quota monitor only.

#### Acceptance Criteria

**BR-037-AC-001: Remain passive during monitoring**

Given the desklet is running  
When it displays or refreshes quota information  
Then it only reads quota-related information  
And it does not perform coding-agent work on the user’s behalf

### BR-038: No Account Switching

The desklet must not automatically switch accounts.

#### Acceptance Criteria

**BR-038-AC-001: Do not switch accounts automatically**

Given multiple accounts are configured  
When one account is close to quota exhaustion  
Then the desklet does not automatically switch the active account in any provider tool

### BR-039: No Account Rotation

The desklet must not rotate between accounts to avoid provider limits.

#### Acceptance Criteria

**BR-039-AC-001: Do not rotate accounts**

Given multiple accounts are configured for a provider  
When quota levels change  
Then the desklet does not rotate accounts  
And it does not trigger behaviour intended to bypass provider limits

### BR-040: No Quota-Consuming Refresh

The desklet must not send prompts, start coding-agent sessions, or perform model calls merely to refresh quota information.

#### Acceptance Criteria

**BR-040-AC-001: Do not consume model quota during refresh**

Given the desklet refreshes quota information  
When provider quota data is requested  
Then the desklet does not send model prompts  
And it does not start coding-agent sessions  
And it does not perform model calls merely to update the display

### BR-041: No Billing Management

The desklet must not manage subscriptions, billing, credit purchases or top-ups.

#### Acceptance Criteria

**BR-041-AC-001: Exclude billing actions**

Given I use the desklet or setup screen  
When I interact with provider account information  
Then the desklet does not provide actions to manage subscriptions  
And it does not purchase credits  
And it does not top up accounts  
And it does not change provider billing settings

---

# 7. Known Risks

## KR-001: Token Storage in JSON

For v1, authentication tokens are stored in a local JSON file. This is insecure compared with an OS keyring or encrypted credential store.

Impact: If the local token file is exposed, provider accounts may be compromised.

Mitigation for v1: Show the token file location, document the risk clearly and avoid storing passwords.

Future mitigation: Move token storage to the OS keyring or another secure credential store.

## KR-002: Unofficial Provider Endpoints

Some quota data may require unofficial or internal provider endpoints.

Impact: Provider changes may break quota refresh without warning.

Mitigation for v1: Show clear stale/error states and isolate provider failures.

## KR-003: Provider Terminology and Data Differences

Providers may expose different quota window names, reset formats and quota measurements.

Impact: Cards may not look identical across providers.

Mitigation for v1: Preserve provider terminology where available and normalise only the display pattern.

## KR-004: Long-Lived History File

Quota history is retained forever.

Impact: The history file may grow over time and may expose account usage patterns.

Mitigation for v1: Allow reset all local data and document the history file location.

---

# 8. Traceability Summary

Acceptance criteria are listed directly beneath their related business requirement using the format:

```text
BR-###-AC-###
```

Every business requirement from BR-001 to BR-049 has at least one directly linked acceptance criterion.

All implementation tests must reference the relevant `BR-###` and `BR-###-AC-###` identifiers in the project test provenance document.

The minimum traceability chain is:

```text
Business requirement → Acceptance criterion → Test provenance row → Test evidence
```

A requirement is not considered delivered until its acceptance criteria have test coverage recorded in the provenance document and the relevant evidence has been produced.

---

# 9. Open Items for Later Versions

1. Move token storage from JSON to the OS keyring or an encrypted credential store.
2. Add account reordering.
3. Add quota history charts.
4. Add optional privacy mode for screen-sharing.
5. Add optional desktop notifications.
6. Add provider-specific diagnostics.
7. Add Claude API or OpenAI API usage monitoring as separate provider modes.
8. Add export/import for account configuration, excluding tokens by default.


---

# Current Implementation Alignment — 2026-05-14

This section supersedes earlier exploratory wording where it differs.

## Implemented provider scope

Codex and Claude Code are real supported providers in the current local production build. Fake provider support remains for development and CI. Claude Code quota polling uses Anthropic's unofficial OAuth usage endpoint; this could change, stop working, or be removed by Anthropic at any time. Antigravity remains future provider/skeleton scope.

## Additional implementation requirements (BR-045 – BR-049)

The following requirements were added during implementation and are numbered BR-045 onwards to avoid collision with the original BR-022 – BR-026 in section 6. The original BR-022 – BR-026 remain in force.

### BR-045: AIQM-Owned Codex Account Sessions

AIQM must use its own Codex browser login/session storage and must not depend on the user's normal Codex CLI login as the production account source.

#### Acceptance Criteria

- BR-045-AC-001: Given I add a Codex account, when browser login completes, then AIQM stores the account under `providers/codex/<email>/codex-home`.
- BR-045-AC-002: Given my normal Codex CLI login changes, when AIQM polls, then AIQM continues using its own configured account profile.
- BR-045-AC-003: Given a Codex profile contains credentials, when documentation describes storage, then it identifies the profile as sensitive local state.

### BR-046: Account Management TUI

The setup TUI must support account add, edit, reorder, logout while keeping the account, delete, and re-login.

#### Acceptance Criteria

- BR-046-AC-001: Given I am on the setup home screen, when I press `(a)dd`, then a Codex browser-login add flow starts.
- BR-046-AC-002: Given an account is selected, when I press `(e)dit`, then I can edit display name, reorder with arrow keys, re-login, logout, or go back.
- BR-046-AC-003: Given an account is selected, when I choose logout, then AIQM removes session/auth data but keeps the account in the list.
- BR-046-AC-004: Given an account is selected, when I choose delete and confirm, then AIQM removes the account from config and provider profile data.
- BR-046-AC-005: Given an account is selected, when I choose re-login, then AIQM replaces that account's AIQM-owned Codex session without creating a duplicate.

### BR-047: Reliable Background Refresh

Quota refresh must not depend on Cinnamon's PATH or the desklet timer alone.

#### Acceptance Criteria

- BR-047-AC-001: Given AIQM is installed, then a user `systemd` timer named `aiqm-poll.timer` is enabled.
- BR-047-AC-002: Given the timer fires, then `aiqm poll --json` writes a fresh `latest.json`.
- BR-047-AC-003: Given `latest.json` changes, then the desklet re-renders without account setup being open.

### BR-048: Codex Quota Semantics

AIQM must display Codex plan quota windows and must not treat OpenAI credit state as Codex usage quota.

#### Acceptance Criteria

- BR-048-AC-001: Given Codex returns 5-hour and weekly windows, then AIQM shows those windows as account metrics.
- BR-048-AC-002: Given Codex returns `credits.hasCredits=false` but valid quota windows, then AIQM still treats the window data as valid.
- BR-048-AC-003: Given Codex returns `rateLimitReachedType`, then AIQM may mark the account unavailable and show safe status text.

### BR-049: Compact Desklet UX

The desklet must present compact, glanceable account cards grouped by provider.

#### Acceptance Criteria

- BR-049-AC-001: Given multiple provider sections exist, then each is contracted (collapsed) by default; clicking a provider header expands it and collapses any other currently expanded section (concertina behaviour — at most one section open at a time).
- BR-049-AC-002: Given an account has two quota windows, then both metrics appear in a single account tile.
- BR-049-AC-003: Given the setup button is visible, then it appears aligned with the desklet header rather than floating separately.

### BR-042: No-Brainer Account Selection Order

The helper service must rank accounts within each provider group so that, during a coding spike, the user can pick the next account with minimal thought. Think of it as a best-before system for quota: the weekly reset is the best-before date, and the 5-hour reset is the smell test after opening.

Ranks are computed by the background polling helper and stored in `latest.json`. The desklet displays them as numbered pills without recomputing.

#### Acceptance Criteria

- BR-042-AC-001: Given multiple accounts in the same provider group, when the polling service writes `latest.json`, then each rankable account carries a `selectionRank` integer (1 = best) and the desklet shows it as a numbered order pill.
- BR-042-AC-002: Given account A has an active 5-hour window with meaningful quota remaining and account B is an unused reserve with the same weekly reset date, when ranks are calculated, then account A ranks above account B (use the opened account first — it is already opened and its short-term quota is ticking).
- BR-042-AC-003: Given account A is an unused reserve whose weekly reset is tomorrow and account B is opened with the same weekly reset date far in the future, when ranks are calculated, then account A ranks above account B (best-before urgency overrides opened preference when the weekly waste risk is materially larger).
- BR-042-AC-004: Given an account has 0% 5-hour quota remaining, when ranks are calculated, then that account receives no order pill (exhausted — not usable for the next coding spike).
- BR-042-AC-005: Given an account has 0% weekly quota remaining, when ranks are calculated, then that account receives no order pill even if the 5-hour bucket appears full (exhausted — weekly allowance is the outer constraint).
- BR-042-AC-006: Given an account has a 5-hour remaining percentage below 10%, when ranks are calculated, then that account is penalised and should fall below accounts with more available quota unless its weekly waste risk is substantially larger.
- BR-042-AC-007: Given rankable accounts exist in multiple provider groups, when ranks are calculated, then rank numbers restart per provider group.
- BR-042-AC-008: Given an account's quota data is stale, when ranks are calculated, then that account may still receive a rank but with reduced confidence, and its score is lower than the equivalent fresh-data account.
- BR-042-AC-009: Given all accounts in a provider group score zero (no urgency pressure), when ranks are calculated, then non-exhausted accounts with data confidence greater than zero still receive a ranked recommendation using the fallback decision order; exhausted accounts and accounts with unavailable or error status receive no rank (TSD Section 11.3).
- BR-042-AC-010: Given the all-zero fallback applies, when ranks are calculated, then fresh reserve accounts (5-hour bucket at 100% with no active reset time) rank above accounts that have partially consumed their 5-hour quota.
- BR-042-AC-011: Given the all-zero fallback applies and fresh-reserve status is equal, when ranks are calculated, then the account with a known weekly reset date ranks above the account without one.
- BR-042-AC-012: Given the all-zero fallback applies and no other signal differentiates accounts, when ranks are calculated, then accounts rank in stable configured display order.
- BR-042-AC-013: Given a ranked account has stale quota data, when the desklet renders the rank pill, then the pill shows a "?" suffix to signal data uncertainty, per TSD Section 11.4.

### BR-044: Per-Account Progressive Poll Back-Off

The polling service must apply a per-account progressive back-off strategy to avoid overwhelming provider APIs and to reduce unnecessary polling when quota is stable.

#### Acceptance Criteria

**BR-044-AC-001: Reset to min on data change**

Given an account's quota usage, reset time, or window status changes between two polls  
When the polling service processes the fresh result  
Then the effective poll interval for that account is reset to the configured minimum

**BR-044-AC-002: Back off by ratio on no data change**

Given an account's quota data is unchanged between two polls  
When the polling service processes the fresh result  
Then the effective poll interval for that account is multiplied by the provider's configured backoff ratio, up to the configured maximum

**BR-044-AC-003: Back off by ratio on error**

Given a poll attempt for an account fails or returns a non-fresh status  
When the polling service processes the result  
Then the effective poll interval for that account is multiplied by the provider's configured backoff ratio, up to the configured maximum

**BR-044-AC-004: Interval stays at max**

Given an account's effective poll interval has reached the configured maximum  
When successive polls continue to find no data change or return errors  
Then the effective poll interval remains at the maximum and does not increase further

**BR-044-AC-005: Skip uses effective interval, not config min**

Given an account's effective poll interval has been backed off beyond the config minimum  
When the polling service runs and the elapsed time is less than the effective interval  
Then that account is skipped for this poll run

**BR-044-AC-006: Configurable boundaries per provider**

Given provider-level min interval, max interval, and backoff ratio are defined in the codebase, and optional account-level interval overrides are set in config  
When the polling service runs  
Then each account uses its provider's floor, ceiling, and ratio for normal back-off, while provider `retry-after` values are honoured even above the configured ceiling

---

### BR-043: Claude Code Provider Discovery and Parser Contracts

AIQM must implement Claude Code using safe, redacted Anthropic/Claude CLI validation evidence and an isolated quota transport. Claude production polling currently uses Anthropic's unofficial OAuth usage endpoint, which could change, stop working, or be removed by Anthropic at any time.

#### Acceptance Criteria

- BR-043-AC-001: Given Claude Code implementation starts, then committed fixtures must contain only redacted auth/status and quota-shaped examples.
- BR-043-AC-002: Given `claude auth status` returns identity/subscription metadata, then AIQM can parse the display-safe account email/subscription shape without storing raw credentials.
- BR-043-AC-003: Given Claude Code quota source returns quota windows or unofficial OAuth usage `utilization` fields, then AIQM has parser tests that normalise those values to `ProviderQuotaResult` without provider secrets.
- BR-043-AC-004: Given Claude Code polling runs in production, then it must not run prompts, agent sessions, reviews, or remote-control commands.
- BR-043-AC-005: Given Anthropic's unofficial OAuth usage endpoint fails or changes shape, then AIQM must fail safely to stale/unavailable provider state.

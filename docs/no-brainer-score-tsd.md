# Technical Spec: No-Brainer Account Ranking

## 1. Purpose

The system must rank available AI coding accounts so that, during a coding spike, the user can pick the next account with minimal thought.

The user should not need to compare reset times, remaining percentages, or account history. The ranked list should answer one question:

> Which account should I use next?

The primary output is a single numeric value:

```text
No-Brainer Score, abbreviated as NBS
```

Accounts are sorted by NBS, highest first.

The expected user behaviour is:

```text
Current account runs out.
User opens the account list.
User picks rank #1.
User continues coding.
```

## 2. Mental Model

The ranking model uses a food-expiry analogy.

### 2.1 Weekly reset: best-before date

The weekly reset is the account's best-before date.

Quota that remains unused when the weekly reset happens is wasted, regardless of whether the account is currently opened or unopened.

This means an unopened account with a weekly reset tomorrow may be more important than an opened account whose weekly reset is far away.

### 2.2 Five-hour reset: smell test after opening

The 5-hour reset is the short-term freshness window once an account is opened.

If an account has an active 5-hour reset window, it is already opened. Opened accounts should usually be used before opening fresh ones, because their short-term quota is already decaying.

However, opened status is not absolute. It should not blindly override weekly urgency.

### 2.3 The system should avoid cleverness at the point of use

The model may use several inputs internally, but the visible decision must remain simple.

The user should see:

```text
1. Account A    NBS 42.7
2. Account B    NBS 31.4
3. Account C    NBS 8.1
```

The details may be available on expansion, but they must not be required for ordinary use.

## 3. Outcome Goals

The ranking must optimise for the following outcomes, in priority order.

### 3.1 Minimise wasted quota

Prefer accounts where meaningful remaining quota is likely to reset unused soon.

### 3.2 Prefer already-opened accounts when urgency is similar

If two accounts are otherwise comparable, prefer the one with an active 5-hour reset window.

This avoids opening fresh accounts unnecessarily.

### 3.3 Allow unopened accounts to win when their weekly reset is urgent

An unopened account must not be treated as untouchable.

If its weekly reset is close and it still has substantial weekly quota left, it should be eligible to rank above opened accounts with low weekly urgency.

### 3.4 Avoid accounts that are too depleted to be useful

An account with very little 5-hour quota left should not be recommended as the main next account unless there are no better choices.

The useful-candidate cutoff is approximately:

```text
10% remaining
```

This is a soft operational cutoff, not a hard business rule. Below 10%, the account is usually not worth switching to during a coding spike.

### 3.5 Preserve glanceability

The list must be easy to act on while the user is cognitively busy.

The user should not have to understand the score to use it.

## 4. Required Inputs

Each account must provide, where available:

```text
Account name
Provider or account type
5-hour remaining percentage
5-hour reset time, if known
Weekly remaining percentage
Weekly reset time, if known
Whether the account is currently in use, if known
Last-used information, if known
Data freshness status, if known
```

Remaining values are percentages from 0 to 100.

Reset times are absolute future times.

If reset times are missing, the system must distinguish between:

```text
Missing because the bucket is full and inactive
Missing because the data source failed or is stale
Missing for an unknown reason
```

These cases should not be treated as equivalent.

## 5. Account States

The ranking system should classify each account into an operational state before scoring.

### 5.1 Opened

An account is opened when it has an active 5-hour reset window.

Opened accounts have short-term expiry pressure.

### 5.2 Unopened reserve

An account is probably unopened when:

```text
5-hour remaining is 100%
5-hour reset time is unknown
```

Unopened reserve accounts have no 5-hour pressure, but they may still have weekly pressure.

### 5.3 Weekly urgent

An account is weekly urgent when its weekly reset is close and it has meaningful weekly quota remaining.

This can apply to both opened and unopened accounts.

### 5.4 Low-usefulness

An account is low-usefulness when its 5-hour remaining percentage is below the useful-candidate cutoff.

Default cutoff:

```text
10%
```

Low-usefulness accounts are not automatically excluded, but they should be heavily penalised.

### 5.5 Exhausted

An account is exhausted when either quota bucket makes it unusable.

Examples:

```text
5-hour remaining is 0%
Weekly remaining is 0%
5-hour remaining is 100% but weekly remaining is 0%
```

The weekly allowance is the outer constraint. If weekly remaining is 0%, the account is not usable, even if the 5-hour bucket appears full.

Exhausted accounts should not be recommended.

## 6. Scoring Principles

The score should be based on three ideas:

```text
Best-before pressure
Opened-window pressure
Usefulness
```

The final score should increase when:

```text
More quota remains
The reset time is closer
The account is already opened
The account has enough remaining quota to be useful
```

The final score should decrease when:

```text
The account is nearly empty
The reset time is unknown because of poor data
The account is exhausted
The account is fresh reserve with no near weekly reset
```

## 7. Pressure Scores

### 7.1 Best-before pressure

Best-before pressure measures weekly expiry urgency.

Conceptually:

```text
best_before_pressure = weekly_remaining_percentage / hours_until_weekly_reset
```

This pressure applies whether the account is opened or unopened.

This is the rule that allows an unopened account with a weekly reset tomorrow to outrank an opened account whose weekly reset is far away.

### 7.2 Opened-window pressure

Opened-window pressure measures short-term 5-hour expiry urgency.

Conceptually:

```text
opened_window_pressure = five_hour_remaining_percentage / hours_until_5_hour_reset
```

This pressure applies only when the 5-hour reset window is known or confidently inferred.

If the 5-hour reset is unknown because the account is full and unopened, opened-window pressure is zero.

### 7.3 Unknown reset handling

Unknown reset times must not be silently treated as accurate data.

Recommended behaviour:

```text
Known reset time: use normal pressure
Unknown because full and inactive: pressure is zero for that bucket
Unknown because data is missing or stale: use degraded confidence
Unknown for unclear reason: use degraded confidence
```

A degraded-confidence score may still be produced, but the account should not outrank known-good candidates unless the pressure difference is large.

## 8. Combining Pressures

The score should combine weekly best-before pressure and opened-window pressure.

Recommended conceptual shape:

```text
urgency = dominant_pressure + secondary_pressure_contribution
```

Where:

```text
dominant_pressure = the larger of best-before pressure and opened-window pressure
secondary_pressure_contribution = a smaller contribution from the other pressure
```

This avoids overcounting while still recognising accounts that are pressured in both ways.

Recommended default:

```text
secondary pressure contributes about one third of its value
```

### 8.1 Opened preference

Opened accounts should receive a small preference when scores are otherwise close.

This should be a tie-breaker or modest multiplier, not a dominant rule.

Reason:

```text
Use opened stock first, unless another account has a materially worse best-before problem.
```

The opened preference must not prevent this case:

```text
Opened account:
  5-hour window active
  weekly reset next month
  mostly full

Unopened account:
  no 5-hour window
  weekly reset tomorrow
  mostly full

Expected result:
  unopened weekly-urgent account ranks higher
```

## 9. Usefulness Adjustment

An account must have enough 5-hour quota left to be worth switching to.

Default useful-candidate cutoff:

```text
10%
```

The usefulness adjustment should be soft rather than binary.

Conceptually:

```text
usefulness = five_hour_remaining_percentage / useful_candidate_cutoff
capped at 1
```

Examples:

```text
50% remaining -> full usefulness
10% remaining -> full usefulness
5% remaining  -> reduced usefulness
1% remaining  -> very low usefulness
0% remaining  -> unavailable
```

The important behavioural rule is:

```text
Below 10%, the account should usually fall below healthier alternatives.
```

## 10. Final No-Brainer Score

The final score should be calculated conceptually as:

```text
NBS = urgency × usefulness × data_confidence_adjustment
```

Optional small modifiers may apply for tie-breaking:

```text
Opened account preference
Current provider preference
Least recently used preference for fresh reserves
```

However, modifiers must not make the ranking hard to reason about.

The system should favour predictable behaviour over tiny theoretical improvements.

## 11. Ranking Behaviour

### 11.1 Normal case

Rank by NBS descending.

The top account is the recommended next account.

### 11.2 Similar scores

If two accounts have very similar scores, prefer:

```text
1. Account that is already opened
2. Account with higher 5-hour remaining percentage
3. Account with earlier email address (deterministic stable sort)
```

The opened preference is only a tie-breaker. It must not override a clearly higher best-before pressure.

Implementation note: weekly pressure is not used as a secondary tiebreaker because the NBS formula already incorporates weekly pressure. Exact NBS ties with materially different weekly pressure are not achievable through normal scoring. Least-recently-used (LRU) tracking is not currently implemented; email alphabetical order provides a deterministic stable fallback that prevents rank flip-flopping between poll cycles.

### 11.3 All scores are zero

If all accounts score zero, the list should still provide a recommendation.

Decision order:

```text
1. Exclude exhausted accounts
2. Prefer fresh reserve accounts
3. Prefer the account with the nearest known weekly reset
4. Prefer least recently used
5. Fall back to stable configured order
```

### 11.4 Data quality problems

If a top-ranked account has stale or degraded data, the UI should show a compact warning.

Example:

```text
NBS 28.4, data uncertain
```

The user should still be able to act quickly, but the system must not pretend low-confidence data is clean.

## 12. Behavioural Examples

### 12.1 Opened account beats fresh reserve

Input:

```text
Account A:
  Opened
  5-hour reset in 2 hours
  5-hour remaining 60%
  Weekly reset in 20 days
  Weekly remaining 100%

Account B:
  Unopened
  5-hour reset unknown
  5-hour remaining 100%
  Weekly reset in 20 days
  Weekly remaining 100%
```

Expected outcome:

```text
Account A ranks above Account B.
```

Reason:

```text
A has active opened-window pressure. B is fresh reserve with no urgent weekly issue.
```

### 12.2 Unopened weekly-urgent account beats opened long-dated account

Input:

```text
Account A:
  Opened
  5-hour reset in 4 hours
  5-hour remaining 100%
  Weekly reset in 30 days
  Weekly remaining 100%

Account B:
  Unopened
  5-hour reset unknown
  5-hour remaining 100%
  Weekly reset tomorrow
  Weekly remaining 100%
```

Expected outcome:

```text
Account B ranks above Account A.
```

Reason:

```text
B has urgent best-before pressure. A is opened, but its weekly expiry is not urgent.
```

### 12.3 Nearly empty account is penalised

Input:

```text
Account A:
  Opened
  5-hour reset in 30 minutes
  5-hour remaining 4%
  Weekly remaining healthy

Account B:
  Opened
  5-hour reset in 3 hours
  5-hour remaining 40%
  Weekly remaining healthy
```

Expected outcome:

```text
Account B should usually rank above Account A.
```

Reason:

```text
A is urgent but not useful enough to be the next coding account.
```

### 12.4 Below 10% is not automatically forbidden

Input:

```text
Account A:
  5-hour remaining 8%
  Weekly reset in 1 hour
  Weekly remaining 80%

Account B:
  5-hour remaining 100%
  Weekly reset in 20 days
  Weekly remaining 100%
```

Expected outcome:

```text
Account A may still rank above Account B.
```

Reason:

```text
A has serious best-before waste risk. The 10% cutoff is a usefulness penalty, not an absolute exclusion.
```

### 12.5 Exhausted accounts do not rank

Input:

```text
Account A:
  5-hour remaining 0%
  Weekly remaining 80%

Account B:
  5-hour remaining 40%
  Weekly remaining 80%
```

Expected outcome:

```text
Account B ranks above Account A.
```

Reason:

```text
A is not usable for the next spike segment.
```

### 12.6 Full 5-hour bucket with exhausted weekly bucket does not rank

Input:

```text
Account A:
  5-hour remaining 100%
  5-hour reset unknown or active
  Weekly remaining 0%

Account B:
  5-hour remaining 15%
  Weekly remaining 20%
```

Expected outcome:

```text
Account B ranks above Account A.
```

Reason:

```text
A looks fresh in the 5-hour window, but the weekly allowance is exhausted. The account is not usable until the weekly reset happens.
```

## 13. Configuration Guidance

The system should support configuration, but defaults should be good enough that the user does not need to tune them frequently.

Recommended configurable values:

```text
Useful-candidate cutoff: default 10%
Secondary pressure contribution: default about one third
Opened preference: small, tie-breaker-level
Minimum reset-time clamp: prevents extreme scores near reset
Data confidence penalty: reduces trust in stale or inferred data
```

Configuration should be hidden from the main flow.

This feature exists to reduce cognitive load, not create a new dashboard to manage.

## 14. Non-Goals

This system does not attempt to:

```text
Predict exact token burn
Optimise across a full multi-hour schedule
Choose the best model for code quality
Balance cost across providers
Explain every ranking decision by default
```

Those may be useful elsewhere, but they are not the purpose of the No-Brainer Score.

The purpose is fast account selection during an active coding spike.

## 15. Acceptance Criteria

The feature is successful if:

```text
The user can choose the next account in under five seconds
The top recommendation avoids obviously wasting soon-resetting quota
Fresh accounts are not opened unnecessarily
Unopened accounts can still win when their weekly reset is urgent
Accounts below roughly 10% remaining are penalised
Exhausted accounts are not recommended
A full 5-hour bucket with 0% weekly remaining is treated as exhausted
Stale or uncertain data is visibly marked
The ranking remains stable enough to avoid confusing flips
```

## 16. Final Behaviour Summary

The ranking should behave like this:

```text
Use opened accounts first when they are meaningfully expiring.
Use unopened accounts when their weekly best-before date is more urgent.
Avoid nearly empty accounts unless the waste risk is large.
Hide the maths.
Show the score.
Sort descending.
Pick #1.
```

That is the whole product promise of the No-Brainer Score.


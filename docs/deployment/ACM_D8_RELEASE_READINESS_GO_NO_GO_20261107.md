# ACM — Release Readiness & GO/NO-GO Dossier
**Prepared:** 2026-11-07 · **Disposition:** `RELEASE_NO_GO` · **Mode:** review-only, no production writes

> This is a **preparation and evidence index**, not a signoff, deployment authorization, or permission to write to any database. Never substitute CI success or a chat-level general approval for the independent, traceable approvals required by Issues #11–#15.

## 1. Baseline and scope

| Component | Last established evidence | Proven result | NOT proven |
|---|---|---|---|
| GitHub PR #39 (`codex/p3-staging-readonly-deployment-20261107`) | Head `98b65cdb0f297ffa2c46a6008f4e983580707274` | Staging fail-closed auth, security HTTP matrix, CI #169 passed | Release/real-data approval |
| GitHub PR #40 (`codex/p3g-zod4-compat-probe-20261107`) | Head `2e7de43b5ee4439f0346a95b5dc8667639376bb9` | Zod4 migration CI #250, isolated mock browser #13 passed | Live backend/data-backed business writer |
| GitHub PR #41 (`codex/p3h-toolchain-security-probe-20261107`) | Head before this dossier `6e47ba866f4b35f0044c693934808d9ced16fa85` | CI #280 and isolated Chromium #21 PASS; 36 executed tests, 1 deferred | Independent review / manual UAT / production rollout |
| Render Free `acm-api-staging-29fw` | Existing service on `codex/cloud-staging-p2e-readonly-deploy-20261107` | Service previously Live, health/readiness and guard verified | It does not include PR #40/#41 upgrades or released return writer |
| Supabase Cloud `acm-qllk-staging` (`dqctxaoaxhtqtgmtsysk`) | Earlier readiness/DB connection verified, staging-only | Read-only Cloud Staging API checks | Authorized schema migration, restore rehearsal or business writes |

PR **merge order only after all approvals**: #41 -> #40 -> #39 -> `main`, with conflict checks and regression runs between merges. This describes dependency order, **not permission to merge any of them**. Alternatively, a reviewer may choose one consolidated reviewed release branch; do not double-apply overlapping commits.

## 2. Hard, ordered authorization gates

| Gate | Issue | Verifiable evidence required | Status |
|---|---|---|---|
| A. Receipt policy + Stage4C DDL | [#11](https://github.com/acmhtql-sys/ACM_QLLK/issues/11) | Business owner accepts/rejects actual receipt format; independent DBA approves reviewed forward/rollback DDL; identities, roles, UTC timestamps, signed references; pinned schema SHA `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac` | **HOLD** |
| B. Isolated PG17 creation | [#12](https://github.com/acmhtql-sys/ACM_QLLK/issues/12) | **Two different humans** (owner + independent technical reviewer) explicitly approve exact PG1C scope; actual review packet SHA verified; near-time baseline / identity preflight | **HOLD** |
| C. DB migration, rollback, concurrent writes | [#13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13) | PG1D verified new instance; separately authorized execution; successful negative FK/constraint controls, 2-session concurrency, atomic receipt/stock/audit and tested isolated backup/restore | **HOLD** |
| D. Real return writer | [#14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14) | Real Stage4C source artifact/hash, actual Prisma Client and DB adapter, source evidence authority, D7 lock-first integration, guarded feature-gate, HTTP/RBAC/idempotency with real synthetic DB | **HOLD** |
| E. Full system release | [#15](https://github.com/acmhtql-sys/ACM_QLLK/issues/15) | All above accepted; self-UAT [#8](https://github.com/acmhtql-sys/ACM_QLLK/issues/8), RBAC owner signoff [#9](https://github.com/acmhtql-sys/ACM_QLLK/issues/9), pilot [#10](https://github.com/acmhtql-sys/ACM_QLLK/issues/10), tested restore, 8 D6 release blockers and independent release signature | **HOLD** |

**The current owner's general request to work faster does not itself satisfy #11/#12/#13 execution authorization.** Never fill in fake signatory names or dates. Do not create PG1C or run any DDL/migration/seed/rollback against Supabase Staging or an unapproved target.

## 3. Narrowest safe execution sequence

**Before signatures (safe now)**
1. Freeze exact source commit hashes, compare PR #39/#40/#41 and prior PR #2/#3/#5/#6/#7 to prevent duplicate integrations.
2. Give business owner the receipt regex decision on #11: proposed `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`; require real anonymized examples and case-sensitivity decision.
3. Give DBA independent DDL/locking/rollback review packet, request actionable review rather than “approved” wording without evidence.
4. Prepare PG1C independent-review packet from owner-provided checksum-verified artifact; **no Create execution**.
5. Review frontend/API authorization, PR diffs, npm audit remaining Router Moderate findings; keep default-deny Cloud Staging.

**Only after gates A and B are formally verified**
6. Authorized operator creates **new** PG17 instance at `%LOCALAPPDATA%\ACM_D8_PG17_55433_NEW_ONLY`, bound to `127.0.0.1:55433`, with separate SCRAM credentials and without touching existing Windows PostgreSQL service. Run PG1D read-only identity proof.
7. **Only after separate SQL execution authorization** run reviewed Stage4C forward/negative/rollback/concurrency experiments on the identified isolated synthetic database; record before/after identity, hashes and protected logs.
8. Review, implement and test real return writer (#14) on a distinct development branch. Leave guarded/503 behavior intact until full proof and authorization.
9. Conduct real frontend↔backend UAT with four roles; run 10 units received → borrow 4 → return 2 GOOD, 1 DAMAGED, 1 LOST; expected `OnHand=9, Borrowed=0, Quarantined=1, Available=8` per #8. Validate retries, conflicts, wrong-location 409, RBAC, audit and mobile.
10. Rehearse backup/restore **onto a separate empty isolated DB**; record approved RPO/RTO, monitoring/on-call, rollback plan and deployment-owner approval.
11. Only after all evidence and real human GO signoffs, plan a reviewed production deploy/cutover. Confirm actual payment impact before provisioning or changing billing.

## 4. Free-tier operational viability — additional explicit decision required

- **Render Free web**: [Render official docs](https://render.com/docs/free) say Free instances are for testing/hobby projects and explicitly warn **not to use them for production**. They may spin down after 15 minutes idle and take about a minute to restart. Usage limits may suspend services or disable builds. Its filesystem is ephemeral, and there is no persistent disk on Free.
- **Supabase Free**: [official pricing](https://supabase.com/pricing) lists **no automatic backups and no point-in-time recovery** on Free. [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups) recommends regular off-site database exports for Free projects. **No tested export/restore or off-site retention is presently evidenced for ACM.**
- The operator's prior instruction is **FREE ONLY / no paid upgrade**. That instruction is respected; it is *not* a claim that Free resources meet the uptime, backup, data protection or continuity requirements for real users.
- Before any live data: business owner must set an approved availability target, RPO/RTO, backup frequency, independent restore-test evidence, external storage/custody and operating owner. If those targets cannot be met on the Free-only design, the owner must **reconsider the hosting architecture or explicitly authorize a budget alternative**. Never upgrade or bill automatically.
- A read-only demo or isolated pilot with synthetic data may be acceptable under the existing protections, but **must not be described as production acceptance**.

## 5. Acceptance log template — leave blank until witnessed

| Item | Result PASS/FAIL/BLOCKED | Evidence URI + SHA | Witness name / role | Time (UTC) | Independent approval |
|---|---|---|---|---|---|
| Business receipt policy #11 | BLOCKED | — | — | — | — |
| DBA Stage4C review #11 | BLOCKED | — | — | — | — |
| Owner PG1C authorization #12 | BLOCKED | — | — | — | — |
| Independent PG1C review #12 | BLOCKED | — | — | — | — |
| PG1D DB identity / Stage4C #13 | BLOCKED | — | — | — | — |
| Real return writer #14 | BLOCKED | — | — | — | — |
| Self UAT #8, RBAC #9, pilot #10 | BLOCKED | — | — | — | — |
| Restore and RPO/RTO #15 | BLOCKED | — | — | — | — |
| Final owner release signoff #15 | BLOCKED | — | — | — | — |

**Stop condition:** any missing or invalid signature, any P0/P1 bug, stock/receipt/audit imbalance, unknown DB identity, unsupported migration rollback, or paid-plan exposure means `NO_GO`. Keep `STAGING_READ_ONLY=true`, `ALLOW_STAGING_AUTH_LOGIN=false`, Render Free and auto-deploy off.

## 6. Honest evidence classification

- **Verified:** CI, mock browser, passive Staging HTTP negative tests, previously observed Render health.
- **Not verified:** real business writer with audited PostgreSQL transactions, Stage4C migration/rollback proof, restore test, owners' signatures, real-data conversion, end-user pilot.
- **Never do:** label a simulated transaction as real DB verification, issue another person's approval, paste credentials into GitHub, relax public inventory permissions or merge/enable writes solely to achieve an earlier date.

**Decision at preparation time:** `P3-H_TECHNICAL_PASS__D8_RELEASE_NO_GO`.

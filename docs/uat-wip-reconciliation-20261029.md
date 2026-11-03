# ACM Stage4C UAT WIP reconciliation — metadata evidence (2026-10-29)

**Status: SOURCE METADATA VERIFIED / SOURCE CONTENT NOT REVIEWED / RELEASE NO-GO.**  
Related: [Supabase staging #21](https://github.com/acmhtql-sys/ACM_QLLK/issues/21), [writer gate #14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14), [draft PR #22](https://github.com/acmhtql-sys/ACM_QLLK/pull/22).

## Verified artifact

Operator uploaded `ACM_UAT_Reconcile_Metadata_V2_20261029_203456.json`; file bytes independently read and SHA-256 checked against the operator-provided checksum:

```text
SHA256 1d5ee2865492fbce2fcfeb3126273f91c211b00c55c284f23711138c842d2fdf
Format ACM_UAT_RECONCILE_METADATA_V2
Repository ACM_QLLK_UAT
Branch fix/phase11d-partial-return-ui
HEAD 0847a73088b98d8b00fb6ac06f02b2f56d288b78
Modified 4 / staged 0 / deleted 0 / untracked 5 / allowed distinct paths 9
Excluded observations 0
```

## WIP inventory

| Path | Local state | Local SHA-256 | Bytes | Exists in GitHub at UAT HEAD? |
|---|---|---|---:|---|
| `apps/api/prisma/schema.prisma` | modified | `ab5bbdc7f6f1de397740fadb4d5522a59bbb9a819e23dfd658218cc144032fac` | 19864 | Yes, tracked version (not local WIP) |
| `apps/api/src/modules/borrow/borrow.router.ts` | modified | `f68cb24f3207eba9a66b8397e953ede55b9608102c104ec648fe46e11ef757cd` | 8352 | Yes, tracked version |
| `apps/api/src/modules/borrow/borrow.service.ts` | modified | `5a63ba2bc7ca5019569fb54fb9a4b10d68d871f1fb092a5c67d548d3649676d5` | 41615 | Yes, tracked version |
| `apps/api/tests/uat.phase11.ledger.integration.test.ts` | modified | `54908d02090988e53d92de2bbf0bd6ccc865a645b64c71238fd135401a034095` | 21568 | Yes, tracked version |
| `apps/api/prisma/Stage4C2A_MIGRATION_REVIEW_ONLY.sql.txt` | untracked | `53337db7d3c5e9447f581d2b3b2e6aea4f9df633b347d451ad63dc64657bcb4b` | 2965 | No, not at UAT HEAD |
| `apps/api/prisma/Stage4C2B_CONSTRAINTS_REVIEW_ONLY.sql.txt` | untracked | `836f4b4397f0e71b7e0a7da67862c772cd48ee4ec8a6771acf69efeb18c272c6` | 2560 | No, not at UAT HEAD |
| `apps/api/src/modules/borrow/borrow.return-operation-foundation.ts` | untracked | `7aec28d2666391c722d565855c46475268ee10b99d716f89bf468cb14c9e6f0f` | 7233 | No, not at UAT HEAD |
| `apps/api/tests/borrow.return-operations.stage4c2a.unit.test.ts` | untracked | `588d49e0063f13e103699d19fdd33a7a02ab0752fa2e7af860f8acea4034728f` | 6755 | No, not at UAT HEAD |
| `apps/api/tests/borrow.return-operations.stage4c2b.schema-contract.unit.test.ts` | untracked | `e7b4a993a815d6e5e3439b61361c1ebc11d064a7f2daa37c2664490729befc36` | 3119 | No, not at UAT HEAD |

The verified local `schema.prisma` SHA-256 equals the Stage4C expected hash in [issue #13](https://github.com/acmhtql-sys/ACM_QLLK/issues/13). This is **hash identity only**, not DDL approval.

## Implications and next gate

1. Nine local WIP paths are **identified**, resolving the previous 4-vs-9 *count* discrepancy; equivalence to every issue #14 WIP claim remains subject to source review.
2. The remote UAT HEAD includes tracked **older** versions of four files, not the locally modified bytes. Five untracked files are missing at that commit. A Git fetch/checkout **does not preserve** these local files on the remote.
3. **Operator action:** retain immutable local backup, verify every source file SHA, screen for secrets and real user/receipt data, then provide an explicitly reviewed source bundle limited to the nine files, with no `.env`, credentials, database dumps, logs or private records.
4. **Reviewer action:** compare actual source against pinned UAT HEAD and recent D7 / Stage4C / Prisma requirements, resolve SQL REVIEW_ONLY / DDL policy. Do not assume a unit-test file proves successful testing.
5. Code and database test execution requires isolated approved environment and separate review/authorization per #11–#15; Supabase project presence is not migration approval.

**Hard stops:** no automatic copying to GitHub, no merge, no migration, no executing review-only SQL, no real-data transfer, no production deployment.

> Scope: metadata-only file evidence and read-only GitHub inspection. No UAT source content was provided or examined in this report.

# ACM – Pre-merge functional and security review (2026-10-17)

## Basis and scope
Reviewed PR #2 (`codex/phase-01-auth-security-clean`), PR #3 (`codex/integration-phase-1-4`), the Phase 05–10 lineage, and Draft PR #6 (`codex/integration-phase01-10-security-review`). This is a *source-level* review, not production/staging acceptance.

## Verified identical blobs (PR #3 branch vs PR #6 branch)
- `apps/api/src/modules/borrow/borrow.router.ts` – SHA `09386c27d93a00476f17b023a5dee8cb0c868751`
- `apps/api/src/modules/borrow/borrow.service.ts` – SHA `40665a3a0f713adfeaa797ee7884ed8ab7964e16`
- `apps/api/src/modules/items/items.service.ts` – SHA `eb2d64a71c7c47f99fc70a48f9362be8d1f11345`
- `apps/api/src/modules/inventory/inventory.service.ts` – SHA `dfa3dbce36e2d65ab02978459ddd0575c1fe63c3`
- `apps/api/prisma/schema.prisma` – SHA `ec969e68f00e17fe2b037dc4c5b58fcff6744983`

These exact-file matches indicate that the cited core PR #3 borrow, inventory and schema implementations are present. They **do not** establish complete parity across all files or behavior.

## Intentional divergence and decisions
| Area | PR #2 / #3 | Phase 10 baseline | PR #6 decision |
| --- | --- | --- | --- |
| JWT identity | Require UUID format | Only requires a truthy `id` | Adopt strict UUID format |
| Optional auth + DB outage | HTTP 500 / fail closed | Continue unauthenticated | Fail closed |
| Rate limit client IP | Use resolved `req.ip`, bounded map | Trust direct `X-Forwarded-For` | Use resolved IP, trust only configured staging proxy |
| Concurrent failed logins | Atomic increment and lock | Read-modify-write | Adopt atomic protection |
| Demo seed | Local-only plus explicit opt-in | Remote override possible | Local-only and opt-in |
| User management | Router-based basic CRUD | Service-based features, audit logs | Retain service; restrict admin reset |
| Audit logs | ADMIN read | ADMIN and LAB_MANAGER read | ADMIN only pending permission review |
| Reports | ADMIN summary | Authenticated roles for detailed reports | ADMIN only pending permission review |
| Self-service password change | Not in PR #2 route | Separate change-password endpoint | Preserve separate self-service workflow |
| Kits / dashboard / richer Web | Earlier implementation | Additional features | Retain Phase 05–10 features |

## Newly added regression tests (PR #6)
- Unit: signed JWT with invalid UUID rejected before DB query; optional-auth DB failure produces HTTP 500; spoofed `X-Forwarded-For` cannot bypass IP rate limit.
- Integration: role matrix for audit logs, report endpoints, and admin password reset; password hash must not change on a forbidden reset.
- These tests complement, but do not substitute, real concurrent-login stress testing.

## Outstanding acceptance gates
- [ ] CI on the **latest** PR #6 commit succeeds with all new tests.
- [ ] Verify LOGIN lockout under concurrent requests and role-transition races against isolated test DB.
- [ ] Confirm ADMIN-only policy for all report types and Audit Log with product owner; a different permission matrix will require intentional change and updated tests.
- [ ] Review remaining application modules/files beyond the five exact source matches and validate Web/API contracts.
- [ ] Execute staging scenarios with realistic roles/data, stock reservation and partial returns; reconcile ledgers.
- [ ] Review final integration into `main` (diverged histories), without force pushing or losing commits.
- [ ] Approve release/deployment separately. No cloud seed or migration until approved.

## Safety
Leave PR #2, PR #3, PR #5 and PR #6 in Draft. Do not merge to `main`, rewrite branch history, run cloud database migrations or deploy production.

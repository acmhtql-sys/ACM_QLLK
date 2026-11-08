# ACM L1 — mobile responsive Web candidate (NOT native Mobile App acceptance)

**Scope:** isolated Draft PR from RC5+Zod4 integration. **Release: NO-GO**.

The ACM source brief explicitly requires **Mobile App + Backend API** for students and lab administrators. This patch only improves accessibility of the EXISTING responsive React Web dashboard. It does **not** create Android/iOS binaries, offline loans, local cached sessions, app-store distributions, service workers, push notifications or camera/QR support.

## Implemented

- Explicit accessible hamburger and drawer-close labels; `aria-expanded`, `aria-controls`.
- A single navigation drawer target ID, Escape dismissal and corrected offscreen transform.
- The **existing** `canAccessPage` policy continues to filter student navigation; no API permissions changed.
- Zero-network React server render unit regression checks: menu state and STUDENT-denied tabs.

## Required safe manual/mobile E2E (not yet performed)

Use a localhost mock browser fixture or a separately authorized LOCAL synthetic backend; never use live Cloud Staging credentials.

1. At **390×844**, without a token, attempt `/dashboard`; it must redirect to `/login`; no offline admin session.
2. With a synthetic STUDENT, open drawer; verify Items and Borrow/Return exist, Transactions/Users/Audit links do not; tap a permitted link, verify drawer closes. Confirm Escape closes the drawer.
3. At **375×667** and **768×1024**, examine login, items, kit, borrow/partial-return status, navigation touch targets, text overflow and keyboard access; record screenshots with **synthetic data only**.
4. Test 504/409 pending-return reconciliation on a mock server using GET-only status; no duplicate POST, no stock writes in cloud.
5. Run actual Android/iOS device/emulator acceptance after the owner chooses the mobile-delivery platform(s) in [Issue #49](https://github.com/acmhtql-sys/ACM_QLLK/issues/49).

## Known blockers

- Responsive Web is not an approved substitute for the requested native Mobile App.
- No native Android/iOS deliverable exists on this branch; no mobile on-device E2E run is asserted.
- Return Writer Stage4C is gated by [#11–#14](https://github.com/acmhtql-sys/ACM_QLLK/issues/14); offline browser mocks never certify physical custody.
- Do not merge/deploy, loosen RBAC, enable cloud login/writes, create paid app-store resources or claim L1 COMPLETE.

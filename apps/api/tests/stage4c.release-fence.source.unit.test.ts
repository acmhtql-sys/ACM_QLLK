import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertLegacyReturnWriteAllowed,
  rejectUnreleasedReturnOperations,
} from '../src/modules/borrow/borrow.return-operation-foundation';

/**
 * Static guard for the explicitly UNRELEASED Stage4C candidate.
 * It must be intentionally reviewed/updated only AFTER signed DBA/SQL
 * authorization and actual writer + independent UAT acceptance.
 * No database connection, external network or HTTP server is used here.
 */
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Stage4C / RC5 release fence — source-only, zero database/network', () => {
  it('DBA-01: keeps the 19-model RC5 Prisma schema until a signed consolidated migration', () => {
    const prisma = source('../prisma/schema.prisma');
    const models = [...prisma.matchAll(/^model\s+\w+\s*\{/gm)];
    expect(models).toHaveLength(19);
    expect(prisma).not.toMatch(/^model BorrowReturnOperation\s*\{/m);
  });

  it('DBA-02: does not expose a live unapproved return-operations route', () => {
    const router = source('../src/modules/borrow/borrow.router.ts');
    expect(router).not.toContain("'/return-operations'");
    expect(router).not.toContain("'/:id/return-operations'");
    expect(router).not.toContain('rejectUnreleasedReturnOperations');
    expect(router).not.toContain('borrow.return-commit-preflight.policy');
    expect(router).not.toContain('borrow.return-operation-foundation');
    expect(router).not.toContain('borrow.return-stock-conservation.review');
    expect(router).not.toContain('borrow.return-qc-claim.review');
  });

  it('DBA-03: keeps pure Stage4C business guards UNWIRED from legacy return service', () => {
    const service = source('../src/modules/borrow/borrow.service.ts');
    expect(service).not.toContain('borrow.return-commit-preflight.policy');
    expect(service).not.toContain('borrow.return-operation-foundation');
    expect(service).not.toContain('borrow.return-workflow-access.policy');
    expect(service).not.toContain('borrow.return-stock-conservation.review');
    expect(service).not.toContain('borrow.return-qc-claim.review');
  });

  it('DBA-04: preserves RC5 Idempotency-Key and read-only lost-session status endpoint', () => {
    const router = source('../src/modules/borrow/borrow.router.ts');
    expect(router).toContain('requireIdempotencyKey');
    expect(router).toContain("'/:id/return-status/:key'");
    expect(router).toContain('getBorrowReturnStatus(');
    expect(router).toContain('returnBorrowRequest(');
  });

  it('DBA-05: preserves lock-first source-only safe return behavior', () => {
    const service = source('../src/modules/borrow/borrow.service.ts');
    expect(service).toContain('runBorrowTransaction(');
    expect(service).toContain('FOR UPDATE');
    expect(service).toContain('sourceLocations.length !== 1');
    expect(service).toContain('returnItem.locationId !== sourceLocationId');
  });

  it('L4-07: HTTP image review router is NOT mounted into the real application', () => {
    const app = source('../src/app.ts');
    const itemRouter = source('../src/modules/items/items.router.ts');
    expect(app).not.toContain('image-storage.http-review');
    expect(app).not.toContain('local-review-images');
    expect(app).not.toContain('image-storage.orphan-reconcile.review');
    expect(app).not.toContain('image-storage.audit-journal.testonly');
    expect(app).not.toContain('image-storage.atomic-bundle.testonly');
    expect(itemRouter).not.toContain('image-storage.http-review');
    expect(itemRouter).not.toContain('createLocalItemImageReviewRouter');
    expect(itemRouter).not.toContain('image-storage.orphan-reconcile.review');
    expect(itemRouter).not.toContain('image-storage.audit-journal.testonly');
    expect(itemRouter).not.toContain('image-storage.atomic-bundle.testonly');
  });

  it('L4-08: unmounted image review route embeds mandatory real authentication before RBAC and parsing', () => {
    const router = source('../src/modules/storage/image-storage.http-review.ts');
    expect(router).toContain("import { authenticate } from '../../middleware/auth'");
    const gate = router.indexOf('router.use(requireLocalReviewMode)');
    const auth = router.indexOf('router.use(authenticate)');
    const role = router.indexOf('router.use(authorizeRoles');
    const parser = router.indexOf('express.raw(');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(auth).toBeGreaterThan(gate);
    expect(role).toBeGreaterThan(auth);
    expect(parser).toBeGreaterThan(role);
  });

  it('L4-09: unmounted image router requires audit sink and acknowledges only after audit', () => {
    const src = source('../src/modules/storage/image-storage.http-review.ts');
    expect(src).toContain('LOCAL_IMAGE_AUDIT_SINK_REQUIRED');
    const uploadAudit = src.indexOf("await auditImage('IMAGE_UPLOAD'");
    const writeSuccess = src.indexOf('res.status(201).json');
    expect(uploadAudit).toBeGreaterThanOrEqual(0);
    expect(writeSuccess).toBeGreaterThan(uploadAudit);
    const readAudit = src.indexOf("'IMAGE_READ', req.user!.id");
    const readSuccess = src.indexOf('res.status(200).end');
    expect(readAudit).toBeGreaterThanOrEqual(0);
    expect(readSuccess).toBeGreaterThan(readAudit);
  });

  it('DBA-06: inert Stage4C helper cannot turn into an operational writer via flag alone', () => {
    expect(() => assertLegacyReturnWriteAllowed('false')).not.toThrow();
    expect(() => assertLegacyReturnWriteAllowed('true')).toThrow();
    expect(() => rejectUnreleasedReturnOperations()).toThrow();
  });
});

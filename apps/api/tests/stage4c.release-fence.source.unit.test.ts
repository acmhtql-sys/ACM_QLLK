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
  });

  it('DBA-03: keeps pure Stage4C business guards UNWIRED from legacy return service', () => {
    const service = source('../src/modules/borrow/borrow.service.ts');
    expect(service).not.toContain('borrow.return-commit-preflight.policy');
    expect(service).not.toContain('borrow.return-operation-foundation');
    expect(service).not.toContain('borrow.return-workflow-access.policy');
    expect(service).not.toContain('borrow.return-stock-conservation.review');
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

  it('DBA-06: inert Stage4C helper cannot turn into an operational writer via flag alone', () => {
    expect(() => assertLegacyReturnWriteAllowed('false')).not.toThrow();
    expect(() => assertLegacyReturnWriteAllowed('true')).toThrow();
    expect(() => rejectUnreleasedReturnOperations()).toThrow();
  });
});

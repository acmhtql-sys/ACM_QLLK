/** Portable Stage 4C-2B Prisma schema contracts ONLY (no external SQL or DB).
 * SQL review is a separate, opt-in test using an externally supplied SHA-pinned asset.
 * Neither test constitutes DBA approval or real PostgreSQL constraint verification.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const schema = src('prisma/schema.prisma');
const model = schema.split('model BorrowReturnOperation {')[1]?.split('\n}')[0] ?? '';
const receipt = schema.split('model ReturnTransaction {')[1]?.split('\n}')[0] ?? '';

describe('Stage 4C-2B portable Prisma schema invariants', () => {
  it('MIG-C01: operation evidence is required from prepare', () => {
    expect(model).toMatch(/physicalEvidenceRef\s+String\s+@map\("physical_evidence_ref"\)/);
    expect(model).not.toMatch(/physicalEvidenceRef\s+String\?/);
  });
  it('MIG-C02: receipt is related by receipt AND borrow identifiers', () => {
    expect(model).toContain('fields: [returnTransactionId, borrowRequestId]');
    expect(model).toContain('references: [id, borrowRequestId]');
    expect(receipt).toContain('@@unique([id, borrowRequestId]');
  });
  it('MIG-C03: receipt operation id remains unique for replay', () => {
    expect(model).toMatch(/returnTransactionId\s+String\?\s+@unique/);
  });
  it('MIG-C04: evidence is unique within a borrow', () => {
    expect(model).toContain('@@unique([borrowRequestId, physicalEvidenceRef])');
  });
  it('MIG-C09: composite 1:1 relation has a unique defining-side field set (Prisma P1012)', () => {
    expect(model).toContain('@@unique([returnTransactionId, borrowRequestId], map: "borrow_return_operations_return_transaction_borrow_key")');
    expect(model).toMatch(/returnTransactionId\s+String\?\s+@unique/);
  });
});

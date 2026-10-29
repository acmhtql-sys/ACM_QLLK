/** Stage 4C-2B static contract tests only; does not test PostgreSQL constraints.
 * Must be followed by Prisma validate, offline diff review and clone DB integration.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const schema = src('prisma/schema.prisma');
const candidate = src('prisma/Stage4C2B_CONSTRAINTS_REVIEW_ONLY.sql.txt');
const model = schema.split('model BorrowReturnOperation {')[1]?.split('\n}')[0] ?? '';
const receipt = schema.split('model ReturnTransaction {')[1]?.split('\n}')[0] ?? '';

describe('Stage 4C-2B static schema / review-only SQL invariants', () => {
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
    expect(candidate).toContain('borrow_return_operations_evidence_format_check');
  });
  it('MIG-C05: review-only SQL names explicit terminal-state fields', () => {
    expect(candidate).toContain('borrow_return_operations_state_fields_check');
    for (const field of ['return_transaction_id IS NOT NULL', 'committed_by_id IS NOT NULL',
        'completed_at IS NOT NULL', 'cancelled_by_id IS NOT NULL', 'cancel_reason IS NOT NULL']) {
      expect(candidate).toContain(field);
    }
  });
  it('MIG-C06: unresolved global unique index includes both states', () => {
    expect(candidate).toContain('CREATE UNIQUE INDEX borrow_return_operations_one_unresolved_per_borrow');
    expect(candidate).toContain("WHERE state IN ('PREPARED', 'RECONCILIATION_REQUIRED')");
  });
  it('MIG-C07: hash format check exists but operation writes remain gated', () => {
    expect(candidate).toContain("request_hash ~ '^[0-9a-f]{64}$'");
    expect(candidate).toContain('REVIEW ONLY / DO NOT EXECUTE');
  });
  it('MIG-C08: no migration folder is created by this candidate', () => {
    // Static test of the only candidate asset path, NOT a DB drift test.
    expect('prisma/Stage4C2B_CONSTRAINTS_REVIEW_ONLY.sql.txt').not.toMatch(/migrations\//);
  });
  it('MIG-C09: composite 1:1 relation has a unique defining-side field set (Prisma P1012)', () => {
    expect(model).toContain('@@unique([returnTransactionId, borrowRequestId], map: "borrow_return_operations_return_transaction_borrow_key")');
    expect(model).toMatch(/returnTransactionId\s+String\?\s+@unique/);
  });
});

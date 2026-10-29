/**
 * Stage 4C-2B DBA SQL artifact review only. NEVER executes SQL or connects to DB.
 * Requires explicit external file and its SHA256, separately verified by reviewers.
 * This file must NOT be included in default test:unit or integration suites.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const evidencePath = process.env.ACM_STAGE4C_SQL_REVIEW_FILE;
const evidenceSha = process.env.ACM_STAGE4C_SQL_REVIEW_SHA256;
if (!evidencePath || !evidenceSha || !/^[a-f0-9]{64}$/i.test(evidenceSha)) {
  throw new Error('SQL_REVIEW_EVIDENCE_REQUIRED: supply exact file and SHA256; nothing is executed');
}
const bytes = readFileSync(resolve(evidencePath));
const actualSha = createHash('sha256').update(bytes).digest('hex');
if (actualSha !== evidenceSha.toLowerCase()) {
  throw new Error('SQL_REVIEW_EVIDENCE_SHA256_MISMATCH: stop and review');
}
const candidate = bytes.toString('utf8');

describe('Stage 4C-2B external SQL contract — text only, not approved', () => {
  it('MIG-C04-SQL: evidence-format check is present', () => {
    expect(candidate).toContain('borrow_return_operations_evidence_format_check');
  });
  it('MIG-C05: terminal-state fields are constrained', () => {
    expect(candidate).toContain('borrow_return_operations_state_fields_check');
    for (const field of ['return_transaction_id IS NOT NULL', 'committed_by_id IS NOT NULL',
        'completed_at IS NOT NULL', 'cancelled_by_id IS NOT NULL', 'cancel_reason IS NOT NULL']) {
      expect(candidate).toContain(field);
    }
  });
  it('MIG-C06: unresolved unique index covers both states', () => {
    expect(candidate).toContain('CREATE UNIQUE INDEX borrow_return_operations_one_unresolved_per_borrow');
    expect(candidate).toContain("WHERE state IN ('PREPARED', 'RECONCILIATION_REQUIRED')");
  });
  it('MIG-C07: request hash format and no-execute warning are present', () => {
    expect(candidate).toContain("request_hash ~ '^[0-9a-f]{64}$'");
    expect(candidate).toContain('REVIEW ONLY / DO NOT EXECUTE');
  });
});

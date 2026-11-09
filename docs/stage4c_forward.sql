CREATE TABLE IF NOT EXISTS borrow_return_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_request_id UUID NOT NULL REFERENCES borrow_requests(id),
  return_transaction_id UUID,
  state VARCHAR(32) NOT NULL DEFAULT 'PREPARED',
  physical_evidence_ref VARCHAR(128) NOT NULL,
  received_by_id UUID NOT NULL REFERENCES users(id),
  verified_by_id UUID REFERENCES users(id),
  received_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE borrow_return_operations
ADD CONSTRAINT chk_physical_evidence_ref_format
CHECK (physical_evidence_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_borrow_return_op_evidence_lower
ON borrow_return_operations (lower(physical_evidence_ref));

ALTER TABLE borrow_return_operations
ADD CONSTRAINT chk_verified_at_after_received_at
CHECK (verified_at IS NULL OR verified_at >= received_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_borrow_return_op_single_pending
ON borrow_return_operations (borrow_request_id)
WHERE state IN ('PREPARED', 'RECONCILIATION_REQUIRED');

DO $\$
DECLARE
  v_completed_count INT := 0;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'borrow_return_operations') THEN
    SELECT COUNT(*) INTO v_completed_count
    FROM borrow_return_operations
    WHERE state = 'COMPLETED';

    IF v_completed_count > 0 THEN
      RAISE EXCEPTION 'ROLLBACK ABORTED: Ðã t?n t?i % giao d?ch COMPLETED, c?m rollback!', v_completed_count;
    END IF;

    DROP INDEX IF EXISTS idx_borrow_return_op_single_pending;
    DROP INDEX IF EXISTS idx_borrow_return_op_evidence_lower;
    DROP TABLE IF EXISTS borrow_return_operations;
    RAISE NOTICE 'GUARDED ROLLBACK SUCCESS: Ðã hoàn nguyên an toàn DDL Stage4C.';
  END IF;
END $\$;

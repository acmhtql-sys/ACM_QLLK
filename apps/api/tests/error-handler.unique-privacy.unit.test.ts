import { describe, expect, it, vi, beforeEach } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler';
import { logger } from '../src/config/logger';

vi.mock('../src/config/logger', () => ({
  logger: { error: vi.fn() },
}));

const response = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
});

/**
 * AppSec G03: even if a future global-evidence unique constraint is triggered,
 * a Prisma exception must never expose metadata, raw evidence values or
 * constraint names in the HTTP response or the server's error log.
 * Zero DB, zero sockets, no migration or Stage4C feature activation.
 */
describe('AppSec G03 — Prisma uniqueness privacy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { target: ['global_physical_evidence_key'], marker: 'ACM-SECRET-001' },
    { target: 'return_operations_global_ref_key', marker: 'ACM-SECRET-002' },
    { target: { fields: ['physicalEvidenceRef'] }, marker: 'ACM-SECRET-003' },
  ])('responds with the same generic 409 without constraint fields', ({ target, marker }) => {
    const res = response();
    const err = Object.assign(
      new Error('Unique constraint failed: ' + marker + ' global_physical_evidence_key'),
      { code: 'P2002', meta: { target, value: marker } }
    );
    errorHandler(err, {} as any, res as any, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Dữ liệu đã tồn tại trong hệ thống (vi phạm ràng buộc duy nhất)',
    });
    const serialized = JSON.stringify(res.json.mock.calls);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain('fields');
    expect(serialized).not.toContain('target');
    expect(serialized).not.toContain('global_physical_evidence_key');
    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled error: Prisma unique constraint violation (P2002)'
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(marker);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('global_physical_evidence_key');
  });

  it('retains 404 mapping for P2025 without exposing Prisma metadata', () => {
    const res = response();
    errorHandler({ code: 'P2025', message: 'record not found' },
      {} as any, res as any, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false, message: 'Không tìm thấy bản ghi yêu cầu',
    });
  });

  it('does not assume an ambiguous DB exception is an approved evidence conflict', () => {
    const res = response();
    errorHandler({ code: 'P2034', message: 'Transaction conflict' },
      {} as any, res as any, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false, message: 'Đã xảy ra lỗi máy chủ nội bộ',
    });
    // Stage4C must distinguish confirmed rollback from ambiguous COMMIT
    // before mapping 40001/40P01/P2034 to any client-visible retry status.
  });
});

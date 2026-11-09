import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Stage4CReturnWriterService } from '../src/modules/borrow/borrow.stage4c-writer.service';
import { UserRole } from '@acm/shared';
import { AuthenticatedUser } from '../src/middleware/auth';
import { AppError } from '../src/shared/AppError';

describe('Stage4C Return Writer Service - Two-Phase Return Unit Tests', () => {
  let service: Stage4CReturnWriterService;
  let mockPrisma: any;

  const mockTechnician: AuthenticatedUser = {
    id: 'c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    email: 'tech@acm.local',
    fullName: 'Ká»¹ thuáº­t viÃªn phÃ²ng lab',
    role: UserRole.TECHNICIAN,
  };

  const mockStudent: AuthenticatedUser = {
    id: '6c39a348-d42a-406b-bd69-fea42e400001',
    email: 'student@acm.local',
    fullName: 'Sinh viÃªn mÆ°á»£n Ä‘á»“',
    role: UserRole.STUDENT,
  };

  beforeEach(() => {
    mockPrisma = {
      borrowRequest: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      borrowDetail: {
        update: vi.fn(),
      },
      stockBalance: {
        updateMany: vi.fn(),
      },
      returnTransaction: {
        create: vi.fn().mockResolvedValue({ id: 'rt-uuid-001', returnNumber: 'RT-12345678' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-001' }),
      },
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    service = new Stage4CReturnWriterService(mockPrisma);
  });

  // --- PHA 1: PREPARE TESTS ---
  describe('Pha 1: Prepare Operation', () => {
    it('TC-S4C-01: Tá»« chá»‘i vai trÃ² STUDENT tiáº¿p nháº­n tráº£ Ä‘á»“ (403)', async () => {
      await expect(
        service.prepareReturnOperation(
          {
            borrowRequestId: 'borrow-uuid-001',
            physicalEvidenceRef: 'EVID-TEST-001',
            items: [],
          },
          mockStudent
        )
      ).rejects.toThrowError(AppError);
    });

    it('TC-S4C-02: Tá»« chá»‘i mÃ£ chá»©ng tá»« chá»©a kÃ½ tá»± cáº¥m vi pháº¡m BIZ-01', async () => {
      await expect(
        service.prepareReturnOperation(
          {
            borrowRequestId: 'borrow-uuid-001',
            physicalEvidenceRef: 'EVID@INVALID!',
            items: [],
          },
          mockTechnician
        )
      ).rejects.toThrowError();
    });

    it('TC-S4C-03: Cháº·n thao tÃ¡c má»›i khi Ä‘ang cÃ³ thao tÃ¡c PREPARED chÆ°a káº¿t thÃºc (409)', async () => {
      mockPrisma.borrowRequest.findUnique.mockResolvedValue({
        id: 'borrow-uuid-001',
        status: 'HANDED_OVER',
      });
      // Giáº£ láº­p cÃ³ 1 thao tÃ¡c Ä‘ang dá»Ÿ dang
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'op-old', state: 'PREPARED' }]);

      await expect(
        service.prepareReturnOperation(
          {
            borrowRequestId: 'borrow-uuid-001',
            physicalEvidenceRef: 'EVID-TEST-002',
            items: [],
          },
          mockTechnician
        )
      ).rejects.toThrowError(/chÆ°a káº¿t thÃºc/);
    });

    it('TC-S4C-04: Táº¡o thÃ nh cÃ´ng báº£n ghi thao tÃ¡c á»Ÿ tráº¡ng thÃ¡i PREPARED', async () => {
      mockPrisma.borrowRequest.findUnique.mockResolvedValue({
        id: 'borrow-uuid-001',
        status: 'HANDED_OVER',
      });
      mockPrisma.$queryRaw.mockResolvedValue([]); // KhÃ´ng cÃ³ thao tÃ¡c dá»Ÿ dang
      mockPrisma.$executeRaw.mockResolvedValue(1);

      const result = await service.prepareReturnOperation(
        {
          borrowRequestId: 'borrow-uuid-001',
          physicalEvidenceRef: 'EVID-TEST-003',
          items: [],
        },
        mockTechnician
      );

      expect(result.state).toBe('PREPARED');
      expect(result.physicalEvidenceRef).toBe('EVID-TEST-003');
    });
  });

  // --- PHA 2: COMMIT TESTS ---
  describe('Pha 2: Commit Operation', () => {
    it('TC-S4C-05: Tá»« chá»‘i commit náº¿u tráº¡ng thÃ¡i thao tÃ¡c khÃ´ng pháº£i lÃ  PREPARED (409)', async () => {
      // Giáº£ láº­p thao tÃ¡c Ä‘Ã£ COMPLETED trÆ°á»›c Ä‘Ã³
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'op-001',
          borrow_request_id: 'borrow-001',
          state: 'COMPLETED',
          physical_evidence_ref: 'EVID-TEST-001',
          received_by_id: mockTechnician.id,
        },
      ]);

      await expect(
        service.commitReturnOperation('op-001', mockTechnician)
      ).rejects.toThrowError(/khÃ´ng thá»ƒ commit/);
    });

    it('TC-S4C-06: Commit thÃ nh cÃ´ng, cáº­p nháº­t kho cÃ¡ch ly (quarantine-first) vÃ  chuyá»ƒn tráº¡ng thÃ¡i COMPLETED', async () => {
      mockPrisma.$queryRaw.mockImplementation(async (sqlQuery: any) => {
        const text = String(sqlQuery);
        if (text.includes('borrow_return_operations')) {
          return [
            {
              id: 'op-001',
              borrow_request_id: 'borrow-001',
              state: 'PREPARED',
              physical_evidence_ref: 'EVID-TEST-001',
              received_by_id: mockTechnician.id,
            },
          ];
        }
        return [];
      });

      mockPrisma.borrowRequest.findUnique.mockResolvedValue({
        id: 'borrow-001',
        details: [
          {
            id: 'detail-001',
            itemId: 'item-uuid-001',
            quantity: 2,
            returnedQuantity: 0,
          },
        ],
      });

      const result = await service.commitReturnOperation('op-001', mockTechnician);

      expect(result.state).toBe('COMPLETED');
      expect(result.returnNumber).toBeDefined();

      // XÃ¡c nháº­n cáº­p nháº­t tá»“n kho theo mÃ´ hÃ¬nh cÃ¡ch ly: borrowed giáº£m, onHand tÄƒng, quarantined tÄƒng
      expect(mockPrisma.stockBalance.updateMany).toHaveBeenCalledWith({
        where: { itemId: 'item-uuid-001' },
        data: {
          borrowed: { decrement: 2 },
          onHand: { increment: 2 },
          quarantined: { increment: 2 },
        },
      });

      // XÃ¡c nháº­n ghi nháº­t kÃ½ kiá»ƒm toÃ¡n AuditLog
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'STAGE4C_RETURN_COMMIT',
          entity: 'BorrowReturnOperation',
        }),
      });
    });
  });
});

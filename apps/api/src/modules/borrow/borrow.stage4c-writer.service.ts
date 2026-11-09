import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/AppError';
import { UserRole } from '@acm/shared';
import { AuthenticatedUser } from '../../middleware/auth';
import {
  assertPhysicalEvidenceReference,
  type ReturnOperationLineSnapshot,
} from './borrow.return-operation-foundation';


export interface PrepareStage4CReturnInput {
  borrowRequestId: string;
  physicalEvidenceRef: string;
  items: ReturnOperationLineSnapshot[];
  notes?: string | null;
}

export class Stage4CReturnWriterService {
  constructor(private prisma: PrismaClient) {}

  /**
   * PHA 1: PREPARE OPERATION
   * Tiáº¿p nháº­n kiá»ƒm Ä‘á»‹nh thá»±c táº¿ vÃ  táº¡o báº£n ghi á»Ÿ tráº¡ng thÃ¡i PREPARED.
   */
  async prepareReturnOperation(
    input: PrepareStage4CReturnInput,
    currentUser: AuthenticatedUser
  ) {
    // 1. Kiá»ƒm tra quyá»n tiáº¿p nháº­n váº­t lÃ½
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.LAB_MANAGER &&
      currentUser.role !== UserRole.TECHNICIAN
    ) {
      throw new AppError('Chá»‰ Quáº£n trá»‹ viÃªn, Quáº£n lÃ½ Lab hoáº·c Ká»¹ thuáº­t viÃªn má»›i cÃ³ quyá»n tiáº¿p nháº­n tráº£ Ä‘á»“', 403);
    }

    // 2. Kiá»ƒm tra Ä‘á»‹nh dáº¡ng mÃ£ chá»©ng tá»« váº­t lÃ½ theo quy táº¯c BIZ-01
    assertPhysicalEvidenceReference(input.physicalEvidenceRef);

    // 3. Kiá»ƒm tra xem phiáº¿u mÆ°á»£n cÃ³ tá»“n táº¡i vÃ  Ä‘ang á»Ÿ tráº¡ng thÃ¡i há»£p lá»‡ khÃ´ng
    const borrow = await this.prisma.borrowRequest.findUnique({
      where: { id: input.borrowRequestId },
      include: { details: true },
    });
    if (!borrow) {
      throw new AppError('Phiáº¿u mÆ°á»£n khÃ´ng tá»“n táº¡i', 404);
    }

    // 4. Kiá»ƒm tra xem phiáº¿u mÆ°á»£n cÃ³ thao tÃ¡c nÃ o Ä‘ang dá»Ÿ dang (PREPARED hoáº·c RECONCILIATION_REQUIRED) khÃ´ng
    const pendingOp = await this.prisma.$queryRaw<Array<{ id: string; state: string }>>`
      SELECT "id", "state" FROM "borrow_return_operations"
      WHERE "borrow_request_id" = ${input.borrowRequestId}::uuid
      AND "state" IN ('PREPARED', 'RECONCILIATION_REQUIRED')
      LIMIT 1
    `;
    if (pendingOp && pendingOp.length > 0) {
      throw new AppError(
        `Phiáº¿u mÆ°á»£n Ä‘ang cÃ³ má»™t thao tÃ¡c hoÃ n tráº£ chÆ°a káº¿t thÃºc (${pendingOp[0].state}). YÃªu cáº§u Ä‘á»‘i soÃ¡t trÆ°á»›c khi táº¡o má»›i.`,
        409
      );
    }

    // 5. Táº¡o báº£n ghi thao tÃ¡c á»Ÿ tráº¡ng thÃ¡i PREPARED
    const operationId = crypto.randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "borrow_return_operations" (
        "id", "borrow_request_id", "state", "physical_evidence_ref", "received_by_id", "received_at"
      ) VALUES (
        ${operationId}::uuid,
        ${input.borrowRequestId}::uuid,
        'PREPARED',
        ${input.physicalEvidenceRef},
        ${currentUser.id}::uuid,
        NOW()
      )
    `;

    return {
      operationId,
      state: 'PREPARED',
      physicalEvidenceRef: input.physicalEvidenceRef,
      borrowRequestId: input.borrowRequestId,
    };
  }

  /**
   * PHA 2: COMMIT OPERATION
   * Tuáº§n tá»± hÃ³a giao dá»‹ch khÃ³a kho, cáº­p nháº­t sá»‘ dÆ° kho cÃ¡ch ly, ghi nháº­n ReturnTransaction vÃ  COMPLETED.
   */
  async commitReturnOperation(
    operationId: string,
    currentUser: AuthenticatedUser,
    idempotencyKey?: string
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. KhÃ³a bi quan báº£n ghi thao tÃ¡c Stage4C
      const ops = await tx.$queryRaw<Array<{
        id: string;
        borrow_request_id: string;
        state: string;
        physical_evidence_ref: string;
        received_by_id: string;
      }>>`
        SELECT "id", "borrow_request_id", "state", "physical_evidence_ref", "received_by_id"
        FROM "borrow_return_operations"
        WHERE "id" = ${operationId}::uuid FOR UPDATE
      `;

      if (!ops || ops.length === 0) {
        throw new AppError('Thao tÃ¡c hoÃ n tráº£ khÃ´ng tá»“n táº¡i', 404);
      }
      const op = ops[0];

      if (op.state !== 'PREPARED') {
        throw new AppError(`Thao tÃ¡c hoÃ n tráº£ Ä‘ang á»Ÿ tráº¡ng thÃ¡i '${op.state}', khÃ´ng thá»ƒ commit`, 409);
      }

      // 2. KhÃ³a dÃ²ng phiáº¿u mÆ°á»£n tÆ°Æ¡ng á»©ng
      await tx.$queryRaw`
        SELECT "id" FROM "borrow_requests"
        WHERE "id" = ${op.borrow_request_id}::uuid FOR UPDATE
      `;

      const borrow = await tx.borrowRequest.findUnique({
        where: { id: op.borrow_request_id },
        include: { details: true, reservations: true },
      });
      if (!borrow) throw new AppError('Phiáº¿u mÆ°á»£n khÃ´ng tá»“n táº¡i', 404);

      // 3. KhÃ³a cÃ¡c dÃ²ng tá»“n kho theo thá»© tá»± ID Ä‘á»ƒ triá»‡t tiÃªu nguy cÆ¡ Deadlock (40P01)
      const sortedItemIds = [...new Set(borrow.details.map((d) => d.itemId))].sort();
      for (const itemId of sortedItemIds) {
        await tx.$queryRaw`
          SELECT "id" FROM "stock_balances"
          WHERE "itemId" = ${itemId}::uuid FOR UPDATE
        `;
      }

      // 4. Cáº­p nháº­t tá»“n kho theo mÃ´ hÃ¬nh cÃ¡ch ly kiá»ƒm Ä‘á»‹nh (Quarantine-First)
      for (const detail of borrow.details) {
        const remainingToReturn = detail.quantity - detail.returnedQuantity;
        if (remainingToReturn <= 0) continue;

        // Cáº­p nháº­t sá»‘ dÆ°: borrowed giáº£m, onHand tÄƒng, quarantined tÄƒng (chá» duyá»‡t QC)
        await tx.stockBalance.updateMany({
          where: { itemId: detail.itemId },
          data: {
            borrowed: { decrement: remainingToReturn },
            onHand: { increment: remainingToReturn },
            quarantined: { increment: remainingToReturn },
          },
        });

        // Ghi nháº­n chi tiáº¿t dÃ²ng mÆ°á»£n
        await tx.borrowDetail.update({
          where: { id: detail.id },
          data: { returnedQuantity: { increment: remainingToReturn } },
        });
      }

      // 5. Sinh chá»©ng tá»« hoÃ n tráº£ ReturnTransaction
      const returnNumber = `RT-${Date.now().toString().slice(-8)}`;
      const returnTx = await tx.returnTransaction.create({
        data: {
          borrowRequestId: borrow.id,
          returnNumber,
          receiverId: op.received_by_id,
        },
      });

      // 6. Chuyá»ƒn tráº¡ng thÃ¡i phiáº¿u mÆ°á»£n vÃ  thao tÃ¡c sang COMPLETED
      await tx.borrowRequest.update({
        where: { id: borrow.id },
        data: { status: 'RETURNED', actualReturnDate: new Date() },
      });

      await tx.$executeRaw`
        UPDATE "borrow_return_operations"
        SET "state" = 'COMPLETED',
            "return_transaction_id" = ${returnTx.id}::uuid,
            "verified_by_id" = ${currentUser.id}::uuid,
            "verified_at" = NOW(),
            "updated_at" = NOW()
        WHERE "id" = ${op.id}::uuid
      `;

      // 7. Ghi nháº­n Audit Log báº¥t biáº¿n
      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'STAGE4C_RETURN_COMMIT',
          entity: 'BorrowReturnOperation',
          entityId: op.id,
          oldValue: { state: 'PREPARED' },
          newValue: { state: 'COMPLETED', returnNumber },
        },
      });

      return {
        operationId: op.id,
        state: 'COMPLETED',
        returnNumber,
        borrowRequestId: borrow.id,
      };
    });
  }
}

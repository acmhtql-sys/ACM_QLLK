import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { AuthenticatedUser } from '../../middleware/auth';
import {
  UserRole,
  BorrowStatus,
  AssetCondition,
  ReservationStatus,
  StockTransactionType,
  BorrowSortField,
  SortOrder,
  CreateBorrowRequestInput,
  ApproveBorrowRequestInput,
  RejectBorrowRequestInput,
  CancelBorrowRequestInput,
  HandoverBorrowRequestInput,
  ReturnBorrowRequestInput,
  QueryBorrowRequestsInput,
  BorrowRequestResponse,
  PaginationMeta,
} from '@acm/shared';

/**
 * Transforms raw database BorrowRequest record into BorrowRequestResponse DTO
 */
export function formatBorrowRequestResponse(b: any): BorrowRequestResponse {
  const isOverdue =
    (b.status === BorrowStatus.HANDED_OVER || b.status === BorrowStatus.PARTIALLY_RETURNED) &&
    Boolean(b.expectedReturnDate && new Date().getTime() > new Date(b.expectedReturnDate).getTime());

  return {
    id: b.id,
    requestNumber: b.requestNumber,
    borrowerId: b.borrowerId,
    borrower: b.borrower
      ? {
          id: b.borrower.id,
          fullName: b.borrower.fullName,
          email: b.borrower.email,
        }
      : undefined,
    borrowerName: b.borrower?.fullName || '',
    borrowerEmail: b.borrower?.email || '',
    approverId: b.approverId,
    approver: b.approver
      ? {
          id: b.approver.id,
          fullName: b.approver.fullName,
          email: b.approver.email,
        }
      : null,
    approverName: b.approver?.fullName || null,
    status: b.status,
    purpose: b.purpose,
    expectedBorrowDate:
      b.expectedBorrowDate instanceof Date
        ? b.expectedBorrowDate.toISOString().slice(0, 10)
        : b.expectedBorrowDate,
    expectedReturnDate:
      b.expectedReturnDate instanceof Date
        ? b.expectedReturnDate.toISOString().slice(0, 10)
        : b.expectedReturnDate,
    actualBorrowDate:
      b.actualBorrowDate instanceof Date ? b.actualBorrowDate.toISOString() : b.actualBorrowDate,
    actualReturnDate:
      b.actualReturnDate instanceof Date ? b.actualReturnDate.toISOString() : b.actualReturnDate,
    rejectionReason: b.rejectionReason,
    notes: b.notes,
    itemCount: b.details?.length || 0,
    details: (b.details || []).map((d: any) => ({
      id: d.id,
      borrowRequestId: d.borrowRequestId,
      itemId: d.itemId,
      item: d.item
        ? {
            id: d.item.id,
            code: d.item.code,
            name: d.item.name,
            unit: d.item.unit,
          }
        : undefined,
      assetId: d.assetId,
      quantity: d.quantity,
      returnedQuantity: d.returnedQuantity || 0,
      notes: d.notes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
    reservations: (b.reservations || []).map((r: any) => ({
      id: r.id,
      borrowRequestId: r.borrowRequestId,
      itemId: r.itemId,
      item: r.item
        ? {
            id: r.item.id,
            code: r.item.code,
            name: r.item.name,
            unit: r.item.unit,
          }
        : undefined,
      locationId: r.locationId,
      location: r.location
        ? {
            id: r.location.id,
            code: r.location.code,
            name: r.location.name,
          }
        : undefined,
      quantity: r.quantity,
      status: r.status,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    })),
    returnTransactions: (b.returnTransactions || []).map((rt: any) => ({
      id: rt.id,
      returnNumber: rt.returnNumber,
      borrowRequestId: rt.borrowRequestId,
      receiverId: rt.receiverId,
      receiver: rt.receiver
        ? {
            id: rt.receiver.id,
            fullName: rt.receiver.fullName,
            email: rt.receiver.email,
          }
        : undefined,
      notes: rt.notes,
      details: (rt.details || []).map((rd: any) => ({
        id: rd.id,
        returnTransactionId: rd.returnTransactionId,
        itemId: rd.itemId,
        item: rd.item
          ? {
              id: rd.item.id,
              code: rd.item.code,
              name: rd.item.name,
              unit: rd.item.unit,
            }
          : undefined,
        assetId: rd.assetId,
        quantity: rd.quantity,
        condition: rd.condition,
        notes: rd.notes,
        createdAt: rd.createdAt,
      })),
      createdAt: rt.createdAt,
      updatedAt: rt.updatedAt,
    })),
    isOverdue,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/**
 * Generates unique Borrow Request Number (format: BR-YYYYMMDD-XXXX)
 */
export async function generateBorrowRequestNumber(
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 10; i++) {
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
    const candidate = `BR-${dateStr}-${randomSuffix}`;
    const existing = await tx.borrowRequest.findUnique({
      where: { requestNumber: candidate },
    });
    if (!existing) {
      return candidate;
    }
  }
  return `BR-${dateStr}-${Date.now().toString().slice(-4)}`;
}

/**
 * Generates unique Return Transaction Number (format: RT-YYYYMMDD-XXXX)
 */
export async function generateReturnTransactionNumber(
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 10; i++) {
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
    const candidate = `RT-${dateStr}-${randomSuffix}`;
    const existing = await tx.returnTransaction.findUnique({
      where: { returnNumber: candidate },
    });
    if (!existing) {
      return candidate;
    }
  }
  return `RT-${dateStr}-${Date.now().toString().slice(-4)}`;
}

export class BorrowService {
  /**
   * Creates a new BorrowRequest with validation of available stock and dates.
   */
  async createBorrowRequest(
    input: CreateBorrowRequestInput,
    currentUser: AuthenticatedUser
  ): Promise<BorrowRequestResponse> {
    const borrowerId =
      currentUser.role === UserRole.STUDENT ? currentUser.id : input.borrowerId || currentUser.id;

    // Verify borrower exists and is active
    const borrower = await prisma.user.findUnique({
      where: { id: borrowerId },
      select: { id: true, fullName: true, email: true, isActive: true, isLocked: true },
    });

    if (!borrower) {
      throw new AppError('Người mượn không tồn tại trong hệ thống', 404);
    }
    if (!borrower.isActive || borrower.isLocked) {
      throw new AppError('Tài khoản người mượn đã bị vô hiệu hóa hoặc tạm khóa', 400);
    }

    // Deduplicate / aggregate items if same itemId appears multiple times
    const itemMap = new Map<string, number>();
    for (const item of input.items) {
      const currentQty = itemMap.get(item.itemId) || 0;
      itemMap.set(item.itemId, currentQty + item.quantity);
    }

    // Validate items and check stock availability
    for (const [itemId, requestedQty] of itemMap.entries()) {
      const itemRecord = await prisma.item.findUnique({
        where: { id: itemId },
        include: { stockBalances: true },
      });

      if (!itemRecord) {
        throw new AppError(`Linh kiện với ID '${itemId}' không tồn tại`, 404);
      }
      if (!itemRecord.isActive) {
        throw new AppError(
          `Linh kiện '${itemRecord.code} - ${itemRecord.name}' đã bị vô hiệu hóa, không thể tạo phiếu mượn`,
          400
        );
      }

      const totalAvailable = (itemRecord.stockBalances || []).reduce(
        (sum, b) => sum + Math.max(0, b.onHand - b.reserved - b.quarantined - b.kitAllocated),
        0
      );

      if (totalAvailable <= 0) {
        throw new AppError(
          `Linh kiện '${itemRecord.code} - ${itemRecord.name}' hiện đã hết hàng khả dụng trong kho`,
          400
        );
      }
    }

    const requestNumber = await generateBorrowRequestNumber(prisma);

    const created = await prisma.$transaction(async (tx) => {
      const borrowReq = await tx.borrowRequest.create({
        data: {
          requestNumber,
          borrowerId,
          status: BorrowStatus.PENDING,
          purpose: input.purpose,
          expectedBorrowDate: new Date(input.expectedBorrowDate),
          expectedReturnDate: new Date(input.expectedReturnDate),
          notes: input.notes,
          details: {
            create: Array.from(itemMap.entries()).map(([itemId, quantity]) => ({
              itemId,
              quantity,
              returnedQuantity: 0,
            })),
          },
        },
        include: {
          borrower: { select: { id: true, fullName: true, email: true } },
          details: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'CREATE',
          entity: 'BorrowRequest',
          entityId: borrowReq.id,
          newValue: {
            requestNumber: borrowReq.requestNumber,
            borrowerId,
            itemCount: borrowReq.details.length,
          },
        },
      });

      return borrowReq;
    });

    return formatBorrowRequestResponse(created);
  }

  /**
   * Approves a PENDING BorrowRequest and allocates/reserves stock across active warehouse locations.
   */
  async approveBorrowRequest(
    id: string,
    input: ApproveBorrowRequestInput,
    currentUser: AuthenticatedUser
  ): Promise<BorrowRequestResponse> {
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.LAB_MANAGER) {
      throw new AppError(
        'Chỉ Quản trị viên (ADMIN) hoặc Quản lý phòng Lab (LAB_MANAGER) mới có quyền phê duyệt phiếu mượn',
        403
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const req = await tx.borrowRequest.findUnique({
        where: { id },
        include: {
          details: { include: { item: true } },
          reservations: true,
        },
      });

      if (!req) {
        throw new AppError('Phiếu mượn không tồn tại', 404);
      }

      if (req.status !== BorrowStatus.PENDING) {
        throw new AppError(
          `Không thể phê duyệt phiếu mượn đang ở trạng thái '${req.status}'. Chỉ phiếu mượn 'Chờ duyệt (PENDING)' mới có thể phê duyệt`,
          400
        );
      }

      // Allocate stock reservation for each item
      for (const detail of req.details) {
        const balances = await tx.stockBalance.findMany({
          where: { itemId: detail.itemId },
          orderBy: { onHand: 'desc' },
        });

        const totalAvailable = balances.reduce(
          (sum, b) => sum + Math.max(0, b.onHand - b.reserved - b.quarantined - b.kitAllocated),
          0
        );

        if (totalAvailable < detail.quantity) {
          throw new AppError(
            `Không đủ tồn kho khả dụng để duyệt phiếu cho linh kiện '${detail.item.name}' (yêu cầu: ${detail.quantity}, khả dụng: ${totalAvailable})`,
            400
          );
        }

        let remainingToReserve = detail.quantity;
        for (const bal of balances) {
          const avail = Math.max(0, bal.onHand - bal.reserved - bal.quarantined - bal.kitAllocated);
          if (avail <= 0) continue;

          const alloc = Math.min(remainingToReserve, avail);

          await tx.stockBalance.update({
            where: { id: bal.id },
            data: { reserved: { increment: alloc } },
          });

          await tx.stockReservation.create({
            data: {
              borrowRequestId: req.id,
              itemId: detail.itemId,
              locationId: bal.locationId,
              quantity: alloc,
              status: ReservationStatus.ACTIVE,
            },
          });

          remainingToReserve -= alloc;
          if (remainingToReserve === 0) break;
        }
      }

      const appendNote = input.notes
        ? req.notes
          ? `${req.notes}\n[Phê duyệt]: ${input.notes}`
          : `[Phê duyệt]: ${input.notes}`
        : req.notes;

      const approvedReq = await tx.borrowRequest.update({
        where: { id },
        data: {
          status: BorrowStatus.APPROVED,
          approverId: currentUser.id,
          notes: appendNote,
        },
        include: {
          borrower: { select: { id: true, fullName: true, email: true } },
          approver: { select: { id: true, fullName: true, email: true } },
          details: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
          reservations: { include: { location: true, item: true } },
          returnTransactions: { include: { details: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'APPROVE',
          entity: 'BorrowRequest',
          entityId: req.id,
          oldValue: { status: req.status },
          newValue: { status: BorrowStatus.APPROVED, approverId: currentUser.id },
        },
      });

      return approvedReq;
    });

    return formatBorrowRequestResponse(updated);
  }

  /**
   * Rejects a PENDING BorrowRequest with mandatory reason.
   */
  async rejectBorrowRequest(
    id: string,
    input: RejectBorrowRequestInput,
    currentUser: AuthenticatedUser
  ): Promise<BorrowRequestResponse> {
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.LAB_MANAGER) {
      throw new AppError(
        'Chỉ Quản trị viên (ADMIN) hoặc Quản lý phòng Lab (LAB_MANAGER) mới có quyền từ chối phiếu mượn',
        403
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const req = await tx.borrowRequest.findUnique({ where: { id } });
      if (!req) {
        throw new AppError('Phiếu mượn không tồn tại', 404);
      }

      if (req.status !== BorrowStatus.PENDING) {
        throw new AppError(
          `Không thể từ chối phiếu mượn đang ở trạng thái '${req.status}'. Chỉ phiếu mượn 'Chờ duyệt (PENDING)' mới có thể từ chối`,
          400
        );
      }

      const rejectedReq = await tx.borrowRequest.update({
        where: { id },
        data: {
          status: BorrowStatus.REJECTED,
          approverId: currentUser.id,
          rejectionReason: input.rejectionReason,
        },
        include: {
          borrower: { select: { id: true, fullName: true, email: true } },
          approver: { select: { id: true, fullName: true, email: true } },
          details: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
          reservations: true,
          returnTransactions: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'REJECT',
          entity: 'BorrowRequest',
          entityId: req.id,
          oldValue: { status: req.status },
          newValue: { status: BorrowStatus.REJECTED, rejectionReason: input.rejectionReason },
        },
      });

      return rejectedReq;
    });

    return formatBorrowRequestResponse(updated);
  }

  /**
   * Cancels a BorrowRequest. If APPROVED, releases all active stock reservations.
   */
  async cancelBorrowRequest(
    id: string,
    input: CancelBorrowRequestInput,
    currentUser: AuthenticatedUser
  ): Promise<BorrowRequestResponse> {
    const updated = await prisma.$transaction(async (tx) => {
      const req = await tx.borrowRequest.findUnique({
        where: { id },
        include: { reservations: true },
      });

      if (!req) {
        throw new AppError('Phiếu mượn không tồn tại', 404);
      }

      // Check RBAC
      if (currentUser.role === UserRole.STUDENT) {
        if (req.borrowerId !== currentUser.id) {
          throw new AppError('Bạn không có quyền hủy phiếu mượn của người khác', 403);
        }
        if (req.status !== BorrowStatus.PENDING) {
          throw new AppError(
            `Sinh viên chỉ có thể hủy phiếu mượn khi ở trạng thái 'Chờ duyệt (PENDING)'. Trạng thái hiện tại: '${req.status}'`,
            400
          );
        }
      } else if (
        currentUser.role !== UserRole.ADMIN &&
        currentUser.role !== UserRole.LAB_MANAGER
      ) {
        throw new AppError('Bạn không có quyền hủy phiếu mượn', 403);
      }

      if (req.status !== BorrowStatus.PENDING && req.status !== BorrowStatus.APPROVED) {
        throw new AppError(
          `Không thể hủy phiếu mượn đang ở trạng thái '${req.status}'. Chỉ phiếu 'PENDING' hoặc 'APPROVED' mới có thể hủy`,
          400
        );
      }

      // If APPROVED, release active reservations and roll back reserved balances
      if (req.status === BorrowStatus.APPROVED) {
        const activeReservations = req.reservations.filter(
          (r) => r.status === ReservationStatus.ACTIVE
        );

        for (const res of activeReservations) {
          await tx.stockBalance.update({
            where: { itemId_locationId: { itemId: res.itemId, locationId: res.locationId } },
            data: { reserved: { decrement: res.quantity } },
          });

          await tx.stockReservation.update({
            where: { id: res.id },
            data: { status: ReservationStatus.RELEASED },
          });
        }
      }

      const appendNote = input.reason
        ? req.notes
          ? `${req.notes}\n[Hủy phiếu]: ${input.reason}`
          : `[Hủy phiếu]: ${input.reason}`
        : req.notes;

      const cancelledReq = await tx.borrowRequest.update({
        where: { id },
        data: {
          status: BorrowStatus.CANCELLED,
          notes: appendNote,
        },
        include: {
          borrower: { select: { id: true, fullName: true, email: true } },
          approver: { select: { id: true, fullName: true, email: true } },
          details: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
          reservations: true,
          returnTransactions: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'CANCEL',
          entity: 'BorrowRequest',
          entityId: req.id,
          oldValue: { status: req.status },
          newValue: { status: BorrowStatus.CANCELLED, reason: input.reason },
        },
      });

      return cancelledReq;
    });

    return formatBorrowRequestResponse(updated);
  }

  /**
   * Hands over items for an APPROVED request:
   * Moves stock from reserved/onHand to borrowed, records StockMovement, fulfills reservations.
   */
  async handoverBorrowRequest(
    id: string,
    input: HandoverBorrowRequestInput,
    currentUser: AuthenticatedUser
  ): Promise<BorrowRequestResponse> {
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.LAB_MANAGER &&
      currentUser.role !== UserRole.TECHNICIAN
    ) {
      throw new AppError(
        'Chỉ Quản trị viên, Quản lý Lab hoặc Kỹ thuật viên mới có quyền thực hiện bàn giao linh kiện',
        403
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const req = await tx.borrowRequest.findUnique({
        where: { id },
        include: {
          reservations: true,
          details: { include: { item: true } },
        },
      });

      if (!req) {
        throw new AppError('Phiếu mượn không tồn tại', 404);
      }

      if (req.status !== BorrowStatus.APPROVED) {
        throw new AppError(
          `Chỉ phiếu mượn ở trạng thái 'Đã duyệt (APPROVED)' mới có thể thực hiện bàn giao. Trạng thái hiện tại: '${req.status}'`,
          400
        );
      }

      const activeReservations = req.reservations.filter(
        (r) => r.status === ReservationStatus.ACTIVE
      );

      if (activeReservations.length === 0) {
        throw new AppError('Không tìm thấy thông tin giữ chỗ (StockReservation) của phiếu mượn', 400);
      }

      for (const res of activeReservations) {
        const bal = await tx.stockBalance.findUnique({
          where: { itemId_locationId: { itemId: res.itemId, locationId: res.locationId } },
        });

        if (!bal) {
          throw new AppError('Không tìm thấy bản ghi tồn kho linh kiện tại vị trí giữ chỗ', 404);
        }

        if (bal.reserved < res.quantity || bal.onHand < res.quantity) {
          throw new AppError(
            `Không đủ tồn kho để bàn giao (onHand: ${bal.onHand}, reserved: ${bal.reserved}, cần bàn giao: ${res.quantity})`,
            400
          );
        }

        const onHandBefore = bal.onHand;
        const onHandAfter = bal.onHand - res.quantity;

        // Inventory update: reserved -= qty, onHand -= qty, borrowed += qty
        await tx.stockBalance.update({
          where: { id: bal.id },
          data: {
            reserved: { decrement: res.quantity },
            onHand: { decrement: res.quantity },
            borrowed: { increment: res.quantity },
          },
        });

        // Stock movement ledger entry
        await tx.stockMovement.create({
          data: {
            itemId: res.itemId,
            locationId: res.locationId,
            type: StockTransactionType.EXPORT,
            quantityDelta: -res.quantity,
            onHandBefore,
            onHandAfter,
            referenceType: 'BORROW_HANDOVER',
            referenceId: req.id,
            reason: `Bàn giao theo phiếu mượn ${req.requestNumber}`,
            createdById: currentUser.id,
          },
        });

        // Fulfill reservation
        await tx.stockReservation.update({
          where: { id: res.id },
          data: { status: ReservationStatus.FULFILLED },
        });
      }

      const appendNote = input.notes
        ? req.notes
          ? `${req.notes}\n[Bàn giao]: ${input.notes}`
          : `[Bàn giao]: ${input.notes}`
        : req.notes;

      const handedOverReq = await tx.borrowRequest.update({
        where: { id },
        data: {
          status: BorrowStatus.HANDED_OVER,
          actualBorrowDate: new Date(),
          notes: appendNote,
        },
        include: {
          borrower: { select: { id: true, fullName: true, email: true } },
          approver: { select: { id: true, fullName: true, email: true } },
          details: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
          reservations: { include: { location: true, item: true } },
          returnTransactions: { include: { details: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'HANDOVER',
          entity: 'BorrowRequest',
          entityId: req.id,
          oldValue: { status: req.status },
          newValue: { status: BorrowStatus.HANDED_OVER, actualBorrowDate: handedOverReq.actualBorrowDate },
        },
      });

      return handedOverReq;
    });

    return formatBorrowRequestResponse(updated);
  }

  /**
   * Confirms returns (full or partial) with anti-double-return validation and inventory reconciliation.
   */
  async returnBorrowRequest(
    id: string,
    input: ReturnBorrowRequestInput,
    currentUser: AuthenticatedUser
  ): Promise<{ borrowRequest: BorrowRequestResponse; returnNumber: string }> {
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.LAB_MANAGER &&
      currentUser.role !== UserRole.TECHNICIAN
    ) {
      throw new AppError(
        'Chỉ Quản trị viên, Quản lý Lab hoặc Kỹ thuật viên mới có quyền nhận hoàn trả linh kiện',
        403
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const req = await tx.borrowRequest.findUnique({
        where: { id },
        include: {
          details: { include: { item: true } },
          reservations: true,
        },
      });

      if (!req) {
        throw new AppError('Phiếu mượn không tồn tại', 404);
      }

      if (
        req.status !== BorrowStatus.HANDED_OVER &&
        req.status !== BorrowStatus.PARTIALLY_RETURNED
      ) {
        throw new AppError(
          `Chỉ phiếu mượn 'Đang mượn (HANDED_OVER)' hoặc 'Đã trả một phần (PARTIALLY_RETURNED)' mới có thể nhận hoàn trả. Trạng thái hiện tại: '${req.status}'`,
          400
        );
      }

      // Prevent duplicate BorrowDetail rows even when service is called directly
      // (outside the HTTP/Zod validation layer).
      const seenReturnDetails = new Set<string>();
      for (const returnItem of input.items) {
        if (seenReturnDetails.has(returnItem.borrowDetailId)) {
          throw new AppError('Không được hoàn trả trùng dòng chi tiết mượn trong một giao dịch', 400);
        }
        seenReturnDetails.add(returnItem.borrowDetailId);
      }

      // Anti-double-return and quantity validation
      for (const returnItem of input.items) {
        const detail = req.details.find((d) => d.id === returnItem.borrowDetailId);
        if (!detail) {
          throw new AppError(
            `Dòng chi tiết mượn với ID '${returnItem.borrowDetailId}' không thuộc phiếu mượn này`,
            400
          );
        }

        const remainingToReturn = detail.quantity - detail.returnedQuantity;
        if (returnItem.returnedQuantity > remainingToReturn) {
          throw new AppError(
            `Số lượng hoàn trả (${returnItem.returnedQuantity}) vượt quá số lượng đang mượn còn lại (${remainingToReturn}) cho linh kiện '${detail.item?.name || detail.itemId}'`,
            400
          );
        }
      }

      const returnNumber = await generateReturnTransactionNumber(tx);

      // Create ReturnTransaction
      const returnTx = await tx.returnTransaction.create({
        data: {
          returnNumber,
          borrowRequestId: req.id,
          receiverId: currentUser.id,
          notes: input.notes,
        },
      });

      // Process each return item
      for (const returnItem of input.items) {
        const detail = req.details.find((d) => d.id === returnItem.borrowDetailId)!;

        // Record ReturnDetail
        await tx.returnDetail.create({
          data: {
            returnTransactionId: returnTx.id,
            itemId: detail.itemId,
            quantity: returnItem.returnedQuantity,
            condition: returnItem.condition,
            notes: returnItem.notes,
          },
        });

        // Update BorrowDetail returnedQuantity
        await tx.borrowDetail.update({
          where: { id: detail.id },
          data: { returnedQuantity: { increment: returnItem.returnedQuantity } },
        });

        // Determine destination location for stock
        let destinationLocationId = returnItem.locationId;
        if (!destinationLocationId) {
          const matchingReservation = req.reservations.find((r) => r.itemId === detail.itemId);
          destinationLocationId = matchingReservation?.locationId;
        }

        if (!destinationLocationId) {
          const firstBalance = await tx.stockBalance.findFirst({
            where: { itemId: detail.itemId },
            select: { locationId: true },
          });
          destinationLocationId = firstBalance?.locationId;
        }

        if (!destinationLocationId) {
          throw new AppError(
            `Không xác định được vị trí kho để hoàn trả cho linh kiện '${detail.item?.name || detail.itemId}'`,
            400
          );
        }

        // Lock / fetch StockBalance
        let bal = await tx.stockBalance.findUnique({
          where: {
            itemId_locationId: { itemId: detail.itemId, locationId: destinationLocationId },
          },
        });

        if (!bal) {
          bal = await tx.stockBalance.create({
            data: {
              itemId: detail.itemId,
              locationId: destinationLocationId,
              onHand: 0,
              reserved: 0,
              quarantined: 0,
              kitAllocated: 0,
              borrowed: 0,
            },
          });
        }

        const onHandBefore = bal.onHand;
        const condition = returnItem.condition || AssetCondition.GOOD;

        if (condition === AssetCondition.GOOD) {
          const onHandAfter = bal.onHand + returnItem.returnedQuantity;
          await tx.stockBalance.update({
            where: { id: bal.id },
            data: {
              borrowed: { decrement: Math.min(bal.borrowed, returnItem.returnedQuantity) },
              onHand: { increment: returnItem.returnedQuantity },
            },
          });

          await tx.stockMovement.create({
            data: {
              itemId: detail.itemId,
              locationId: destinationLocationId,
              type: StockTransactionType.IMPORT,
              quantityDelta: returnItem.returnedQuantity,
              onHandBefore,
              onHandAfter,
              referenceType: 'RETURN',
              referenceId: returnTx.id,
              reason: `Hoàn trả linh kiện tốt theo phiếu ${req.requestNumber}`,
              createdById: currentUser.id,
            },
          });
        } else if (condition === AssetCondition.DAMAGED) {
          const onHandAfter = bal.onHand + returnItem.returnedQuantity;
          await tx.stockBalance.update({
            where: { id: bal.id },
            data: {
              borrowed: { decrement: Math.min(bal.borrowed, returnItem.returnedQuantity) },
              onHand: { increment: returnItem.returnedQuantity },
              quarantined: { increment: returnItem.returnedQuantity },
            },
          });

          await tx.stockMovement.create({
            data: {
              itemId: detail.itemId,
              locationId: destinationLocationId,
              type: StockTransactionType.IMPORT,
              quantityDelta: returnItem.returnedQuantity,
              onHandBefore,
              onHandAfter,
              referenceType: 'RETURN_DAMAGED',
              referenceId: returnTx.id,
              reason: `Hoàn trả linh kiện hỏng - cách ly theo phiếu ${req.requestNumber}`,
              createdById: currentUser.id,
            },
          });
        } else if (condition === AssetCondition.LOST) {
          // Physically lost: doesn't return to onHand, only decrement borrowed
          await tx.stockBalance.update({
            where: { id: bal.id },
            data: {
              borrowed: { decrement: Math.min(bal.borrowed, returnItem.returnedQuantity) },
            },
          });

          await tx.stockMovement.create({
            data: {
              itemId: detail.itemId,
              locationId: destinationLocationId,
              type: StockTransactionType.EXPORT,
              quantityDelta: 0,
              onHandBefore,
              onHandAfter: onHandBefore,
              referenceType: 'RETURN_LOST',
              referenceId: returnTx.id,
              reason: `Báo mất linh kiện khi trả theo phiếu ${req.requestNumber}`,
              createdById: currentUser.id,
            },
          });
        }
      }

      // Check overall return completion
      const updatedDetails = await tx.borrowDetail.findMany({
        where: { borrowRequestId: req.id },
      });

      const allReturned = updatedDetails.every((d) => d.returnedQuantity >= d.quantity);
      const newStatus = allReturned ? BorrowStatus.RETURNED : BorrowStatus.PARTIALLY_RETURNED;
      const actualReturnDate = allReturned ? new Date() : null;

      const updatedReq = await tx.borrowRequest.update({
        where: { id: req.id },
        data: {
          status: newStatus,
          actualReturnDate: actualReturnDate || req.actualReturnDate,
        },
        include: {
          borrower: { select: { id: true, fullName: true, email: true } },
          approver: { select: { id: true, fullName: true, email: true } },
          details: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
          reservations: { include: { location: true, item: true } },
          returnTransactions: {
            include: {
              receiver: { select: { id: true, fullName: true, email: true } },
              details: { include: { item: true } },
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUser.id,
          action: 'RETURN',
          entity: 'BorrowRequest',
          entityId: req.id,
          oldValue: { status: req.status },
          newValue: {
            returnNumber,
            status: newStatus,
            allReturned,
          },
        },
      });

      return { updatedReq, returnNumber };
    });

    return {
      borrowRequest: formatBorrowRequestResponse(result.updatedReq),
      returnNumber: result.returnNumber,
    };
  }

  /**
   * Retrieves paginated list of BorrowRequests with RBAC filtering, overdue detection and search.
   */
  async listBorrowRequests(
    query: QueryBorrowRequestsInput,
    currentUser: AuthenticatedUser
  ): Promise<{ items: BorrowRequestResponse[]; meta: PaginationMeta }> {
    const where: Prisma.BorrowRequestWhereInput = {};

    // RBAC: Students can only list their own borrow requests
    if (currentUser.role === UserRole.STUDENT) {
      where.borrowerId = currentUser.id;
    } else if (query.borrowerId) {
      where.borrowerId = query.borrowerId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.isOverdue === true) {
      where.status = { in: [BorrowStatus.HANDED_OVER, BorrowStatus.PARTIALLY_RETURNED] };
      where.expectedReturnDate = { lt: new Date() };
    } else if (query.isOverdue === false) {
      where.OR = [
        { status: { notIn: [BorrowStatus.HANDED_OVER, BorrowStatus.PARTIALLY_RETURNED] } },
        { expectedReturnDate: { gte: new Date() } },
      ];
    }

    if (query.search) {
      const searchFilter: Prisma.BorrowRequestWhereInput[] = [
        { requestNumber: { contains: query.search, mode: 'insensitive' } },
        { purpose: { contains: query.search, mode: 'insensitive' } },
        { borrower: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { borrower: { email: { contains: query.search, mode: 'insensitive' } } },
      ];

      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchFilter }];
        delete where.OR;
      } else {
        where.OR = searchFilter;
      }
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const sortByField = query.sortBy || BorrowSortField.CREATED_AT;
    const sortOrderVal = query.sortOrder || SortOrder.DESC;

    const [totalItems, records] = await Promise.all([
      prisma.borrowRequest.count({ where }),
      prisma.borrowRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortByField]: sortOrderVal },
        include: {
          borrower: { select: { id: true, fullName: true, email: true } },
          approver: { select: { id: true, fullName: true, email: true } },
          details: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
          reservations: { include: { location: true, item: true } },
          returnTransactions: {
            include: {
              receiver: { select: { id: true, fullName: true, email: true } },
              details: { include: { item: true } },
            },
          },
        },
      }),
    ]);

    const items = records.map((r) => formatBorrowRequestResponse(r));
    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      items,
      meta: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Retrieves single BorrowRequest by ID with RBAC permission check.
   */
  async getBorrowRequestById(
    id: string,
    currentUser: AuthenticatedUser
  ): Promise<BorrowRequestResponse> {
    const record = await prisma.borrowRequest.findUnique({
      where: { id },
      include: {
        borrower: { select: { id: true, fullName: true, email: true } },
        approver: { select: { id: true, fullName: true, email: true } },
        details: { include: { item: { select: { id: true, code: true, name: true, unit: true } } } },
        reservations: { include: { location: true, item: true } },
        returnTransactions: {
          include: {
            receiver: { select: { id: true, fullName: true, email: true } },
            details: { include: { item: true } },
          },
        },
      },
    });

    if (!record) {
      throw new AppError('Phiếu mượn không tồn tại', 404);
    }

    if (currentUser.role === UserRole.STUDENT && record.borrowerId !== currentUser.id) {
      throw new AppError('Bạn không có quyền xem thông tin phiếu mượn này', 403);
    }

    return formatBorrowRequestResponse(record);
  }
}

export const borrowService = new BorrowService();

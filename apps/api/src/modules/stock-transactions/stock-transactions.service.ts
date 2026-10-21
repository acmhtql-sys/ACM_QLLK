import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { AppError } from '../../shared/AppError';
import {
  QueryStockTransactionsInput,
  PaginationMeta,
  StockTransactionSortField,
  SortOrder,
  ImportStockInput,
  ExportStockInput,
  TransferStockInput,
  AdjustStockInput,
  AdjustStockInputV2,
  StockTransactionType,
  calculateAvailableStock,
  validateStockInvariant,
} from '@acm/shared';
import { idempotencyService } from '../inventory/idempotency.service';
import {
  validateActiveItemAndLocation,
  sortLockOrder,
  validateMovementLedgerConsistency,
  generateTransactionNumber,
  withRetry,
} from '../inventory/inventory.helpers';

export class StockTransactionsService {
  /**
   * Retrieves paginated list of stock transactions with filters and search.
   */
  async listTransactions(
    query: QueryStockTransactionsInput
  ): Promise<{ transactions: any[]; meta: PaginationMeta }> {
    const where: Prisma.StockTransactionWhereInput = {};

    if (query.type) {
      where.type = query.type;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { transactionNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const sortBy = query.sortBy || StockTransactionSortField.CREATED_AT;
    const sortOrder = query.sortOrder || SortOrder.DESC;

    const [totalItems, txs] = await Promise.all([
      prisma.stockTransaction.count({ where }),
      prisma.stockTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          createdBy: { select: { id: true, fullName: true, email: true } },
          details: {
            include: {
              item: { select: { id: true, code: true, name: true, unit: true } },
              location: { select: { id: true, code: true, name: true, type: true } },
            },
          },
        },
      }),
    ]);

    const mapped = txs.map((t) => ({
      id: t.id,
      transactionNumber: t.transactionNumber,
      type: t.type,
      status: t.status,
      notes: t.notes,
      createdById: t.createdById,
      creatorName: t.createdBy?.fullName || '',
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      itemCount: t.details.length,
      totalQuantity: t.details.reduce((s, d) => s + d.quantity, 0),
      details: t.details,
    }));

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      transactions: mapped,
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
   * Retrieves single stock transaction details by ID.
   */
  async getTransactionById(id: string): Promise<any> {
    const tx = await prisma.stockTransaction.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
        details: {
          include: {
            item: { select: { id: true, code: true, name: true, unit: true } },
            location: { select: { id: true, code: true, name: true, type: true } },
          },
        },
      },
    });

    if (!tx) {
      throw new AppError('Không tìm thấy giao dịch kho yêu cầu', 404);
    }

    return {
      id: tx.id,
      transactionNumber: tx.transactionNumber,
      type: tx.type,
      status: tx.status,
      notes: tx.notes,
      createdById: tx.createdById,
      creatorName: tx.createdBy?.fullName || '',
      createdBy: tx.createdBy,
      createdAt: tx.createdAt.toISOString(),
      updatedAt: tx.updatedAt.toISOString(),
      itemCount: tx.details.length,
      totalQuantity: tx.details.reduce((s, d) => s + d.quantity, 0),
      details: tx.details,
    };
  }

  /**
   * Retrieves idempotency record status by key with strict owner-only security.
   * Step S2A Implementation:
   * - Strict owner check: returns 404 for non-existent or other user's key (anti-probing).
   * - Status mapping: COMMITTED, IN_PROGRESS, CONFIRMED_FAILED, EXPIRED, UNKNOWN.
   * - Priority: If COMPLETED and transaction exists, always reports COMMITTED even if expiresAt < NOW.
   * - Pure SELECT: Zero DB mutations, zero AuditLogs written.
   */
  async queryIdempotencyRecord(key: string, currentUserId: string): Promise<any> {
    const record = await prisma.idempotencyRecord.findUnique({
      where: { key },
      include: {
        transaction: {
          select: {
            id: true,
            transactionNumber: true,
            type: true,
            status: true,
            notes: true,
            createdAt: true,
            details: {
              select: {
                quantity: true,
              },
            },
          },
        },
      },
    });

    // 1. Uniform 404 for non-existent OR non-owner keys (Anti-probing defense)
    if (!record || record.userId !== currentUserId) {
      throw new AppError(
        'Không tìm thấy bản ghi giao dịch tương ứng với Idempotency-Key này trên máy chủ',
        404,
        {
          errorCode: 'IDEMPOTENCY_KEY_NOT_FOUND',
          status: 'UNKNOWN',
        }
      );
    }

    const isPastTtl = new Date() > new Date(record.expiresAt);

    // 2. Status A & F: COMPLETED with valid transaction (Priority: COMMITTED even if past TTL)
    if (record.status === 'COMPLETED' && record.transaction) {
      const details = record.transaction.details || [];
      return {
        key: record.key,
        status: 'COMMITTED',
        endpoint: record.endpoint,
        statusCode: record.statusCode || 201,
        transaction: {
          id: record.transaction.id,
          transactionNumber: record.transaction.transactionNumber,
          type: record.transaction.type,
          status: record.transaction.status,
          notes: record.transaction.notes,
          itemCount: details.length,
          totalQuantity: details.reduce((sum: number, d: any) => sum + d.quantity, 0),
          createdAt: record.transaction.createdAt.toISOString(),
        },
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      };
    }

    // 3. Status G: COMPLETED but missing transaction link -> inconsistent state
    if (record.status === 'COMPLETED' && !record.transaction) {
      logger.warn(`Idempotency record ${record.id} marked COMPLETED but missing transaction link`);
      return {
        key: record.key,
        status: 'UNKNOWN',
        endpoint: record.endpoint,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      };
    }

    // 4. Status F: Past TTL and not completed -> EXPIRED
    if (isPastTtl) {
      return {
        key: record.key,
        status: 'EXPIRED',
        endpoint: record.endpoint,
        statusCode: record.statusCode || 200,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      };
    }

    // 5. Status B: PENDING
    if (record.status === 'PENDING') {
      return {
        key: record.key,
        status: 'IN_PROGRESS',
        endpoint: record.endpoint,
        statusCode: 200,
        retryAfterSeconds: 2,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      };
    }

    // 6. Status C: FAILED
    if (record.status === 'FAILED') {
      return {
        key: record.key,
        status: 'CONFIRMED_FAILED',
        endpoint: record.endpoint,
        statusCode: record.statusCode || 400,
        error: {
          statusCode: record.statusCode || 400,
          errorCode: 'TRANSACTION_FAILED',
          message: 'Giao dịch trước đó đã bị từ chối do vi phạm quy tắc nghiệp vụ',
        },
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      };
    }

    // Fallback: UNKNOWN
    return {
      key: record.key,
      status: 'UNKNOWN',
      endpoint: record.endpoint,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
    };
  }

  /**
   * Performs an atomic stock import (IMPORT).
   * Validates items & locations, updates or creates stock balances, logs movements and audit log,
   * and completes idempotency record inside an atomic transaction.
   */
  async importStock(
    input: ImportStockInput,
    userId: string,
    idempotencyKey: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ cached: boolean; statusCode: number; data: any }> {
    const endpoint = '/api/v1/stock-transactions/import';

    // 1. Idempotency precheck
    const precheck = await idempotencyService.handlePrecheck(
      idempotencyKey,
      userId,
      endpoint,
      input,
      prisma
    );

    if (precheck.action === 'RETURN_CACHED') {
      return {
        cached: true,
        statusCode: precheck.statusCode || 200,
        data: precheck.cachedResponse,
      };
    }

    // 2. Execute within withRetry & Prisma transaction
    return await withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // Register or transition IdempotencyRecord to PENDING
        if (precheck.action === 'RETRY_PENDING' || precheck.action === 'RETRY_FAILED') {
          await tx.idempotencyRecord.update({
            where: { key: idempotencyKey },
            data: {
              status: 'PENDING',
              requestHash: precheck.requestHash,
              createdAt: new Date(),
              expiresAt: idempotencyService.getExpirationDate(24),
            },
          });
        } else {
          try {
            await tx.idempotencyRecord.create({
              data: {
                key: idempotencyKey,
                userId,
                endpoint,
                requestHash: precheck.requestHash,
                status: 'PENDING',
                expiresAt: idempotencyService.getExpirationDate(24),
              },
            });
          } catch (err: any) {
            if (idempotencyService.isIdempotencyKeyConflict(err)) {
              throw new AppError(
                'Yêu cầu với Idempotency-Key này đang được xử lý đồng thời, vui lòng thử lại sau',
                409
              );
            }
            throw err;
          }
        }

        // Validate all items and locations are active
        for (const item of input.items) {
          await validateActiveItemAndLocation(item.itemId, item.locationId, tx);
        }

        // Sort items deterministically to avoid deadlocks across concurrent requests
        const sortedItems = sortLockOrder(input.items);

        // Generate unique transaction number and create StockTransaction
        const transactionNumber = await generateTransactionNumber(StockTransactionType.IMPORT, tx);
        const stockTx = await tx.stockTransaction.create({
          data: {
            transactionNumber,
            type: StockTransactionType.IMPORT,
            status: 'COMPLETED',
            notes: input.notes || null,
            createdById: userId,
          },
        });

        const detailsCreated: any[] = [];

        for (const item of sortedItems) {
          // Acquire row-level lock on StockBalance
          let lockedRows: any[] = await tx.$queryRawUnsafe(
            `SELECT id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed"
             FROM "stock_balances"
             WHERE "itemId" = $1::uuid AND "locationId" = $2::uuid
             FOR UPDATE`,
            item.itemId,
            item.locationId
          );

          if (lockedRows.length === 0) {
            // Concurrency safe insertion: if another concurrent transaction creates the row first, DO NOTHING
            await tx.$executeRawUnsafe(
              `INSERT INTO "stock_balances" (id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 0, 0, 0, 0, 0, NOW(), NOW())
               ON CONFLICT ("itemId", "locationId") DO NOTHING`,
              item.itemId,
              item.locationId
            );

            // Re-acquire row-level lock on the row (guaranteed to exist now)
            lockedRows = await tx.$queryRawUnsafe(
              `SELECT id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed"
               FROM "stock_balances"
               WHERE "itemId" = $1::uuid AND "locationId" = $2::uuid
               FOR UPDATE`,
              item.itemId,
              item.locationId
            );
          }

          const row = lockedRows[0];
          const onHandBefore = row.onHand;
          const onHandAfter = onHandBefore + item.quantity;

          await tx.stockBalance.update({
            where: { id: row.id },
            data: { onHand: onHandAfter },
          });

          // Invariant & ledger validation
          validateMovementLedgerConsistency({
            type: StockTransactionType.IMPORT,
            quantityDelta: item.quantity,
            onHandBefore,
            onHandAfter,
          });

          // Create stock transaction detail
          const detail = await tx.stockTransactionDetail.create({
            data: {
              stockTransactionId: stockTx.id,
              itemId: item.itemId,
              locationId: item.locationId,
              quantity: item.quantity,
              unitCost: item.unitCost || null,
              notes: item.notes || null,
            },
          });
          detailsCreated.push(detail);

          // Create stock movement ledger entry
          await tx.stockMovement.create({
            data: {
              itemId: item.itemId,
              locationId: item.locationId,
              type: StockTransactionType.IMPORT,
              quantityDelta: item.quantity,
              onHandBefore,
              onHandAfter,
              referenceType: 'TRANSACTION',
              referenceId: stockTx.id,
              reason: item.notes || input.notes || 'Nhập kho',
              createdById: userId,
            },
          });
        }

        // Record AuditLog entry
        await tx.auditLog.create({
          data: {
            userId,
            action: 'IMPORT_STOCK',
            entity: 'StockTransaction',
            entityId: stockTx.id,
            newValue: {
              transactionNumber,
              type: 'IMPORT',
              itemCount: input.items.length,
              totalQuantity: input.items.reduce((s, it) => s + it.quantity, 0),
            },
            ipAddress: ipAddress || null,
            userAgent: userAgent || null,
          },
        });

        // Formulate complete response
        const responsePayload = {
          success: true,
          message: 'Nhập kho thành công',
          data: {
            id: stockTx.id,
            transactionNumber: stockTx.transactionNumber,
            type: stockTx.type,
            status: stockTx.status,
            notes: stockTx.notes,
            itemCount: input.items.length,
            totalQuantity: input.items.reduce((s, it) => s + it.quantity, 0),
            createdAt: stockTx.createdAt.toISOString(),
            details: detailsCreated.map((d) => ({
              id: d.id,
              itemId: d.itemId,
              locationId: d.locationId,
              quantity: d.quantity,
              unitCost: d.unitCost,
            })),
          },
        };

        // Mark IdempotencyRecord as COMPLETED
        await tx.idempotencyRecord.update({
          where: { key: idempotencyKey },
          data: {
            status: 'COMPLETED',
            transactionId: stockTx.id,
            responseBody: idempotencyService.sanitizeResponse(responsePayload),
            statusCode: 201,
          },
        });

        return {
          cached: false,
          statusCode: 201,
          data: responsePayload,
        };
      });
    });
  }

  /**
   * Performs an atomic stock export (EXPORT).
   * Validates items & locations, enforces available stock invariants with row-level locks,
   * decrements balances safely, logs movements and audit log, and completes idempotency record.
   */
  async exportStock(
    input: ExportStockInput,
    userId: string,
    idempotencyKey: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ cached: boolean; statusCode: number; data: any }> {
    const endpoint = '/api/v1/stock-transactions/export';

    // 1. Idempotency precheck
    const precheck = await idempotencyService.handlePrecheck(
      idempotencyKey,
      userId,
      endpoint,
      input,
      prisma
    );

    if (precheck.action === 'RETURN_CACHED') {
      return {
        cached: true,
        statusCode: precheck.statusCode || 200,
        data: precheck.cachedResponse,
      };
    }

    // 2. Execute within withRetry & Prisma transaction
    return await withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // Register or transition IdempotencyRecord to PENDING
        if (precheck.action === 'RETRY_PENDING' || precheck.action === 'RETRY_FAILED') {
          await tx.idempotencyRecord.update({
            where: { key: idempotencyKey },
            data: {
              status: 'PENDING',
              requestHash: precheck.requestHash,
              createdAt: new Date(),
              expiresAt: idempotencyService.getExpirationDate(24),
            },
          });
        } else {
          try {
            await tx.idempotencyRecord.create({
              data: {
                key: idempotencyKey,
                userId,
                endpoint,
                requestHash: precheck.requestHash,
                status: 'PENDING',
                expiresAt: idempotencyService.getExpirationDate(24),
              },
            });
          } catch (err: any) {
            if (idempotencyService.isIdempotencyKeyConflict(err)) {
              throw new AppError(
                'Yêu cầu với Idempotency-Key này đang được xử lý đồng thời, vui lòng thử lại sau',
                409
              );
            }
            throw err;
          }
        }

        // Validate all items and locations are active
        const entityMap = new Map<string, { item: any; location: any }>();
        for (const item of input.items) {
          const entities = await validateActiveItemAndLocation(item.itemId, item.locationId, tx);
          entityMap.set(`${item.itemId}:${item.locationId}`, entities);
        }

        // Sort items deterministically to avoid deadlocks across concurrent transactions
        const sortedItems = sortLockOrder(input.items);

        // Generate unique transaction number and create StockTransaction
        const transactionNumber = await generateTransactionNumber(StockTransactionType.EXPORT, tx);
        const stockTx = await tx.stockTransaction.create({
          data: {
            transactionNumber,
            type: StockTransactionType.EXPORT,
            status: 'COMPLETED',
            notes: input.notes || input.reason || null,
            createdById: userId,
          },
        });

        const detailsCreated: any[] = [];

        for (const item of sortedItems) {
          const entities = entityMap.get(`${item.itemId}:${item.locationId}`)!;

          // Acquire row-level lock on StockBalance
          const lockedRows: any[] = await tx.$queryRawUnsafe(
            `SELECT id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed"
             FROM "stock_balances"
             WHERE "itemId" = $1::uuid AND "locationId" = $2::uuid
             FOR UPDATE`,
            item.itemId,
            item.locationId
          );

          if (lockedRows.length === 0) {
            throw new AppError(
              `Linh kiện '${entities.item.code}' tại vị trí '${entities.location.code}' chưa có số dư tồn kho (Khả dụng: 0, Yêu cầu xuất: ${item.quantity})`,
              400
            );
          }

          const row = lockedRows[0];
          const onHand = row.onHand;
          const reserved = row.reserved;
          const quarantined = row.quarantined;
          const kitAllocated = row.kitAllocated;
          const borrowed = row.borrowed;

          // Compute Available stock strictly according to invariant
          const available = calculateAvailableStock({
            onHand,
            reserved,
            quarantined,
            kitAllocated,
            borrowed,
          });

          if (available < item.quantity) {
            throw new AppError(
              `Linh kiện '${entities.item.code}' tại vị trí '${entities.location.code}' không đủ tồn kho khả dụng để xuất (Khả dụng: ${available}, Yêu cầu xuất: ${item.quantity})`,
              400
            );
          }

          const onHandBefore = onHand;
          const onHandAfter = onHandBefore - item.quantity;

          // Invariant validation
          validateStockInvariant({
            onHand: onHandAfter,
            reserved,
            quarantined,
            kitAllocated,
            borrowed,
          });

          // Decrement balance safely
          await tx.stockBalance.update({
            where: { id: row.id },
            data: { onHand: onHandAfter },
          });

          // Validate movement ledger consistency
          validateMovementLedgerConsistency({
            type: StockTransactionType.EXPORT,
            quantityDelta: -item.quantity,
            onHandBefore,
            onHandAfter,
          });

          // Create stock transaction detail
          const detail = await tx.stockTransactionDetail.create({
            data: {
              stockTransactionId: stockTx.id,
              itemId: item.itemId,
              locationId: item.locationId,
              quantity: item.quantity,
              notes: item.notes || item.reason || null,
            },
          });
          detailsCreated.push(detail);

          // Create stock movement ledger entry
          const itemReason = item.reason || input.reason || item.notes || input.notes || 'Xuất kho';
          await tx.stockMovement.create({
            data: {
              itemId: item.itemId,
              locationId: item.locationId,
              type: StockTransactionType.EXPORT,
              quantityDelta: -item.quantity,
              onHandBefore,
              onHandAfter,
              referenceType: 'TRANSACTION',
              referenceId: stockTx.id,
              reason: itemReason,
              createdById: userId,
            },
          });
        }

        // Record AuditLog entry
        await tx.auditLog.create({
          data: {
            userId,
            action: 'EXPORT_STOCK',
            entity: 'StockTransaction',
            entityId: stockTx.id,
            newValue: {
              transactionNumber,
              type: 'EXPORT',
              itemCount: input.items.length,
              totalQuantity: input.items.reduce((s, it) => s + it.quantity, 0),
              reason: input.reason || null,
            },
            ipAddress: ipAddress || null,
            userAgent: userAgent || null,
          },
        });

        // Formulate complete response
        const responsePayload = {
          success: true,
          message: 'Xuất kho thành công',
          data: {
            id: stockTx.id,
            transactionNumber: stockTx.transactionNumber,
            type: stockTx.type,
            status: stockTx.status,
            notes: stockTx.notes,
            itemCount: input.items.length,
            totalQuantity: input.items.reduce((sum, it) => sum + it.quantity, 0),
            createdAt: stockTx.createdAt.toISOString(),
            details: detailsCreated.map((d) => ({
              id: d.id,
              itemId: d.itemId,
              locationId: d.locationId,
              quantity: d.quantity,
            })),
          },
        };

        // Mark IdempotencyRecord as COMPLETED
        await tx.idempotencyRecord.update({
          where: { key: idempotencyKey },
          data: {
            status: 'COMPLETED',
            transactionId: stockTx.id,
            responseBody: idempotencyService.sanitizeResponse(responsePayload),
            statusCode: 201,
          },
        });

        return {
          cached: false,
          statusCode: 201,
          data: responsePayload,
        };
      });
    });
  }

  /**
   * Performs an atomic stock transfer (TRANSFER).
   * Moves stock from source location to destination location.
   * Decrements source onHand, increments destination onHand (deltaSource + deltaDest = 0).
   * Validates available invariant at source, creates 2 StockMovements per item,
   * records toLocationId on detail, AuditLog, and completes idempotency record.
   */
  async transferStock(
    input: TransferStockInput,
    userId: string,
    idempotencyKey: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ cached: boolean; statusCode: number; data: any }> {
    const endpoint = '/api/v1/stock-transactions/transfer';

    // 1. Idempotency precheck
    const precheck = await idempotencyService.handlePrecheck(
      idempotencyKey,
      userId,
      endpoint,
      input,
      prisma
    );

    if (precheck.action === 'RETURN_CACHED') {
      return {
        cached: true,
        statusCode: precheck.statusCode || 200,
        data: precheck.cachedResponse,
      };
    }

    // 2. Execute within withRetry & Prisma transaction
    return await withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // Register or transition IdempotencyRecord to PENDING
        if (precheck.action === 'RETRY_PENDING' || precheck.action === 'RETRY_FAILED') {
          await tx.idempotencyRecord.update({
            where: { key: idempotencyKey },
            data: {
              status: 'PENDING',
              requestHash: precheck.requestHash,
              createdAt: new Date(),
              expiresAt: idempotencyService.getExpirationDate(24),
            },
          });
        } else {
          try {
            await tx.idempotencyRecord.create({
              data: {
                key: idempotencyKey,
                userId,
                endpoint,
                requestHash: precheck.requestHash,
                status: 'PENDING',
                expiresAt: idempotencyService.getExpirationDate(24),
              },
            });
          } catch (err: any) {
            if (idempotencyService.isIdempotencyKeyConflict(err)) {
              throw new AppError(
                'Yêu cầu với Idempotency-Key này đang được xử lý đồng thời, vui lòng thử lại sau',
                409
              );
            }
            throw err;
          }
        }

        // Normalize lines
        const lines = input.items.map((it) => {
          const fromLoc = it.fromLocationId || input.fromLocationId;
          const toLoc = it.toLocationId || input.toLocationId;
          if (!fromLoc || !toLoc) {
            throw new AppError('Vị trí nguồn và vị trí đích phải được xác định cho tất cả mặt hàng điều chuyển', 400);
          }
          if (fromLoc === toLoc) {
            throw new AppError('Vị trí nguồn và vị trí đích không được trùng nhau', 400);
          }
          return {
            itemId: it.itemId,
            fromLocationId: fromLoc,
            toLocationId: toLoc,
            quantity: it.quantity,
            notes: it.notes || null,
          };
        });

        // Validate all items and locations are active
        for (const line of lines) {
          await validateActiveItemAndLocation(line.itemId, line.fromLocationId, tx);
          await validateActiveItemAndLocation(line.itemId, line.toLocationId, tx);
        }

        // Collect all distinct (itemId, locationId) lock targets
        const uniqueTargetsMap = new Map<string, { itemId: string; locationId: string }>();
        for (const line of lines) {
          uniqueTargetsMap.set(`${line.itemId}:${line.fromLocationId}`, { itemId: line.itemId, locationId: line.fromLocationId });
          uniqueTargetsMap.set(`${line.itemId}:${line.toLocationId}`, { itemId: line.itemId, locationId: line.toLocationId });
        }
        const sortedLockTargets = sortLockOrder(Array.from(uniqueTargetsMap.values()));

        // Acquire row-level locks deterministically
        const lockedRowMap = new Map<string, any>();
        for (const target of sortedLockTargets) {
          let lockedRows: any[] = await tx.$queryRawUnsafe(
            `SELECT id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed"
             FROM "stock_balances"
             WHERE "itemId" = $1::uuid AND "locationId" = $2::uuid
             FOR UPDATE`,
            target.itemId,
            target.locationId
          );

          if (lockedRows.length === 0) {
            // Safe initial insert for destination if not yet existing
            await tx.$executeRawUnsafe(
              `INSERT INTO "stock_balances" (id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 0, 0, 0, 0, 0, NOW(), NOW())
               ON CONFLICT ("itemId", "locationId") DO NOTHING`,
              target.itemId,
              target.locationId
            );

            lockedRows = await tx.$queryRawUnsafe(
              `SELECT id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed"
               FROM "stock_balances"
               WHERE "itemId" = $1::uuid AND "locationId" = $2::uuid
               FOR UPDATE`,
              target.itemId,
              target.locationId
            );
          }
          lockedRowMap.set(`${target.itemId}:${target.locationId}`, lockedRows[0]);
        }

        // Generate unique transaction number
        const transactionNumber = await generateTransactionNumber(StockTransactionType.TRANSFER, tx);
        const stockTx = await tx.stockTransaction.create({
          data: {
            transactionNumber,
            type: StockTransactionType.TRANSFER,
            status: 'COMPLETED',
            notes: input.notes || input.reason || null,
            createdById: userId,
          },
        });

        const detailsCreated: any[] = [];

        for (const line of lines) {
          const srcRow = lockedRowMap.get(`${line.itemId}:${line.fromLocationId}`)!;
          const dstRow = lockedRowMap.get(`${line.itemId}:${line.toLocationId}`)!;

          const availableSrc = calculateAvailableStock({
            onHand: srcRow.onHand,
            reserved: srcRow.reserved,
            quarantined: srcRow.quarantined,
            kitAllocated: srcRow.kitAllocated,
            borrowed: srcRow.borrowed,
          });

          if (availableSrc < line.quantity) {
            throw new AppError(
              `Linh kiện tại vị trí nguồn không đủ tồn kho khả dụng để điều chuyển (Khả dụng: ${availableSrc}, Yêu cầu chuyển: ${line.quantity})`,
              400
            );
          }

          const srcOnHandBefore = srcRow.onHand;
          const srcOnHandAfter = srcOnHandBefore - line.quantity;

          validateStockInvariant({
            onHand: srcOnHandAfter,
            reserved: srcRow.reserved,
            quarantined: srcRow.quarantined,
            kitAllocated: srcRow.kitAllocated,
            borrowed: srcRow.borrowed,
          });

          await tx.stockBalance.update({
            where: { id: srcRow.id },
            data: { onHand: srcOnHandAfter },
          });
          srcRow.onHand = srcOnHandAfter;

          const dstOnHandBefore = dstRow.onHand;
          const dstOnHandAfter = dstOnHandBefore + line.quantity;

          await tx.stockBalance.update({
            where: { id: dstRow.id },
            data: { onHand: dstOnHandAfter },
          });
          dstRow.onHand = dstOnHandAfter;

          const detail = await tx.stockTransactionDetail.create({
            data: {
              stockTransactionId: stockTx.id,
              itemId: line.itemId,
              locationId: line.fromLocationId,
              toLocationId: line.toLocationId,
              quantity: line.quantity,
              notes: line.notes || null,
            },
          });
          detailsCreated.push(detail);

          validateMovementLedgerConsistency({
            type: StockTransactionType.TRANSFER,
            quantityDelta: -line.quantity,
            onHandBefore: srcOnHandBefore,
            onHandAfter: srcOnHandAfter,
          });

          await tx.stockMovement.create({
            data: {
              itemId: line.itemId,
              locationId: line.fromLocationId,
              type: StockTransactionType.TRANSFER,
              quantityDelta: -line.quantity,
              onHandBefore: srcOnHandBefore,
              onHandAfter: srcOnHandAfter,
              referenceType: 'TRANSACTION',
              referenceId: stockTx.id,
              reason: input.reason || line.notes || 'Điều chuyển đi',
              createdById: userId,
            },
          });

          validateMovementLedgerConsistency({
            type: StockTransactionType.TRANSFER,
            quantityDelta: line.quantity,
            onHandBefore: dstOnHandBefore,
            onHandAfter: dstOnHandAfter,
          });

          await tx.stockMovement.create({
            data: {
              itemId: line.itemId,
              locationId: line.toLocationId,
              type: StockTransactionType.TRANSFER,
              quantityDelta: line.quantity,
              onHandBefore: dstOnHandBefore,
              onHandAfter: dstOnHandAfter,
              referenceType: 'TRANSACTION',
              referenceId: stockTx.id,
              reason: input.reason || line.notes || 'Điều chuyển đến',
              createdById: userId,
            },
          });
        }

        // Record AuditLog
        await tx.auditLog.create({
          data: {
            userId,
            action: 'STOCK_TRANSFER',
            entity: 'StockTransaction',
            entityId: stockTx.id,
            newValue: {
              transactionNumber,
              type: 'TRANSFER',
              itemCount: lines.length,
              totalQuantity: lines.reduce((s, it) => s + it.quantity, 0),
              reason: input.reason || null,
            },
            ipAddress: ipAddress || null,
            userAgent: userAgent || null,
          },
        });

        // Formulate response
        const responsePayload = {
          success: true,
          message: 'Điều chuyển kho thành công',
          data: {
            id: stockTx.id,
            transactionNumber: stockTx.transactionNumber,
            type: stockTx.type,
            status: stockTx.status,
            notes: stockTx.notes,
            itemCount: lines.length,
            totalQuantity: lines.reduce((s, it) => s + it.quantity, 0),
            createdAt: stockTx.createdAt.toISOString(),
            details: detailsCreated.map((d) => ({
              id: d.id,
              itemId: d.itemId,
              locationId: d.locationId,
              toLocationId: d.toLocationId,
              quantity: d.quantity,
            })),
          },
        };

        await tx.idempotencyRecord.update({
          where: { key: idempotencyKey },
          data: {
            status: 'COMPLETED',
            transactionId: stockTx.id,
            responseBody: idempotencyService.sanitizeResponse(responsePayload),
            statusCode: 201,
          },
        });

        return {
          cached: false,
          statusCode: 201,
          data: responsePayload,
        };
      });
    });
  }

  /**
   * Performs an atomic stock adjustment (ADJUSTMENT).
   * Aligns actual counted physical inventory with system onHand balance.
   * If actualOnHand < currentOnHand, ensures actualOnHand >= reserved + quarantined + kitAllocated.
   * Logs movements only for items with non-zero delta, creates AuditLog, and completes idempotency record.
   */
  async adjustStock(
    input: AdjustStockInput | AdjustStockInputV2,
    userId: string,
    idempotencyKey: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ cached: boolean; statusCode: number; data: any }> {
    const endpoint = '/api/v1/stock-transactions/adjustment';

    // 1. Idempotency precheck
    const precheck = await idempotencyService.handlePrecheck(
      idempotencyKey,
      userId,
      endpoint,
      input,
      prisma
    );

    if (precheck.action === 'RETURN_CACHED') {
      return {
        cached: true,
        statusCode: precheck.statusCode || 200,
        data: precheck.cachedResponse,
      };
    }

    // 2. Execute within withRetry & Prisma transaction
    return await withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // Register or transition IdempotencyRecord to PENDING
        if (precheck.action === 'RETRY_PENDING' || precheck.action === 'RETRY_FAILED') {
          await tx.idempotencyRecord.update({
            where: { key: idempotencyKey },
            data: {
              status: 'PENDING',
              requestHash: precheck.requestHash,
              createdAt: new Date(),
              expiresAt: idempotencyService.getExpirationDate(24),
            },
          });
        } else {
          try {
            await tx.idempotencyRecord.create({
              data: {
                key: idempotencyKey,
                userId,
                endpoint,
                requestHash: precheck.requestHash,
                status: 'PENDING',
                expiresAt: idempotencyService.getExpirationDate(24),
              },
            });
          } catch (err: any) {
            if (idempotencyService.isIdempotencyKeyConflict(err)) {
              throw new AppError(
                'Yêu cầu với Idempotency-Key này đang được xử lý đồng thời, vui lòng thử lại sau',
                409
              );
            }
            throw err;
          }
        }

        // Normalize lines
        const lines = input.items.map((it: any) => {
          const locId = it.locationId || input.locationId;
          if (!locId) {
            throw new AppError('Vị trí kho phải được cung cấp ở cấp phiếu hoặc trên từng dòng mặt hàng', 400);
          }
          return {
            itemId: it.itemId,
            locationId: locId,
            expectedOnHand: it.expectedOnHand,
            expectedReserved: it.expectedReserved,
            expectedQuarantined: it.expectedQuarantined,
            expectedKitAllocated: it.expectedKitAllocated,
            actualOnHand: it.actualOnHand,
            reason: it.reason || input.reason || null,
            notes: it.notes || null,
          };
        });

        // Check for duplicates
        const seen = new Set<string>();
        for (const l of lines) {
          const k = `${l.itemId}:${l.locationId}`;
          if (seen.has(k)) {
            throw new AppError(`Không chấp nhận các dòng trùng linh kiện và vị trí trong cùng chứng từ điều chỉnh (${l.itemId})`, 400);
          }
          seen.add(k);
        }

        // Validate active items and locations
        for (const line of lines) {
          await validateActiveItemAndLocation(line.itemId, line.locationId, tx);
        }

        // Sort locks deterministically
        const sortedLines = sortLockOrder(lines);

        // Lock all balance rows
        const lockedRowMap = new Map<string, any>();
        for (const line of sortedLines) {
          let lockedRows: any[] = await tx.$queryRawUnsafe(
            `SELECT id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed"
             FROM "stock_balances"
             WHERE "itemId" = $1::uuid AND "locationId" = $2::uuid
             FOR UPDATE`,
            line.itemId,
            line.locationId
          );

          if (lockedRows.length === 0) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "stock_balances" (id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed", "createdAt", "updatedAt")
               VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 0, 0, 0, 0, 0, NOW(), NOW())
               ON CONFLICT ("itemId", "locationId") DO NOTHING`,
              line.itemId,
              line.locationId
            );

            lockedRows = await tx.$queryRawUnsafe(
              `SELECT id, "itemId", "locationId", "onHand", "reserved", "quarantined", "kitAllocated", "borrowed"
               FROM "stock_balances"
               WHERE "itemId" = $1::uuid AND "locationId" = $2::uuid
               FOR UPDATE`,
              line.itemId,
              line.locationId
            );
          }
          lockedRowMap.set(`${line.itemId}:${line.locationId}`, lockedRows[0]);
        }

        // Validate Snapshot for Concurrency Protection (Step S2B)
        for (const line of lines) {
          const row = lockedRowMap.get(`${line.itemId}:${line.locationId}`)!;

          // Enforce presence of snapshot fields (Snapshot V2)
          if (
            line.expectedOnHand === undefined ||
            line.expectedReserved === undefined ||
            line.expectedQuarantined === undefined ||
            line.expectedKitAllocated === undefined
          ) {
            throw new AppError(
              'Yêu cầu snapshot tồn kho đầy đủ (expectedOnHand, expectedReserved, expectedQuarantined, expectedKitAllocated) để kiểm soát tương tranh',
              422
            );
          }

          const isSnapshotMismatch =
            row.onHand !== line.expectedOnHand ||
            row.reserved !== line.expectedReserved ||
            row.quarantined !== line.expectedQuarantined ||
            row.kitAllocated !== line.expectedKitAllocated;

          if (isSnapshotMismatch) {
            throw new AppError(
              `Số dư tồn kho của linh kiện '${line.itemId}' tại vị trí '${line.locationId}' đã bị thay đổi bởi giao dịch đồng thời khác. Vui lòng tải lại số dư mới nhất và lập lại phiếu kiểm kê.`,
              409,
              {
                errorCode: 'CONCURRENT_STOCK_MODIFICATION',
                conflict: {
                  itemId: line.itemId,
                  locationId: line.locationId,
                  expectedSnapshot: {
                    onHand: line.expectedOnHand,
                    reserved: line.expectedReserved,
                    quarantined: line.expectedQuarantined,
                    kitAllocated: line.expectedKitAllocated,
                  },
                  currentSnapshot: {
                    onHand: row.onHand,
                    reserved: row.reserved,
                    quarantined: row.quarantined,
                    kitAllocated: row.kitAllocated,
                  },
                },
                resolution:
                  'Tồn kho trên hệ thống đã bị thay đổi bởi giao dịch khác trong quá trình kiểm kê. Vui lòng tải lại số dư mới nhất và thực hiện kiểm kê lại.',
              }
            );
          }
        }

        // Validate adjustments & check for non-zero discrepancy
        let nonZeroDeltasCount = 0;
        for (const line of lines) {
          const row = lockedRowMap.get(`${line.itemId}:${line.locationId}`)!;
          const currentOnHand = row.onHand;
          const delta = line.actualOnHand - currentOnHand;
          if (delta !== 0) nonZeroDeltasCount++;

          if (delta < 0) {
            const committedStock = row.reserved + row.quarantined + row.kitAllocated;
            if (line.actualOnHand < committedStock) {
              throw new AppError(
                `Không thể điều chỉnh tồn kho vật lý (${line.actualOnHand}) nhỏ hơn số lượng đã cam kết (${committedStock} = Reserved: ${row.reserved} + Quarantined: ${row.quarantined} + KitAllocated: ${row.kitAllocated})`,
                400
              );
            }
          }
        }

        if (nonZeroDeltasCount === 0) {
          throw new AppError(
            'Tồn kho thực tế của tất cả mặt hàng đều khớp với số dư trên hệ thống (delta = 0). Không có chênh lệch tồn kho nào cần điều chỉnh.',
            400
          );
        }

        // Generate transaction number
        const transactionNumber = await generateTransactionNumber(StockTransactionType.ADJUSTMENT, tx);
        const stockTx = await tx.stockTransaction.create({
          data: {
            transactionNumber,
            type: StockTransactionType.ADJUSTMENT,
            status: 'COMPLETED',
            notes: input.notes || input.reason || null,
            createdById: userId,
          },
        });

        const detailsCreated: any[] = [];
        for (const line of lines) {
          const row = lockedRowMap.get(`${line.itemId}:${line.locationId}`)!;
          const currentOnHand = row.onHand;
          const delta = line.actualOnHand - currentOnHand;

          if (delta === 0) continue;

          await tx.stockBalance.update({
            where: { id: row.id },
            data: { onHand: line.actualOnHand },
          });

          const detail = await tx.stockTransactionDetail.create({
            data: {
              stockTransactionId: stockTx.id,
              itemId: line.itemId,
              locationId: line.locationId,
              quantity: Math.abs(delta),
              notes: line.notes || line.reason || `Điều chỉnh từ ${currentOnHand} thành ${line.actualOnHand} (chênh lệch: ${delta > 0 ? '+' : ''}${delta})`,
            },
          });
          detailsCreated.push(detail);

          // Only record movement if delta !== 0
          if (delta !== 0) {
            validateMovementLedgerConsistency({
              type: StockTransactionType.ADJUSTMENT,
              quantityDelta: delta,
              onHandBefore: currentOnHand,
              onHandAfter: line.actualOnHand,
            });

            await tx.stockMovement.create({
              data: {
                itemId: line.itemId,
                locationId: line.locationId,
                type: StockTransactionType.ADJUSTMENT,
                quantityDelta: delta,
                onHandBefore: currentOnHand,
                onHandAfter: line.actualOnHand,
                referenceType: 'TRANSACTION',
                referenceId: stockTx.id,
                reason: line.reason || input.reason || 'Kiểm kê điều chỉnh tồn kho',
                createdById: userId,
              },
            });
          }
        }

        // Record AuditLog
        await tx.auditLog.create({
          data: {
            userId,
            action: 'STOCK_ADJUSTMENT',
            entity: 'StockTransaction',
            entityId: stockTx.id,
            newValue: {
              transactionNumber,
              type: 'ADJUSTMENT',
              itemCount: detailsCreated.length,
              adjustedItemsCount: nonZeroDeltasCount,
              reason: input.reason || null,
            },
            ipAddress: ipAddress || null,
            userAgent: userAgent || null,
          },
        });

        const responsePayload = {
          success: true,
          message: 'Điều chỉnh tồn kho thành công',
          data: {
            id: stockTx.id,
            transactionNumber: stockTx.transactionNumber,
            type: stockTx.type,
            status: stockTx.status,
            notes: stockTx.notes,
            itemCount: detailsCreated.length,
            adjustedItemsCount: nonZeroDeltasCount,
            createdAt: stockTx.createdAt.toISOString(),
            details: detailsCreated.map((d) => ({
              id: d.id,
              itemId: d.itemId,
              locationId: d.locationId,
              quantity: d.quantity,
              notes: d.notes,
            })),
          },
        };

        await tx.idempotencyRecord.update({
          where: { key: idempotencyKey },
          data: {
            status: 'COMPLETED',
            transactionId: stockTx.id,
            responseBody: idempotencyService.sanitizeResponse(responsePayload),
            statusCode: 201,
          },
        });

        return {
          cached: false,
          statusCode: 201,
          data: responsePayload,
        };
      });
    });
  }
}

export const stockTransactionsService = new StockTransactionsService();

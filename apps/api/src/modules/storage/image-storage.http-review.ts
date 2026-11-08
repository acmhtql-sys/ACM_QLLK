/**
 * L4 experimental HTTP candidate for synthetic local-only image fixtures.
 *
 * UNMOUNTED BY DESIGN. This module is NOT imported by app.ts or items.router.
 * The router installs the existing ACM JWT + current-DB-role `authenticate`
 * middleware itself, before RBAC and before any body parsing. This remains
 * an UNMOUNTED review candidate pending item audit/retention/scan/owner signoff.
 *
 * No filesystem or cloud provider is instantiated by this router. All actual
 * data operations are delegated to an injected ItemImageStorageProvider.
 */
import express, { Router, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { UserRole } from '@prisma/client';
import { authorizeRoles } from '../../middleware/rbac';
import { authenticate } from '../../middleware/auth';
import { AppError } from '../../shared/AppError';
import { ItemImageAuditSink, ItemImageAuditAction } from './image-storage.audit.contract';
import {
  ImageStorageValidationError,
  ItemImageStorageProvider,
  AllowedImageMime,
  MAX_ITEM_IMAGE_BYTES,
} from './image-storage.contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

const readItemId = (value: unknown): string => {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new AppError('Mã linh kiện không hợp lệ', 422);
  }
  return value.toLowerCase();
};

const requireLocalReviewMode = (
  _req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!isLocalImageHttpReviewEnabled()) {
    return next(new AppError('Không có endpoint hình ảnh local', 404));
  }
  next();
};

/**
 * Do NOT accept a caller-supplied configuration object: the actual process
 * environment is authoritative, and TEST/CLOUD/PRODUCTION must fail closed.
 */
export function isLocalImageHttpReviewEnabled(): boolean {
  return process.env.NODE_ENV === 'development' &&
    process.env.ACM_DEPLOYMENT_PROFILE === 'local_dev' &&
    process.env.ACM_LOCAL_IMAGE_STORAGE_ENABLED === 'true' &&
    process.env.ACM_LOCAL_IMAGE_HTTP_REVIEW_ENABLED === 'true';
}

export interface ItemImageReviewDependencies {
  storage: ItemImageStorageProvider;
  /** MUST resolve this from a trusted backend/DB source, never browser input. */
  isActiveItem: (itemId: string) => Promise<boolean>;
  /** Required, fail-closed. Actual durable implementation still needs approval. */
  audit: ItemImageAuditSink;
}

const localParserError: ErrorRequestHandler = (error, _req, res, next) => {
  if ((error as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ success: false, message: 'Hình ảnh vượt giới hạn 5 MiB' });
    return;
  }
  if ((error as { type?: string }).type === 'encoding.unsupported') {
    res.status(415).json({ success: false, message: 'Không hỗ trợ nội dung nén' });
    return;
  }
  next(error);
};

/**
 * Future mount point candidate: /api/v1/local-review-images
 *
 * Routes (router itself includes mandatory authenticate; still UNMOUNTED):
 * POST /:itemId           raw image/png|jpeg|webp, X-File-Name
 * GET  /:itemId/:imageId  private binary download, no public image URL
 *
 * There is no DELETE route: deletion/retention/audit policy is not approved.
 * Even on localhost, this must remain a test-only review surface.
 */
export function createLocalItemImageReviewRouter(
  { storage, isActiveItem, audit }: ItemImageReviewDependencies
): Router {
  if (!audit || typeof audit.record !== 'function') {
    throw new Error('LOCAL_IMAGE_AUDIT_SINK_REQUIRED');
  }
  const router = Router();
  router.use(requireLocalReviewMode);
  // Always authenticate with ACM's real JWT + live user status/role; any
  // upstream req.user alone must never authorize a local-image operation.
  router.use(authenticate);
  router.use(authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER));

  const auditImage = async (
    action: ItemImageAuditAction,
    actorId: string,
    itemId: string,
    imageId: string,
    sha256: string,
    byteLength: number
  ): Promise<void> => {
    // No raw file bytes, filename, authorization header or client role in logs.
    await audit.record({
      action, actorId, itemId, imageId, sha256, byteLength,
      recordedAt: new Date().toISOString(),
    });
  };

  const verifyItem = async (itemId: string): Promise<void> => {
    if (!(await isActiveItem(itemId))) {
      throw new AppError('Không tìm thấy linh kiện đang hoạt động', 404);
    }
  };

  router.post(
    '/:itemId',
    // Parse only after the explicit environment gate and role guard.
    express.raw({
      type: 'image/*',
      inflate: false,
      limit: MAX_ITEM_IMAGE_BYTES,
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const itemId = readItemId(req.params.itemId);
        const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        if (!contentType || !ALLOWED_MIMES.includes(contentType)) {
          throw new AppError('Chỉ nhận PNG, JPEG hoặc WebP', 415);
        }
        if (!Buffer.isBuffer(req.body)) {
          throw new AppError('Thiếu nội dung hình ảnh hợp lệ', 422);
        }
        const originalName = req.headers['x-file-name'];
        if (typeof originalName !== 'string') {
          throw new AppError('Thiếu tên tệp hợp lệ', 422);
        }
        const actorId = req.user!.id; // Derived from mandatory authenticate above
        await verifyItem(itemId);
        const saved = await storage.save({
          itemId,
          uploadedById: actorId,
          originalName,
          mimeType: contentType as AllowedImageMime,
          contents: req.body,
        });
        try {
          await auditImage('IMAGE_UPLOAD', actorId, itemId, saved.id, saved.sha256, saved.byteLength);
        } catch (_auditError) {
          // Compensating deletion is best effort, not a database transaction.
          // Never acknowledge an unaudited upload even if cleanup also fails.
          await storage.deleteForItem(itemId, saved.id).catch(() => false);
          throw new AppError('Không thể ghi nhận nhật ký tải hình ảnh', 503);
        }
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(201).json({ success: true, data: saved });
      } catch (error) {
        next(error instanceof ImageStorageValidationError
          ? new AppError(error.message, 422) : error);
      }
    }
  );
  router.get('/:itemId/:imageId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const itemId = readItemId(req.params.itemId);
      if (!UUID.test(req.params.imageId)) {
        throw new AppError('Mã hình ảnh không hợp lệ', 422);
      }
      await verifyItem(itemId);
      const record = await storage.readForItem(itemId, req.params.imageId);
      if (!record) {
        throw new AppError('Không tìm thấy hình ảnh của linh kiện', 404);
      }
      try {
        await auditImage(
          'IMAGE_READ', req.user!.id, itemId, record.metadata.id,
          record.metadata.sha256, record.metadata.byteLength
        );
      } catch (_auditError) {
        // Do not release image bytes if its read-access event was not recorded.
        throw new AppError('Không thể ghi nhận nhật ký truy cập hình ảnh', 503);
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', record.metadata.mimeType);
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).end(Buffer.from(record.contents));
    } catch (error) {
      next(error);
    }
  });
  router.use(localParserError);
  return router;
}

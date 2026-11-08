/**
 * L4 experimental HTTP candidate for synthetic local-only image fixtures.
 *
 * UNMOUNTED BY DESIGN. This module is NOT imported by app.ts or items.router.
 * The future integrator must provide the REAL `authenticate` middleware
 * upstream, an authenticated/audited item lookup, retention/cleanup, antivirus
 * and independent AppSec/owner approval before it can become an operational API.
 *
 * No filesystem or cloud provider is instantiated by this router. All actual
 * data operations are delegated to an injected ItemImageStorageProvider.
 */
import express, { Router, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { UserRole } from '@prisma/client';
import { authorizeRoles } from '../../middleware/rbac';
import { AppError } from '../../shared/AppError';
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
 * Routes (only if explicitly mounted AFTER real authenticate):
 * POST /:itemId           raw image/png|jpeg|webp, X-File-Name
 * GET  /:itemId/:imageId  private binary download, no public image URL
 *
 * There is no DELETE route: deletion/retention/audit policy is not approved.
 * Even on localhost, this must remain a test-only review surface.
 */
export function createLocalItemImageReviewRouter(
  { storage, isActiveItem }: ItemImageReviewDependencies
): Router {
  const router = Router();
  router.use(requireLocalReviewMode);
  router.use(authorizeRoles(UserRole.ADMIN, UserRole.LAB_MANAGER));

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
        const actorId = req.user!.id; // Real JWT middleware REQUIRED before mount
        await verifyItem(itemId);
        const saved = await storage.save({
          itemId,
          uploadedById: actorId,
          originalName,
          mimeType: contentType as AllowedImageMime,
          contents: req.body,
        });
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

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/AppError';
import { logger } from '../config/logger';
import { ZodError } from 'zod';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): Response {
  // Redact potential connection strings containing passwords from logs
  const sanitizedMessage = String(err.message || '').replace(
    /postgresql:\/\/[^:]+:[^@]+@/g,
    'postgresql://***:***@'
  );
  logger.error(`Unhandled error: ${sanitizedMessage}`);

  // Compressed request bodies are intentionally unsupported. Respond with 415
  // (not an internal 500) without echoing raw parser errors or request data.
  if (err?.type === 'encoding.unsupported') {
    return res.status(415).json({
      success: false,
      message: 'Nội dung yêu cầu đã nén không được hỗ trợ.',
    });
  }

  // Custom AppError
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  }

  // Zod Validation Error
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      message: 'Dữ liệu đầu vào không hợp lệ',
      details: err.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Prisma Database Connection / Initialization Errors
  if (
    err.name === 'PrismaClientInitializationError' ||
    err.code === 'P1000' ||
    err.code === 'P1001'
  ) {
    return res.status(503).json({
      success: false,
      message: 'Dịch vụ cơ sở dữ liệu hiện không khả dụng. Vui lòng kiểm tra kết nối database.',
    });
  }

  // Prisma Known Request Errors
  if (err.code && typeof err.code === 'string' && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Dữ liệu đã tồn tại trong hệ thống (vi phạm ràng buộc duy nhất)',
        fields: err.meta?.target,
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy bản ghi yêu cầu',
      });
    }
  }

  // Internal Server Error Fallback
  return res.status(500).json({
    success: false,
    message: 'Đã xảy ra lỗi máy chủ nội bộ',
  });
}

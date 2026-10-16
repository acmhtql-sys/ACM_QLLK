import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export interface RateLimiterOptions {
  windowMs?: number; // Time window in milliseconds (default: 15 minutes)
  max?: number; // Max requests per window per IP (default: 5)
  message?: string;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
}

interface ClientRecord {
  count: number;
  firstRequestAt: number;
  resetAt: number;
}

/**
 * Creates an in-memory sliding-window rate limiter middleware for authentication endpoints.
 * Thread-safe for single Node.js runtime process, zero external dependencies.
 */
export function createLoginRateLimiter(options: RateLimiterOptions = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
  const max = options.max !== undefined ? options.max : 5; // 5 attempts default
  const message =
    options.message ||
    'Quá nhiều yêu cầu đăng nhập từ địa chỉ IP này. Vui lòng thử lại sau 15 phút.';

  const defaultKeyGen = (req: Request): string => {
    // Prefer x-forwarded-for header (first IP if comma separated), fallback to req.ip or socket remoteAddress
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const firstIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
        .split(',')[0]
        .trim();
      if (firstIp) return firstIp;
    }
    return req.ip || req.socket?.remoteAddress || '127.0.0.1';
  };

  const keyGen = options.keyGenerator || defaultKeyGen;

  // In-memory store for client hit counts
  const hits = new Map<string, ClientRecord>();

  // Periodic cleanup of expired records every 60 seconds
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetAt) {
        hits.delete(key);
      }
    }
  }, 60000);

  // Unref interval so it does not block Node.js event loop shutdown
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGen(req);
    const now = Date.now();

    let record = hits.get(key);

    if (!record || now > record.resetAt) {
      // First request or window expired
      record = {
        count: 1,
        firstRequestAt: now,
        resetAt: now + windowMs,
      };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);

    // Set standard rate limit headers
    res.setHeader('X-RateLimit-Limit', max.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString());

    if (record.count > max) {
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      logger.warn(
        `[RateLimit] IP ${key} exceeded login rate limit (${record.count}/${max}). Retry in ${retryAfterSeconds}s.`
      );

      res.status(429).json({
        success: false,
        message,
        retryAfterSeconds,
      });
      return;
    }

    next();
  };

  // Helper method to reset hit count (used in tests or manual unblock)
  middleware.reset = (targetKey?: string) => {
    if (targetKey) {
      hits.delete(targetKey);
    } else {
      hits.clear();
    }
  };

  middleware.getRecord = (targetKey: string): ClientRecord | undefined => {
    return hits.get(targetKey);
  };

  middleware.destroy = () => {
    clearInterval(cleanupInterval);
    hits.clear();
  };

  return middleware;
}

/**
 * Default Login Rate Limiter instance: 5 attempts per 15 minutes per IP.
 */
export const loginRateLimiter = createLoginRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Quá nhiều yêu cầu đăng nhập từ địa chỉ IP này. Vui lòng thử lại sau 15 phút.',
});

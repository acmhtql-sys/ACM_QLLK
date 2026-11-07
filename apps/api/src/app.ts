import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './modules/health/health.router';
import { authRouter } from './modules/auth/auth.router';
import { usersRouter } from './modules/users/users.router';
import { categoriesRouter } from './modules/categories/categories.router';
import { itemsRouter } from './modules/items/items.router';
import { locationsRouter } from './modules/locations/locations.router';
import { inventoryRouter } from './modules/inventory/inventory.router';
import { stockTransactionsRouter } from './modules/stock-transactions/stock-transactions.router';
import { stockMovementsRouter } from './modules/stock-movements/stock-movements.router';
import { borrowRouter } from './modules/borrow/borrow.router';
import { reportsRouter } from './modules/reports/reports.router';
import { auditLogsRouter } from './modules/audit-logs/audit-logs.router';
import { cloudStagingReadOnlyMiddleware, StagingReadOnlyOptions } from './middleware/cloudStagingReadOnly';

export function createApp(options?: { stagingReadOnly?: StagingReadOnlyOptions }): Express {
  const app = express();

  // Only trust the single hosting proxy in cloud staging. Rate limiting uses req.ip,
  // never a raw client-supplied X-Forwarded-For value.
  app.set('trust proxy', env.ACM_DEPLOYMENT_PROFILE === 'cloud_staging' ? 1 : false);

  // Basic security and parsing middleware
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  // Reject compressed request bodies before body-parser decompresses them.
  // Mitigates GHSA-27r3-jxmh-p828 (body-parser 1.20.x) without upgrading
  // Express / parser major versions during the staging review window.
  app.use(express.json({ inflate: false, limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, inflate: false, limit: '100kb' }));

  if (env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Cloud Staging Read-Only Protection Middleware (Fail-Closed)
  app.use(cloudStagingReadOnlyMiddleware(options?.stagingReadOnly));

  // API prefix
  const prefix = env.API_PREFIX; // default /api/v1


  // Routes registration
  app.use(`${prefix}/health`, healthRouter);
  app.use(`${prefix}/auth`, authRouter);
  app.use(`${prefix}/users`, usersRouter);
  app.use(`${prefix}/categories`, categoriesRouter);
  app.use(`${prefix}/items`, itemsRouter);
  app.use(`${prefix}/locations`, locationsRouter);
  app.use(`${prefix}/inventory`, inventoryRouter);
  app.use(`${prefix}/stock-transactions`, stockTransactionsRouter);
  app.use(`${prefix}/stock-movements`, stockMovementsRouter);
  app.use(`${prefix}/borrow-requests`, borrowRouter);
  app.use(`${prefix}/reports`, reportsRouter);
  app.use(`${prefix}/audit-logs`, auditLogsRouter);

  // 404 Catch-all handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: `Tài nguyên không tồn tại: ${req.method} ${req.originalUrl}`,
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

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
import { kitsRouter } from './modules/kits/kits.router';
import { cloudStagingReadOnlyMiddleware, StagingReadOnlyOptions } from './middleware/cloudStagingReadOnly';

export function createApp(options?: { stagingReadOnly?: StagingReadOnlyOptions }): Express {
  const app = express();

  // Basic security and parsing middleware
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
  app.use(`${prefix}/kits`, kitsRouter);
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

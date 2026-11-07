import { Request, Response, NextFunction } from 'express';
import { ZodObject } from 'zod';

export function validateRequest(schema: {
  body?: ZodObject;
  query?: ZodObject;
  params?: ZodObject;
}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.query) {
        req.query = (await schema.query.parseAsync(req.query)) as unknown as Request['query'];
      }
      if (schema.params) {
        req.params = (await schema.params.parseAsync(req.params)) as unknown as Request['params'];
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

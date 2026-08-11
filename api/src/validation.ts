import { Response } from 'express';
import { z } from 'zod';

export function parseRequest<T extends z.ZodType>(schema: T, value: unknown, res: Response): z.infer<T> | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid request',
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
    });
    return null;
  }
  return parsed.data;
}

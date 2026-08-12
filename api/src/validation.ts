import { Response } from 'express';
import { z } from 'zod';

export const positiveIdSchema = z.coerce.number().int().positive();
export const emptyBodySchema = z.object({}).strict().optional();
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z0-9]+$/;

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

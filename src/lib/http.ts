import type { Request, Response, NextFunction } from 'express';

/** Lets an async handler reject without taking the process down. */
export function wrap(
  fn: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => { void fn(req, res).catch(next); };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (why: string) => new HttpError(400, why);
/** The request was valid; the world changed under it — stock ran out mid-checkout. */
export const conflict = (why: string) => new HttpError(409, why);

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export function int(v: unknown): number | undefined {
  const n = Number(str(v));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** Money arrives from clients as rupees and is held as paise everywhere else. */
export function rupeesToPaise(v: unknown): number | undefined {
  const n = Number(str(v));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

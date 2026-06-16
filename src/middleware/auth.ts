import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload, TenantTokenPayload } from '../lib/jwt';

export function requireOwnerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7)) as TokenPayload;
    if (payload.role !== 'owner') throw new Error('Not owner token');
    (req as any).owner = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireTenantAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing tenant token' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7)) as TenantTokenPayload;
    if (!['admin', 'cashier', 'captain'].includes(payload.role)) {
      throw new Error('Not a tenant token');
    }
    (req as any).tenant = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired tenant token' });
  }
}

export function requireTenantAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7)) as TenantTokenPayload;
    if (payload.role !== 'admin') throw new Error('Not admin token');
    (req as any).tenant = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

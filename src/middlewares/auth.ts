import { Request, Response, NextFunction } from 'express';
import { verifyTokenRaw } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request { user?: { id: string; role: string }; }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ message: 'Falta token Bearer' });
  try {
    req.user = verifyTokenRaw(h.split(' ')[1]);
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Acceso denegado' });
    }
    next();
  };
}
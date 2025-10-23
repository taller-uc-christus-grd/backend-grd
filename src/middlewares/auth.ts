import { Request, Response, NextFunction } from 'express';
import { verifyTokenRaw } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Falta token Bearer' });
  }
  const token = auth.split(' ')[1];
  try {
    const decoded = verifyTokenRaw(token);
    req.user = decoded;
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
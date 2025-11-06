import { Request, Response, NextFunction } from 'express';
import { verifyTokenRaw } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Falta token Bearer' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = verifyTokenRaw(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'No autenticado' });
    }

    // Normalizar roles a mayúsculas para comparación
    const userRoleUpper = req.user.role.toUpperCase();
    const rolesUpper = roles.map(r => r.toUpperCase());

    if (!rolesUpper.includes(userRoleUpper)) {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    next();
  };
}
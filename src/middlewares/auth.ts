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

// Función para normalizar roles: eliminar tildes, espacios, convertir a mayúsculas
function normalizeRole(role: string): string {
  return role
    .toUpperCase()
    .normalize('NFD') // Descompone caracteres con tildes (é -> e + ´)
    .replace(/[\u0300-\u036f]/g, '') // Elimina los diacríticos (tildes)
    .trim() // Elimina espacios al inicio y final
    .replace(/\s+/g, ''); // Elimina espacios internos
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'No autenticado' });
    }

    // Normalizar roles para comparación (eliminar tildes, espacios, convertir a mayúsculas)
    const userRoleNormalized = normalizeRole(req.user.role);
    const rolesNormalized = roles.map(r => normalizeRole(r));

    if (!rolesNormalized.includes(userRoleNormalized)) {
      console.log(`❌ Acceso denegado: Rol del usuario "${req.user.role}" (normalizado: "${userRoleNormalized}") no está en [${roles.join(', ')}] (normalizados: [${rolesNormalized.join(', ')}])`);
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    next();
  };
}
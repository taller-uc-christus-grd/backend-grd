import { Request, Response } from 'express';
import { prisma } from '../db/client';

// Obtener logs del sistema con filtros opcionales
export async function getLogs(req: Request, res: Response) {
  try {
    const { 
      level, 
      limit = '100', 
      offset = '0',
      userId,
      startDate,
      endDate
    } = req.query;
    
    const where: any = {};
    
    if (level && level !== 'all') {
      where.level = level;
    }
    
    if (userId) {
      where.userId = parseInt(userId as string);
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }
    
    const logs = await prisma.logSistema.findMany({
      where,
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });
    
    // Formatear los logs para el frontend
    const formattedLogs = logs.map(log => ({
      id: log.id.toString(),
      user: log.usuario?.email || 'sistema@ucchristus.cl',
      userName: log.usuario?.nombre || 'Sistema',
      action: log.action || log.message || 'Acción desconocida',
      timestamp: log.createdAt.toISOString().replace('T', ' ').substring(0, 19),
      type: mapLevelToType(log.level || 'info'),
      ip: (log.metadata as any)?.ip || 'N/A',
      details: log.message || log.endpoint || 'Sin detalles',
      level: log.level || 'info',
      endpoint: log.endpoint,
      metadata: log.metadata
    }));
    
    // Obtener total de logs para paginación
    const total = await prisma.logSistema.count({ where });
    
    return res.json({
      logs: formattedLogs,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });
  } catch (error: any) {
    console.error('Error obteniendo logs:', error);
    return res.status(500).json({ message: 'Error obteniendo logs del sistema' });
  }
}

// Función helper para mapear niveles de log a tipos del frontend
function mapLevelToType(level: string | null | undefined): 'success' | 'error' | 'warning' | 'info' {
  if (!level) return 'info';
  const levelLower = level.toLowerCase();
  if (levelLower === 'error' || levelLower === 'fatal' || levelLower === 'err') {
    return 'error';
  }
  if (levelLower === 'warn' || levelLower === 'warning') {
    return 'warning';
  }
  if (levelLower === 'success') {
    return 'success';
  }
  return 'info';
}


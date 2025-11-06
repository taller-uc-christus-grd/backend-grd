import { Request, Response } from 'express';
import { prisma } from '../db/client';
import { logAdminAction } from '../utils/logger';

// Obtener todas las configuraciones del sistema
export async function getConfig(req: Request, res: Response) {
  try {
    const configs = await prisma.configuracionSistema.findMany();
    
    // Convertir a un objeto clave-valor más fácil de usar
    const configObj: Record<string, any> = {};
    configs.forEach(config => {
      let value: any = config.valor;
      
      // Parsear según el tipo
      if (config.tipo === 'number') {
        value = parseFloat(config.valor);
      } else if (config.tipo === 'boolean') {
        value = config.valor === 'true';
      } else if (config.tipo === 'json') {
        try {
          value = JSON.parse(config.valor);
        } catch {
          value = config.valor;
        }
      }
      
      configObj[config.clave] = value;
    });
    
    return res.json(configObj);
  } catch (error: any) {
    console.error('Error obteniendo configuración:', error);
    return res.status(500).json({ message: 'Error obteniendo configuración del sistema' });
  }
}

// Obtener una configuración específica por clave
export async function getConfigByKey(req: Request, res: Response) {
  try {
    const { clave } = req.params;
    const config = await prisma.configuracionSistema.findUnique({
      where: { clave }
    });
    
    if (!config) {
      return res.status(404).json({ message: 'Configuración no encontrada' });
    }
    
    let value: any = config.valor;
    if (config.tipo === 'number') {
      value = parseFloat(config.valor);
    } else if (config.tipo === 'boolean') {
      value = config.valor === 'true';
    } else if (config.tipo === 'json') {
      try {
        value = JSON.parse(config.valor);
      } catch {
        value = config.valor;
      }
    }
    
    return res.json({ clave: config.clave, valor: value, tipo: config.tipo });
  } catch (error: any) {
    console.error('Error obteniendo configuración:', error);
    return res.status(500).json({ message: 'Error obteniendo configuración' });
  }
}

// Actualizar configuración (upsert)
export async function updateConfig(req: Request, res: Response) {
  try {
    const { configuracion } = req.body as {
      configuracion: {
        maxFileSizeMB?: number;
        sessionTimeout?: number;
        maxLoginAttempts?: number;
        passwordMinLength?: number;
      };
    };
    
    if (!configuracion) {
      return res.status(400).json({ message: 'Se requiere objeto configuracion' });
    }
    
    // Actualizar o crear cada configuración
    const updates = [];
    
    if (configuracion.maxFileSizeMB !== undefined) {
      updates.push(
        prisma.configuracionSistema.upsert({
          where: { clave: 'maxFileSizeMB' },
          update: { 
            valor: configuracion.maxFileSizeMB.toString(),
            tipo: 'number'
          },
          create: {
            clave: 'maxFileSizeMB',
            valor: configuracion.maxFileSizeMB.toString(),
            tipo: 'number',
            descripcion: 'Tamaño máximo de archivo en MB'
          }
        })
      );
    }
    
    if (configuracion.sessionTimeout !== undefined) {
      updates.push(
        prisma.configuracionSistema.upsert({
          where: { clave: 'sessionTimeout' },
          update: { 
            valor: configuracion.sessionTimeout.toString(),
            tipo: 'number'
          },
          create: {
            clave: 'sessionTimeout',
            valor: configuracion.sessionTimeout.toString(),
            tipo: 'number',
            descripcion: 'Timeout de sesión en minutos'
          }
        })
      );
    }
    
    if (configuracion.maxLoginAttempts !== undefined) {
      updates.push(
        prisma.configuracionSistema.upsert({
          where: { clave: 'maxLoginAttempts' },
          update: { 
            valor: configuracion.maxLoginAttempts.toString(),
            tipo: 'number'
          },
          create: {
            clave: 'maxLoginAttempts',
            valor: configuracion.maxLoginAttempts.toString(),
            tipo: 'number',
            descripcion: 'Intentos máximos de login'
          }
        })
      );
    }
    
    if (configuracion.passwordMinLength !== undefined) {
      updates.push(
        prisma.configuracionSistema.upsert({
          where: { clave: 'passwordMinLength' },
          update: { 
            valor: configuracion.passwordMinLength.toString(),
            tipo: 'number'
          },
          create: {
            clave: 'passwordMinLength',
            valor: configuracion.passwordMinLength.toString(),
            tipo: 'number',
            descripcion: 'Longitud mínima de contraseña'
          }
        })
      );
    }
    
    await Promise.all(updates);
    
    // Log de acción administrativa
    const userId = parseInt(req.user!.id);
    await logAdminAction(userId, 'Configuración del sistema actualizada', 'Configuración modificada', {
      changes: Object.keys(configuracion)
    });
    
    // Obtener la configuración actualizada
    const configs = await prisma.configuracionSistema.findMany();
    const configObj: Record<string, any> = {};
    configs.forEach(config => {
      let value: any = config.valor;
      if (config.tipo === 'number') {
        value = parseFloat(config.valor);
      } else if (config.tipo === 'boolean') {
        value = config.valor === 'true';
      } else if (config.tipo === 'json') {
        try {
          value = JSON.parse(config.valor);
        } catch {
          value = config.valor;
        }
      }
      configObj[config.clave] = value;
    });
    
    return res.json(configObj);
  } catch (error: any) {
    console.error('Error actualizando configuración:', error);
    return res.status(500).json({ message: 'Error actualizando configuración del sistema' });
  }
}


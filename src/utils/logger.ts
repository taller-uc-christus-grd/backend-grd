import { prisma } from '../db/client';

export interface LogData {
  userId?: number;
  endpoint?: string;
  action: string;
  level?: 'info' | 'error' | 'warn' | 'success';
  message?: string;
  metadata?: Record<string, any>;
}

/**
 * Crea un log en el sistema
 */
export async function createLog(data: LogData) {
  try {
    await prisma.logSistema.create({
      data: {
        userId: data.userId,
        endpoint: data.endpoint,
        action: data.action,
        level: data.level || 'info',
        message: data.message || data.action,
        metadata: data.metadata || {}
      }
    });
  } catch (error) {
    // No queremos que los logs rompan la aplicación, solo logueamos el error
    console.error('Error creando log del sistema:', error);
  }
}

/**
 * Helper para crear logs de login
 */
export async function logLogin(userId: number | null, success: boolean, ip?: string, email?: string) {
  await createLog({
    userId: userId && userId > 0 ? userId : undefined,
    endpoint: '/api/auth/login',
    action: success ? 'Login exitoso' : 'Intento de login fallido',
    level: success ? 'success' : 'error',
    message: success 
      ? `Usuario ${email} inició sesión correctamente`
      : `Intento de login fallido para ${email}`,
    metadata: {
      ip: ip || 'N/A',
      email: email || 'N/A',
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Helper para crear logs de acciones administrativas
 */
export async function logAdminAction(
  userId: number, 
  action: string, 
  details?: string, 
  metadata?: Record<string, any>
) {
  await createLog({
    userId,
    endpoint: '/api/admin',
    action,
    level: 'info',
    message: details || action,
    metadata: {
      ...metadata,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Helper para crear logs de carga de archivos
 */
export async function logFileUpload(
  userId: number,
  fileName: string,
  fileSize: number,
  success: boolean,
  error?: string
) {
  await createLog({
    userId,
    endpoint: '/api/upload',
    action: success ? 'Carga de archivo exitosa' : 'Error al cargar archivo',
    level: success ? 'success' : 'error',
    message: success
      ? `Archivo ${fileName} cargado correctamente (${(fileSize / 1024 / 1024).toFixed(2)} MB)`
      : `Error al cargar archivo ${fileName}: ${error}`,
    metadata: {
      fileName,
      fileSize,
      success,
      error: error || null,
      timestamp: new Date().toISOString()
    }
  });
}


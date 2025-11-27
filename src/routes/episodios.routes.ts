import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import * as path from 'path';
// import * as fs from 'fs'; // No se necesita para memoryStorage
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import { requireAuth, requireRole } from '../middlewares/auth';
import { prisma } from '../db/client'; // ¡Importante! Conecta con la DB
import { Readable } from 'stream';
import { uploadToCloudinary } from '../config/cloudinary';
import cloudinary from '../config/cloudinary';

const router = Router();

// --- Configuración de Multer (AHORA EN MEMORIA) ---
const storage = multer.memoryStorage();

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'text/csv', 'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const fileExtension = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo CSV y Excel.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50MB Límite
});

// Mapeo de campos del frontend a la base de datos
const fieldMapping: Record<string, string> = {
  estadoRN: 'estadoRn',
  montoAT: 'montoAt',
  montoRN: 'montoRn',
  pagoDemora: 'pagoDemoraRescate',
  pagoOutlierSup: 'pagoOutlierSuperior',
  at: 'atSn', // 'at' del frontend se mapea a 'atSn' en la BD
  validado: 'validado',
};

// Función para mapear campos del frontend a la base de datos
function mapFieldsToDB(data: any): any {
  const mapped: any = {};
  for (const [key, value] of Object.entries(data)) {
    const dbKey = fieldMapping[key] || key;
    mapped[dbKey] = value;
  }
  return mapped;
}

// Funciones de cálculo (deben estar antes de normalizeEpisodeResponse)

// Función para calcular valorGRD como peso * precioBaseTramo
function calcularValorGRD(
  peso: number | null | undefined,
  precioBaseTramo: number | null | undefined
): number {
  const pesoNum = peso ?? 0;
  const precioNum = precioBaseTramo ?? 0;
  
  if (pesoNum === 0 || precioNum === 0) {
    return 0;
  }
  
  return pesoNum * precioNum;
}

// Función para calcular montoFinal según la fórmula de negocio
function calcularMontoFinal(
  valorGRD: number | null | undefined,
  montoAT: number | null | undefined,
  pagoOutlierSup: number | null | undefined,
  pagoDemora: number | null | undefined
): number {
  const vGRD = valorGRD ?? 0;
  const mAT = montoAT ?? 0;
  const pOutlier = pagoOutlierSup ?? 0;
  const pDemora = pagoDemora ?? 0;
  
  return vGRD + mAT + pOutlier + pDemora;
}

/**
 * Calcula el tramo basado en el peso GRD para convenios con sistema de tramos (FNS012, FNS026)
 * @param pesoGRD Peso GRD del episodio
 * @returns 'T1', 'T2', 'T3' o null si no se puede determinar
 */
function calcularTramo(pesoGRD: number | null | undefined): 'T1' | 'T2' | 'T3' | null {
  if (pesoGRD === null || pesoGRD === undefined) {
    return null; // No se puede determinar el tramo sin peso
  }
  
  if (pesoGRD >= 0 && pesoGRD <= 1.5) {
    return 'T1';
  } else if (pesoGRD > 1.5 && pesoGRD <= 2.5) {
    return 'T2';
  } else if (pesoGRD > 2.5) {
    return 'T3';
  }
  
  return null; // Peso negativo (no debería ocurrir)
}

/**
 * Obtiene el precio base por tramo basándose en el convenio y el peso GRD
 * @param convenio Código del convenio (FNS012, FNS026, FNS019, CH0041)
 * @param pesoGRD Peso GRD del episodio
 * @returns Precio base calculado o null si no se puede determinar
 */
async function obtenerPrecioBaseTramo(
  convenio: string | null | undefined,
  pesoGRD: number | null | undefined
): Promise<number | null> {
  // Validar que el convenio esté presente
  if (!convenio || typeof convenio !== 'string' || convenio.trim() === '') {
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ obtenerPrecioBaseTramo: Convenio no proporcionado o inválido');
    }
    return null;
  }

  const convenioNormalizado = convenio.trim().toUpperCase();
  
  // Determinar si el convenio usa tramos o precio único
  const conveniosConTramos = ['FNS012', 'FNS026'];
  const conveniosPrecioUnico = ['FNS019', 'CH0041'];
  
  if (conveniosConTramos.includes(convenioNormalizado)) {
    // Calcular tramo basado en peso GRD
    const tramo = calcularTramo(pesoGRD);
    if (!tramo) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: No se pudo determinar el tramo para convenio ${convenioNormalizado} con peso GRD ${pesoGRD}`);
      }
      return null; // No se puede determinar el tramo
    }
    
    // Buscar en precios_convenios (sin validar fechas)
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenioNormalizado,
        tramo: tramo
      },
      orderBy: {
        createdAt: 'desc' // Si hay múltiples, tomar el más reciente
      }
    });
    
    if (!precioRegistro || precioRegistro.precio === null || precioRegistro.precio === undefined) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: No se encontró precio para convenio ${convenioNormalizado} y tramo ${tramo}`);
      }
      return null;
    }
    
    const precio = typeof precioRegistro.precio === 'number' 
      ? precioRegistro.precio 
      : parseFloat(String(precioRegistro.precio));
    
    if (isNaN(precio) || !isFinite(precio)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: Precio inválido para convenio ${convenioNormalizado} y tramo ${tramo}: ${precioRegistro.precio}`);
      }
      return null;
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ obtenerPrecioBaseTramo: Precio encontrado para ${convenioNormalizado} ${tramo}: ${precio}`);
    }
    
    return precio;
    
  } else if (conveniosPrecioUnico.includes(convenioNormalizado)) {
    // Buscar precio único (ignorar tramo y fechas)
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenioNormalizado
      },
      orderBy: {
        createdAt: 'desc' // Si hay múltiples, tomar el más reciente
      }
    });
    
    if (!precioRegistro || precioRegistro.precio === null || precioRegistro.precio === undefined) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: No se encontró precio para convenio ${convenioNormalizado}`);
      }
      return null;
    }
    
    const precio = typeof precioRegistro.precio === 'number' 
      ? precioRegistro.precio 
      : parseFloat(String(precioRegistro.precio));
    
    if (isNaN(precio) || !isFinite(precio)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: Precio inválido para convenio ${convenioNormalizado}: ${precioRegistro.precio}`);
      }
      return null;
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ obtenerPrecioBaseTramo: Precio encontrado para ${convenioNormalizado}: ${precio}`);
    }
    
    return precio;
  }
  
  // Si el convenio no está en ninguna de las listas, retornar null
  if (process.env.NODE_ENV === 'development') {
    console.warn(`⚠️ obtenerPrecioBaseTramo: Convenio desconocido: ${convenioNormalizado}`);
  }
  return null;
}

// Función para normalizar datos de episodio antes de enviar al frontend
function normalizeEpisodeResponse(episode: any): any {
  // Normalizar campo 'at': SIEMPRE devolver "S" o "N" (string)
  let atValue: string;
  if (episode.atSn === true || episode.atSn === 'S' || episode.atSn === 's') {
    atValue = 'S';
  } else {
    atValue = 'N';
  }

  // Normalizar estadoRN: string válido o null (nunca undefined o "")
  let estadoRN: string | null = null;
  if (episode.estadoRn && ['Aprobado', 'Pendiente', 'Rechazado'].includes(episode.estadoRn)) {
    estadoRN = episode.estadoRn;
  }

  // Helper para convertir a número seguro
  const toNumber = (value: any): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      if (isNaN(value) || !isFinite(value)) return null;
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (isNaN(parsed) || !isFinite(parsed)) return null;
      return parsed;
    }
    // Si es Decimal de Prisma
    if (value && typeof value.toNumber === 'function') {
      const num = value.toNumber();
      if (isNaN(num) || !isFinite(num)) return null;
      return num;
    }
    return null;
  };

  // Helper para convertir a entero seguro
  const toInteger = (value: any): number | null => {
    const num = toNumber(value);
    return num !== null ? Math.floor(num) : null;
  };

  // Normalizar atDetalle: siempre string o null (nunca undefined o "")
  let atDetalle: string | null = null;
  if (episode.atDetalle !== null && episode.atDetalle !== undefined) {
    if (typeof episode.atDetalle === 'string' && episode.atDetalle.trim() !== '') {
      atDetalle = episode.atDetalle;
    }
    // Si es null explícitamente, mantenerlo como null
    // Si es undefined, mantenerlo como null (no undefined)
  }

  // Normalizar documentacion
  let documentacion: string | null = null;
  if (episode.documentacion) {
    if (typeof episode.documentacion === 'string') {
      documentacion = episode.documentacion;
    } else if (typeof episode.documentacion === 'object' && episode.documentacion !== null) {
      if ('texto' in episode.documentacion) {
        documentacion = episode.documentacion.texto as string;
      } else {
        documentacion = JSON.stringify(episode.documentacion);
      }
    }
  }

  // SIEMPRE recalcular valorGRD = peso * precioBaseTramo
  const peso = toNumber(episode.pesoGrd) ?? 0;
  const precioBaseTramo = toNumber(episode.precioBaseTramo) ?? 0;
  const valorGRDCalculado = calcularValorGRD(peso, precioBaseTramo);

  // SIEMPRE recalcular montoFinal = valorGRD + montoAT + pagoOutlierSup + pagoDemora
  const montoAT = toNumber(episode.montoAt) ?? 0;
  const pagoOutlierSup = toNumber(episode.pagoOutlierSuperior) ?? 0;
  const pagoDemora = toNumber(episode.pagoDemoraRescate) ?? 0;
  const montoFinalCalculado = calcularMontoFinal(
    valorGRDCalculado,
    montoAT,
    pagoOutlierSup,
    pagoDemora
  );

  return {
    episodio: episode.episodioCmdb || '',
    rut: episode.paciente?.rut || '',
    nombre: episode.paciente?.nombre || '',
    fechaIngreso: episode.fechaIngreso ? episode.fechaIngreso.toISOString().split('T')[0] : null,
    fechaAlta: episode.fechaAlta ? episode.fechaAlta.toISOString().split('T')[0] : null,
    servicioAlta: episode.servicioAlta || '',
    
    // Campos editables por finanzas (NORMALIZADOS)
    estadoRN, // string válido o null
    at: atValue, // SIEMPRE "S" o "N"
    atDetalle, // SIEMPRE string o null (nunca undefined o "")
    montoAT: toNumber(episode.montoAt), // SIEMPRE number o null
    montoRN: toNumber(episode.montoRn), // SIEMPRE number o null
    diasDemoraRescate: toInteger(episode.diasDemoraRescate), // SIEMPRE integer o null
    pagoDemora: toNumber(episode.pagoDemoraRescate), // SIEMPRE number o null
    pagoOutlierSup: toNumber(episode.pagoOutlierSuperior), // SIEMPRE number o null
    precioBaseTramo: toNumber(episode.precioBaseTramo), // SIEMPRE number o null
    valorGRD: valorGRDCalculado, // SIEMPRE calculado como peso * precioBaseTramo
    montoFinal: montoFinalCalculado, // SIEMPRE calculado automáticamente
    documentacion, // string o null
    
    // Campo editable por gestión
    validado: episode.validado ?? null, // boolean | null (null = Pendiente, true = Aprobado, false = Rechazado)
    
    // Campos de solo lectura
    grdCodigo: episode.grd?.codigo || '',
    peso: toNumber(episode.pesoGrd), // SIEMPRE number o null (para compatibilidad)
    pesoGrd: toNumber(episode.pesoGrd), // SIEMPRE number o null (nuevo campo "Peso GRD Medio (Todos)")
    inlierOutlier: episode.inlierOutlier || '',
    grupoDentroNorma: episode.grupoEnNorma || false,
    diasEstada: toInteger(episode.diasEstada), // SIEMPRE integer o null
    
    // Otros campos del episodio
    centro: episode.centro || null,
    numeroFolio: episode.numeroFolio || null,
    tipoEpisodio: episode.tipoEpisodio || null,
    id: episode.id,
  };
}

// Esquema Joi para validación (lo mantenemos)
const episodioSchema = Joi.object({
  centro: Joi.string().optional().allow(null),
  numeroFolio: Joi.string().optional().allow(null),
  episodioCmdb: Joi.string().optional().allow(null),
  idDerivacion: Joi.string().optional().allow(null),
  tipoEpisodio: Joi.string().optional().allow(null),
  fechaIngreso: Joi.date().optional().allow(null),
  fechaAlta: Joi.date().optional().allow(null),
  servicioAlta: Joi.string().optional().allow(null),
  estadoRn: Joi.string().optional().allow(null),
  // Campos del frontend (camelCase con mayúsculas)
  estadoRN: Joi.string().optional().allow(null), // Alias para estadoRn
  validado: Joi.boolean().optional().allow(null),
  atSn: Joi.boolean().optional().allow(null),
  at: Joi.boolean().optional().allow(null), // Alias para atSn
  atDetalle: Joi.string().optional().allow(null),
  montoAt: Joi.number().optional().allow(null),
  montoAT: Joi.number().optional().allow(null), // Alias para montoAt
  tipoAlta: Joi.string().optional().allow(null),
  pesoGrd: Joi.number().optional().allow(null),
  montoRn: Joi.number().optional().allow(null),
  montoRN: Joi.number().optional().allow(null), // Alias para montoRn
  diasDemoraRescate: Joi.number().integer().optional().allow(null),
  pagoDemoraRescate: Joi.number().optional().allow(null),
  pagoDemora: Joi.number().optional().allow(null), // Alias para pagoDemoraRescate
  pagoOutlierSuperior: Joi.number().optional().allow(null),
  pagoOutlierSup: Joi.number().optional().allow(null), // Alias para pagoOutlierSuperior
  documentacion: Joi.object().optional().allow(null), // Asumiendo JSON
  inlierOutlier: Joi.string().optional().allow(null),
  grupoEnNorma: Joi.boolean().optional().allow(null),
  diasEstada: Joi.number().integer().optional().allow(null),
  precioBaseTramo: Joi.number().optional().allow(null),
  valorGrd: Joi.number().optional().allow(null),
  montoFinal: Joi.number().optional().allow(null),
  facturacionTotal: Joi.number().optional().allow(null),
  especialidad: Joi.string().optional().allow(null),
  anio: Joi.number().integer().optional().allow(null),
  mes: Joi.number().integer().optional().allow(null),
  convenio: Joi.string().optional().allow(null), // Código del convenio (ej: 'FNS012', 'FNS026', 'FNS019', 'CH0041')
  pacienteId: Joi.number().integer().optional().allow(null),
  grdId: Joi.number().integer().optional().allow(null),
});

// Listar episodios (AHORA DESDE PRISMA)
router.get('/episodios', requireAuth, async (_req: Request, res: Response) => {
  try {
    const episodios = await prisma.episodio.findMany({
      include: {
        paciente: { select: { id: true, nombre: true, rut: true } },
        grd: { select: { id: true, codigo: true, descripcion: true } },
      },
      orderBy: {
        id: 'desc',
      },
    });
    res.json({ total: episodios.length, data: episodios });
  } catch (error: any) {
    console.error('Error al listar episodios:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({ 
      error: 'Error al listar episodios',
      message: error?.message || 'Error desconocido'
    });
  }
});

// Endpoint para obtener metadata de episodios
router.get('/episodios/meta', requireAuth, async (_req: Request, res: Response) => {
  try {
    const count = await prisma.episodio.count();
    const lastEpisode = await prisma.episodio.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    
    return res.json({
      count,
      lastImportedAt: lastEpisode?.createdAt ? lastEpisode.createdAt.toISOString() : null,
    });
  } catch (error: any) {
    console.error('Error al obtener metadata:', error);
    console.error('Stack:', error?.stack);
    return res.status(500).json({ 
      error: 'Error al obtener metadata',
      message: error?.message || 'Error desconocido'
    });
  }
});

// Endpoint para obtener episodios finales (con paginación)
router.get('/episodios/final', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    const [episodes, total] = await Promise.all([
      prisma.episodio.findMany({
        skip,
        take: pageSize,
        include: {
          paciente: true,
          grd: true,
        },
      orderBy: {
        id: 'desc',
      },
      }),
      prisma.episodio.count(),
    ]);

    // Recalcular precioBaseTramo para episodios que lo necesiten (lazy calculation)
    for (const episode of episodes) {
      if (!episode.precioBaseTramo && episode.convenio) {
        const pesoGRD = episode.pesoGrd ? Number(episode.pesoGrd) : null;
        const precioCalculado = await obtenerPrecioBaseTramo(episode.convenio, pesoGRD);
        if (precioCalculado !== null) {
          // Actualizar en la base de datos para evitar recalcular en cada consulta
          await prisma.episodio.update({
            where: { id: episode.id },
            data: { precioBaseTramo: precioCalculado }
          });
          // Actualizar el objeto en memoria para esta respuesta
          episode.precioBaseTramo = precioCalculado as any;
        }
      }
    }

    // Helper para convertir Decimal a Number
    const toNumber = (value: any): number => {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseFloat(value) || 0;
      if (value && typeof value.toNumber === 'function') return value.toNumber();
      return 0;
    };

    // Transformar al formato esperado por el frontend usando normalización
    // Usar la función normalizeEpisodeResponse para cada episodio
    const items = episodes.map((e: any) => {
      const normalized = normalizeEpisodeResponse(e);
      
      // El endpoint /final tiene un formato ligeramente diferente, ajustar campos
      // IMPORTANTE: Asegurar que atDetalle siempre esté presente (null o string, nunca undefined)
      // Si es undefined, establecerlo explícitamente como null para que se incluya en el JSON
      const atDetalleValue = (normalized.atDetalle !== undefined && normalized.atDetalle !== null) 
        ? normalized.atDetalle 
        : null;
      
      // DEBUG: Verificar que atDetalle está presente
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 GET /episodios/final - Episodio ${e.episodioCmdb || e.id}:`, {
          atDetalleEnBD: e.atDetalle,
          atDetalleNormalizado: normalized.atDetalle,
          atDetalleValue: atDetalleValue,
          tipo: typeof normalized.atDetalle,
          keysEnNormalized: Object.keys(normalized).filter(k => k.includes('at'))
        });
      }
      
      // Construir el objeto de respuesta explícitamente para asegurar que atDetalle esté presente
      const itemResponse: any = {
        episodio: normalized.episodio,
        nombre: normalized.nombre,
        rut: normalized.rut,
        centro: normalized.centro || '',
        folio: normalized.numeroFolio || '',
        tipoEpisodio: normalized.tipoEpisodio || '',
        fechaIngreso: normalized.fechaIngreso || '',
        fechaAlta: normalized.fechaAlta || '',
        servicioAlta: normalized.servicioAlta || '',
        grdCodigo: normalized.grdCodigo,
        peso: normalized.peso || 0, // Para compatibilidad con el formato anterior
        montoRN: normalized.montoRN || 0, // Para compatibilidad con el formato anterior
        inlierOutlier: normalized.inlierOutlier || '',
        // Agregar campos normalizados adicionales si el frontend los necesita
        validado: normalized.validado,
        estadoRN: normalized.estadoRN,
        at: normalized.at,
        atDetalle: atDetalleValue, // ⚠️ CRÍTICO: Incluir atDetalle en la respuesta (siempre null o string, nunca undefined)
        montoAT: normalized.montoAT,
        diasDemoraRescate: normalized.diasDemoraRescate,
        pagoDemora: normalized.pagoDemora,
        pagoOutlierSup: normalized.pagoOutlierSup,
        precioBaseTramo: normalized.precioBaseTramo,
        valorGRD: normalized.valorGRD,
        montoFinal: normalized.montoFinal,
      };
      
      // VERIFICACIÓN FINAL: Asegurar que atDetalle esté presente en el objeto
      if (!('atDetalle' in itemResponse)) {
        itemResponse.atDetalle = null;
        console.warn(`⚠️ atDetalle no estaba presente en itemResponse para episodio ${e.episodioCmdb || e.id}. Agregado como null.`);
      }
      
      return itemResponse;
    });

    return res.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: any) {
    console.error('Error al obtener episodios finales:', error);
    console.error('Stack:', error?.stack);
    return res.status(500).json({ 
      error: 'Error al obtener episodios finales',
      message: error?.message || 'Error desconocido'
    });
  }
});

// ===================================================================
// ==================== ENDPOINTS DE DOCUMENTOS =====================
// IMPORTANTE: Estas rutas deben ir ANTES de /episodios/:id para evitar conflictos
// ===================================================================

// Helper para buscar episodio de forma flexible (por episodioCmdb o id interno)
// El frontend puede enviar el campo "episodio" (episodioCmdb) como string numérico
async function findEpisodioFlexibleForDocuments(identifier: string) {
  const idNum = parseInt(identifier);
  let episodio;

  // Intentar buscar primero por episodioCmdb (el campo que usa el frontend)
  episodio = await prisma.episodio.findFirst({
    where: { episodioCmdb: identifier },
    select: { id: true },
  });

  // Si no se encuentra por episodioCmdb y el ID es numérico, intentar por id interno
  if (!episodio && !isNaN(idNum)) {
    episodio = await prisma.episodio.findUnique({
      where: { id: idNum },
      select: { id: true },
    });
  }

  return episodio;
}

// Configuración de Multer para documentos (usando memoryStorage para Cloudinary)
const documentosStorage = multer.memoryStorage();
const documentosUpload = multer({
  storage: documentosStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB límite
});

/**
 * POST /api/episodios/:episodioId/documentos
 * Sube un archivo a Cloudinary y lo asocia al episodio
 * Body: FormData con file y episodioId
 * Response: DocumentoCloudinary
 */
router.post(
  '/episodios/:episodioId/documentos',
  requireAuth,
  documentosUpload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const { episodioId } = req.params;

      if (!req.file) {
        return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
      }

      // Buscar episodio de forma flexible (por episodioCmdb o id interno)
      const episodio = await findEpisodioFlexibleForDocuments(episodioId);

      if (!episodio) {
        return res.status(404).json({ error: 'Episodio no encontrado' });
      }

      // Usar el ID interno del episodio encontrado
      const episodioIdInterno = episodio.id;

      // Preparar nombre del archivo (sin extensión para public_id)
      const originalName = req.file.originalname;
      const extension = path.extname(originalName);
      const nombreSinExtension = path.basename(originalName, extension);
      // Limpiar nombre para que sea válido en Cloudinary (eliminar caracteres especiales)
      const nombreArchivoLimpio = nombreSinExtension.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Estructura según especificación: folder: episodios/{episodioId}, public_id: episodios/{episodioId}/{nombreArchivo}
      // Usar el ID interno para la estructura de carpetas en Cloudinary
      const folder = `episodios/${episodioIdInterno}`;
      const publicId = `episodios/${episodioIdInterno}/${nombreArchivoLimpio}`;

      // Subir archivo a Cloudinary
      const result: any = await uploadToCloudinary(req.file.buffer, {
        folder: folder,
        public_id: publicId,
        resource_type: 'auto', // Detecta automáticamente el tipo (PDF, imagen, etc.)
      });

      // Guardar en la base de datos usando el ID interno
      const documento = await prisma.documentoCloudinary.create({
        data: {
          nombre: originalName,
          publicId: result.public_id,
          url: result.secure_url,
          formato: extension.substring(1).toLowerCase(), // Sin el punto
          tamano: req.file.size,
          episodioId: episodioIdInterno,
        },
      });

      // Formatear respuesta según tipo DocumentoCloudinary
      const response = {
        id: documento.id,
        nombre: documento.nombre,
        publicId: documento.publicId,
        url: documento.url,
        formato: documento.formato,
        tamano: documento.tamano,
        uploadedAt: documento.uploadedAt.toISOString(),
      };

      res.status(201).json(response);
    } catch (error: any) {
      console.error('Error subiendo documento:', error);
      res.status(500).json({
        error: 'Error interno al subir el documento',
        message: error.message || 'Error desconocido',
      });
    }
  }
);

/**
 * GET /api/episodios/:episodioId/documentos
 * Obtiene todos los documentos de un episodio
 * Response: Array de DocumentoCloudinary
 */
router.get('/episodios/:episodioId/documentos', requireAuth, async (req: Request, res: Response) => {
  try {
    const { episodioId } = req.params;

    // Buscar episodio de forma flexible (por episodioCmdb o id interno)
    const episodio = await findEpisodioFlexibleForDocuments(episodioId);

    if (!episodio) {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }

    // Usar el ID interno del episodio encontrado
    const episodioIdInterno = episodio.id;

    // Obtener documentos del episodio
    const documentos = await prisma.documentoCloudinary.findMany({
      where: { episodioId: episodioIdInterno },
      orderBy: { uploadedAt: 'desc' },
    });

    // Formatear respuesta según tipo DocumentoCloudinary
    const response = documentos.map((doc) => ({
      id: doc.id,
      nombre: doc.nombre,
      publicId: doc.publicId,
      url: doc.url,
      formato: doc.formato,
      tamano: doc.tamano,
      uploadedAt: doc.uploadedAt.toISOString(),
    }));

    res.json(response);
  } catch (error: any) {
    console.error('Error obteniendo documentos:', error);
    res.status(500).json({
      error: 'Error interno al obtener documentos',
      message: error.message || 'Error desconocido',
    });
  }
});

/**
 * DELETE /api/episodios/:episodioId/documentos/:documentoId
 * Elimina un documento de Cloudinary usando public_id
 * Response: 204 No Content
 */
router.delete(
  '/episodios/:episodioId/documentos/:documentoId',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { episodioId, documentoId } = req.params;

      // Buscar episodio de forma flexible (por episodioCmdb o id interno)
      const episodio = await findEpisodioFlexibleForDocuments(episodioId);

      if (!episodio) {
        return res.status(404).json({ error: 'Episodio no encontrado' });
      }

      // Usar el ID interno del episodio encontrado
      const episodioIdInterno = episodio.id;

      // Buscar el documento
      const documento = await prisma.documentoCloudinary.findUnique({
        where: { id: parseInt(documentoId) },
      });

      if (!documento) {
        return res.status(404).json({ error: 'Documento no encontrado' });
      }

      // Verificar que el documento pertenezca al episodio
      if (documento.episodioId !== episodioIdInterno) {
        return res.status(400).json({ error: 'El documento no pertenece a este episodio' });
      }

      // Determinar el resource_type basado en el formato del archivo
      // PDFs y documentos se suben como 'raw', imágenes como 'image', videos como 'video'
      const formato = documento.formato?.toLowerCase() || '';
      let resourceType: 'image' | 'video' | 'raw' = 'raw'; // Por defecto raw
      
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(formato)) {
        resourceType = 'image';
      } else if (['mp4', 'mov', 'avi', 'webm'].includes(formato)) {
        resourceType = 'video';
      }
      // PDFs, DOCX, XLSX, etc. son 'raw' (por defecto)

      // Eliminar de Cloudinary usando public_id y resource_type
      let cloudinaryDeleted = false;
      try {
        const result = await cloudinary.uploader.destroy(documento.publicId, {
          resource_type: resourceType,
        });
        
        // El resultado de destroy puede ser { result: 'ok' } o { result: 'not found' }
        cloudinaryDeleted = result.result === 'ok';
        
        if (!cloudinaryDeleted) {
          console.warn(`Documento no encontrado en Cloudinary: ${documento.publicId} (result: ${result.result})`);
          // Continuamos con la eliminación de BD aunque no esté en Cloudinary
        }
      } catch (cloudinaryError: any) {
        console.error('Error eliminando de Cloudinary:', cloudinaryError);
        // Continuar con la eliminación de la BD aunque falle en Cloudinary
        // (el archivo puede no existir ya en Cloudinary o haber un error de conexión)
      }

      // Eliminar de la base de datos
      await prisma.documentoCloudinary.delete({
        where: { id: parseInt(documentoId) },
      });

      // Si se eliminó correctamente de Cloudinary, devolver 204
      // Si no estaba en Cloudinary pero se eliminó de BD, también 204
      res.status(204).send();
    } catch (error: any) {
      console.error('Error eliminando documento:', error);
      res.status(500).json({
        error: 'Error interno al eliminar documento',
        message: error.message || 'Error desconocido',
      });
    }
  }
);

// ===================================================================
// RUTAS GENÉRICAS DE EPISODIOS (deben ir después de las específicas)
// ===================================================================

// Obtener episodio por id (AHORA DESDE PRISMA) - Soporta ID numérico o episodioCmdb
router.get('/episodios/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'ID es requerido' });
    }
    
    // Buscar episodio de forma flexible: primero por episodioCmdb, luego por id interno
    // El frontend puede enviar el campo "episodio" (episodioCmdb) como string numérico
    const idNum = parseInt(id);
    let episodio;
    
    // Intentar buscar primero por episodioCmdb (el campo que usa el frontend)
    episodio = await prisma.episodio.findFirst({
      where: { episodioCmdb: id },
      include: {
        paciente: true,
        grd: true,
        diagnosticos: true,
        respaldos: true,
      },
    });

    // Si no se encuentra por episodioCmdb y el ID es numérico, intentar por id interno
    if (!episodio && !isNaN(idNum)) {
      episodio = await prisma.episodio.findUnique({
        where: { id: idNum },
        include: {
          paciente: true,
          grd: true,
          diagnosticos: true,
          respaldos: true,
        },
      });
    }

    if (!episodio) {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }
    
    // Recalcular precioBaseTramo si es necesario (lazy calculation)
    if (!episodio.precioBaseTramo && episodio.convenio) {
      const pesoGRD = episodio.pesoGrd ? Number(episodio.pesoGrd) : null;
      const precioCalculado = await obtenerPrecioBaseTramo(episodio.convenio, pesoGRD);
      if (precioCalculado !== null) {
        // Actualizar en la base de datos
        episodio = await prisma.episodio.update({
          where: { id: episodio.id },
          data: { precioBaseTramo: precioCalculado },
          include: {
            paciente: true,
            grd: true,
            diagnosticos: true,
            respaldos: true,
          },
        });
      }
    }
    
    // Normalizar respuesta antes de enviar
    const normalized = normalizeEpisodeResponse(episodio);
    res.json(normalized);
  } catch (error: any) {
    console.error('Error al obtener episodio:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({ 
      error: 'Error al obtener episodio',
      message: error?.message || 'Error desconocido'
    });
  }
});

// Crear episodio (AHORA EN PRISMA)
router.post('/episodios', requireAuth, async (req: Request, res: Response) => {
  try {
    const { error, value } = episodioSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
    }

    const record = await prisma.episodio.create({
      data: value,
    });

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear episodio' });
  }
});

// Actualizar episodio (AHORA EN PRISMA) - PUT para actualización completa
router.put('/episodios/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = episodioSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
    }

    // Buscar episodio de forma flexible: primero por episodioCmdb, luego por id interno
    const idNum = parseInt(id);
    let episodioId: number;

    // Intentar buscar primero por episodioCmdb (el campo que usa el frontend)
    let existing = await prisma.episodio.findFirst({
      where: { episodioCmdb: id },
      select: { id: true },
    });

    // Si no se encuentra por episodioCmdb y el ID es numérico, intentar por id interno
    if (!existing && !isNaN(idNum)) {
      existing = await prisma.episodio.findUnique({
        where: { id: idNum },
        select: { id: true },
      });
    }

    if (!existing) {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }

    episodioId = existing.id;

    const updated = await prisma.episodio.update({
      where: { id: episodioId },
      data: value,
      include: {
        paciente: true,
        grd: true,
        diagnosticos: true,
        respaldos: true,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar episodio' });
  }
});

// Esquema de validación específico para campos de codificador (PATCH)
// Permite editar 'at', 'atDetalle', y para casos fuera de norma: 'valorGRD' y 'montoFinal'
const codificadorSchema = Joi.object({
  at: Joi.alternatives().try(
    Joi.boolean(),
    Joi.string().valid('S', 's', 'N', 'n')
  ).optional(),
  atDetalle: Joi.string().allow(null, '').optional(),
  valorGRD: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  montoFinal: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
}).unknown(false); // No permitir campos desconocidos

// Esquema de validación específico para campos de finanzas (PATCH)
// Validamos con nombres del frontend, luego mapeamos a nombres de BD
// NOTA: 'at' y 'atDetalle' NO están permitidos para finanzas/gestion
const finanzasSchema = Joi.object({
  estadoRN: Joi.string().valid('Aprobado', 'Pendiente', 'Rechazado').allow(null, '').optional(),
  montoAT: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  montoRN: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  diasDemoraRescate: Joi.alternatives().try(
    Joi.number().integer().min(0),
    Joi.string().pattern(/^\d+$/).min(0)
  ).optional(),
  pagoDemora: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).allow(null).optional(),
  pagoOutlierSup: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).allow(null).optional(),
  precioBaseTramo: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  valorGRD: Joi.alternatives().try(       // 👈 NUEVO
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  montoFinal: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(), // Se ignora, se calcula automáticamente
  documentacion: Joi.string().allow(null, '').optional(),
}).unknown(false); // No permitir campos desconocidos

// Mapeo completo de campos del frontend a la base de datos para finanzas
const finanzasFieldMapping: Record<string, string> = {
  estadoRN: 'estadoRn',
  at: 'atSn',
  montoAT: 'montoAt',
  montoRN: 'montoRn',
  pagoDemora: 'pagoDemoraRescate',
  pagoOutlierSup: 'pagoOutlierSuperior',
  valorGRD: 'valorGrd', // NUEVO: para override manual
};

// Actualizar episodio parcialmente (PATCH) - Funcionalidad de Finanzas, Gestión y Codificador
router.patch('/episodios/:id', 
  requireAuth, 
  // Permitir a finanzas, gestion y codificador
  requireRole(['finanzas', 'FINANZAS', 'gestion', 'GESTION', 'codificador', 'CODIFICADOR']), 
  async (req: Request, res: Response) => {
  // DEBUG: Verificar que el código se está ejecutando
  console.log('🔍 PATCH /episodios/:id - Código actualizado con codificador - VERSIÓN 2.0');
  console.log('🔍 Roles permitidos en requireRole:', ['finanzas', 'FINANZAS', 'gestion', 'GESTION', 'codificador', 'CODIFICADOR']);
  try {
    const { id } = req.params;
    const userRole = req.user?.role || '';
    console.log('🔍 Rol del usuario recibido:', userRole);
    
    // Ignorar valorGRD si viene en el request (se calculará automáticamente)
    const requestBody = { ...req.body };
    delete requestBody.valorGRD;
    
    // Verificar qué campos se están intentando actualizar
    // IMPORTANTE: montoAT siempre viene junto con at o atDetalle, pero NO se considera un campo editable
    // Es solo una consecuencia automática de editar at o atDetalle
    const camposATEditables = ['at', 'atDetalle'];
    const camposOverrideManual = ['valorGRD', 'montoFinal']; // Campos para override manual en casos fuera de norma
    const camposEditablesEnPayload = camposATEditables.filter(campo => campo in requestBody);
    const camposOverrideEnPayload = camposOverrideManual.filter(campo => campo in requestBody);
    const otrosCampos = Object.keys(requestBody).filter(
      campo => !camposATEditables.includes(campo) && 
               !camposOverrideManual.includes(campo) && 
               campo !== 'montoAT' && 
               campo !== 'validado'
    );
    const userRoleUpper = userRole.toUpperCase();
    
    console.log('🔐 Verificando permisos para PATCH /api/episodios/:id:', {
      rol: userRole,
      camposATEditables: camposEditablesEnPayload,
      camposOverride: camposOverrideEnPayload,
      otrosCampos: otrosCampos,
      montoATEnPayload: 'montoAT' in requestBody,
      payloadCompleto: requestBody
    });
    
    // CASO 1: Si está intentando editar 'at' o 'atDetalle' directamente, SOLO codificador puede hacerlo
    // ⚠️ IMPORTANTE: Incluso si montoAT viene junto, es parte de la autocompletación/limpieza automática
    if (camposEditablesEnPayload.length > 0) {
      if (userRoleUpper !== 'CODIFICADOR') {
        return res.status(403).json({
          message: `Acceso denegado: Solo el rol codificador puede editar los campos AT(S/N) y AT Detalle. Rol actual: "${userRole}".`,
          error: 'FORBIDDEN',
          campos: camposEditablesEnPayload,
          rolActual: userRole,
          camposRequeridos: ['at', 'atDetalle']
        });
      }
      // Si el rol es CODIFICADOR y está editando at o atDetalle, permitir
      // Incluso si montoAT viene en el payload, es aceptable porque se autocompleta
      console.log('✅ Permiso concedido para codificador editando:', camposEditablesEnPayload);
    }
    
    // CASO 1.5: Si está intentando editar valorGRD o montoFinal (override manual), permitir finanzas y codificador
    // Estos campos solo son editables para casos fuera de norma (se valida más adelante)
    if (camposOverrideEnPayload.length > 0) {
      const rolesPermitidosParaOverride = ['FINANZAS', 'CODIFICADOR'];
      if (!rolesPermitidosParaOverride.includes(userRoleUpper)) {
        return res.status(403).json({
          message: `Acceso denegado: Solo los roles finanzas y codificador pueden hacer override manual de valorGRD y montoFinal. Rol actual: "${userRole}".`,
          error: 'FORBIDDEN',
          campos: camposOverrideEnPayload,
          rolActual: userRole,
          camposRequeridos: ['valorGRD', 'montoFinal']
        });
      }
      console.log('✅ Permiso concedido para', userRole, 'editando override manual:', camposOverrideEnPayload);
    }
    
    // CASO 2: Si está intentando editar otros campos (pero NO at ni atDetalle ni override), permitir finanzas y gestion
    if (otrosCampos.length > 0) {
      const rolesPermitidosParaOtros = ['FINANZAS', 'GESTION'];
      if (!rolesPermitidosParaOtros.includes(userRoleUpper)) {
        return res.status(403).json({
          message: `Acceso denegado: Rol del usuario "${userRole}" no está permitido para editar estos campos.`,
          error: 'FORBIDDEN',
          rolActual: userRole,
          campos: otrosCampos
        });
      }
      console.log('✅ Permiso concedido para', userRole, 'editando:', otrosCampos);
    }
    
    // CASO ESPECIAL: Si el payload solo contiene montoAT sin at ni atDetalle
    // Esto no debería pasar desde el frontend, pero por seguridad rechazar
    if ('montoAT' in requestBody && camposEditablesEnPayload.length === 0 && otrosCampos.length === 0) {
      return res.status(403).json({
        message: 'Acceso denegado: El campo montoAT no puede editarse directamente. Solo se autocompleta al editar AT Detalle.',
        error: 'FORBIDDEN',
        rolActual: userRole
      });
    }
    
    console.log('✅ Permisos verificados correctamente. Procediendo con actualización...');

    // 2. MODIFICACIÓN: "Rescatar" el campo 'validado' (de gestión) ANTES de la validación
    const validadoValue = requestBody.validado;
    // Lo quitamos temporalmente para que los esquemas no lo eliminen con stripUnknown
    delete requestBody.validado; 

    // Validar campos según el rol del usuario
    let validatedValue: any = {};
    if (Object.keys(requestBody).length > 0) {
      let schema;
      let errorMessagePrefix = '';
      
      if (userRole.toLowerCase() === 'codificador') {
        // Codificador puede editar 'at', 'atDetalle', y para casos fuera de norma: 'valorGRD' y 'montoFinal'
        schema = codificadorSchema;
        errorMessagePrefix = 'Error de validación (codificador)';
      } else {
        // Finanzas y Gestión usan el esquema de finanzas (sin 'at' y 'atDetalle')
        schema = finanzasSchema;
        errorMessagePrefix = 'Error de validación (finanzas/gestión)';
        
        // Verificar que no intente editar 'at' o 'atDetalle' (ya validado arriba, pero por seguridad)
        if ('at' in requestBody || 'atDetalle' in requestBody) {
          return res.status(403).json({
            message: 'Acceso denegado: Solo el rol codificador puede editar los campos AT(S/N) y AT Detalle.',
            error: 'FORBIDDEN',
            campos: ['at', 'atDetalle'].filter(c => c in requestBody),
            rolActual: userRole
          });
        }
      }
      
      const { error, value } = schema.validate(requestBody, {
        stripUnknown: true,
        abortEarly: false,
        presence: 'optional',
      });
      
      if (error) {
        const errorDetails = error.details.map((d: Joi.ValidationErrorItem) => {
          // Mensajes más descriptivos
          if (d.path[0] === 'estadoRN') {
            return 'Estado inválido. Use: Aprobado, Pendiente o Rechazado';
          }
          if (d.type === 'number.min') {
            return `${d.path[0]} debe ser mayor o igual a 0`;
          }
          return d.message;
        });
        
        return res.status(400).json({
          message: errorDetails[0] || 'Datos inválidos',
          error: 'ValidationError',
          field: error.details[0]?.path[0] || 'unknown',
        });
      }
      
      validatedValue = value || {};
    }

    // 3. MODIFICACIÓN: Re-inyectar 'validado' DESPUÉS de la validación
    if (validadoValue !== undefined) {
      const userRoleUpper = (req.user?.role || '').toUpperCase();

      // Solo FINANZAS puede cambiar el campo "validado"
      if (userRoleUpper !== 'FINANZAS') {
        return res.status(403).json({
          message: 'Solo el rol FINANZAS puede aprobar/rechazar episodios (campo "validado").',
          error: 'FORBIDDEN',
          field: 'validado',
        });
      }

      // Validar tipo del valor
      if (typeof validadoValue === 'boolean' || validadoValue === null) {
        validatedValue.validado = validadoValue;
      } else {
        return res.status(400).json({
          message: 'El campo "validado" debe ser true, false o null.',
          error: 'ValidationError',
          field: 'validado',
        });
      }
    }

    // 4. MODIFICACIÓN: Mover este chequeo DESPUÉS de la re-inyección de 'validado'
    // Si no hay campos para actualizar (ni de finanzas, ni 'validado'), retornar error
    if (Object.keys(validatedValue).length === 0) {
      return res.status(400).json({ 
        message: 'No se proporcionaron campos para actualizar',
        error: 'ValidationError'
      });
    }


    // Mapear campos del frontend a nombres de la base de datos
    const updateData: any = {};
    
    // Mapeo común para campos compartidos (at, atDetalle)
    const commonFieldMapping: Record<string, string> = {
      at: 'atSn',
    };
    
    for (const [key, value] of Object.entries(validatedValue)) {
      
      // 5. MODIFICACIÓN: Añadir 'validado' al mapeo
      if (key === 'validado') {
        updateData.validado = value; // Se llama igual en la DB
        continue; // Saltar el resto del loop para esta clave
      }

      // Usar mapeo común o mapeo de finanzas según corresponda
      const dbKey = commonFieldMapping[key] || finanzasFieldMapping[key] || key;
      
      // Normalizar campos antes de guardar
      if (dbKey === 'atSn') {
        // Normalizar 'at': aceptar boolean o "S"/"N", convertir a boolean para BD
        if (value === true || value === 'S' || value === 's') {
          updateData.atSn = true;
        } else if (value === false || value === 'N' || value === 'n') {
          updateData.atSn = false;
        }
      } else if (dbKey === 'estadoRn') {
        // Normalizar estadoRN: vacío o inválido → null
        if (value && typeof value === 'string' && ['Aprobado', 'Pendiente', 'Rechazado'].includes(value)) {
          updateData.estadoRn = value;
        } else {
          updateData.estadoRn = null;
        }
      } else if (key.match(/^(montoAT|montoRN|pagoDemora|pagoOutlierSup|precioBaseTramo|montoFinal|diasDemoraRescate)$/i)) {
        // valorGRD NO debe procesarse aquí - se ignora y se calcula después
        // Convertir strings numéricos a números (si es string)
        // Si ya es número, dejarlo como está
        if (typeof value === 'string') {
          const numValue = dbKey === 'diasDemoraRescate' ? parseInt(value, 10) : parseFloat(value);
          if (!isNaN(numValue) && isFinite(numValue)) {
            updateData[dbKey] = dbKey === 'diasDemoraRescate' ? Math.floor(numValue) : numValue;
          } else {
            // Si no se puede convertir, usar null
            updateData[dbKey] = null;
          }
        } else if (typeof value === 'number') {
          // Si ya es número, asegurar que sea entero para diasDemoraRescate
          updateData[dbKey] = dbKey === 'diasDemoraRescate' ? Math.floor(value) : value;
        } else {
          updateData[dbKey] = value;
        }
      } else {
        updateData[dbKey] = value;
      }
    }


    // Validaciones de reglas de negocio
    // Si at === false (o 'N'), atDetalle debe ser null y montoAT debe ser 0
    // IMPORTANTE: Cuando at = 'N', siempre limpiar atDetalle y montoAT, incluso si vienen en el payload
    if (updateData.atSn === false) {
      updateData.atDetalle = null;
      updateData.montoAt = 0;
      console.log('🧹 Limpiando atDetalle y montoAT porque AT = N');
    }

    // Validación y autocompletado de montoAT cuando se actualiza atDetalle
    // IMPORTANTE: El frontend NO envía montoAT cuando guarda atDetalle - solo envía atDetalle
    // El backend DEBE autocompletar montoAT automáticamente consultando ajustes_tecnologia
    let ajusteTecnologiaEncontrado: any = null;
    
    if (updateData.atDetalle !== undefined) {
      const atDetalle = updateData.atDetalle;
      
      if (atDetalle && typeof atDetalle === 'string' && atDetalle.trim() !== '') {
        // Buscar el ajuste de tecnología correspondiente (una sola búsqueda)
        ajusteTecnologiaEncontrado = await prisma.ajusteTecnologia.findFirst({
          where: {
            at: atDetalle.trim(),
          },
        });

        // Validación: verificar que atDetalle exista en ajustes_tecnologia.at
        if (!ajusteTecnologiaEncontrado) {
          return res.status(400).json({
            error: 'ValidationError',
            message: `El valor de atDetalle "${atDetalle}" no existe en la tabla de ajustes de tecnología`,
          });
        }
        
        // Autocompletar montoAT automáticamente si se encontró el ajuste y tiene monto válido
        if (ajusteTecnologiaEncontrado.monto !== null && ajusteTecnologiaEncontrado.monto !== undefined) {
          // SIEMPRE autocompletar montoAT (el frontend no lo envía cuando guarda atDetalle)
          updateData.montoAt = ajusteTecnologiaEncontrado.monto;
          console.log(`💰 Autocompletado montoAT: ${ajusteTecnologiaEncontrado.monto} para atDetalle: "${atDetalle}"`);
        } else {
          // Si el ajuste existe pero el monto es null/undefined, establecer montoAT a 0
          updateData.montoAt = 0;
          console.warn(`⚠️ Ajuste encontrado pero monto es null para atDetalle: "${atDetalle}". Estableciendo montoAT a 0.`);
        }
      } else {
        // Si atDetalle es null o vacío, establecer montoAT a 0
        updateData.montoAt = 0;
        console.log(`🧹 atDetalle es null/vacío. Estableciendo montoAT a 0.`);
      }
    }

    // Manejar documentacion: Prisma espera Json (objeto/array), no string
    // Si el frontend envía un string, intentar parsearlo como JSON
    if (updateData.documentacion !== undefined && updateData.documentacion !== null) {
      if (typeof updateData.documentacion === 'string') {
        // Si es string vacío, convertir a null
        if (updateData.documentacion.trim() === '') {
          updateData.documentacion = null;
        } else {
          // Intentar parsear el string como JSON
          try {
            updateData.documentacion = JSON.parse(updateData.documentacion);
          } catch {
            // Si no es JSON válido, guardarlo como objeto con el texto
            updateData.documentacion = { texto: updateData.documentacion };
          }
        }
      }
      // Si ya es objeto/array, dejarlo así
    }

    // Buscar episodio de forma flexible: primero por episodioCmdb, luego por id interno
    // El frontend puede enviar el campo "episodio" (episodioCmdb) como string numérico
    const idNum = parseInt(id);
    let episodio;

    // 6. MODIFICACIÓN: Priorizar la búsqueda por 'id' numérico, ya que el frontend
    // debería estar enviando el 'id' de la DB (ej. 123) y no el 'episodioCmdb' (ej. EP001)
    if (!isNaN(idNum)) {
      episodio = await prisma.episodio.findUnique({
        where: { id: idNum },
        include: {
          paciente: true,
          grd: true,
          diagnosticos: true,
          respaldos: true,
        },
      });
    }

    // Si no se encuentra por id interno (como fallback), intentar por episodioCmdb
    if (!episodio) {
      episodio = await prisma.episodio.findFirst({
        where: { episodioCmdb: id },
        include: {
          paciente: true,
          grd: true,
          diagnosticos: true,
          respaldos: true,
        },
      });
    }


    if (!episodio) {
      // Log para debugging
      console.log(`🔍 PATCH /api/episodios/${id}: Episodio no encontrado`);
      console.log(`   - Buscado por id interno: ${idNum}`);
      console.log(`   - Buscado por episodioCmdb: "${id}"`);
      
      return res.status(404).json({
        message: `El episodio ${id} no fue encontrado`,
        error: 'NotFound'
      });
    }

    // Log para debugging (solo en desarrollo)
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ PATCH /api/episodios/${id}: Episodio encontrado`);
      console.log(`   - ID interno: ${episodio.id}`);
      console.log(`   - episodioCmdb: ${episodio.episodioCmdb}`);
    }

    // Obtener valores actuales del episodio
    const pesoActual = episodio.pesoGrd ? Number(episodio.pesoGrd) : null;
    const precioBaseTramoActual = episodio.precioBaseTramo ? Number(episodio.precioBaseTramo) : null;
    const convenioActual = episodio.convenio;
    const montoATActual = episodio.montoAt ? Number(episodio.montoAt) : 0;
    const pagoOutlierSupActual = episodio.pagoOutlierSuperior ? Number(episodio.pagoOutlierSuperior) : 0;
    const pagoDemoraActual = episodio.pagoDemoraRescate ? Number(episodio.pagoDemoraRescate) : 0;
        // Caso fuera de norma (override manual permitido)
    const esFueraDeNorma = episodio.grupoEnNorma === false;

    // Determinar valores finales (nuevos o actuales)
    // NOTA: pesoGrd NO es editable por finanzas, siempre usar el valor actual
    const peso = pesoActual;
    const convenio = updateData.convenio !== undefined ? updateData.convenio : convenioActual;
    
    // RECALCULAR precioBaseTramo automáticamente si:
    // 1. Cambió el peso (puede cambiar el tramo para FNS012/FNS026)
    // 2. Cambió el convenio
    // 3. precioBaseTramo es null y hay convenio
    // IMPORTANTE: Ignorar cualquier valor de precioBaseTramo que venga en el request (Opción A recomendada)
    const pesoCambio = updateData.pesoGrd !== undefined && updateData.pesoGrd !== pesoActual;
    const convenioCambio = updateData.convenio !== undefined && updateData.convenio !== convenioActual;
    const necesitaRecalculo = pesoCambio || convenioCambio || (!precioBaseTramoActual && convenio);
    
    let precioBaseTramo: number | null = precioBaseTramoActual;
    if (necesitaRecalculo && convenio) {
      const pesoParaCalculo = pesoCambio && updateData.pesoGrd !== undefined 
        ? Number(updateData.pesoGrd) 
        : peso;
      precioBaseTramo = await obtenerPrecioBaseTramo(convenio, pesoParaCalculo);
      if (precioBaseTramo !== null) {
        updateData.precioBaseTramo = precioBaseTramo;
        if (process.env.NODE_ENV === 'development') {
          console.log(`💰 Precio base recalculado para episodio ${episodio.id}: ${precioBaseTramo} (convenio: ${convenio}, peso: ${pesoParaCalculo})`);
        }
      }
    } else if (updateData.precioBaseTramo !== undefined) {
      // Si viene precioBaseTramo en el request pero no necesita recálculo, ignorarlo (mantener consistencia)
      delete updateData.precioBaseTramo;
      if (process.env.NODE_ENV === 'development') {
        console.log(`⚠️ precioBaseTramo enviado en request ignorado (se recalcula automáticamente)`);
      }
    }
    
    // Usar el precio calculado para los cálculos siguientes
    const precioBaseTramoParaCalculo = precioBaseTramo ?? 0;
    const montoAT = updateData.montoAt !== undefined ? (updateData.montoAt ?? 0) : montoATActual;
    const pagoOutlierSup = updateData.pagoOutlierSuperior !== undefined ? (updateData.pagoOutlierSuperior ?? 0) : pagoOutlierSupActual;
    const pagoDemora = updateData.pagoDemoraRescate !== undefined ? (updateData.pagoDemoraRescate ?? 0) : pagoDemoraActual;

    // ¿Hay overrides manuales?
    const tieneOverrideValorGRD = esFueraDeNorma && updateData.valorGrd !== undefined && updateData.valorGrd !== null;
    const tieneOverrideMontoFinal = esFueraDeNorma && updateData.montoFinal !== undefined && updateData.montoFinal !== null;

    // PASO 1: valorGRD
    let valorGRDFinal: number;
    if (tieneOverrideValorGRD) {
      // Si FINANZAS manda valorGRD en caso fuera de norma, lo respetamos
      const v = typeof updateData.valorGrd === 'string'
        ? parseFloat(updateData.valorGrd)
        : Number(updateData.valorGrd);
      valorGRDFinal = !isNaN(v) && isFinite(v) ? v : 0;
    } else {
      // Caso normal: lo calculamos
      valorGRDFinal = calcularValorGRD(peso ?? 0, precioBaseTramoParaCalculo);
    }
    updateData.valorGrd = valorGRDFinal;

    // PASO 2: montoFinal
    let montoFinalFinal: number;
    if (tieneOverrideMontoFinal) {
      // Si FINANZAS manda montoFinal en fuera de norma, lo respetamos
      const m = typeof updateData.montoFinal === 'string'
        ? parseFloat(updateData.montoFinal)
        : Number(updateData.montoFinal);
      montoFinalFinal = !isNaN(m) && isFinite(m) ? m : 0;
    } else {
      // Caso normal: lo calculamos
      montoFinalFinal = calcularMontoFinal(
        valorGRDFinal,
        montoAT,
        pagoOutlierSup,
        pagoDemora
      );
    }
    updateData.montoFinal = montoFinalFinal;

    // Actualizar el episodio
    const updated = await prisma.episodio.update({
      where: { id: episodio.id },
      data: updateData,
      include: {
        paciente: true,
        grd: true,
        diagnosticos: true,
        respaldos: true,
      },
    });

    // Normalizar y formatear respuesta según especificaciones
    const response = normalizeEpisodeResponse(updated);

    res.json(response);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        message: `El episodio ${req.params.id} no fue encontrado`,
        error: 'NotFound'
      });
    }
    console.error('Error al actualizar episodio:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      message: 'Error del servidor. Por favor, intenta nuevamente más tarde.',
      error: 'InternalServerError'
    });
  }
});

// Helper functions para procesamiento de archivos
type RawRow = Record<string, string>;

function isEmpty(value?: any): boolean {
  if (value === undefined || value === null) return true;
  const v = typeof value === 'string' ? value.trim() : String(value).trim();
  return v === '' || v.toLowerCase() === 'null';
}

function isNumeric(value?: any): boolean {
  if (value === undefined || value === null) return false;
  return !isNaN(Number(value));
}

function isValidDate(value?: any): boolean {
  if (value === undefined || value === null) return false;
  const d = value instanceof Date ? value : new Date(value);
  return !isNaN(d.getTime());
}

function cleanString(value?: any): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value);
  const out = s.replace(/\s+/g, ' ').trim();
  return out === '' ? null : out;
}

// ===================================================================
// =================== ¡MODIFICACIÓN 1: validateRow! ===================
// ===================================================================
// Se elimina la validación de GRD. Solo validamos duplicados de Episodio y campos requeridos.
async function validateRow(row: RawRow, index: number): Promise<boolean> {
  const requiredFields = ['Episodio CMBD', 'Hospital (Descripción)', 'RUT', 'IR GRD (Código)'];
  const missing = requiredFields.filter((f) => isEmpty(row[f]));
  
  if (missing.length > 0) {
    console.log(`Fila ${index} rechazada: Campos faltantes: ${missing.join(', ')}`);
    return false;
  }

  // Validación de duplicados - convertir a string para asegurar compatibilidad con Prisma
  const episodioCmdb = cleanString(row['Episodio CMBD']);
  if (episodioCmdb) {
    const existing = await prisma.episodio.findFirst({
      where: { episodioCmdb: episodioCmdb },
    });
    if (existing) {
      console.log(`Fila ${index} rechazada: Duplicado de Episodio CMBD ${episodioCmdb}`);
      return false;
    }
  } else {
    console.log(`Fila ${index} rechazada: Episodio CMBD está vacío`);
    return false;
  }
  
  // Validar que el GRD no esté vacío (pero no que exista, eso lo hace processRow)
  const grdCode = cleanString(row['IR GRD (Código)']);
  if (!grdCode) {
    console.log(`Fila ${index} rechazada: IR GRD (Código) está vacío`);
    return false;
  }

  if (!isValidDate(row['Fecha Ingreso completa']) || !isValidDate(row['Fecha Completa'])) {
    console.log(`Fila ${index} rechazada: Fecha inválida`);
    return false;
  }

  return true;
}

// ===================================================================
// ================== ¡MODIFICACIÓN 2: processRow! ===================
// ===================================================================
// Se usa prisma.grd.upsert() para crear el GRD si no existe.
async function processRow(row: RawRow, rowIndex?: number) {
  // Log muy visible para confirmar que el código se ejecuta
  console.log('========================================');
  console.log(`🔄 PROCESANDO FILA ${rowIndex || '?'} - Episodio: ${row['Episodio CMBD']}`);
  console.log('========================================');
  
  const rut = cleanString(row['RUT']);
  const nombre = cleanString(row['Nombre']);
  const grdCode = cleanString(row['IR GRD (Código)'])!;

  // 1. Crea o actualiza el Paciente (Upsert)
  const paciente = await prisma.paciente.upsert({
    where: { rut: rut || 'SIN-RUT' },
    update: {
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']) || cleanString(row['Sexo (Desc)']), // Cuidado con dobles espacios
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
    create: {
      rut: rut || 'SIN-RUT',
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']) || cleanString(row['Sexo (Desc)']),
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
  });

  // 2. ¡NUEVO! Crea o actualiza el GRD (Upsert)
  const grdRule = await prisma.grd.upsert({
    where: { codigo: grdCode },
    // Si ya existe, actualiza sus datos con los de esta fila
    update: {
      // Usamos el nombre de columna que vimos en la imagen/frontend
      peso: isNumeric(row['Peso Medio [Norma IR]'])
        ? parseFloat(row['Peso Medio [Norma IR]'])
        : undefined,
      // Aquí puedes agregar más campos si los tienes, ej:
      // precioBaseTramo: isNumeric(row['Precio Base']) ? parseFloat(row['Precio Base']) : undefined,
    },
    // Si no existe, créalo
    create: {
      codigo: grdCode,
      // Usamos el motivo de egreso como descripción, o un placeholder
      descripcion: cleanString(row['Motivo Egreso (Descripción)']) || `GRD ${grdCode}`,
      peso: isNumeric(row['Peso Medio [Norma IR]'])
        ? parseFloat(row['Peso Medio [Norma IR]'])
        : undefined,
    },
  });

  // 3. Obtener datos para calcular precioBaseTramo
  // Función auxiliar para buscar columnas de forma flexible (similar a catalogs.routes.ts)
  const getColumnValue = (possibleNames: string[]): string | null => {
    // Primero buscar coincidencia exacta
    for (const name of possibleNames) {
      const value = row[name];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return cleanString(value);
      }
    }
    // Si no se encuentra, buscar por nombre parcial (case-insensitive, ignorando espacios)
    for (const key in row) {
      for (const name of possibleNames) {
        const normalizedKey = key.replace(/\s+/g, ' ').trim();
        const normalizedName = name.replace(/\s+/g, ' ').trim();
        if (normalizedKey.toLowerCase() === normalizedName.toLowerCase() || 
            normalizedKey.toLowerCase().includes(normalizedName.toLowerCase()) ||
            normalizedName.toLowerCase().includes(normalizedKey.toLowerCase())) {
          const value = row[key];
          if (value !== undefined && value !== null && String(value).trim() !== '') {
            console.log(`🔍 Columna encontrada por coincidencia parcial: "${key}" -> "${name}"`);
            return cleanString(value);
          }
        }
      }
    }
    return null;
  };

  // Buscar convenio con múltiples variantes posibles
  const convenio = getColumnValue([
    'Convenios  (cod)',
    'Convenios (cod)',
    'Convenios(cod)',
    'Convenios',
    'Convenio',
    'Código Convenio',
    'Codigo Convenio'
  ]);
  
  const pesoGRD = isNumeric(row['Peso GRD Medio (Todos)'])
    ? parseFloat(row['Peso GRD Medio (Todos)'])
    : null;
  
  // Log de depuración para la primera fila procesada (siempre mostrar, no solo en development)
  if (rowIndex === 1) {
    console.log('📋 Columnas disponibles en el CSV:', Object.keys(row));
    console.log('🔍 Buscando columna de convenio...');
    console.log(`🔍 Convenio encontrado: "${convenio}" para episodio ${row['Episodio CMBD']}`);
  }
  
  // Calcular precioBaseTramo automáticamente si hay convenio
  let precioBaseTramoCalculado: number | null = null;
  if (convenio) {
    precioBaseTramoCalculado = await obtenerPrecioBaseTramo(convenio, pesoGRD);
    if (precioBaseTramoCalculado !== null) {
      console.log(`💰 Precio base calculado para episodio ${row['Episodio CMBD']}: ${precioBaseTramoCalculado} (convenio: ${convenio}, peso: ${pesoGRD})`);
    } else {
      console.warn(`⚠️ No se pudo calcular precio base para episodio ${row['Episodio CMBD']} (convenio: ${convenio}, peso: ${pesoGRD})`);
    }
  } else {
    // Solo mostrar warning en la primera fila para no saturar los logs
    if (rowIndex === 1) {
      const columnasConvenio = Object.keys(row).filter(k => k.toLowerCase().includes('conven'));
      console.warn(`⚠️ Convenio no encontrado para episodio ${row['Episodio CMBD']}.`);
      console.warn(`   Columnas que contienen "conven":`, columnasConvenio.length > 0 ? columnasConvenio : 'NINGUNA');
      console.warn(`   Todas las columnas:`, Object.keys(row));
    }
  }

  // 4. Crea el Episodio, ahora SÍ podemos vincular el grdId
  return await prisma.episodio.create({
    data: {
      centro: cleanString(row['Hospital (Descripción)']),
      numeroFolio: cleanString(row['ID Derivación']),
      episodioCmdb: cleanString(row['Episodio CMBD']),
      tipoEpisodio: cleanString(row['Tipo Actividad']),
      fechaIngreso: new Date(row['Fecha Ingreso completa']),
      fechaAlta: new Date(row['Fecha Completa']),
      servicioAlta: cleanString(row['Servicio Egreso (Descripción)']),
      montoRn: isNumeric(row['Facturación Total del episodio']) // Asegúrate que esta columna exista en tu excel
        ? parseFloat(row['Facturación Total del episodio'])
        : 0,
      pesoGrd: pesoGRD, // Mapea la columna "Peso GRD Medio (Todos)"
      convenio: convenio, // Guardar el convenio
      precioBaseTramo: precioBaseTramoCalculado, // Precio base calculado automáticamente
      inlierOutlier: cleanString(row['IR Alta Inlier / Outlier']),
      diasEstada: isNumeric(row['Estancia real del episodio'])
        ? parseInt(String(row['Estancia real del episodio']), 10)
        : null,

      // Vinculamos las entidades
      pacienteId: paciente.id,
      grdId: grdRule.id, // <-- ¡Esto ahora SIEMPRE funcionará!
    },
    include: {
      paciente: true,
      grd: true,
    },
  });
}

// Endpoint de importación de episodios (formato esperado por el frontend)
router.post('/episodios/import', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  const errorRecords: any[] = [];
  const validRecords: RawRow[] = [];

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    const replace = req.body.replace === 'true';
    if (replace) {
      console.log('REEMPLAZANDO DATOS: Eliminando episodios anteriores...');
      // ¡CUIDADO! Esto borra todo.
      // Para evitar borrar en cascada Pacientes o Grds (si están enlazados),
      // es más seguro borrar solo los episodios.
      await prisma.episodio.deleteMany({});
      // Si quisieras borrar todo:
      // await prisma.episodio.deleteMany({});
      // await prisma.paciente.deleteMany({});
      // await prisma.grd.deleteMany({}); // <-- No recomendado si quieres mantener el catálogo
    }

    const fileBuffer = req.file.buffer;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let data: RawRow[] = [];

    // Parsear archivo desde el buffer de memoria
    if (ext === '.csv') {
      await new Promise<void>((resolve, reject) => {
        Readable.from(fileBuffer)
          .pipe(csv())
          .on('data', (row) => data.push(row as RawRow))
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet) as RawRow[];
    }

    // Validar y procesar filas
    let index = 0;
    const createdEpisodes: any[] = [];
    
    for (const row of data) {
      index++;
      // Usamos el validateRow modificado
      const isValid = await validateRow(row, index); 
      if (isValid) {
        validRecords.push(row);
        try {
          // Usamos el processRow modificado (pasar el índice para logs)
          const episode = await processRow(row, index);
          createdEpisodes.push(episode);
        } catch (err: any) {
          console.error(`Error procesando fila ${index}:`, err.message);
          errorRecords.push({
            fila: index,
            error: err.message || 'Error al procesar fila',
          });
        }
      } else {
        // El error ya se logueó en validateRow
        errorRecords.push({
          fila: index,
          error: 'Fila inválida o duplicada (ver logs del servidor para detalle)',
        });
      }
    }

    // Helper para convertir Decimal a Number
    const toNumber = (value: any): number => {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseFloat(value) || 0;
      if (value && typeof value.toNumber === 'function') return value.toNumber();
      return 0;
    };

    // Formato de respuesta esperado por el frontend
    const response = {
      summary: {
        total: data.length,
        valid: createdEpisodes.length,
        errors: errorRecords.length,
      },
      episodes: createdEpisodes.map((e) => ({
        episodio: e.episodioCmdb || '',
        nombre: e.paciente?.nombre || '',
        rut: e.paciente?.rut || '',
        centro: e.centro || '',
        folio: e.numeroFolio || '',
        tipoEpisodio: e.tipoEpisodio || '',
        fechaIngreso: e.fechaIngreso ? e.fechaIngreso.toISOString().split('T')[0] : '',
        // ===================================================================
        // ======================= ¡AQUÍ ESTÁ LA CORRECCIÓN! =================
        // ===================================================================
        fechaAlta: e.fechaAlta ? e.fechaAlta.toISOString().split('T')[0] : '', // <-- ANTES DECÍA [MAIN]
        servicioAlta: e.servicioAlta || '',
        grdCodigo: e.grd?.codigo || '',
        peso: toNumber(e.pesoGrd), // Para compatibilidad
        pesoGrd: toNumber(e.pesoGrd), // Campo "Peso GRD Medio (Todos)"
        montoRN: toNumber(e.montoRn),
        inlierOutlier: e.inlierOutlier || '',
      })),
      // Opcional: enviar los primeros 50 errores al frontend
      errorDetails: errorRecords.slice(0, 50),
    };

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('Error al importar episodios:', error);
    console.error('Stack:', error?.stack);
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: error?.message || 'Error procesando archivo',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

export default router;

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
  if (episode.atDetalle && typeof episode.atDetalle === 'string' && episode.atDetalle.trim() !== '') {
    atDetalle = episode.atDetalle;
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
    
    // Campos de solo lectura
    grdCodigo: episode.grd?.codigo || '',
    peso: toNumber(episode.pesoGrd), // SIEMPRE number o null
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
      return {
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
        estadoRN: normalized.estadoRN,
        at: normalized.at,
        montoAT: normalized.montoAT,
        diasDemoraRescate: normalized.diasDemoraRescate,
        pagoDemora: normalized.pagoDemora,
        pagoOutlierSup: normalized.pagoOutlierSup,
        precioBaseTramo: normalized.precioBaseTramo,
        valorGRD: normalized.valorGRD,
        montoFinal: normalized.montoFinal,
      };
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

// Esquema de validación específico para campos de finanzas (PATCH)
// Validamos con nombres del frontend, luego mapeamos a nombres de BD
// Acepta 'at' como boolean O string ("S"/"N") para retrocompatibilidad
const finanzasSchema = Joi.object({
  estadoRN: Joi.string().valid('Aprobado', 'Pendiente', 'Rechazado').allow(null, '').optional(),
  at: Joi.alternatives().try(
    Joi.boolean(),
    Joi.string().valid('S', 's', 'N', 'n')
  ).optional(),
  atDetalle: Joi.string().allow(null, '').optional(),
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
  // valorGRD NO es editable - se calcula automáticamente como peso * precioBaseTramo
  // Se ignora si viene en el request
  montoFinal: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(), // Se ignora, se calcula automáticamente
  documentacion: Joi.string().allow(null, '').optional(),
}).unknown(false); // No permitir campos desconocidos

// Mapeo completo de campos del frontend a la base de datos para finanzas
// NOTA: valorGRD NO está en el mapeo porque NO es editable (se calcula automáticamente)
const finanzasFieldMapping: Record<string, string> = {
  estadoRN: 'estadoRn',
  at: 'atSn',
  montoAT: 'montoAt',
  montoRN: 'montoRn',
  pagoDemora: 'pagoDemoraRescate',
  pagoOutlierSup: 'pagoOutlierSuperior',
  // valorGRD: NO editable, se calcula automáticamente
};

// Actualizar episodio parcialmente (PATCH) - Funcionalidad de Finanzas
router.patch('/episodios/:id', requireAuth, requireRole(['finanzas', 'FINANZAS']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Ignorar valorGRD si viene en el request (se calculará automáticamente)
    const requestBody = { ...req.body };
    delete requestBody.valorGRD;
    
    // Validar campos según esquema de finanzas (con nombres del frontend)
    const { error, value: validatedValue } = finanzasSchema.validate(requestBody, {
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

    // Si no hay campos para actualizar, retornar error
    if (Object.keys(validatedValue).length === 0) {
      return res.status(400).json({ 
        message: 'No se proporcionaron campos para actualizar',
        error: 'ValidationError'
      });
    }

    // Mapear campos del frontend a nombres de la base de datos
    const updateData: any = {};
    for (const [key, value] of Object.entries(validatedValue)) {
      const dbKey = finanzasFieldMapping[key] || key;
      
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

    // IGNORAR montoFinal y valorGRD si vienen en el request (se calcularán automáticamente)
    delete updateData.montoFinal;
    delete updateData.valorGrd; // valorGRD NO es editable, siempre se calcula

    // Validaciones de reglas de negocio
    // Si at === false, atDetalle debe ser null
    if (updateData.atSn === false && updateData.atDetalle !== undefined) {
      updateData.atDetalle = null;
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

    // Intentar buscar primero por episodioCmdb (el campo que usa el frontend)
    // Esto es importante porque el frontend envía el valor del campo "episodio" del objeto
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
      // Log para debugging
      console.log(`🔍 PATCH /api/episodios/${id}: Episodio no encontrado`);
      console.log(`   - Buscado por episodioCmdb: "${id}"`);
      if (!isNaN(idNum)) {
        console.log(`   - Buscado por id interno: ${idNum}`);
      }
      
      return res.status(404).json({
        message: `El episodio ${id} no fue encontrado`,
        error: 'NotFound'
      });
    }

    // Log para debugging (solo en desarrollo)
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ PATCH /api/episodios/${id}: Episodio encontrado`);
      console.log(`   - ID interno: ${episodio.id}`);
      console.log(`   - episodioCmdb: ${episodio.episodioCmdb}`);
    }

    // Obtener valores actuales del episodio
    const pesoActual = episodio.pesoGrd ? Number(episodio.pesoGrd) : 0;
    const precioBaseTramoActual = episodio.precioBaseTramo ? Number(episodio.precioBaseTramo) : 0;
    const montoATActual = episodio.montoAt ? Number(episodio.montoAt) : 0;
    const pagoOutlierSupActual = episodio.pagoOutlierSuperior ? Number(episodio.pagoOutlierSuperior) : 0;
    const pagoDemoraActual = episodio.pagoDemoraRescate ? Number(episodio.pagoDemoraRescate) : 0;

    // Usar valores nuevos si vienen en el request, sino usar los actuales
    // Si viene null explícitamente, usar 0 para el cálculo (pero guardar null en BD)
    // NOTA: pesoGrd NO es editable por finanzas, siempre usar el valor actual
    const peso = pesoActual;
    const precioBaseTramo = updateData.precioBaseTramo !== undefined ? (updateData.precioBaseTramo ?? 0) : precioBaseTramoActual;
    const montoAT = updateData.montoAt !== undefined ? (updateData.montoAt ?? 0) : montoATActual;
    const pagoOutlierSup = updateData.pagoOutlierSuperior !== undefined ? (updateData.pagoOutlierSuperior ?? 0) : pagoOutlierSupActual;
    const pagoDemora = updateData.pagoDemoraRescate !== undefined ? (updateData.pagoDemoraRescate ?? 0) : pagoDemoraActual;

    // PASO 1: SIEMPRE recalcular valorGRD = peso * precioBaseTramo
    // (ignorar cualquier valor que haya venido en el request)
    const valorGRDCalculado = calcularValorGRD(peso, precioBaseTramo);
    updateData.valorGrd = valorGRDCalculado;

    // PASO 2: Calcular montoFinal usando el valorGRD calculado
    const montoFinalCalculado = calcularMontoFinal(
      valorGRDCalculado,
      montoAT,
      pagoOutlierSup,
      pagoDemora
    );
    updateData.montoFinal = montoFinalCalculado;

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

// Eliminar episodio (AHORA EN PRISMA)
router.delete('/episodios/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.episodio.delete({
      where: { id: parseInt(id) },
    });
    res.json({ success: true, message: 'Episodio eliminado' });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar episodio' });
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
async function processRow(row: RawRow) {
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

  // 3. Crea el Episodio, ahora SÍ podemos vincular el grdId
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
      pesoGrd: isNumeric(row['Peso Medio [Norma IR]']) // Usamos la columna correcta
        ? parseFloat(row['Peso Medio [Norma IR]'])
        : 0,
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
          // Usamos el processRow modificado
          const episode = await processRow(row);
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
        peso: toNumber(e.pesoGd),
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

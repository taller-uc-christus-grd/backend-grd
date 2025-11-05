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

    // Transformar al formato esperado por el frontend
    const items = episodes.map((e) => ({
      episodio: e.episodioCmdb || '',
      nombre: e.paciente?.nombre || '',
      rut: e.paciente?.rut || '',
      centro: e.centro || '',
      folio: e.numeroFolio || '',
      tipoEpisodio: e.tipoEpisodio || '',
      fechaIngreso: e.fechaIngreso ? e.fechaIngreso.toISOString().split('T')[0] : '',
      fechaAlta: e.fechaAlta ? e.fechaAlta.toISOString().split('T')[0] : '',
      servicioAlta: e.servicioAlta || '',
      grdCodigo: e.grd?.codigo || '',
      peso: toNumber(e.pesoGrd),
      montoRN: toNumber(e.montoRn),
      inlierOutlier: e.inlierOutlier || '',
    }));

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

// Obtener episodio por id (AHORA DESDE PRISMA) - Soporta ID numérico o episodioCmdb
router.get('/episodios/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'ID es requerido' });
    }
    
    // Intentar buscar por ID numérico o por episodioCmdb
    const idNum = parseInt(id);
    let episodio;
    
    if (isNaN(idNum)) {
      // Buscar por episodioCmdb (string) - usar findFirst porque no es único
      episodio = await prisma.episodio.findFirst({
        where: { episodioCmdb: id },
        include: {
          paciente: true,
          grd: true,
          diagnosticos: true,
          respaldos: true,
        },
      });
    } else {
      // Buscar por ID numérico (único)
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
    res.json(episodio);
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

    // Intentar buscar por ID numérico o por episodioCmdb
    const idNum = parseInt(id);
    let episodioId: number;

    if (isNaN(idNum)) {
      // Buscar por episodioCmdb (string) - obtener el ID primero
      const existing = await prisma.episodio.findFirst({
        where: { episodioCmdb: id },
        select: { id: true },
      });
      
      if (!existing) {
        return res.status(404).json({ error: 'Episodio no encontrado' });
      }
      
      episodioId = existing.id;
    } else {
      // Verificar que existe el ID numérico
      const existing = await prisma.episodio.findUnique({
        where: { id: idNum },
        select: { id: true },
      });
      
      if (!existing) {
        return res.status(404).json({ error: 'Episodio no encontrado' });
      }
      
      episodioId = idNum;
    }

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
const finanzasSchema = Joi.object({
  estadoRN: Joi.string().valid('Aprobado', 'Pendiente', 'Rechazado').allow(null).optional(),
  at: Joi.boolean().optional(),
  atDetalle: Joi.string().allow(null, '').optional(),
  montoAT: Joi.number().min(0).optional(),
  montoRN: Joi.number().min(0).optional(),
  diasDemoraRescate: Joi.number().integer().min(0).optional(),
  pagoDemora: Joi.number().min(0).allow(null).optional(),
  pagoOutlierSup: Joi.number().min(0).allow(null).optional(),
  precioBaseTramo: Joi.number().min(0).optional(),
  valorGRD: Joi.number().min(0).optional(),
  montoFinal: Joi.number().min(0).optional(), // Se ignora, se calcula automáticamente
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
  valorGRD: 'valorGrd',
};

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

// Actualizar episodio parcialmente (PATCH) - Funcionalidad de Finanzas
router.patch('/episodios/:id', requireAuth, requireRole(['finanzas', 'FINANZAS']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Validar campos según esquema de finanzas (con nombres del frontend)
    const { error, value: validatedValue } = finanzasSchema.validate(req.body, {
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
      updateData[dbKey] = value;
    }

    // IGNORAR montoFinal si viene en el request (se calculará automáticamente)
    delete updateData.montoFinal;

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

    // Buscar episodio por ID numérico o por episodioCmdb
    const idNum = parseInt(id);
    let episodio;

    if (isNaN(idNum)) {
      // Buscar por episodioCmdb (string)
      episodio = await prisma.episodio.findFirst({
        where: { episodioCmdb: id },
        include: {
          paciente: true,
          grd: true,
          diagnosticos: true,
          respaldos: true,
        },
      });
    } else {
      // Buscar por ID numérico
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
      return res.status(404).json({
        message: `El episodio ${id} no fue encontrado`,
        error: 'NotFound'
      });
    }

    // Obtener valores actuales para calcular montoFinal
    const valorGRDActual = episodio.valorGrd ? Number(episodio.valorGrd) : 0;
    const montoATActual = episodio.montoAt ? Number(episodio.montoAt) : 0;
    const pagoOutlierSupActual = episodio.pagoOutlierSuperior ? Number(episodio.pagoOutlierSuperior) : 0;
    const pagoDemoraActual = episodio.pagoDemoraRescate ? Number(episodio.pagoDemoraRescate) : 0;

    // Usar valores nuevos si vienen en el request, sino usar los actuales
    // Si viene null explícitamente, usar 0 para el cálculo (pero guardar null en BD)
    const valorGRD = updateData.valorGrd !== undefined ? (updateData.valorGrd ?? 0) : valorGRDActual;
    const montoAT = updateData.montoAt !== undefined ? (updateData.montoAt ?? 0) : montoATActual;
    const pagoOutlierSup = updateData.pagoOutlierSuperior !== undefined ? (updateData.pagoOutlierSuperior ?? 0) : pagoOutlierSupActual;
    const pagoDemora = updateData.pagoDemoraRescate !== undefined ? (updateData.pagoDemoraRescate ?? 0) : pagoDemoraActual;

    // Calcular montoFinal automáticamente
    const montoFinalCalculado = calcularMontoFinal(
      valorGRD,
      montoAT,
      pagoOutlierSup,
      pagoDemora
    );

    // Agregar montoFinal calculado a los datos de actualización
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

    // Formatear respuesta según especificaciones
    const response = {
      episodio: updated.episodioCmdb || '',
      rut: updated.paciente?.rut || '',
      nombre: updated.paciente?.nombre || '',
      fechaIngreso: updated.fechaIngreso ? updated.fechaIngreso.toISOString().split('T')[0] : null,
      fechaAlta: updated.fechaAlta ? updated.fechaAlta.toISOString().split('T')[0] : null,
      servicioAlta: updated.servicioAlta || '',
      
      // Campos editables por finanzas
      estadoRN: updated.estadoRn,
      at: updated.atSn,
      atDetalle: updated.atDetalle,
      montoAT: updated.montoAt ? Number(updated.montoAt) : null,
      montoRN: updated.montoRn ? Number(updated.montoRn) : null,
      diasDemoraRescate: updated.diasDemoraRescate,
      pagoDemora: updated.pagoDemoraRescate ? Number(updated.pagoDemoraRescate) : null,
      pagoOutlierSup: updated.pagoOutlierSuperior ? Number(updated.pagoOutlierSuperior) : null,
      precioBaseTramo: updated.precioBaseTramo ? Number(updated.precioBaseTramo) : null,
      valorGRD: updated.valorGrd ? Number(updated.valorGrd) : null,
      montoFinal: updated.montoFinal ? Number(updated.montoFinal) : null,
      documentacion: updated.documentacion 
        ? (typeof updated.documentacion === 'string' 
            ? updated.documentacion 
            : (typeof updated.documentacion === 'object' && updated.documentacion !== null
                ? ('texto' in updated.documentacion 
                    ? updated.documentacion.texto as string
                    : JSON.stringify(updated.documentacion))
                : String(updated.documentacion)))
        : null,
      
      // Campos de solo lectura
      grdCodigo: updated.grd?.codigo || '',
      peso: updated.pesoGrd ? Number(updated.pesoGrd) : null,
      inlierOutlier: updated.inlierOutlier || '',
      grupoDentroNorma: updated.grupoEnNorma,
      diasEstada: updated.diasEstada,
      
      // Otros campos del episodio
      centro: updated.centro,
      numeroFolio: updated.numeroFolio,
      tipoEpisodio: updated.tipoEpisodio,
      id: updated.id,
    };

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

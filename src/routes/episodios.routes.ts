import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middlewares/auth';
import { prisma } from '../db/client'; // ¡Importante! Conecta con la DB

const router = Router();

// --- Configuración de Multer para importación de episodios ---
//const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
//if (!fs.existsSync(UPLOAD_DIR)) {
//  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
//}

//const storage = multer.diskStorage({
//  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
//  filename: (req, file, cb) => {
//    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
//    cb(null, 'episodes-import-' + uniqueSuffix + path.extname(file.originalname));
//  },
//});

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
  atSn: Joi.boolean().optional().allow(null),
  atDetalle: Joi.string().optional().allow(null),
  montoAt: Joi.number().optional().allow(null),
  tipoAlta: Joi.string().optional().allow(null),
  pesoGrd: Joi.number().optional().allow(null),
  montoRn: Joi.number().optional().allow(null),
  diasDemoraRescate: Joi.number().integer().optional().allow(null),
  pagoDemoraRescate: Joi.number().optional().allow(null),
  pagoOutlierSuperior: Joi.number().optional().allow(null),
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
router.get('/episodes', requireAuth, async (_req: Request, res: Response) => {
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

// Obtener episodio por id (AHORA DESDE PRISMA)
router.get('/episodes/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'ID es requerido' });
    }
    
    const idNum = parseInt(id);
    if (isNaN(idNum)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    
    const episodio = await prisma.episodio.findUnique({
      where: { id: idNum },
      include: {
        paciente: true,
        grd: true,
        diagnosticos: true, // Incluye diagnósticos asociados
        respaldos: true, // Incluye respaldos asociados
      },
    });

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
router.post('/episodes', requireAuth, async (req: Request, res: Response) => {
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

// Actualizar episodio (AHORA EN PRISMA)
router.put('/episodes/:id', requireAuth, async (req: Request, res: Response) => {
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

    const updated = await prisma.episodio.update({
      where: { id: parseInt(id) },
      data: value,
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

// Eliminar episodio (AHORA EN PRISMA)
router.delete('/episodes/:id', requireAuth, async (req: Request, res: Response) => {
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
  // Convertir a string siempre, incluso si es un número (para campos como Episodio CMBD que pueden venir como número desde Excel)
  const s = String(value);
  const out = s.replace(/\s+/g, ' ').trim();
  return out === '' ? null : out;
}

async function validateRow(row: RawRow, index: number): Promise<boolean> {
  const requiredFields = ['Episodio CMBD', 'Hospital (Descripción)', 'RUT', 'IR GRD (Código)'];
  const missing = requiredFields.filter((f) => isEmpty(row[f]));
  
  if (missing.length > 0) {
    return false;
  }

  // Validación de duplicados - convertir a string para asegurar compatibilidad con Prisma
  const episodioCmdb = cleanString(row['Episodio CMBD']);
  if (episodioCmdb) {
    const existing = await prisma.episodio.findFirst({
      where: { episodioCmdb: episodioCmdb },
    });
    if (existing) {
      return false;
    }
  } else {
    return false;
  }
  
  // Validar que el GRD exista
  const grdCode = cleanString(row['IR GRD (Código)']);
  if (grdCode) {
    const grdRule = await prisma.grd.findUnique({ where: { codigo: grdCode }});
    if (!grdRule) {
      return false;
    }
  } else {
    return false;
  }

  if (!isValidDate(row['Fecha Ingreso completa']) || !isValidDate(row['Fecha Completa'])) {
    return false;
  }

  return true;
}

async function processRow(row: RawRow) {
  const rut = cleanString(row['RUT']);
  const nombre = cleanString(row['Nombre']);
  const grdCode = cleanString(row['IR GRD (Código)'])!;

  const paciente = await prisma.paciente.upsert({
    where: { rut: rut || 'SIN-RUT' },
    update: {
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']),
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
    create: {
      rut: rut || 'SIN-RUT',
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']),
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
  });

  const grdRule = await prisma.grd.findUnique({ where: { codigo: grdCode }});
  if (!grdRule) {
    throw new Error(`Regla GRD ${grdCode} no encontrada durante el procesamiento.`);
  }

  return await prisma.episodio.create({
    data: {
      centro: cleanString(row['Hospital (Descripción)']),
      numeroFolio: cleanString(row['ID Derivación']),
      episodioCmdb: cleanString(row['Episodio CMBD']),
      tipoEpisodio: cleanString(row['Tipo Actividad']),
      fechaIngreso: new Date(row['Fecha Ingreso completa']),
      fechaAlta: new Date(row['Fecha Completa']),
      servicioAlta: cleanString(row['Servicio Egreso (Descripción)']),
      montoRn: isNumeric(row['Facturación Total del episodio'])
        ? parseFloat(row['Facturación Total del episodio'])
        : 0,
      pesoGrd: isNumeric(row['Peso GRD Medio (Todos)'])
        ? parseFloat(row['Peso GRD Medio (Todos)'])
        : 0,
      inlierOutlier: cleanString(row['IR Alta Inlier / Outlier']),
      pacienteId: paciente.id,
      grdId: grdRule.id,
    },
    include: {
      paciente: true,
      grd: true,
    },
  });
}

// Endpoint de importación de episodios (formato esperado por el frontend)
router.post('/episodes/import', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  //let filePath: string | null = null;
  const errorRecords: any[] = [];
  const validRecords: RawRow[] = [];

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    // Verificar si se debe reemplazar (opción replace del frontend)
    const replace = req.body.replace === 'true';
    if (replace) {
      // Eliminar todos los episodios existentes
      await prisma.episodio.deleteMany({});
    }

    const fileBuffer = req.file.buffer;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let data: RawRow[] = [];

    // Parsear archivo
    if (ext === '.csv') {
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(fileBuffer)
          .pipe(csv())
          .on('data', (row) => data.push(row as RawRow))
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      const workbook = XLSX.readFile(fileBuffer);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet) as RawRow[];
    }

    // Validar y procesar filas
    let index = 0;
    const createdEpisodes: any[] = [];
    
    for (const row of data) {
      index++;
      const isValid = await validateRow(row, index);
      if (isValid) {
        validRecords.push(row);
        try {
          const episode = await processRow(row);
          createdEpisodes.push(episode);
        } catch (err: any) {
          errorRecords.push({
            fila: index,
            error: err.message || 'Error al procesar fila',
          });
        }
      } else {
        errorRecords.push({
          fila: index,
          error: 'Fila inválida o duplicada',
        });
      }
    }

    // Limpiar archivo temporal
    //if (filePath && fs.existsSync(filePath)) {
    //  fs.unlinkSync(filePath);
    //}

    // Helper para convertir Decimal a Number
    const toNumber = (value: any): number => {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseFloat(value) || 0;
      // Si es un objeto Decimal de Prisma
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
        fechaAlta: e.fechaAlta ? e.fechaAlta.toISOString().split('T')[0] : '',
        servicioAlta: e.servicioAlta || '',
        grdCodigo: e.grd?.codigo || '',
        peso: toNumber(e.pesoGrd),
        montoRN: toNumber(e.montoRn),
        inlierOutlier: e.inlierOutlier || '',
      })),
    };

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('Error al importar episodios:', error);
    console.error('Stack:', error?.stack);
    //if (filePath && fs.existsSync(filePath)) {
    //  try { fs.unlinkSync(filePath); } catch (_) {}
    //}
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: error?.message || 'Error procesando archivo',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

// Endpoint para obtener metadata de episodios
router.get('/episodes/meta', requireAuth, async (_req: Request, res: Response) => {
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
router.get('/episodes/final', requireAuth, async (req: Request, res: Response) => {
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
      // Si es un objeto Decimal de Prisma
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

export default router;
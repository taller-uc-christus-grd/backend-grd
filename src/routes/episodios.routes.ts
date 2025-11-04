import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import * as path from 'path';
// import * as fs from 'fs'; // No se necesita para memoryStorage
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middlewares/auth';
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
router.post('/episodes/import', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
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

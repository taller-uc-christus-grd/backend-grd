import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import csv from 'csv-parser';
import *S XLSX from 'xlsx';
import { prisma, Prisma } from '../db/client'; // ¡Importante! Conecta con la DB
import { requireAuth } from '../middlewares/auth'; // Proteger la ruta

const router = Router();

// --- Configuración de Multer (Almacenamiento temporal) ---
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

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
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10MB Límite
});

// --- Lógica de ETL (Adaptada de tus scripts) ---

type RawRow = Record<string, string>;
const errorRecords: any[] = [];
const validRecords: RawRow[] = [];

// Funciones Helper de limpieza
function isEmpty(value?: string | null): boolean {
  return !value || value.trim() === '' || value.toLowerCase() === 'null';
}
function isNumeric(value?: string | null): boolean {
  return value !== undefined && value !== null && !isNaN(Number(value));
}
function isValidDate(value?: string | null): boolean {
  return value ? !isNaN(new Date(value).getTime()) : false;
}
function cleanString(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, ' ').trim();
}

// Valida una fila (adaptado de tu script)
// NOTA: La validación de duplicados en la DB es costosa para un request.
// La comentamos, pero la de "campos faltantes" es clave.
async function validateRow(row: RawRow, index: number): Promise<boolean> {
  const requiredFields = ['Episodio CMBD', 'Hospital (Descripción)', 'RUT', 'IR GRD (Código)'];
  const missing = requiredFields.filter((f) => isEmpty(row[f]));

  if (missing.length > 0) {
    errorRecords.push({
      fila: index,
      error: `Campos faltantes: ${missing.join(', ')}`,
      registro: row,
    });
    return false;
  }

  // Validación de duplicados (Costosa para un request, pero la mantenemos de tu script)
  const existing = await prisma.episodio.findFirst({
    where: { episodioCmdb: row['Episodio CMBD'] },
  });
  if (existing) {
    errorRecords.push({
      fila: index,
      error: `Duplicado detectado: Episodio CMBD ${row['Episodio CMBD']}`,
      registro: row,
    });
    return false;
  }

  if (!isValidDate(row['Fecha Ingreso completa']) || !isValidDate(row['Fecha Completa'])) {
    errorRecords.push({
      fila: index,
      error: 'Fecha inválida en ingreso o alta',
      registro: row,
    });
    return false;
  }

  return true;
}

// Procesa y guarda una fila en la DB (adaptado de tu script)
async function processRow(row: RawRow) {
  const rut = cleanString(row['RUT']);
  const nombre = cleanString(row['Nombre']);

  const paciente = await prisma.paciente.upsert({
    where: { rut: rut || 'SIN-RUT' }, // Usar un placeholder si el RUT es nulo
    update: {
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']),
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
    create: {
      rut: rut || 'SIN-RUT',
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']),
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
  });

  const grd = await prisma.grd.upsert({
    where: { codigo: row['IR GRD (Código)'] },
    update: {
      descripcion: row['IR GRD'],
      peso: isNumeric(row['Peso GRD Medio (Todos)']) ? new Prisma.Decimal(row['Peso GRD Medio (Todos)']) : null,
    },
    create: {
      codigo: row['IR GRD (Código)'],
      descripcion: row['IR GRD'],
      peso: isNumeric(row['Peso GRD Medio (Todos)']) ? new Prisma.Decimal(row['Peso GRD Medio (Todos)']) : null,
    },
  });

  await prisma.episodio.create({
    data: {
      centro: cleanString(row['Hospital (Descripción)']),
      numeroFolio: cleanString(row['ID Derivación']),
      episodioCmdb: cleanString(row['Episodio CMBD']),
      tipoEpisodio: cleanString(row['Tipo Actividad']),
      fechaIngreso: new Date(row['Fecha Ingreso completa']),
      fechaAlta: new Date(row['Fecha Completa']),
      servicioAlta: cleanString(row['Servicio Egreso (Descripción)']),
      montoRn: isNumeric(row['Facturación Total del episodio'])
        ? new Prisma.Decimal(row['Facturación Total del episodio'])
        : new Prisma.Decimal(0),
      pesoGrd: isNumeric(row['Peso GRD Medio (Todos)'])
        ? new Prisma.Decimal(row['Peso GRD Medio (Todos)'])
        : new Prisma.Decimal(0),
      inlierOutlier: cleanString(row['IR Alta Inlier / Outlier']),
      pacienteId: paciente.id,
      grdId: grd.id,
      // ... (agregar más campos si es necesario)
    },
  });
}

// --- Endpoint de Carga (AHORA GUARDA EN DB) ---
router.post('/upload', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  let filePath: string | null = null;
  
  // Limpiar arrays de errores/válidos en cada request
  errorRecords.length = 0;
  validRecords.length = 0;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }
    filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let data: RawRow[] = [];

    // 1. Parsear el archivo (CSV o Excel) a un array de JSON
    if (ext === '.csv') {
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(filePath!)
          .pipe(csv()) // Asumir separador automático o especificar
          .on('data', (row) => data.push(row as RawRow))
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet) as RawRow[];
    }

    // 2. Validar cada fila (asíncronamente)
    console.log(`Validando ${data.length} filas...`);
    let index = 0;
    for (const row of data) {
      index++;
      const isValid = await validateRow(row, index); // Llama a la validación de BBDD
      if (isValid) {
        validRecords.push(row);
      }
    }
    
    // 3. Procesar y guardar solo las filas válidas
    console.log(`Guardando ${validRecords.length} filas válidas...`);
    for (const row of validRecords) {
      try {
        await processRow(row); // Llama a la lógica de guardado en BBDD
      } catch (err: any) {
        errorRecords.push({
          fila: 'Procesamiento',
          error: `Error al guardar: ${err.message}`,
          registro: row,
        });
      }
    }
    
    // 4. Generar respuesta
    const response = {
      success: true,
      message: 'Archivo procesado. Ver resumen.',
      summary: {
        total_rows: data.length,
        valid_rows: validRecords.length - errorRecords.filter(e => e.fila === 'Procesamiento').length,
        invalid_rows: errorRecords.length,
        file_name: req.file.originalname,
        file_size: req.file.size,
        processed_at: new Date().toISOString()
      },
      // Devuelve solo los primeros 50 errores para no sobrecargar el JSON
      errors: errorRecords.slice(0, 50) 
    };

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // Limpiar archivo temporal
    }

    return res.json(response);

  } catch (error: any) {
    console.error('Error general procesando archivo:', error);
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: error?.message || 'Error procesando archivo'
    });
  }
});

router.get('/upload/info', (_req: Request, res: Response) => {
  res.json({
    endpoint: '/api/upload',
    method: 'POST',
    description: 'Sube y procesa CSV/Excel con datos clínicos',
    accepted_formats: ['CSV (.csv)', 'Excel (.xlsx, .xls)'],
    max_file_size: '10MB'
  });
});

export default router;
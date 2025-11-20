import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import { prisma } from '../db/client';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../middlewares/auth'; // Proteger la ruta
import { logFileUpload } from '../utils/logger';

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

// Función para obtener el tamaño máximo de archivo desde la configuración
async function getMaxFileSize(): Promise<number> {
  try {
    const config = await prisma.configuracionSistema.findUnique({
      where: { clave: 'maxFileSizeMB' }
    });
    if (config && config.tipo === 'number') {
      return parseInt(config.valor) * 1024 * 1024; // Convertir MB a bytes
    }
  } catch (error) {
    console.error('Error obteniendo configuración de tamaño máximo:', error);
  }
  return 10 * 1024 * 1024; // Default: 10MB
}

// Crear upload middleware dinámico
const createUpload = () => {
  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 100 * 1024 * 1024, files: 1 }, // Límite temporal alto, se validará en el endpoint
  });
};

const upload = createUpload();

// --- Lógica de ETL (Adaptada de tus scripts) ---

type RawRow = Record<string, string>;
const errorRecords: any[] = [];
const validRecords: RawRow[] = [];

// Funciones Helper de limpieza
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
  const s = typeof value === 'string' ? value : String(value);
  const out = s.replace(/\s+/g, ' ').trim();
  return out === '' ? null : out;
}

// Helper para buscar columna "Convenio" de manera flexible
// Prioriza "Convenios (cod)" sobre "Convenios (des)" cuando hay múltiples columnas
function findConvenioValue(row: RawRow): string | null {
  // PRIMERA PRIORIDAD: Buscar específicamente columnas con "(cod)" que tengan valor
  // Esto asegura que encontremos "Convenios (cod)" antes que "Convenios (des)"
  const todasLasKeys = Object.keys(row);
  
  // Buscar primero columnas que contengan "(cod)" y tengan valor
  for (const key of todasLasKeys) {
    if (key) {
      const normalized = key.toLowerCase().trim().replace(/\s+/g, ' ');
      // Priorizar columnas que contengan "(cod)"
      if (normalized.includes('convenio') && (normalized.includes('(cod)') || normalized.includes(' cod'))) {
        const value = cleanString(row[key]);
        if (value) {
          console.log(`✅ Encontrado Convenio (prioridad cod) en columna "${key}": "${value}"`);
          return value;
        }
      }
    }
  }
  
  // SEGUNDA PRIORIDAD: Buscar por nombres exactos que contengan "(cod)"
  const nombresExactosConCod = [
    'Convenios (cod)',
    'Convenios  (cod)', // Con dos espacios
    'Convenios(cod)',
    'CONVENIOS (COD)',
    'convenios (cod)',
    'Convenio (cod)',
    'Convenio(cod)',
  ];
  
  for (const nombreExacto of nombresExactosConCod) {
    if (nombreExacto in row) {
      const value = cleanString(row[nombreExacto]);
      if (value) {
        console.log(`✅ Encontrado Convenio (exacto con cod) en columna "${nombreExacto}": "${value}"`);
        return value;
      }
    }
  }
  
  // TERCERA PRIORIDAD: Buscar otras variaciones de convenio (sin "(cod)" específico)
  for (const key of todasLasKeys) {
    if (key) {
      const normalized = key.toLowerCase().trim().replace(/\s+/g, ' ');
      if (normalized.includes('convenio') && !normalized.includes('(des)') && !normalized.includes(' des')) {
        const value = cleanString(row[key]);
        if (value) {
          console.log(`✅ Encontrado Convenio (flexible) en columna "${key}": "${value}"`);
          return value;
        }
      }
    }
  }
  
  // CUARTA PRIORIDAD: Buscar nombres exactos sin "(cod)"
  const nombresExactosSinCod = [
    'Convenio',
    'Convenios',
    'CONVENIO',
    'CONVENIOS'
  ];
  
  for (const nombreExacto of nombresExactosSinCod) {
    if (nombreExacto in row) {
      const value = cleanString(row[nombreExacto]);
      if (value) {
        console.log(`✅ Encontrado Convenio (exacto sin cod) en columna "${nombreExacto}": "${value}"`);
        return value;
      }
    }
  }
  
  // Log solo si realmente no se encontró nada
  if (todasLasKeys.length > 0) {
    const columnasConvenio = todasLasKeys.filter(k => k.toLowerCase().includes('convenio'));
    if (columnasConvenio.length > 0) {
      console.log(`⚠️ No se encontró columna Convenio con valor. Columnas relacionadas encontradas: ${columnasConvenio.join(', ')}`);
      columnasConvenio.forEach(col => {
        console.log(`   "${col}" = "${row[col]}" (vacío: ${!cleanString(row[col])})`);
      });
    }
  }
  return null;
}

/**
 * Valida una fila ANTES de procesarla.
 * ¡MODIFICADO con la validación de GRD!
 */
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

  // Validación de duplicados
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
  
  // ¡NUEVO! Validar que el GRD exista en nuestra tabla de Normas
  const grdCode = cleanString(row['IR GRD (Código)']);
  if (grdCode) {
    const grdRule = await prisma.grd.findUnique({ where: { codigo: grdCode }});
    if (!grdRule) {
      errorRecords.push({
        fila: index,
        error: `Regla GRD no encontrada en la Norma Minsal: ${grdCode}. Cargue la norma primero.`,
        registro: row,
      });
      return false;
    }
  } else {
     errorRecords.push({
        fila: index,
        error: `El campo 'IR GRD (Código)' está vacío.`,
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

/**
 * Procesa y guarda una fila en la DB (¡MODIFICADO!)
 * Ya no crea GRDs, solo los vincula.
 * Se corrige el error de Prisma.Decimal.
 */
async function processRow(row: RawRow) {
  const rut = cleanString(row['RUT']);
  const nombre = cleanString(row['Nombre']);
  const grdCode = cleanString(row['IR GRD (Código)'])!; // Sabemos que no es nulo por validateRow

  const paciente = await prisma.paciente.upsert({
    where: { rut: rut || 'SIN-RUT' }, // Usar un placeholder si el RUT es nulo
    update: {
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']), // Cuidado con el doble espacio
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
    create: {
      rut: rut || 'SIN-RUT',
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']), // Cuidado con el doble espacio
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
  });

  // ¡MODIFICADO! Ya no usamos 'upsert' para GRD. Solo buscamos el ID de la regla.
  const grdRule = await prisma.grd.findUnique({ where: { codigo: grdCode }});
  
  if (!grdRule) {
    // Esto no debería pasar gracias a validateRow, pero es una buena defensa
    throw new Error(`Regla GRD ${grdCode} no encontrada durante el procesamiento.`);
  }

  // ¡MODIFICADO! Aquí guardamos los datos *crudos* del CSV.
  // El cálculo se hará en la exportación.
  // ¡CORREGIDO! Se elimina 'new Prisma.Decimal()'
  // Buscar columna "Convenio" de manera flexible
  console.log(`🔍 [UPLOAD] Buscando Convenio para episodio ${cleanString(row['Episodio CMBD'])}`);
  const convenioValue = findConvenioValue(row);
  console.log(`💾 [UPLOAD] Convenio encontrado: "${convenioValue || 'null/vacío'}"`);

  await prisma.episodio.create({
    data: {
      centro: cleanString(row['Hospital (Descripción)']),
      numeroFolio: cleanString(row['ID Derivación']),
      episodioCmdb: cleanString(row['Episodio CMBD']),
      tipoEpisodio: cleanString(row['Tipo Actividad']),
      fechaIngreso: new Date(row['Fecha Ingreso completa']),
      fechaAlta: new Date(row['Fecha Completa']),
      servicioAlta: cleanString(row['Servicio Egreso (Descripción)']),
      
      // Guardamos los montos y pesos crudos del archivo de entrada
      // (Usamos parseFloat para manejar decimales)
      montoRn: isNumeric(row['Facturación Total del episodio'])
        ? parseFloat(row['Facturación Total del episodio'])
        : 0,
      pesoGrd: isNumeric(row['Peso GRD Medio (Todos)'])
        ? parseFloat(row['Peso GRD Medio (Todos)'])
        : 0,
        
      inlierOutlier: cleanString(row['IR Alta Inlier / Outlier']),
      // Convenio es un campo requerido - siempre debe estar presente
      // Si no hay valor en el Excel, usamos cadena vacía en lugar de null
      convenio: convenioValue ? cleanString(convenioValue) : '',
      
      // Vinculamos las entidades
      pacienteId: paciente.id,
      grdId: grdRule.id, // <-- Vinculado, no creado
    },
  });
  
  console.log(`✅ [UPLOAD] Episodio creado: ${cleanString(row['Episodio CMBD'])}, convenio: "${convenioValue ? cleanString(convenioValue) : ''}"`);
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

    // Validar tamaño del archivo contra la configuración del sistema
    const maxFileSize = await getMaxFileSize();
    if (req.file.size > maxFileSize) {
      const maxMB = maxFileSize / (1024 * 1024);
      return res.status(400).json({ 
        error: `El archivo excede el tamaño máximo permitido de ${maxMB}MB` 
      });
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
      // ¡validateRow ahora es async y consulta la DB!
      const isValid = await validateRow(row, index); 
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
    const validRowsCount = validRecords.length - errorRecords.filter(e => e.fila === 'Procesamiento').length;
    const response = {
      success: true,
      message: 'Archivo procesado. Ver resumen.',
      summary: {
        total_rows: data.length,
        valid_rows: validRowsCount,
        invalid_rows: errorRecords.length,
        file_name: req.file.originalname,
        file_size: req.file.size,
        processed_at: new Date().toISOString()
      },
      // Devuelve solo los primeros 50 errores para no sobrecargar el JSON
      errors: errorRecords.slice(0, 50) 
    };

    // Log de carga de archivo
    const userId = parseInt(req.user!.id);
    await logFileUpload(
      userId,
      req.file.originalname,
      req.file.size,
      true,
      errorRecords.length > 0 ? `${errorRecords.length} filas con errores` : undefined
    );

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // Limpiar archivo temporal
    }

    return res.json(response);

  } catch (error: any) {
    console.error('Error general procesando archivo:', error);
    
    // Log de error al cargar archivo
    if (req.user && req.file) {
      const userId = parseInt(req.user.id);
      await logFileUpload(
        userId,
        req.file.originalname,
        req.file.size,
        false,
        error?.message || 'Error procesando archivo'
      );
    }
    
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: error?.message || 'Error procesando archivo'
    });
  }
});

router.get('/upload/info', async (_req: Request, res: Response) => {
  const maxFileSize = await getMaxFileSize();
  const maxMB = maxFileSize / (1024 * 1024);
  
  res.json({
    endpoint: '/api/upload',
    method: 'POST',
    description: 'Sube y procesa CSV/Excel con datos clínicos',
    accepted_formats: ['CSV (.csv)', 'Excel (.xlsx, .xls)'],
    max_file_size: `${maxMB}MB`
  });
});

export default router;
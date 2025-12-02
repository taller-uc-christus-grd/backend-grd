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

function excelSerialToJSDate(serial: number): Date {
  const excelEpoch = new Date(1899, 11, 30);
  return new Date(excelEpoch.getTime() + serial * 86400000);
}


function isNumeric(value?: any): boolean {
  if (value === undefined || value === null) return false;
  return !isNaN(Number(value));
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
 * Calcula el tramo basado en el peso GRD para convenios con sistema de tramos (FNS012, FNS026)
 */
function calcularTramo(pesoGRD: number | null | undefined): 'T1' | 'T2' | 'T3' | null {
  if (pesoGRD === null || pesoGRD === undefined) {
    return null;
  }
  
  if (pesoGRD >= 0 && pesoGRD <= 1.5) {
    return 'T1';
  } else if (pesoGRD > 1.5 && pesoGRD <= 2.5) {
    return 'T2';
  } else if (pesoGRD > 2.5) {
    return 'T3';
  }
  
  return null;
}

/**
 * Obtiene el precio base por tramo basándose en el convenio y el peso GRD
 */
async function obtenerPrecioBaseTramo(
  convenio: string | null | undefined,
  pesoGRD: number | null | undefined
): Promise<number | null> {
  if (!convenio || typeof convenio !== 'string' || convenio.trim() === '') {
    return null;
  }

  const convenioNormalizado = convenio.trim().toUpperCase();
  const conveniosConTramos = ['FNS012', 'FNS026'];
  const conveniosPrecioUnico = ['FNS019', 'CH0041'];
  
  if (conveniosConTramos.includes(convenioNormalizado)) {
    const tramo = calcularTramo(pesoGRD);
    if (!tramo) {
      return null;
    }
    
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenioNormalizado,
        tramo: tramo
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    if (!precioRegistro || precioRegistro.precio === null || precioRegistro.precio === undefined) {
      return null;
    }
    
    const precio = typeof precioRegistro.precio === 'number' 
      ? precioRegistro.precio 
      : parseFloat(String(precioRegistro.precio));
    
    if (isNaN(precio) || !isFinite(precio)) {
      return null;
    }
    
    return precio;
    
  } else if (conveniosPrecioUnico.includes(convenioNormalizado)) {
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenioNormalizado
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    if (!precioRegistro || precioRegistro.precio === null || precioRegistro.precio === undefined) {
      return null;
    }
    
    const precio = typeof precioRegistro.precio === 'number' 
      ? precioRegistro.precio 
      : parseFloat(String(precioRegistro.precio));
    
    if (isNaN(precio) || !isFinite(precio)) {
      return null;
    }
    
    return precio;
  }
  
  return null;
}

/**
 * Valida una fila ANTES de procesarla.
 * ¡MODIFICADO con la validación de GRD!
 * Permite espacios y casillas vacías en campos opcionales
 */
async function validateRow(row: RawRow, index: number): Promise<boolean> {
  // Normalizar nombres de columnas buscando variaciones con espacios
  const normalizeColumnName = (name: string): string | null => {
    const normalized = name.trim().replace(/\s+/g, ' ');
    // Buscar en todas las claves del row
    for (const key of Object.keys(row)) {
      const normalizedKey = key.trim().replace(/\s+/g, ' ');
      if (normalizedKey.toLowerCase() === normalized.toLowerCase()) {
        return key;
      }
    }
    return null;
  };

  // Buscar campos requeridos con flexibilidad de espacios
  const requiredFields = [
    { name: 'Episodio CMBD', keys: ['Episodio CMBD', 'EpisodioCMBD', 'Episodio  CMBD'] },
    { name: 'Hospital (Descripción)', keys: ['Hospital (Descripción)', 'Hospital(Descripción)', 'Hospital  (Descripción)'] },
    { name: 'RUT', keys: ['RUT', 'Rut', 'rut'] },
    { name: 'IR GRD (Código)', keys: ['IR GRD (Código)', 'IR GRD(Código)', 'IR  GRD  (Código)'] }
  ];

  const missing: string[] = [];
  const foundFields: Record<string, string> = {};

  for (const field of requiredFields) {
    let found = false;
    for (const key of field.keys) {
      const actualKey = normalizeColumnName(key);
      if (actualKey && row[actualKey] !== undefined && row[actualKey] !== null) {
        const value = String(row[actualKey]).trim();
        if (value !== '') {
          foundFields[field.name] = actualKey;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      missing.push(field.name);
    }
  }

  if (missing.length > 0) {
    errorRecords.push({
      fila: index,
      error: `Campos faltantes: ${missing.join(', ')}`,
      registro: row,
    });
    return false;
  }

  // Validación de duplicados (usar el campo encontrado)
  const episodioKey = foundFields['Episodio CMBD'];
  const episodioValue = cleanString(row[episodioKey]);
  if (episodioValue) {
    const existing = await prisma.episodio.findFirst({
      where: { episodioCmdb: episodioValue },
    });
    if (existing) {
      errorRecords.push({
        fila: index,
        error: `Duplicado detectado: Episodio CMBD ${episodioValue}`,
        registro: row,
      });
      return false;
    }
  }
  
  // Validar que el GRD exista en nuestra tabla de Normas
  const grdKey = foundFields['IR GRD (Código)'];
  const grdCode = cleanString(row[grdKey]);
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

  // Validar fechas (permitir espacios pero deben ser válidas si están presentes)
  const fechaIngresoKey = normalizeColumnName('Fecha Ingreso completa') || 'Fecha Ingreso completa';
  const fechaAltaKey = normalizeColumnName('Fecha Completa') || 'Fecha Completa';
  
  const fechaIngreso = row[fechaIngresoKey];
  const fechaAlta = row[fechaAltaKey];
  
  // Solo validar fechas si tienen valor (permitir vacíos)
  if (fechaIngreso && String(fechaIngreso).trim() !== '' && !isValidDate(fechaIngreso)) {
    errorRecords.push({
      fila: index,
      error: 'Fecha de ingreso inválida',
      registro: row,
    });
    return false;
  }
  
  if (fechaAlta && String(fechaAlta).trim() !== '' && !isValidDate(fechaAlta)) {
    errorRecords.push({
      fila: index,
      error: 'Fecha de alta inválida',
      registro: row,
    });
    return false;
  }

  // Los siguientes campos pueden estar vacíos o con espacios:
  // 'Estado RN', 'AT', 'AT Detalle', 'Monto AT', 'Monto RN', 
  // 'Días Demora Rescate', 'Pago Demora Rescate', 'Pago Outlier Superior'
  // No se validan aquí, se procesan con valores por defecto en processRow

  return true;
}

/**
 * Procesa y guarda una fila en la DB (¡MODIFICADO!)
 * Ya no crea GRDs, solo los vincula.
 * Se corrige el error de Prisma.Decimal.
 */
async function processRow(row: RawRow) {
  console.log('========================================');
  console.log(`🔄 PROCESANDO FILA - Episodio: ${row['Episodio CMBD']}`);
  console.log('========================================');
  
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

  // Obtener datos para calcular precioBaseTramo
  const getColumnValue = (possibleNames: string[]): string | null => {
    for (const name of possibleNames) {
      const value = row[name];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return cleanString(value);
      }
    }
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
  
  console.log(`📋 Columnas disponibles:`, Object.keys(row));
  console.log(`🔍 Convenio encontrado: "${convenio}" para episodio ${row['Episodio CMBD']}`);
  
  let precioBaseTramoCalculado: number | null = null;
  if (convenio) {
    precioBaseTramoCalculado = await obtenerPrecioBaseTramo(convenio, pesoGRD);
    if (precioBaseTramoCalculado !== null) {
      console.log(`💰 Precio base calculado: ${precioBaseTramoCalculado} (convenio: ${convenio}, peso: ${pesoGRD})`);
    } else {
      console.warn(`⚠️ No se pudo calcular precio base (convenio: ${convenio}, peso: ${pesoGRD})`);
    }
  } else {
    console.warn(`⚠️ Convenio no encontrado. Columnas:`, Object.keys(row).filter(k => k.toLowerCase().includes('conven')));
  }

  // ✅ SOLO AGREGAR ESTOS CAMPOS CON DEFAULTS EN EL create()
  const estadoRN = cleanString(row['Estado RN']) || 'Pendiente';
  const atValue = cleanString(row['AT']);
  const atSn = atValue ? (atValue.toUpperCase() === 'S' ? true : false) : false;
  const atDetalle = atSn ? cleanString(row['AT Detalle']) : null;
  const montoAt = isNumeric(row['Monto AT']) ? parseFloat(row['Monto AT']) : 0;
  const diasDemoraRescate = isNumeric(row['Días Demora Rescate']) ? parseInt(row['Días Demora Rescate']) : 0;
  const pagoDemoraRescate = isNumeric(row['Pago Demora Rescate']) ? parseFloat(row['Pago Demora Rescate']) : 0;
  const pagoOutlierSuperior = isNumeric(row['Pago Outlier Superior']) ? parseFloat(row['Pago Outlier Superior']) : 0;

  // Calcular días de estadía desde las fechas del archivo maestro
  let fechaIngresoRaw = row['Fecha Ingreso completa'];
  let fechaAltaRaw = row['Fecha Completa'];

  let fechaIngreso: Date | null = null;
  let fechaAlta: Date | null = null;

// Convertir fecha ingreso
if (typeof fechaIngresoRaw === "number") {
  fechaIngreso = excelSerialToJSDate(fechaIngresoRaw);
} else {
  fechaIngreso = parseExcelDate(fechaIngresoRaw);
}

// Convertir fecha alta
if (typeof fechaAltaRaw === "number") {
  fechaAlta = excelSerialToJSDate(fechaAltaRaw);
} else {
  fechaAlta = parseExcelDate(fechaAltaRaw);
}

// Si por algo viniera nulo
if (!fechaIngreso) fechaIngreso = new Date("2000-01-01");
if (!fechaAlta) fechaAlta = fechaIngreso;

  const diasEstada = Math.round((fechaAlta.getTime() - fechaIngreso.getTime()) / 86400000);
  const diasEstadaCalculados = diasEstada >= 0 ? diasEstada : 0;

  // Calcular inlier/outlier automáticamente basándose en días de estadía vs punto corte del GRD
  // NO usar el valor del archivo maestro, calcularlo automáticamente
  let inlierOutlierCalculado: string | null = null;
  if (grdRule && diasEstadaCalculados >= 0) {
    const puntoCorteInf = grdRule.puntoCorteInf ? Number(grdRule.puntoCorteInf) : null;
    const puntoCorteSup = grdRule.puntoCorteSup ? Number(grdRule.puntoCorteSup) : null;
    
    // Outlier Superior: días de estadía > punto corte superior
    if (puntoCorteSup !== null && diasEstadaCalculados > puntoCorteSup) {
      inlierOutlierCalculado = 'Outlier Superior';
    }
    // Outlier Inferior: días de estadía < punto corte inferior
    else if (puntoCorteInf !== null && diasEstadaCalculados < puntoCorteInf) {
      inlierOutlierCalculado = 'Outlier Inferior';
    }
    // En cualquier otro caso es Inlier
    else {
      inlierOutlierCalculado = 'Inlier';
    }
    
    console.log(`📊 Inlier/Outlier calculado automáticamente: ${inlierOutlierCalculado} (días: ${diasEstadaCalculados}, puntoInf: ${puntoCorteInf}, puntoSup: ${puntoCorteSup})`);
  }

  // Crear el episodio con convenio y precioBaseTramo calculados
  await prisma.episodio.create({
    data: {
      centro: cleanString(row['Hospital (Descripción)']),
      numeroFolio: cleanString(row['ID Derivación']),
      episodioCmdb: cleanString(row['Episodio CMBD']),
      tipoEpisodio: cleanString(row['Tipo Actividad']),
      fechaIngreso,
      fechaAlta,
      servicioAlta: cleanString(row['Servicio Egreso (Descripción)']),

      montoRn: isNumeric(row['Facturación Total del episodio'])
        ? parseFloat(row['Facturación Total del episodio'])
        : 0,

      pesoGrd: pesoGRD,
      // convenio nunca null: si no se encontró, string vacía
      convenio: convenio || '',
      precioBaseTramo: precioBaseTramoCalculado,
      inlierOutlier: inlierOutlierCalculado, // Usar el valor calculado automáticamente, NO el del archivo maestro
      diasEstada: diasEstadaCalculados, // Guardar días de estadía calculados

      // ✅ NUEVOS CAMPOS CON DEFAULTS PARA CAMPOS EN BLANCO
      estadoRn: estadoRN,
      atSn,
      atDetalle,
      montoAt,
      diasDemoraRescate,
      pagoDemoraRescate,
      pagoOutlierSuperior,

      pacienteId: paciente.id,
      grdId: grdRule.id,
    },
  });

  console.log(
    `✅ [UPLOAD] Episodio creado: ${cleanString(row['Episodio CMBD'])}, convenio: "${convenio || ''}"`
  );
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
      const workbook = XLSX.readFile(filePath, {
        cellDates: true,
        raw: false
      });
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
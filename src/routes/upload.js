const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const Joi = require('joi');

const router = express.Router();


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const fileExtension = path.extname(file.originalname).toLowerCase();
  if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) cb(null, true);
  else cb(new Error('Tipo de archivo no permitido. Solo se aceptan archivos CSV y Excel.'), false);
};
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});


const normalize = (str = '') =>
  str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin acentos
    .replace(/\s+/g, ' ') // colapsa múltiples espacios
    .trim()
    .toLowerCase();

const COLUMN_MAP = new Map([
  // Identificación
  [normalize('RUT'), 'paciente_id'],
  [normalize('paciente_id'), 'paciente_id'],
  [normalize('id_paciente'), 'paciente_id'],
  [normalize('pacienteId'), 'paciente_id'],
  [normalize('nombre_paciente'), 'paciente_id'], // Mapeo adicional
  [normalize('id'), 'paciente_id'],
  [normalize('patient_id'), 'paciente_id'],
  // Fechas
  [normalize('Fecha Ingreso completa'), 'fecha_ingreso'],
  [normalize('fecha_ingreso'), 'fecha_ingreso'],
  [normalize('fechaIngreso'), 'fecha_ingreso'],
  [normalize('fecha ingreso'), 'fecha_ingreso'],
  [normalize('fecha'), 'fecha_ingreso'], // Mapeo adicional
  [normalize('date'), 'fecha_ingreso'],
  [normalize('ingreso'), 'fecha_ingreso'],
  // Si en tu archivo se usa "Fecha Completa" como fecha de egreso/alta:
  [normalize('Fecha Completa'), 'fecha_egreso'],
  [normalize('fecha_egreso'), 'fecha_egreso'],
  [normalize('fechaEgreso'), 'fecha_egreso'],
  [normalize('fecha egreso'), 'fecha_egreso'],
  [normalize('Fecha Egreso'), 'fecha_egreso'],
  [normalize('Fecha Alta'), 'fecha_egreso'],
  // Diagnósticos
  [normalize('Diagnóstico   Principal'), 'diagnostico_principal'],
  [normalize('diagnostico_principal'), 'diagnostico_principal'],
  [normalize('diagnosticoPrincipal'), 'diagnostico_principal'],
  [normalize('Diagnóstico Principal'), 'diagnostico_principal'],
  [normalize('diagnostico principal'), 'diagnostico_principal'],
  [normalize('diagnostico'), 'diagnostico_principal'], // Mapeo adicional
  [normalize('diagnosis'), 'diagnostico_principal'],
  [normalize('dx'), 'diagnostico_principal'],
  [normalize('Conjunto Dx'), 'diagnostico_secundario'],
  [normalize('diagnostico_secundario'), 'diagnostico_secundario'],
  [normalize('diagnosticoSecundario'), 'diagnostico_secundario'],
  [normalize('diagnostico secundario'), 'diagnostico_secundario'],
  // Procedimientos
  [normalize('Proced 01 Principal    (cod)'), 'procedimiento'],
  [normalize('procedimiento'), 'procedimiento'],
  [normalize('Procedimiento Principal (cod)'), 'procedimiento'],
  [normalize('procedimiento principal'), 'procedimiento'],
  // Demográficos
  [normalize('Edad en años'), 'edad'],
  [normalize('edad'), 'edad'],
  [normalize('age'), 'edad'],
  [normalize('anios'), 'edad'], // Mapeo adicional
  [normalize('años'), 'edad'],
  [normalize('Sexo  (Desc)'), 'sexo'],
  [normalize('sexo'), 'sexo'],
  [normalize('Sexo (Desc)'), 'sexo'],
  [normalize('genero'), 'sexo'],
  [normalize('género'), 'sexo'],
  [normalize('sex'), 'sexo'],
  [normalize('gender'), 'sexo'],
  [normalize('genero'), 'sexo'], // Mapeo adicional
  // Campos opcionales
  [normalize('peso'), 'peso'],
  [normalize('talla'), 'talla'],
  [normalize('dias_estancia'), 'dias_estancia'],
  [normalize('dias estancia'), 'dias_estancia'],
  [normalize('días_estancia'), 'dias_estancia'],
  [normalize('días estancia'), 'dias_estancia']
]);

// Columnas requeridas mínimas para validar estructura
const REQUIRED_COLUMNS = [
  'paciente_id',
  'fecha_ingreso', 
  'diagnostico_principal',
  'edad',
  'sexo'
];

// Función para validar estructura de columnas
const validateColumnStructure = (headers) => {
  const errors = [];
  const warnings = [];
  const foundColumns = new Set();
  
  // Normalizar headers del archivo
  const normalizedHeaders = headers.map(header => normalize(header));
  
  // Verificar columnas requeridas
  for (const requiredCol of REQUIRED_COLUMNS) {
    let found = false;
    let foundVariants = [];
    
    // Buscar variantes de la columna requerida
    for (const [mappedKey, mappedValue] of COLUMN_MAP.entries()) {
      if (mappedValue === requiredCol) {
        foundVariants.push(mappedKey);
        if (normalizedHeaders.includes(mappedKey)) {
          found = true;
          foundColumns.add(requiredCol);
          break;
        }
      }
    }
    
    if (!found) {
      errors.push({
        column: requiredCol,
        message: `Columna requerida '${requiredCol}' no encontrada`,
        suggested_variants: foundVariants.slice(0, 3), // Mostrar solo las primeras 3 variantes
        available_columns: headers
      });
    }
  }
  
  // Verificar columnas no reconocidas
  const recognizedColumns = new Set();
  for (const header of normalizedHeaders) {
    if (COLUMN_MAP.has(header)) {
      recognizedColumns.add(header);
    } else {
      warnings.push({
        column: header,
        message: `Columna '${header}' no reconocida`,
        suggestion: 'Verificar nombre de columna o agregar mapeo'
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    foundColumns: Array.from(foundColumns),
    recognizedColumns: Array.from(recognizedColumns)
  };
};

/** Convierte un objeto con headers “reales” → a nuestros campos internos */
const mapRowToInternal = (row) => {
  const out = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = normalize(rawKey);
    const mapped = COLUMN_MAP.get(key);
    if (mapped) out[mapped] = value;
  }
  return out;
};

const toNumber = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const num = Number(String(v).toString().replace(',', '.'));
  return Number.isFinite(num) ? num : undefined;
};
const toInt = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};
const toDate = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  // Acepta Date, cadena ISO, o serial Excel
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'number') {
    // Excel serial date (base 1900)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + v * 86400000);
    return isNaN(d) ? undefined : d;
  }
  const d = new Date(v);
  return isNaN(d) ? undefined : d;
};
const normSexo = (v) => {
  if (!v && v !== 0) return undefined;
  const s = normalize(String(v));
  if (['m', 'masculino', 'varon', 'hombre'].includes(s)) return 'M';
  if (['f', 'femenino', 'mujer'].includes(s)) return 'F';
  return String(v); // deja tal cual si viene algo distinto (se validará si aplica)
};
const computeDiasEstancia = (ing, egr) => {
  if (!(ing instanceof Date) || isNaN(ing) || !(egr instanceof Date) || isNaN(egr)) return undefined;
  const diff = Math.round((egr - ing) / 86400000);
  return diff >= 0 ? diff : undefined;
};

const episodeSchema = Joi.object({
  paciente_id: Joi.string().required().min(1).messages({
    'string.empty': 'El ID del paciente es requerido',
    'any.required': 'El ID del paciente es requerido'
  }),
  fecha_ingreso: Joi.date().required().messages({
    'date.base': 'La fecha de ingreso debe ser una fecha válida',
    'any.required': 'La fecha de ingreso es requerida'
  }),
  fecha_egreso: Joi.date().allow(null).optional(),
  diagnostico_principal: Joi.string().required().min(1).messages({
    'string.empty': 'El diagnóstico principal es requerido',
    'any.required': 'El diagnóstico principal es requerido'
  }),
  diagnostico_secundario: Joi.string().allow('', null).optional(),
  procedimiento: Joi.string().allow('', null).optional(),
  edad: Joi.number().integer().min(0).max(120).required().messages({
    'number.base': 'La edad debe ser un número',
    'number.integer': 'La edad debe ser un número entero',
    'number.min': 'La edad debe ser mayor o igual a 0',
    'number.max': 'La edad debe ser menor o igual a 120',
    'any.required': 'La edad es requerida'
  }),
  sexo: Joi.string().valid('M', 'F', 'Masculino', 'Femenino').required().messages({
    'any.only': 'El sexo debe ser M, F, Masculino o Femenino',
    'any.required': 'El sexo es requerido'
  }),
  peso: Joi.number().positive().allow(null).optional(),
  talla: Joi.number().positive().allow(null).optional(),
  dias_estancia: Joi.number().integer().min(0).allow(null).optional()
}).unknown(false);


const normalizeRow = (mappedRow) => {
  // Convertimos tipos si están presentes
  const out = { ...mappedRow };

  if ('edad' in out) out.edad = toInt(out.edad);
  if ('sexo' in out) out.sexo = normSexo(out.sexo);

  if ('fecha_ingreso' in out) out.fecha_ingreso = toDate(out.fecha_ingreso) || null;
  if ('fecha_egreso' in out) out.fecha_egreso = toDate(out.fecha_egreso) || null;

  // Si no viene dias_estancia, lo inferimos si se puede:
  if (!('dias_estancia' in out) || out.dias_estancia == null) {
    const d = computeDiasEstancia(out.fecha_ingreso, out.fecha_egreso);
    if (Number.isFinite(d)) out.dias_estancia = d;
  } else {
    out.dias_estancia = toInt(out.dias_estancia);
  }

  // Limpieza de strings
  ['paciente_id','diagnostico_principal','diagnostico_secundario','procedimiento'].forEach(k => {
    if (k in out && out[k] != null) out[k] = String(out[k]).trim();
  });

  return out;
};

const processCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    const structureErrors = [];
    const warnings = [];
    let rowIdx = 0;
    let headers = [];
    let structureValidated = false;
    let shouldStopProcessing = false;

    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header })) // preserva header original
      .on('data', (raw) => {
        if (shouldStopProcessing) return;
        
        rowIdx += 1;
        
        // Validar estructura de columnas solo en la primera fila
        if (!structureValidated && rowIdx === 1) {
          headers = Object.keys(raw);
          console.log(`🔍 Validando estructura de columnas:`, headers);
          
          const structureValidation = validateColumnStructure(headers);
          console.log(`📊 Resultado validación:`, {
            valid: structureValidation.valid,
            errors: structureValidation.errors.length,
            warnings: structureValidation.warnings.length
          });
          
          if (!structureValidation.valid) {
            structureErrors.push(...structureValidation.errors);
            console.log(`❌ Errores de estructura encontrados:`, structureValidation.errors);
            shouldStopProcessing = true;
            // Forzar resolución inmediata con errores de estructura
            resolve({ 
              results: [], 
              errors: [], 
              structureErrors, 
              warnings,
              headers: headers.length > 0 ? headers : undefined
            });
            return;
          }
          
          if (structureValidation.warnings.length > 0) {
            warnings.push(...structureValidation.warnings);
            console.log(`⚠️ Advertencias de estructura:`, structureValidation.warnings);
          }
          
          structureValidated = true;
        }
        
        // Si hay errores de estructura, no procesar filas
        if (shouldStopProcessing) {
          return;
        }
        
        try {
          const mapped = mapRowToInternal(raw);       // mapea a nuestros campos
          const normalized = normalizeRow(mapped);    // castea tipos / calcula días
          
          // Validar que al menos algunos campos requeridos estén presentes
          if (!mapped.paciente_id && !mapped.fecha_ingreso && !mapped.diagnostico_principal) {
            errors.push({ 
              row: rowIdx, 
              error: 'Fila vacía o sin datos válidos', 
              data: raw 
            });
            return;
          }
          
          const { error, value } = episodeSchema.validate(normalized, { 
            convert: false, 
            abortEarly: true,
            stripUnknown: true
          });
          
          if (error) {
            errors.push({ 
              row: rowIdx, 
              error: error.details[0].message, 
              data: normalized 
            });
          } else {
            results.push(value);
          }
        } catch (err) {
          errors.push({ 
            row: rowIdx, 
            error: 'Error al procesar fila: ' + err.message, 
            data: raw 
          });
        }
      })
      .on('end', () => {
        console.log(`🏁 Finalizando procesamiento CSV. Errores estructura: ${structureErrors.length}`);
        resolve({ 
          results, 
          errors, 
          structureErrors, 
          warnings,
          headers: headers.length > 0 ? headers : undefined
        });
      })
      .on('error', (err) => reject(err));
  });
};

const processExcel = (filePath) => {
  try {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });

    const results = [];
    const errors = [];
    const structureErrors = [];
    const warnings = [];
    let headers = [];

    // Validar estructura de columnas si hay datos
    if (data.length > 0) {
      headers = Object.keys(data[0]);
      const structureValidation = validateColumnStructure(headers);
      
      if (!structureValidation.valid) {
        structureErrors.push(...structureValidation.errors);
      }
      
      if (structureValidation.warnings.length > 0) {
        warnings.push(...structureValidation.warnings);
      }
    }

    // Si hay errores de estructura críticos, no procesar filas
    if (structureErrors.length === 0) {
      data.forEach((raw, i) => {
        try {
          const mapped = mapRowToInternal(raw);
          const normalized = normalizeRow(mapped);
          
          // Validar que al menos algunos campos requeridos estén presentes
          if (!mapped.paciente_id && !mapped.fecha_ingreso && !mapped.diagnostico_principal) {
            errors.push({ 
              row: i + 1, 
              error: 'Fila vacía o sin datos válidos', 
              data: raw 
            });
            return;
          }
          
          const { error, value } = episodeSchema.validate(normalized, { 
            convert: false, 
            abortEarly: true,
            stripUnknown: true
          });
          
          if (error) {
            errors.push({ 
              row: i + 1, 
              error: error.details[0].message, 
              data: normalized 
            });
          } else {
            results.push(value);
          }
        } catch (err) {
          errors.push({ 
            row: i + 1, 
            error: 'Error al procesar fila: ' + err.message, 
            data: raw 
          });
        }
      });
    }

    return { 
      results, 
      errors, 
      structureErrors, 
      warnings,
      headers: headers.length > 0 ? headers : undefined
    };
  } catch (err) {
    throw new Error('Error al leer archivo Excel: ' + err.message);
  }
};

router.post('/upload', upload.single('file'), async (req, res) => {
  let filePath = null;
  
  try {
    // Validar que se subió un archivo
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No se proporcionó ningún archivo', 
        message: 'Debe enviar un archivo CSV o Excel' 
      });
    }

    filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    console.log(`📁 Procesando archivo: ${req.file.originalname} (${req.file.size} bytes)`);

    // Validar formato de archivo
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ 
        error: 'Formato de archivo no soportado', 
        message: 'Solo se aceptan archivos CSV y Excel (.csv, .xlsx, .xls)' 
      });
    }

    let processedData;
    
    try {
      if (ext === '.csv') {
        processedData = await processCSV(filePath);
      } else if (ext === '.xlsx' || ext === '.xls') {
        processedData = processExcel(filePath);
      }
    } catch (processError) {
      console.error('Error procesando archivo:', processError);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(500).json({ 
        error: 'Error procesando archivo', 
        message: processError.message 
      });
    }

    // Limpieza del archivo temporal
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      filePath = null;
    }

    // Verificar errores de estructura de columnas
    if (processedData.structureErrors && processedData.structureErrors.length > 0) {
      console.log(`❌ Errores de estructura de columnas: ${processedData.structureErrors.length}`);
      return res.status(400).json({
        success: false,
        error: 'Estructura de columnas inválida',
        message: 'El archivo no contiene las columnas requeridas',
        structure_errors: processedData.structureErrors,
        available_columns: processedData.headers || [],
        required_columns: REQUIRED_COLUMNS,
        suggestions: processedData.structureErrors.map(err => ({
          column: err.column,
          message: err.message,
          suggested_variants: err.suggested_variants
        }))
      });
    }

    // Preparar respuesta
    const response = {
      success: true,
      message: 'Archivo procesado exitosamente',
      summary: {
        total_rows: processedData.results.length + processedData.errors.length,
        valid_rows: processedData.results.length,
        invalid_rows: processedData.errors.length,
        file_name: req.file.originalname,
        file_size: req.file.size,
        processed_at: new Date().toISOString(),
        columns_found: processedData.headers || [],
        structure_valid: true
      },
      data: processedData.results,
      errors: processedData.errors
    };

    // Agregar advertencias si hay errores de datos
    if (processedData.errors.length > 0) {
      response.warnings = {
        message: 'Se encontraron errores en algunas filas',
        error_count: processedData.errors.length,
        error_details: processedData.errors.slice(0, 10) // Mostrar solo los primeros 10 errores
      };
    }

    // Agregar advertencias de estructura si las hay
    if (processedData.warnings && processedData.warnings.length > 0) {
      response.structure_warnings = {
        message: 'Se encontraron columnas no reconocidas',
        warning_count: processedData.warnings.length,
        warning_details: processedData.warnings.slice(0, 5) // Mostrar solo las primeras 5 advertencias
      };
    }

    console.log(`✅ Procesamiento completado: ${processedData.results.length} válidos, ${processedData.errors.length} errores`);
    res.json(response);

  } catch (error) {
    console.error('Error general procesando archivo:', error);
    
    // Limpiar archivo temporal en caso de error
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.status(500).json({ 
      error: 'Error interno del servidor', 
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando archivo' 
    });
  }
});

// Endpoint GET para información del endpoint
router.get('/upload/info', (req, res) => {
  res.json({
    endpoint: '/api/upload',
    method: 'POST',
    description: 'Endpoint para subir archivos CSV/Excel con datos clínicos de episodios',
    accepted_formats: ['CSV (.csv)', 'Excel (.xlsx, .xls)'],
    max_file_size: '10MB',
    validation: {
      column_structure: 'Validación automática de nombres de columnas',
      required_columns: 'Columnas obligatorias para el procesamiento',
      data_validation: 'Validación de tipos y rangos de datos'
    },
    required_fields: [
      'paciente_id',
      'fecha_ingreso', 
      'diagnostico_principal',
      'edad',
      'sexo'
    ],
    optional_fields: [
      'fecha_egreso',
      'diagnostico_secundario',
      'procedimiento',
      'peso',
      'talla',
      'dias_estancia'
    ],
    column_mapping_examples: {
      'RUT': 'paciente_id',
      'Fecha Ingreso completa': 'fecha_ingreso',
      'Fecha Completa': 'fecha_egreso',
      'Diagnóstico   Principal': 'diagnostico_principal',
      'Conjunto Dx': 'diagnostico_secundario',
      'Proced 01 Principal    (cod)': 'procedimiento',
      'Edad en años': 'edad',
      'Sexo  (Desc)': 'sexo'
    },
    supported_column_variants: {
      'paciente_id': ['RUT', 'paciente_id', 'id_paciente', 'pacienteId'],
      'fecha_ingreso': ['Fecha Ingreso completa', 'fecha_ingreso', 'fechaIngreso'],
      'diagnostico_principal': ['Diagnóstico Principal', 'diagnostico_principal', 'diagnosticoPrincipal'],
      'edad': ['Edad en años', 'edad', 'age'],
      'sexo': ['Sexo (Desc)', 'sexo', 'genero', 'género', 'sex']
    },
    error_responses: {
      structure_errors: '400 - Errores de estructura de columnas',
      data_errors: '200 - Errores en filas específicas',
      processing_errors: '500 - Errores de procesamiento'
    },
    example_usage: {
      method: 'POST',
      url: '/api/upload',
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      body: 'file: [archivo CSV/Excel]'
    }
  });
});

module.exports = router;

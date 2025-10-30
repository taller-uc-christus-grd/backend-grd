const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const Joi = require('joi');

const router = express.Router();

let loadMinsalNorma;
let validateClinical;

try {
  ({ loadMinsalNorma } = require('../utils/grdRules'));
} catch (err) {
  console.warn('Aviso: ../utils/grdRules no encontrado. Usando fallback vacío.');
  loadMinsalNorma = async () => new Map();
}

try {
  ({ validateClinical } = require('../utils/clinicalValidator'));
} catch (err) {
  console.warn('Aviso: ../utils/clinicalValidator no encontrado. Usando validador por defecto.');
  validateClinical = (row /*, rules */) => ({
    VALIDADO: 'OK',
    inlier_outlier: '',
    OBSERVACIONES: []
  });
}

// ----------------------
// Audit logging (uploads)
// ----------------------
const uploadAuditDir = path.join(__dirname, '..', '..', 'logs');
const uploadAuditFile = path.join(uploadAuditDir, 'upload-audit.log');

async function logUploadAction(entry) {
  try {
    await fs.promises.mkdir(uploadAuditDir, { recursive: true });
    const payload = {
      ts: new Date().toISOString(),
      ...entry
    };
    await fs.promises.appendFile(uploadAuditFile, JSON.stringify(payload) + '\n', 'utf8');
    console.info('🔒 Upload audit saved:', { file: entry.file_name, total_rows: entry.total_rows, valid_rows: entry.valid_rows, invalid_rows: entry.invalid_rows, duplicates: entry.duplicates_count });
  } catch (err) {
    console.error('Failed to write upload audit:', err);
  }
}

// Helper para obtener/caché reglas (loadMinsalNorma ya cachea internamente)
async function getGrdRules() {
  try {
    return await loadMinsalNorma();
  } catch (e) {
    console.warn('No se pudo cargar GRD rules (fallback):', e?.message ?? e);
    return new Map();
  }
}

/* ============================
   1) Multer: uploads
============================ */
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const fileExtension = path.extname(file.originalname).toLowerCase();
  if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) cb(null, true);
  else cb(new Error('Tipo de archivo no permitido. Solo CSV y Excel.'), false);
};
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

/* ============================
   2) Normalización y mapeo
============================ */
const normalize = (str = '') =>
  String(str)
    .normalize ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : String(str)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const COLUMN_MAP = new Map([
  // Identificación
  [normalize('RUT'), 'paciente_id'],
  [normalize('paciente_id'), 'paciente_id'],
  [normalize('id_paciente'), 'paciente_id'],
  [normalize('pacienteid'), 'paciente_id'],
  [normalize('nombre_paciente'), 'paciente_id'],
  [normalize('id'), 'paciente_id'],
  [normalize('patient_id'), 'paciente_id'],

  // Fechas
  [normalize('fecha ingreso completa'), 'fecha_ingreso'],
  [normalize('fecha_ingreso'), 'fecha_ingreso'],
  [normalize('fechaingreso'), 'fecha_ingreso'],
  [normalize('fecha ingreso'), 'fecha_ingreso'],
  [normalize('fecha'), 'fecha_ingreso'],
  [normalize('date'), 'fecha_ingreso'],
  [normalize('ingreso'), 'fecha_ingreso'],

  [normalize('fecha completa'), 'fecha_egreso'],
  [normalize('fecha_egreso'), 'fecha_egreso'],
  [normalize('fechaegreso'), 'fecha_egreso'],
  [normalize('fecha egreso'), 'fecha_egreso'],
  [normalize('fecha alta'), 'fecha_egreso'],

  // Diagnósticos
  [normalize('diagnóstico principal'), 'diagnostico_principal'],
  [normalize('diagnostico_principal'), 'diagnostico_principal'],
  [normalize('diagnosticoprincipal'), 'diagnostico_principal'],
  [normalize('diagnostico principal'), 'diagnostico_principal'],
  [normalize('diagnostico'), 'diagnostico_principal'],
  [normalize('diagnosis'), 'diagnostico_principal'],
  [normalize('dx'), 'diagnostico_principal'],

  [normalize('conjunto dx'), 'diagnostico_secundario'],
  [normalize('diagnostico_secundario'), 'diagnostico_secundario'],
  [normalize('diagnosticosecundario'), 'diagnostico_secundario'],
  [normalize('diagnostico secundario'), 'diagnostico_secundario'],

  // Procedimientos
  [normalize('procedimiento'), 'procedimiento'],
  [normalize('procedimiento principal'), 'procedimiento'],

  // Demográficos
  [normalize('edad en años'), 'edad'],
  [normalize('edad'), 'edad'],
  [normalize('age'), 'edad'],
  [normalize('anios'), 'edad'],
  [normalize('años'), 'edad'],

  [normalize('sexo  (desc)'), 'sexo'],
  [normalize('sexo'), 'sexo'],
  [normalize('sexo (desc)'), 'sexo'],
  [normalize('genero'), 'sexo'],
  [normalize('género'), 'sexo'],
  [normalize('sex'), 'sexo'],
  [normalize('gender'), 'sexo'],

  // Opcionales
  [normalize('peso'), 'peso'],
  [normalize('talla'), 'talla'],
  [normalize('dias_estancia'), 'dias_estancia'],
  [normalize('dias estancia'), 'dias_estancia'],
  [normalize('días_estancia'), 'dias_estancia'],
  [normalize('días estancia'), 'dias_estancia'],

  // GRD
  [normalize('ir - grd'), 'ir_grd'],
  [normalize('ir_grd'), 'ir_grd'],
  [normalize('grd'), 'ir_grd'],

  [normalize('inlier/outlier'), 'inlier_outlier'],
  [normalize('grupo dentro de norma s/n'), 'grupo_norma_sn'],
  [normalize('pago por outlier superior'), 'pago_outlier_sup'],
  [normalize('pago demora rescate'), 'pago_demora_rescate'],
  [normalize('dias de estada'), 'dias_estancia'],
  [normalize('días de estada'), 'dias_estancia']
]);

// Columnas “requeridas” (se validan por fila con Joi)
const REQUIRED_COLUMNS = [
  'paciente_id',
  'fecha_ingreso',
  'diagnostico_principal',
  'edad',
  'sexo'
];

/* ============================
   3) Validación de estructura (SOFT)
============================ */
const validateColumnStructure = (headers) => {
  const warnings = [];
  const normalized = headers.map(h => normalize(h));

  const missingRequired = [];
  for (const requiredCol of REQUIRED_COLUMNS) {
    let found = false;
    for (const [mappedKey, mappedVal] of COLUMN_MAP.entries()) {
      if (mappedVal === requiredCol && normalized.includes(mappedKey)) {
        found = true; break;
      }
    }
    if (!found) missingRequired.push(requiredCol);
  }

  if (missingRequired.length > 0) {
    warnings.push({
      type: 'missing_required_columns',
      message: 'Faltan columnas requeridas a nivel de estructura (se validará fila a fila igualmente).',
      missing: missingRequired
    });
  }

  normalized.forEach(h => {
    if (!COLUMN_MAP.has(h)) {
      warnings.push({
        type: 'unknown_column',
        column: h,
        message: 'Columna no reconocida. Verificar nombre o agregar mapeo.'
      });
    }
  });

  return {
    valid: true,
    errors: [],
    warnings,
    recognizedColumns: normalized.filter(h => COLUMN_MAP.has(h)),
    originalHeaders: headers
  };
};

/* ============================
   4) Helpers de conversión
============================ */
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
  const num = Number(String(v).replace(',', '.'));
  return Number.isFinite(num) ? num : undefined;
};
const toInt = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};
const toDate = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + v * 86400000);
    return isNaN(d) ? undefined : d;
  }
  const d = new Date(v);
  return isNaN(d) ? undefined : d;
};
const normSexo = (v) => {
  if (v === undefined || v === null) return undefined;
  const s = normalize(String(v));
  if (['m', 'masculino', 'varon', 'hombre'].includes(s)) return 'M';
  if (['f', 'femenino', 'mujer'].includes(s)) return 'F';
  return String(v).toUpperCase();
};
const computeDiasEstancia = (ing, egr) => {
  if (!(ing instanceof Date) || isNaN(ing) || !(egr instanceof Date) || isNaN(egr)) return undefined;
  const diff = Math.round((egr - ing) / 86400000);
  return diff >= 0 ? diff : undefined;
};

/* ============================
   5) Validación por fila (Joi)
============================ */
const episodeSchema = Joi.object({
  paciente_id: Joi.string().required().min(1),
  fecha_ingreso: Joi.date().required(),
  fecha_egreso: Joi.date().allow(null).optional(),
  diagnostico_principal: Joi.string().required().min(1),
  diagnostico_secundario: Joi.string().allow('', null).optional(),
  procedimiento: Joi.string().allow('', null).optional(),
  edad: Joi.number().integer().min(0).max(120).required(),
  sexo: Joi.string().valid('M', 'F', 'Masculino', 'Femenino').required(),
  peso: Joi.number().positive().allow(null).optional(),
  talla: Joi.number().positive().allow(null).optional(),
  dias_estancia: Joi.number().integer().min(0).allow(null).optional(),
  ir_grd: Joi.string().allow('', null),
  inlier_outlier: Joi.string().allow('', null),
  grupo_norma_sn: Joi.string().allow('', null),
  pago_outlier_sup: Joi.number().min(0).allow(null),
  pago_demora_rescate: Joi.number().min(0).allow(null)
}).unknown(false);

/* ============================
   6) Normalización de una fila
============================ */
const normalizeRow = (mappedRow) => {
  const out = { ...mappedRow };

  if ('edad' in out) out.edad = toInt(out.edad);
  if ('sexo' in out) out.sexo = normSexo(out.sexo);

  if ('fecha_ingreso' in out) out.fecha_ingreso = toDate(out.fecha_ingreso) || null;
  if ('fecha_egreso' in out) out.fecha_egreso = toDate(out.fecha_egreso) || null;

  // dias_estancia
  if (!('dias_estancia' in out) || out.dias_estancia == null) {
    const d = computeDiasEstancia(out.fecha_ingreso, out.fecha_egreso);
    if (Number.isFinite(d)) out.dias_estancia = d;
  } else {
    out.dias_estancia = toInt(out.dias_estancia);
  }

  // limpieza campos texto
  ['paciente_id','diagnostico_principal','diagnostico_secundario','procedimiento','ir_grd'].forEach(k => {
    if (k in out && out[k] != null) out[k] = String(out[k]).trim();
  });

  // números suaves
  if ('pago_outlier_sup' in out) out.pago_outlier_sup = toNumber(out.pago_outlier_sup);
  if ('pago_demora_rescate' in out) out.pago_demora_rescate = toNumber(out.pago_demora_rescate);

  return out;
};

/* ============================
   7) Procesamiento CSV / Excel
   (se mantienen las funciones processCSV y processExcel)
============================ */
const processCSV = (filePath, grdRules) => {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    const warnings = [];
    let rowIdx = 0;
    let headers = [];
    let structureValidated = false;

    const stream = fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header }));

    stream.on('data', (raw) => {
      rowIdx += 1;
      try {
        if (!structureValidated) {
          headers = Object.keys(raw);
          const structureValidation = validateColumnStructure(headers);
          if (structureValidation.warnings.length > 0) warnings.push(...structureValidation.warnings);
          structureValidated = true;
        }

        const mapped = mapRowToInternal(raw);
        const normalized = normalizeRow(mapped);

        // Fila vacía mínima
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
          // Intentar attach banderas clínicas y devolver como error por fila
          let rowWithFlags = { ...normalized };
          try {
            const clinical = validateClinical(rowWithFlags, grdRules || new Map());
            rowWithFlags = {
              ...rowWithFlags,
              VALIDADO: 'Con errores',
              inlier_outlier: clinical?.inlier_outlier || '',
              OBSERVACIONES: [error.details[0].message, ...(clinical?.OBSERVACIONES || [])]
            };
            if (!rowWithFlags.grupo_norma_sn) {
              rowWithFlags.grupo_norma_sn = rowWithFlags.inlier_outlier === 'inlier' ? 'S'
                : rowWithFlags.inlier_outlier === 'outlier' ? 'N' : '';
            }
          } catch (e) {
            rowWithFlags.VALIDADO = 'Con errores';
            rowWithFlags.OBSERVACIONES = [error.details[0].message];
          }
          errors.push({ row: rowIdx, error: error.details[0].message, data: rowWithFlags });
        } else {
          // OK por Joi -> valida clínica GRD (con try/catch)
          try {
            const clinical = validateClinical(value, grdRules || new Map()) || {};
            const finalRow = {
              ...value,
              VALIDADO: clinical.VALIDADO ?? 'OK',
              inlier_outlier: clinical.inlier_outlier || '',
              OBSERVACIONES: clinical.OBSERVACIONES || []
            };
            if (!finalRow.grupo_norma_sn) {
              finalRow.grupo_norma_sn = finalRow.inlier_outlier === 'inlier' ? 'S'
                : finalRow.inlier_outlier === 'outlier' ? 'N' : '';
            }
            results.push(finalRow);
          } catch (errClinical) {
            results.push({
              ...value,
              VALIDADO: 'OK',
              inlier_outlier: '',
              OBSERVACIONES: ['Clin. validator error: ' + (errClinical?.message || String(errClinical))]
            });
          }
        }
      } catch (err) {
        errors.push({
          row: rowIdx,
          error: 'Error al procesar fila: ' + (err?.message || String(err)),
          data: raw
        });
      }
    });

    stream.on('end', () => {
      resolve({
        results,
        errors,
        warnings,
        headers: headers.length > 0 ? headers : undefined
      });
    });

    stream.on('error', (err) => reject(err));
  });
};

const processExcel = (filePath, grdRules) => {
  try {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });

    const results = [];
    const errors = [];
    const warnings = [];
    let headers = [];

    if (data.length > 0) {
      headers = Object.keys(data[0]);
      const structureValidation = validateColumnStructure(headers);
      if (structureValidation.warnings.length > 0) warnings.push(...structureValidation.warnings);
    }

    data.forEach((raw, i) => {
      try {
        const mapped = mapRowToInternal(raw);
        const normalized = normalizeRow(mapped);

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
          let rowWithFlags = { ...normalized };
          try {
            const clinical = validateClinical(rowWithFlags, grdRules || new Map());
            rowWithFlags = {
              ...rowWithFlags,
              VALIDADO: 'Con errores',
              inlier_outlier: clinical?.inlier_outlier || '',
              OBSERVACIONES: [error.details[0].message, ...(clinical?.OBSERVACIONES || [])]
            };
            if (!rowWithFlags.grupo_norma_sn) {
              rowWithFlags.grupo_norma_sn = rowWithFlags.inlier_outlier === 'inlier' ? 'S'
                : rowWithFlags.inlier_outlier === 'outlier' ? 'N' : '';
            }
          } catch (e) {
            rowWithFlags.VALIDADO = 'Con errores';
            rowWithFlags.OBSERVACIONES = [error.details[0].message];
          }
          errors.push({ row: i + 1, error: error.details[0].message, data: rowWithFlags });
        } else {
          try {
            const clinical = validateClinical(value, grdRules || new Map()) || {};
            const finalRow = {
              ...value,
              VALIDADO: clinical.VALIDADO ?? 'OK',
              inlier_outlier: clinical.inlier_outlier || '',
              OBSERVACIONES: clinical.OBSERVACIONES || []
            };
            if (!finalRow.grupo_norma_sn) {
              finalRow.grupo_norma_sn = finalRow.inlier_outlier === 'inlier' ? 'S'
                : finalRow.inlier_outlier === 'outlier' ? 'N' : '';
            }
            results.push(finalRow);
          } catch (errClinical) {
            results.push({
              ...value,
              VALIDADO: 'OK',
              inlier_outlier: '',
              OBSERVACIONES: ['Clin. validator error: ' + (errClinical?.message || String(errClinical))]
            });
          }
        }
      } catch (err) {
        errors.push({
          row: i + 1,
          error: 'Error al procesar fila: ' + (err?.message || String(err)),
          data: raw
        });
      }
    });

    return {
      results,
      errors,
      warnings,
      headers: headers.length > 0 ? headers : undefined
    };
  } catch (err) {
    throw new Error('Error al leer archivo Excel: ' + (err?.message || String(err)));
  }
};

/* ============================
   8) Endpoint POST /upload
============================ */
router.post('/upload', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No se proporcionó ningún archivo',
        message: 'Debe enviar un archivo CSV o Excel'
      });
    }

    filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({
        error: 'Formato de archivo no soportado',
        message: 'Solo se aceptan archivos CSV y Excel (.csv, .xlsx, .xls)'
      });
    }

    // Cargar reglas GRD (remotas y cacheadas) ANTES de procesar filas
    let GRD_RULES = new Map();
    try {
      GRD_RULES = await getGrdRules();
    } catch (e) {
      console.warn('⚠️ No se pudieron cargar reglas GRD. Se continuará sin validación clínica:', e?.message ?? e);
      GRD_RULES = new Map();
    }

    let processedData;
    try {
      if (ext === '.csv') {
        processedData = await processCSV(filePath, GRD_RULES);
      } else {
        processedData = processExcel(filePath, GRD_RULES);
      }
    } catch (processError) {
      console.error('Error procesando archivo:', processError);
      // borrar archivo temporal si existe
      try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      return res.status(500).json({
        error: 'Error procesando archivo',
        message: processError?.message ?? String(processError)
      });
    }

    // ============================
    //  Detección de duplicados (antes de "insertar")
    //  Criterio: mismo número de episodio OR mismo paciente_id.
    //  Mantener la primera aparición y omitir posteriores.
    //  Se registran los registros omitidos en la respuesta.
    // ============================
    const seenEpisodio = new Set();
    const seenPaciente = new Set();
    const uniqueResults = [];
    const duplicates = [];

    const pickEpisodioKey = (r) => String(r.episodio ?? r.episodio_cmbd ?? '').trim();
    const pickPacienteKey = (r) => String(r.paciente_id ?? r.rut ?? r.patient_id ?? '').trim();

    for (const row of processedData.results) {
      const epKey = pickEpisodioKey(row);
      const pacKey = pickPacienteKey(row);
      const reasons = [];

      if (epKey) {
        if (seenEpisodio.has(epKey)) reasons.push('episodio');
      }
      if (pacKey) {
        if (seenPaciente.has(pacKey)) reasons.push('paciente');
      }

      if (reasons.length > 0) {
        // Omitir: ya existe episodio o paciente previamente procesado
        duplicates.push({
          reason: reasons.join('|'),
          episodio: epKey || null,
          paciente_id: pacKey || null,
          data: row
        });
      } else {
        // marcar como visto y conservar
        if (epKey) seenEpisodio.add(epKey);
        if (pacKey) seenPaciente.add(pacKey);
        uniqueResults.push(row);
      }
    }

    // Reemplazar resultados válidos por los no duplicados
    processedData.results = uniqueResults;
    // Adjuntar info de duplicados para que se notifique al usuario
    processedData.duplicates = duplicates;

    // Preparar respuesta
    const response = {
      success: true,
      message: 'Archivo procesado exitosamente',
      summary: {
        total_rows: (processedData.results.length + processedData.errors.length + (processedData.duplicates?.length || 0)),
        valid_rows: processedData.results.length,
        invalid_rows: processedData.errors.length,
        file_name: req.file.originalname,
        stored_name: req.file.filename,
        file_size: req.file.size,
        processed_at: new Date().toISOString(),
        columns_found: processedData.headers || [],
        structure_valid: true
      },
      data: processedData.results,
      errors: processedData.errors,
      omitted_duplicates: {
        count: processedData.duplicates?.length || 0,
        examples: (processedData.duplicates || []).slice(0, 10)
      }
    };

    // Métricas clínicas simples
    const okCount = processedData.results.filter(r => r.VALIDADO === 'OK').length;
    const withErrCount = processedData.results.filter(r => r.VALIDADO === 'Con errores').length;
    const clinicalErrorCount = processedData.errors.filter(e => {
      const obs = e?.data?.OBSERVACIONES || [];
      const v = e?.data?.VALIDADO || '';
      return v === 'Con errores' || (Array.isArray(obs) && obs.length > 0);
    }).length;

    response.summary.clinical = {
      rules_source: 'norma MINSAL (remota)',
      in_results_ok: okCount,
      in_results_with_errors: withErrCount,
      in_errors_count: clinicalErrorCount
    };

    if ((processedData.duplicates || []).length > 0) {
      console.warn(`Se omitieron ${processedData.duplicates.length} registros por duplicados (episodio/paciente).`);
    }

    if (processedData.errors.length > 0) {
      response.warnings = {
        message: 'Se encontraron errores en algunas filas',
        error_count: processedData.errors.length,
        error_details: processedData.errors.slice(0, 10)
      };
    }

    if (processedData.warnings && processedData.warnings.length > 0) {
      response.structure_warnings = {
        message: 'Advertencias de estructura (no bloquean el procesamiento)',
        warning_count: processedData.warnings.length,
        warning_details: processedData.warnings.slice(0, 5)
      };
    }

    // ------------------------
    // Audit log (async, pero esperamos a que se escriba)
    // ------------------------
    try {
      await logUploadAction({
        user: req.user || null,
        file_name: req.file.originalname,
        stored_name: req.file.filename,
        file_size: req.file.size,
        total_rows: response.summary.total_rows,
        valid_rows: response.summary.valid_rows,
        invalid_rows: response.summary.invalid_rows,
        duplicates_count: processedData.duplicates?.length || 0,
        errors_count: processedData.errors.length,
        warnings_count: processedData.warnings?.length || 0,
        clinical_ok: okCount,
        clinical_with_errors: withErrCount
      });
    } catch (e) {
      console.warn('No se pudo guardar audit upload (continuando):', e?.message ?? e);
    }

    // ------------------------
    // Eliminar archivo temporal (rechazamos conservar archivos tras el proceso)
    // ------------------------
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.warn('No se pudo borrar archivo temporal:', e?.message ?? e);
    } finally {
      filePath = null;
    }

    return res.json(response);

  } catch (error) {
    console.error('Error general procesando archivo:', error);
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: process.env.NODE_ENV === 'development' ? (error?.message ?? String(error)) : 'Error procesando archivo'
    });
  }
});

/* ============================
   9) Endpoint info
============================ */
router.get('/upload/info', (req, res) => {
  res.json({
    endpoint: '/api/upload',
    method: 'POST',
    description: 'Sube CSV/Excel con datos clínicos. Mapea columnas flexiblemente, valida por fila (Joi) y aplica reglas clínicas GRD (MINSAL) sin bloquear por estructura.',
    accepted_formats: ['CSV (.csv)', 'Excel (.xlsx, .xls)'],
    max_file_size: '10MB',
    validation: {
      column_structure: 'Validación suave: advertencias, no bloquea',
      required_columns: REQUIRED_COLUMNS,
      data_validation: 'Validación por fila con Joi + validación clínica GRD'
    }
  });
});

module.exports = router;

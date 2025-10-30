// routes/export.js
const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// === NUEVO: reglas GRD (carga remota) y validador clínico ===
// Si los módulos no existen, creamos fallbacks para evitar crash en runtime.
let loadMinsalNorma;
let validateClinical;

try {
  ({ loadMinsalNorma } = require('../utils/grdRules'));
} catch (err) {
  console.warn('Aviso: ../utils/grdRules no encontrado. Usando loader por defecto.');
  loadMinsalNorma = async () => ({});
}

try {
  ({ validateClinical } = require('../utils/clinicalValidator'));
} catch (err) {
  console.warn('Aviso: ../utils/clinicalValidator no encontrado. Usando validador por defecto.');
  validateClinical = (row /*, rules */) => {
    // Retornar keys esperadas por el resto del flujo
    return {
      inlier_outlier: '',
      grupo_norma_sn: '',
      VALIDADO: row.validado ?? 'SÍ'
    };
  };
}

// --------- Middlewares de ejemplo (igual) ----------
const requireAuth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
};

const requireExportPermission = (req, res, next) => {
  const ALLOWED_ROLES = [
    'Usuario Ciclo de Ingresos / Finanzas',
    'Usuario Coordinador / Gestión'
  ];
  const user = req.user || {};
  const roles = [];
  if (Array.isArray(user.roles)) roles.push(...user.roles);
  if (typeof user.role === 'string') roles.push(user.role);
  const hasRole = roles.some(r => ALLOWED_ROLES.includes(String(r).trim()));
  if (!hasRole) {
    return res.status(403).json({ error: 'forbidden', message: 'no tiene permisos para exportar' });
  }
  next();
};

// --------- Helpers ----------
const toExcelDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10); // YYYY-MM-DD
};

// Recalcula dias_estancia si falta / está mal
const ensureDiasEstancia = (row) => {
  const val = row.dias_estancia;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (row.fecha_ingreso && row.fecha_egreso) {
    const fi = new Date(row.fecha_ingreso);
    const fe = new Date(row.fecha_egreso);
    if (!isNaN(fi.getTime()) && !isNaN(fe.getTime())) {
      const diff = Math.round((fe - fi) / 86400000);
      return diff >= 0 ? diff : '';
    }
  }
  return '';
};

// Auditoría simple a archivo
const auditDir = path.join(__dirname, '..', '..', 'logs');
const auditFile = path.join(auditDir, 'export-audit.log');
async function logExportAction({ user, metadata, filename }) {
  try {
    await fs.promises.mkdir(auditDir, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      user: {
        id: user?.id ?? null,
        name: user?.name ?? null,
        email: user?.email ?? null,
        roles: user?.roles ?? user?.role ?? null
      },
      requestId: metadata?.requestId ?? null,
      filters: metadata?.filters ?? null,
      grdType: metadata?.grdType ?? null,
      filename
    };
    await fs.promises.appendFile(auditFile, JSON.stringify(entry) + '\n', 'utf8');
    console.info('🔒 Export audit saved:', entry);
  } catch (err) {
    console.error('Failed to write export audit:', err);
  }
}

// --------- Simulación de datos procesados (reemplaza por BD) ----------
const getProcessedData = async (filters) => {
  const { desde, hasta, centro, validado } = filters;

  const mockData = [
    {
      id: 1,
      validado: 'SÍ',
      centro: 'Hospital UC Christus',
      folio: 'FOL-001',
      episodio: 'EP-001',
      rut: '12345678-9',
      paciente_id: 'P001',
      nombre: 'Juan Pérez',
      tipo_episodio: 'Hospitalización',
      fecha_ingreso: '2024-01-15',
      fecha_egreso: '2024-01-20',
      servicio_alta: 'Medicina Interna',
      estado_rn: 'N/A',
      at_sn: 'S',
      at_detalle: 'Cirugía programada',
      monto_at: 1500000,
      tipo_alta: 'Alta médica',
      ir_grd: '11011',
      peso: 70,
      monto_rn: 0,
      demora_rescate_dias: 0,
      pago_demora_rescate: 0,
      pago_outlier_sup: 0,
      doc_necesaria: 'Completa',
      inlier_outlier: '',
      grupo_norma_sn: '',
      dias_estancia: null,
      precio_base_tramo: 1200000,
      valor_grd: 1200000,
      monto_final: 1200000
    },
    {
      id: 2,
      validado: 'SÍ',
      centro: 'Hospital UC Christus',
      folio: 'FOL-002',
      episodio: 'EP-002',
      rut: '98765432-1',
      paciente_id: 'P002',
      nombre: 'María González',
      tipo_episodio: 'Hospitalización',
      fecha_ingreso: '2024-01-16',
      fecha_egreso: '2024-02-20',
      servicio_alta: 'Cardiología',
      estado_rn: 'N/A',
      at_sn: 'N',
      at_detalle: '',
      monto_at: 0,
      tipo_alta: 'Alta médica',
      ir_grd: '11101',
      peso: 65,
      monto_rn: 0,
      demora_rescate_dias: 0,
      pago_demora_rescate: 0,
      pago_outlier_sup: 0,
      doc_necesaria: 'Completa',
      inlier_outlier: '',
      grupo_norma_sn: '',
      dias_estancia: null,
      precio_base_tramo: 1500000,
      valor_grd: 1500000,
      monto_final: 1500000
    }
  ];

  let filteredData = mockData;
  if (desde) {
    const desdeD = new Date(desde);
    if (!isNaN(desdeD.getTime())) filteredData = filteredData.filter(item => new Date(item.fecha_ingreso) >= desdeD);
  }
  if (hasta) {
    const hastaD = new Date(hasta);
    if (!isNaN(hastaD.getTime())) filteredData = filteredData.filter(item => new Date(item.fecha_ingreso) <= hastaD);
  }
  if (centro) filteredData = filteredData.filter(item => item.centro.toLowerCase().includes(centro.toLowerCase()));
  if (validado) filteredData = filteredData.filter(item => String(item.validado).toLowerCase() === String(validado).toLowerCase());
  return filteredData;
};

// --------- Export principal ----------
router.get('/export', requireAuth, requireExportPermission, async (req, res) => {
  try {
    const { desde, hasta, centro, validado } = req.query;

    console.log(`📤 Iniciando exportación con filtros:`, { desde, hasta, centro, validado });

    // 1) Datos procesados
    const rows = await getProcessedData({ desde, hasta, centro, validado });
    console.log(`📊 Datos encontrados: ${rows.length} registros`);

    // 2) Cargar reglas GRD (desde SharePoint público, cacheadas)
    const GRD_RULES = await loadMinsalNorma();

    // 3) Metadatos/Trazabilidad (guardamos en hoja "Metadata", no ensuciamos FONASA)
    const user = req.user || { id: 'anon', name: 'anon', email: '' };
    const metadata = {
      generatedBy: { id: user.id, name: user.name, email: user.email },
      generatedAt: new Date().toISOString(),
      grdType: req.query.type || 'FONASA',
      filters: { desde, hasta, centro, validado },
      requestId: req.headers['x-request-id'] || '',
      systemVersion: process.env.npm_package_version || 'dev'
    };

    // 4) Layout exacto (29 columnas)
    const headers = [
      'Unnamed: 0', 'VALIDADO', 'Centro', 'N° Folio', 'Episodio', 'Rut Paciente',
      'Nombre Paciente', 'TIPO EPISODIO', 'Fecha de ingreso', 'Fecha Alta',
      'Servicios de alta', 'ESTADO RN', 'AT (S/N)', 'AT detalle', 'Monto AT',
      'Tipo de Alta', 'IR - GRD', 'PESO', 'MONTO  RN', 'Dias de demora rescate desde Hospital',
      'Pago demora rescate', 'Pago por outlier superior', 'DOCUMENTACIÓN NECESARIA',
      'Inlier/outlier', 'Grupo dentro de norma S/N', 'Dias de Estada',
      'Precio Base por tramo correspondiente', 'Valor GRD', 'Monto Final'
    ];

    const sheetData = [headers];

    // 5) Validar/ajustar fila a fila con GRD y reglas clínicas
    rows.forEach((raw) => {
      // asegurar campos mínimos esperados por el validador
      const base = { ...raw };
      base.dias_estancia = ensureDiasEstancia(base);

      // Ejecutar validador clínico (usa GRD_RULES)
      let clinical = {};
      try {
        clinical = validateClinical(base, GRD_RULES) || {};
      } catch (err) {
        console.error('Error en validateClinical, usando fallback:', err);
        clinical = {};
      }

      // Enriquecer fila con banderas/derivados
      const r = {
        ...base,
        ...clinical,
      };
      // Grupo dentro de norma S/N desde inlier/outlier
      if (!r.grupo_norma_sn) {
        r.grupo_norma_sn = r.inlier_outlier === 'inlier' ? 'S' : (r.inlier_outlier === 'outlier' ? 'N' : '');
      }
      // Normalizar fechas formato texto (solo para export)
      const fechaIngreso = toExcelDate(r.fecha_ingreso);
      const fechaAlta = toExcelDate(r.fecha_egreso);

      // Pushear fila en el orden exacto
      sheetData.push([
        '',                                   // Unnamed: 0
        r.VALIDADO ?? r.validado ?? '',       // VALIDADO (preferimos el del validador)
        r.centro ?? r.hospital_desc ?? '',    // Centro
        r.folio ?? r.id_derivacion ?? '',     // N° Folio
        r.episodio ?? r.episodio_cmbd ?? '',  // Episodio
        r.rut ?? r.paciente_id ?? '',         // Rut Paciente
        r.nombre ?? '',                       // Nombre Paciente
        r.tipo_episodio ?? r.tipo_actividad ?? '', // TIPO EPISODIO
        fechaIngreso,                         // Fecha de ingreso
        fechaAlta,                            // Fecha Alta
        r.servicio_alta ?? r.servicio_egreso_desc ?? '', // Servicios de alta
        r.estado_rn ?? '',                    // ESTADO RN
        r.at_sn ?? '',                        // AT (S/N)
        r.at_detalle ?? '',                   // AT detalle
        Number(r.monto_at) || 0,              // Monto AT
        r.tipo_alta ?? r.motivo_egreso_desc ?? '', // Tipo de Alta
        r.ir_grd ?? r.grd ?? '',              // IR - GRD
        (r.peso ?? r.PESO ?? '') === '' ? '' : Number(r.peso ?? r.PESO), // PESO
        Number(r.monto_rn) || 0,              // MONTO RN
        (r.demora_rescate_dias ?? '') === '' ? '' : Number(r.demora_rescate_dias), // Días demora rescate
        Number(r.pago_demora_rescate) || 0,   // Pago demora rescate
        Number(r.pago_outlier_sup) || 0,      // Pago por outlier superior
        r.doc_necesaria ?? '',                // DOCUMENTACIÓN NECESARIA
        r.inlier_outlier ?? '',               // Inlier/outlier
        r.grupo_norma_sn ?? '',               // Grupo dentro de norma S/N
        (r.dias_estancia ?? '') === '' ? '' : Number(r.dias_estancia), // Dias de Estada
        Number(r.precio_base_tramo) || 0,     // Precio Base por tramo correspondiente
        Number(r.valor_grd) || 0,             // Valor GRD
        Number(r.monto_final) || 0            // Monto Final
      ]);
    });

    // 6) Workbook: FONASA + Metadata (separadas)
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'FONASA');

    const metaSheetData = Object.entries({
      ...metadata,
      total_rows: rows.length,
    }).map(([k, v]) => [k, (typeof v === 'object') ? JSON.stringify(v) : String(v)]);
    const metaWs = XLSX.utils.aoa_to_sheet(metaSheetData);
    XLSX.utils.book_append_sheet(wb, metaWs, 'Metadata');

    // 7) Respuesta
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const filename = `FONASA_export_${ts}.xlsx`;

    logExportAction({ user, metadata, filename }).catch(() => {});

    console.log(`✅ Archivo Excel generado: ${filename} (${buf.length} bytes)`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.status(200).send(buf);

  } catch (err) {
    console.error('Export error:', err);
    return res.status(500).json({ error: 'export_failed', message: err?.message ?? String(err) });
  }
});

// Info endpoint
router.get('/export/info', (req, res) => {
  res.json({
    endpoint: '/api/export',
    method: 'GET',
    description: 'Exporta datos procesados en formato Excel FONASA (29 columnas). Aplica validaciones GRD en tiempo de export como second-pass.',
    authentication: 'Requiere autenticación y permisos de exportación',
    parameters: {
      desde: { type: 'string', format: 'YYYY-MM-DD' },
      hasta: { type: 'string', format: 'YYYY-MM-DD' },
      centro: { type: 'string' },
      validado: { type: 'string', values: ['SÍ', 'NO'] }
    },
    response: {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'FONASA_export_YYYYMMDDTHHMMSS.xlsx'
    }
  });
});

module.exports = router;

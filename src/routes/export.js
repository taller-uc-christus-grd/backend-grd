const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();

// Middlewares de ejemplo
const requireAuth = (req, res, next) => {
  // Verifica JWT/sesión
  // if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
};

const requireExportPermission = (req, res, next) => {
  // if (!req.user.permissions.includes('canExportFonasa')) return res.status(403).json({ error: 'forbidden' });
  next();
};

// Helper: normalizar tipos/salida
const toExcelDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  // YYYY-MM-DD
  return dt.toISOString().slice(0, 10);
};

// Simulación de datos procesados (en producción vendría de BD)
const getProcessedData = async (filters) => {
  const { desde, hasta, centro, validado } = filters;
  
  // TODO: Reemplazar por consulta real a la base de datos
  // const rows = await repo.findProcessed({ desde, hasta, centro, validado });
  
  // Datos de ejemplo para demostración
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
      grd: 'GRD-001',
      peso: 70,
      monto_rn: 0,
      demora_rescate_dias: 0,
      pago_demora_rescate: 0,
      pago_outlier_sup: 0,
      doc_necesaria: 'Completa',
      inlier_outlier: 'Inlier',
      grupo_norma_sn: 'S',
      dias_estancia: 5,
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
      fecha_egreso: '2024-01-22',
      servicio_alta: 'Cardiología',
      estado_rn: 'N/A',
      at_sn: 'N',
      at_detalle: '',
      monto_at: 0,
      tipo_alta: 'Alta médica',
      grd: 'GRD-002',
      peso: 65,
      monto_rn: 0,
      demora_rescate_dias: 0,
      pago_demora_rescate: 0,
      pago_outlier_sup: 0,
      doc_necesaria: 'Completa',
      inlier_outlier: 'Inlier',
      grupo_norma_sn: 'S',
      dias_estancia: 6,
      precio_base_tramo: 1500000,
      valor_grd: 1500000,
      monto_final: 1500000
    }
  ];
  
  // Aplicar filtros (simulación)
  let filteredData = mockData;
  
  if (desde) {
    filteredData = filteredData.filter(item => new Date(item.fecha_ingreso) >= new Date(desde));
  }
  
  if (hasta) {
    filteredData = filteredData.filter(item => new Date(item.fecha_ingreso) <= new Date(hasta));
  }
  
  if (centro) {
    filteredData = filteredData.filter(item => 
      item.centro.toLowerCase().includes(centro.toLowerCase())
    );
  }
  
  if (validado) {
    filteredData = filteredData.filter(item => 
      item.validado.toLowerCase() === validado.toLowerCase()
    );
  }
  
  return filteredData;
};

router.get('/export', requireAuth, requireExportPermission, async (req, res) => {
  try {
    const { desde, hasta, centro, validado } = req.query;

    console.log(`📤 Iniciando exportación con filtros:`, { desde, hasta, centro, validado });

    // 1) Obtener datos ya procesados desde tu capa de datos (BD/tablas intermedias).
    const rows = await getProcessedData({ desde, hasta, centro, validado });

    console.log(`📊 Datos encontrados: ${rows.length} registros`);

    // 2) Transformar al layout exacto (29 columnas)
    const sheetData = [];

    // --- Metadatos / trazabilidad (añadido) ---
    const user = req.user || { id: 'anon', name: 'anon', email: '' };
    const metadata = {
      generatedBy: { id: user.id, name: user.name, email: user.email },
      generatedAt: new Date().toISOString(),
      grdType: req.query.type || 'FONASA',
      filters: { desde, hasta, centro, validado },
      requestId: req.headers['x-request-id'] || '',
      systemVersion: process.env.npm_package_version || 'dev'
    };

    // Insertar metadatos como encabezado (líneas que empiezan con "# key: value")
    Object.entries(metadata).forEach(([k, v]) => {
      const value = (typeof v === 'object') ? JSON.stringify(v) : String(v);
      sheetData.push([`# ${k}:`, value]);
    });
    sheetData.push([]); // fila separadora
    // --- fin metadatos ---

    // Encabezados EXACTOS
    const headers = [
      'Unnamed: 0', 'VALIDADO', 'Centro', 'N° Folio', 'Episodio', 'Rut Paciente',
      'Nombre Paciente', 'TIPO EPISODIO', 'Fecha de ingreso ', 'Fecha Alta',
      'Servicios de alta', 'ESTADO RN', 'AT (S/N)', 'AT detalle', 'Monto AT',
      'Tipo de Alta', 'IR - GRD', 'PESO ', 'MONTO  RN', 'Dias de demora rescate desde Hospital',
      'Pago demora rescate', 'Pago por outlier superior', 'DOCUMENTACIÓN NECESARIA',
      'Inlier/outlier', 'Grupo dentro de norma S/N', 'Dias de Estada',
      'Precio Base por tramo correspondiente', 'Valor GRD', 'Monto Final'
    ];
    sheetData.push(headers);

    // 3) Mapear cada fila
    rows.forEach((r, idx) => {
      // r = registro normalizado desde tu BD (de /upload)
      // Aplica mapeo definido más arriba
      const fechaIngreso = toExcelDate(r.fecha_ingreso);
      const fechaAlta = toExcelDate(r.fecha_egreso);
      const diasEstada = Number.isFinite(r.dias_estancia) ? r.dias_estancia : (
        (r.fecha_ingreso && r.fecha_egreso) ? Math.max(0, Math.round((new Date(r.fecha_egreso) - new Date(r.fecha_ingreso)) / 86400000)) : ''
      );

      sheetData.push([
        '',                                   // Unnamed: 0
        r.validado ?? '',                     // VALIDADO
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
        r.monto_at ?? 0,                      // Monto AT
        r.tipo_alta ?? r.motivo_egreso_desc ?? '', // Tipo de Alta
        r.grd ?? r.ir_grd ?? '',              // IR - GRD
        r.peso ?? '',                         // PESO
        r.monto_rn ?? 0,                      // MONTO RN
        r.demora_rescate_dias ?? '',          // Días demora rescate
        r.pago_demora_rescate ?? 0,           // Pago demora rescate
        r.pago_outlier_sup ?? 0,              // Pago por outlier superior
        r.doc_necesaria ?? '',                // DOCUMENTACIÓN NECESARIA
        r.inlier_outlier ?? '',               // Inlier/outlier
        r.grupo_norma_sn ?? '',               // Grupo dentro de norma S/N
        diasEstada,                           // Dias de Estada
        r.precio_base_tramo ?? 0,             // Precio Base por tramo correspondiente
        r.valor_grd ?? 0,                     // Valor GRD
        r.monto_final ?? 0                    // Monto Final
      ]);
    });

    // 4) Generar workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Añadir hoja separada con metadatos (clave / valor) para auditoría (añadido)
    const metaSheetData = Object.entries(metadata).map(([k, v]) => [k, (typeof v === 'object') ? JSON.stringify(v) : String(v)]);
    const metaWs = XLSX.utils.aoa_to_sheet(metaSheetData);
    XLSX.utils.book_append_sheet(wb, metaWs, 'Metadata');

    XLSX.utils.book_append_sheet(wb, ws, 'FONASA');

    // 5) Escribir a buffer y responder descarga
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const filename = `FONASA_export_${ts}.xlsx`;

    console.log(`✅ Archivo Excel generado: ${filename} (${buf.length} bytes)`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.status(200).send(buf);

  } catch (err) {
    console.error('Export error:', err);
    return res.status(500).json({ error: 'export_failed', message: err.message });
  }
});

// Endpoint GET para información del endpoint de exportación
router.get('/export/info', (req, res) => {
  res.json({
    endpoint: '/api/export',
    method: 'GET',
    description: 'Endpoint para exportar datos procesados a formato Excel FONASA',
    authentication: 'Requiere autenticación y permisos de exportación',
    parameters: {
      desde: {
        type: 'string',
        format: 'YYYY-MM-DD',
        description: 'Fecha de inicio del rango (opcional)',
        example: '2024-01-01'
      },
      hasta: {
        type: 'string',
        format: 'YYYY-MM-DD',
        description: 'Fecha de fin del rango (opcional)',
        example: '2024-01-31'
      },
      centro: {
        type: 'string',
        description: 'Filtrar por centro médico (opcional)',
        example: 'Hospital UC Christus'
      },
      validado: {
        type: 'string',
        description: 'Filtrar por estado de validación (opcional)',
        values: ['SÍ', 'NO'],
        example: 'SÍ'
      }
    },
    response: {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      description: 'Archivo Excel con 29 columnas según formato FONASA',
      filename: 'FONASA_export_YYYYMMDDTHHMMSS.xlsx'
    },
    example_usage: {
      method: 'GET',
      url: '/api/export?desde=2024-01-01&hasta=2024-01-31&centro=Hospital UC Christus&validado=SÍ',
      headers: {
        'Authorization': 'Bearer <token>'
      }
    }
  });
});

module.exports = router;

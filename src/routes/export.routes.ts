import { Router, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { requireAuth } from '../middlewares/auth';

const router = Router();

// Helper functions
const toExcelDate = (d: string | Date): string => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
};

const ensureDiasEstancia = (row: any): number | string => {
  const val = row.dias_estancia;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (row.fecha_ingreso && row.fecha_egreso) {
    const fi = new Date(row.fecha_ingreso);
    const fe = new Date(row.fecha_egreso);
    if (!isNaN(fi.getTime()) && !isNaN(fe.getTime())) {
      const diff = Math.round((fe.getTime() - fi.getTime()) / 86400000);
      return diff >= 0 ? diff : '';
    }
  }
  return '';
};

const getProcessedData = async (filters: any): Promise<any[]> => {
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
    }
  ];

  let filteredData = mockData;
  if (desde) {
    const desdeD = new Date(desde as string);
    if (!isNaN(desdeD.getTime())) {
      filteredData = filteredData.filter(item => new Date(item.fecha_ingreso) >= desdeD);
    }
  }
  if (hasta) {
    const hastaD = new Date(hasta as string);
    if (!isNaN(hastaD.getTime())) {
      filteredData = filteredData.filter(item => new Date(item.fecha_ingreso) <= hastaD);
    }
  }
  if (centro) {
    filteredData = filteredData.filter(item => 
      item.centro.toLowerCase().includes((centro as string).toLowerCase())
    );
  }
  if (validado) {
    filteredData = filteredData.filter(item => 
      String(item.validado).toLowerCase() === String(validado).toLowerCase()
    );
  }
  return filteredData;
};

// Export endpoint
router.get('/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const { desde, hasta, centro, validado } = req.query;

    console.log(`📤 Iniciando exportación con filtros:`, { desde, hasta, centro, validado });

    const rows = await getProcessedData({ desde, hasta, centro, validado });
    console.log(`📊 Datos encontrados: ${rows.length} registros`);

    const metadata = {
      generatedBy: { id: req.user?.id || 'anon', name: 'anon', email: '' },
      generatedAt: new Date().toISOString(),
      grdType: req.query.type || 'FONASA',
      filters: { desde, hasta, centro, validado },
      requestId: req.headers['x-request-id'] || '',
      systemVersion: process.env.npm_package_version || 'dev'
    };

    const headers = [
      'Unnamed: 0', 'VALIDADO', 'Centro', 'N° Folio', 'Episodio', 'Rut Paciente',
      'Nombre Paciente', 'TIPO EPISODIO', 'Fecha de ingreso', 'Fecha Alta',
      'Servicios de alta', 'ESTADO RN', 'AT (S/N)', 'AT detalle', 'Monto AT',
      'Tipo de Alta', 'IR - GRD', 'PESO', 'MONTO  RN', 'Dias de demora rescate desde Hospital',
      'Pago demora rescate', 'Pago por outlier superior', 'DOCUMENTACIÓN NECESARIA',
      'Inlier/outlier', 'Grupo dentro de norma S/N', 'Dias de Estada',
      'Precio Base por tramo correspondiente', 'Valor GRD', 'Monto Final'
    ];

    const sheetData: any[][] = [headers];

    rows.forEach((raw) => {
      const base = { ...raw };
      base.dias_estancia = ensureDiasEstancia(base);

      const fechaIngreso = toExcelDate(raw.fecha_ingreso);
      const fechaAlta = toExcelDate(raw.fecha_egreso);

      sheetData.push([
        '',
        raw.VALIDADO || raw.validado || '',
        raw.centro || '',
        raw.folio || '',
        raw.episodio || '',
        raw.rut || raw.paciente_id || '',
        raw.nombre || '',
        raw.tipo_episodio || '',
        fechaIngreso,
        fechaAlta,
        raw.servicio_alta || '',
        raw.estado_rn || '',
        raw.at_sn || '',
        raw.at_detalle || '',
        Number(raw.monto_at) || 0,
        raw.tipo_alta || '',
        raw.ir_grd || '',
        Number(raw.peso) || '',
        Number(raw.monto_rn) || 0,
        Number(raw.demora_rescate_dias) || '',
        Number(raw.pago_demora_rescate) || 0,
        Number(raw.pago_outlier_sup) || 0,
        raw.doc_necesaria || '',
        raw.inlier_outlier || '',
        raw.grupo_norma_sn || '',
        Number(raw.dias_estancia) || '',
        Number(raw.precio_base_tramo) || 0,
        Number(raw.valor_grd) || 0,
        Number(raw.monto_final) || 0
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'FONASA');

    const metaSheetData = Object.entries({
      ...metadata,
      total_rows: rows.length,
    }).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);

    const metaWs = XLSX.utils.aoa_to_sheet(metaSheetData);
    XLSX.utils.book_append_sheet(wb, metaWs, 'Metadata');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const filename = `FONASA_export_${ts}.xlsx`;

    console.log(`✅ Archivo Excel generado: ${filename} (${buf.length} bytes)`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.status(200).send(buf);

  } catch (err: any) {
    console.error('Export error:', err);
    return res.status(500).json({ error: 'export_failed', message: err?.message ?? String(err) });
  }
});

router.get('/export/info', (_req: Request, res: Response) => {
  res.json({
    endpoint: '/api/export',
    method: 'GET',
    description: 'Exporta datos procesados en formato Excel FONASA',
    authentication: 'Requiere autenticación',
    parameters: {
      desde: { type: 'string', format: 'YYYY-MM-DD' },
      hasta: { type: 'string', format: 'YYYY-MM-DD' },
      centro: { type: 'string' },
      validado: { type: 'string', values: ['SÍ', 'NO'] }
    }
  });
});

export default router;


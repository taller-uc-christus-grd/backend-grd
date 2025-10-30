import { Router, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middlewares/auth';
import { prisma, Prisma } from '../db/client'; // ¡Importante! Conecta con la DB

const router = Router();

// Funciones Helper (las mantenemos)
const toExcelDate = (d: string | Date | null | undefined): string => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
};

const ensureDiasEstancia = (row: any): number | string => {
  const val = row.diasEstada; // Corregido a 'diasEstada' de tu schema
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (row.fechaIngreso && row.fechaAlta) {
    const fi = new Date(row.fechaIngreso);
    const fe = new Date(row.fechaAlta);
    if (!isNaN(fi.getTime()) && !isNaN(fe.getTime())) {
      const diff = Math.round((fe.getTime() - fi.getTime()) / 86400000);
      return diff >= 0 ? diff : '';
    }
  }
  return '';
};

// ¡Función MODIFICADA! Ahora consulta la base de datos.
const getProcessedData = async (filters: any): Promise<any[]> => {
  const { desde, hasta, centro } = filters; // 'validado' se usará en el 'where'

  const where: Prisma.EpisodioWhereInput = {};

  if (desde) {
    try {
      where.fechaIngreso = { ...where.fechaIngreso, gte: new Date(desde as string) };
    } catch (e) {
      console.warn('Fecha "desde" inválida:', desde);
    }
  }
  if (hasta) {
    try {
      where.fechaIngreso = { ...where.fechaIngreso, lte: new Date(hasta as string) };
    } catch (e) {
      console.warn('Fecha "hasta" inválida:', hasta);
    }
  }
  if (centro) {
    where.centro = { contains: centro as string, mode: 'insensitive' };
  }
  // No veo 'validado' en tu schema, usaré 'grupoEnNorma'
  // if (validado) {
  //   where.grupoEnNorma = String(validado).toLowerCase() === 'sí';
  // }

  const dbData = await prisma.episodio.findMany({
    where,
    include: {
      paciente: true, // Incluye datos del paciente
      grd: true, // Incluye datos del GRD
    },
    orderBy: {
      fechaIngreso: 'asc',
    },
  });

  // Mapea los datos de Prisma al formato plano que espera el Excel
  return dbData.map((e) => ({
    VALIDADO: e.grupoEnNorma ? 'SÍ' : 'NO',
    centro: e.centro,
    folio: e.numeroFolio,
    episodio: e.episodioCmdb,
    rut: e.paciente?.rut,
    nombre: e.paciente?.nombre,
    tipo_episodio: e.tipoEpisodio,
    fecha_ingreso: e.fechaIngreso,
    fecha_egreso: e.fechaAlta,
    servicio_alta: e.servicioAlta,
    estado_rn: e.estadoRn,
    at_sn: e.atSn ? 'S' : 'N',
    at_detalle: e.atDetalle,
    monto_at: e.montoAt,
    tipo_alta: e.tipoAlta,
    ir_grd: e.grd?.codigo,
    peso: e.pesoGrd,
    monto_rn: e.montoRn,
    demora_rescate_dias: e.diasDemoraRescate,
    pago_demora_rescate: e.pagoDemoraRescate,
    pago_outlier_sup: e.pagoOutlierSuperior,
    doc_necesaria: '', // Este campo no está en tu schema, se deja vacío
    inlier_outlier: e.inlierOutlier,
    grupo_norma_sn: e.grupoEnNorma ? 'S' : 'N',
    dias_estancia: e.diasEstada, // Se calculará en el helper
    precio_base_tramo: e.precioBaseTramo,
    valor_grd: e.valorGrd,
    monto_final: e.montoFinal,
  }));
};

// Endpoint de Exportación (AHORA CON DATOS REALES)
router.get('/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const { desde, hasta, centro, validado } = req.query;

    console.log(`📤 Iniciando exportación con filtros:`, { desde, hasta, centro, validado });

    // ¡getProcessedData ahora es async y consulta la DB!
    const rows = await getProcessedData({ desde, hasta, centro, validado });
    console.log(`📊 Datos encontrados: ${rows.length} registros`);

    const metadata = {
      generatedBy: { id: req.user?.id || 'anon', role: req.user?.role || 'anon' },
      generatedAt: new Date().toISOString(),
      grdType: req.query.type || 'FONASA',
      filters: { desde, hasta, centro, validado },
    };

    const headers = [
      'Unnamed: 0', 'VALIDADO', 'Centro', 'N° Folio', 'Episodio', 'Rut Paciente',
      'Nombre Paciente', 'TIPO EPISODIO', 'Fecha de ingreso', 'Fecha Alta',
      'Servicios de alta', 'ESTADO RN', 'AT (S/N)', 'AT detalle', 'Monto AT',
      'Tipo de Alta', 'IR - GRD', 'PESO', 'MONTO  RN', 'Dias de demora rescate desde Hospital',
      'Pago demora rescate', 'Pago por outlier superior', 'DOCUMENTACIÓN NECESARIA',
      'Inlier/outlier', 'Grupo dentro de norma S/N', 'Dias de Estada',
      'Precio Base por tramo correspondiente', 'Valor GRD', 'Monto Final'
    ];

    const sheetData: any[][] = [headers];

    rows.forEach((raw) => {
      // Usamos una copia para no mutar el 'raw' original
      const rowConEstancia = { ...raw, dias_estancia: ensureDiasEstancia(raw) };

      const fechaIngreso = toExcelDate(rowConEstancia.fecha_ingreso);
      const fechaAlta = toExcelDate(rowConEstancia.fecha_egreso);

      sheetData.push([
        '',
        rowConEstancia.VALIDADO || '',
        rowConEstancia.centro || '',
        rowConEstancia.folio || '',
        rowConEstancia.episodio || '',
        rowConEstancia.rut || '',
        rowConEstancia.nombre || '',
        rowConEstancia.tipo_episodio || '',
        fechaIngreso,
        fechaAlta,
        rowConEstancia.servicio_alta || '',
        rowConEstancia.estado_rn || '',
        rowConEstancia.at_sn || '',
        rowConEstancia.at_detalle || '',
        Number(rowConEstancia.monto_at) || 0,
        rowConEstancia.tipo_alta || '',
        rowConEstancia.ir_grd || '',
        Number(rowConEstancia.peso) || '',
        Number(rowConEstancia.monto_rn) || 0,
        Number(rowConEstancia.demora_rescate_dias) || '',
        Number(rowConEstancia.pago_demora_rescate) || 0,
        Number(rowConEstancia.pago_outlier_sup) || 0,
        rowConEstancia.doc_necesaria || '',
        rowConEstancia.inlier_outlier || '',
        rowConEstancia.grupo_norma_sn || '',
        Number(rowConEstancia.dias_estancia) || '',
        Number(rowConEstancia.precio_base_tramo) || 0,
        Number(rowConEstancia.valor_grd) || 0,
        Number(rowConEstancia.monto_final) || 0
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

// Ruta de Info (la mantenemos)
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
      // validado: { type: 'string', values: ['SÍ', 'NO'] } // Comentado ya que no está en el schema
    }
  });
});

export default router;
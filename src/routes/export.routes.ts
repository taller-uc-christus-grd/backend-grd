import { Router, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middlewares/auth';
import { prisma } from '../db/client';
import type { Prisma } from '@prisma/client';
import { uploadToCloudinary } from '../config/cloudinary';
import { logFileDownload } from '../utils/logger';

const router = Router();

// --- Funciones Helper ---
const toExcelDate = (d: string | Date | null | undefined): string => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
};

const getDiasEstada = (fechaIngreso: Date | null | undefined, fechaAlta: Date | null | undefined): number => {
  if (!fechaIngreso || !fechaAlta) return 0;
  const diff = Math.round((fechaAlta.getTime() - fechaIngreso.getTime()) / 86400000);
  return diff >= 0 ? diff : 0;
};

// --- Lógica de Cálculo (basado en tu esquema) ---
function calcularValores(episodio: any): any {
  const { grd } = episodio;
  if (!grd) {
    return {
      diasEstada: getDiasEstada(episodio.fechaIngreso, episodio.fechaAlta),
      inlierOutlier: 'SIN GRD',
      precioBaseTramo: 0,
      valorGrd: 0,
      montoFinal: 0,
    };
  }

  const diasEstada = getDiasEstada(episodio.fechaIngreso, episodio.fechaAlta);
  const { peso = 0, precioBaseTramo = 0, puntoCorteInf = 0, puntoCorteSup = 0 } = grd as any;

  let inlierOutlier = 'Inlier';
  if (diasEstada > (puntoCorteSup as number)) {
    inlierOutlier = 'Outlier Superior';
  } else if (diasEstada < (puntoCorteInf as number)) {
    inlierOutlier = 'Outlier Inferior';
  }

  const valorGrd = (peso as number) * (precioBaseTramo as number);
  const montoFinal =
    (valorGrd || 0) +
    (episodio.montoAt as number || 0) +
    (episodio.pagoDemoraRescate as number || 0) +
    (episodio.pagoOutlierSuperior as number || 0);

  return {
    diasEstada,
    inlierOutlier,
    precioBaseTramo: precioBaseTramo as number,
    valorGrd,
    montoFinal,
  };
}

// --- Endpoint de Exportación ---
router.get('/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const { desde, hasta, centro } = req.query;
    console.log('📤 Iniciando exportación con filtros:', { desde, hasta, centro });

    const where: Prisma.EpisodioWhereInput = {};
    if (desde || hasta) {
      const fechaFilter: Prisma.DateTimeFilter = {};
      if (desde) fechaFilter.gte = new Date(desde as string);
      if (hasta) fechaFilter.lte = new Date(hasta as string);
      where.fechaIngreso = fechaFilter;
    }
    if (centro) where.centro = { contains: centro as string, mode: 'insensitive' };

    const episodiosDB = await prisma.episodio.findMany({
      where,
      include: {
        paciente: true,
        grd: true,
      },
      orderBy: { fechaIngreso: 'asc' },
    });
    console.log(`📊 Datos encontrados: ${episodiosDB.length} registros`);

    const rows = episodiosDB.map((e) => {
      const calculos = calcularValores(e);
      return {
        centro: e.centro,
        folio: e.numeroFolio,
        episodio: e.episodioCmdb,
        tipo_episodio: e.tipoEpisodio,
        fecha_ingreso: e.fechaIngreso,
        fecha_egreso: e.fechaAlta,
        servicio_alta: e.servicioAlta,
        estado_rn: e.estadoRn,
        at_sn: e.atSn ? 'S' : 'N',
        at_detalle: e.atDetalle,
        monto_at: e.montoAt,
        tipo_alta: e.tipoAlta,
        demora_rescate_dias: e.diasDemoraRescate,
        pago_demora_rescate: e.pagoDemoraRescate,
        pago_outlier_sup: e.pagoOutlierSuperior,
        rut: e.paciente?.rut,
        nombre: e.paciente?.nombre,
        ir_grd: e.grd?.codigo,
        peso: e.grd?.peso,
        ...calculos,
        VALIDADO: 'SÍ',
        grupo_norma_sn: 'S',
        doc_necesaria: '',
      };
    });

    // Cabeceras en el orden del sheetData
    const headers = [
      'Tipo dato', 'VALIDADO', 'Centro', 'N° Folio', 'Episodio', 'Rut Paciente', 'Nombre Paciente',
      'TIPO EPISODIO', 'Fecha de ingreso', 'Fecha Alta', 'Servicios de alta', 'ESTADO RN', 'AT (S/N)',
      'AT detalle', 'Monto AT', 'Tipo de Alta', 'IR - GRD', 'PESO', 'MONTO RN', 'Dias de demora rescate desde Hospital',
      'Pago demora rescate', 'Pago por outlier superior', 'DOCUMENTACIÓN NECESARIA', 'Inlier/outlier',
      'Grupo dentro de norma S/N', 'Dias de Estada', 'Precio Base por tramo correspondiente', 'Valor GRD', 'Monto Final'
    ];

    const sheetData: any[][] = [headers];

    rows.forEach((row) => {
      sheetData.push([
        'manual', // Tipo dato ejemplo
        row.VALIDADO || '',
        row.centro || '',
        row.folio || '',
        row.episodio || '',
        row.rut || '',
        row.nombre || '',
        row.tipo_episodio || '',
        toExcelDate(row.fecha_ingreso),
        toExcelDate(row.fecha_egreso),
        row.servicio_alta || '',
        row.estado_rn || '',
        row.at_sn || '',
        row.at_detalle || '',
        Number(row.monto_at) || 0,
        row.tipo_alta || '',
        row.ir_grd || '',
        Number(row.peso) || 0,
        0,
        Number(row.demora_rescate_dias) || 0,
        Number(row.pago_demora_rescate) || 0,
        Number(row.pago_outlier_sup) || 0,
        row.doc_necesaria || '',
        row.inlierOutlier || '',
        row.grupo_norma_sn || '',
        Number(row.diasEstada) || 0,
        Number(row.precioBaseTramo) || 0,
        Number(row.valorGrd) || 0,
        Number(row.montoFinal) || 0,
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'FONASA');

    // Generar Buffer
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    // Opción: subir a Cloudinary si se indica ?upload=true
    if ((req.query as any).upload === 'true' && typeof uploadToCloudinary === 'function') {
      try {
        const filename = `grd_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
        const result = await uploadToCloudinary(buf, { folder: 'grd_exports', public_id: filename, resource_type: 'raw' });
        return res.json({ ok: true, uploaded: true, result });
      } catch (err: any) {
        console.error('Error subiendo a Cloudinary:', err);
        return res.status(500).json({ message: 'Error subiendo a Cloudinary' });
      }
    }

    // Enviar archivo como descarga
    const fileName = `grd_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    
    // Log de descarga de archivo
    const userId = parseInt(req.user!.id);
    await logFileDownload(
      userId,
      fileName,
      'xlsx',
      buf.length,
      { desde, hasta, centro, totalEpisodios: episodiosDB.length }
    );
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buf);
  } catch (err: any) {
    console.error('Error en export route:', err);
    return res.status(500).json({ message: 'Error generando export' });
  }
});

// Ruta de Info
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
    },
  });
});

export default router;
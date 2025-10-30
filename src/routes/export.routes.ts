import { Router, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middlewares/auth';
import { prisma, Prisma } from '../db/client';
import { uploadToCloudinary } from '../config/cloudinary'; // <-- 1. Importar Cloudinary

const router = Router();

// --- Funciones Helper ---
const toExcelDate = (d: string | Date | null | undefined): string => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
};

const getDiasEstada = (fechaIngreso: Date, fechaAlta: Date): number => {
  if (!fechaIngreso || !fechaAlta) return 0;
  const diff = Math.round((fechaAlta.getTime() - fechaIngreso.getTime()) / 86400000);
  return diff >= 0 ? diff : 0;
};

// --- Lógica de Cálculo (Basada en image_da1fad.png) ---
function calcularValores(episodio: any): any {
  const { grd } = episodio;
  if (!grd) {
    // Si no hay GRD vinculado, devolver valores por defecto
    return {
      diasEstada: getDiasEstada(episodio.fechaIngreso, episodio.fechaAlta),
      inlierOutlier: 'SIN GRD',
      precioBaseTramo: 0,
      valorGrd: 0,
      montoFinal: 0,
    };
  }

  const diasEstada = getDiasEstada(episodio.fechaIngreso, episodio.fechaAlta);
  const { peso, precioBaseTramo, puntoCorteInf, puntoCorteSup } = grd;
  
  // 1. Calcular Inlier/Outlier
  let inlierOutlier = 'Inlier';
  if (diasEstada > (puntoCorteSup as number)) {
    inlierOutlier = 'Outlier Superior';
  } else if (diasEstada < (puntoCorteInf as number)) {
    inlierOutlier = 'Outlier Inferior';
  }

  // 2. Calcular Valor GRD (Peso * Precio Base)
  const valorGrd = (peso as number) * (precioBaseTramo as number);

  // 3. Calcular Monto Final (Simplificado, basado en tu schema)
  // (Valor GRD + Monto AT + Recargo Rescate + Pago Outlier)
  const montoFinal = valorGrd + 
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


// --- Endpoint de Exportación (MODIFICADO) ---
router.get('/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const { desde, hasta, centro } = req.query;
    console.log(`📤 Iniciando exportación con filtros:`, { desde, hasta, centro });

    // 1. Buscar datos crudos de la DB
    const where: Prisma.EpisodioWhereInput = {};
    if (desde) where.fechaIngreso = { ...where.fechaIngreso, gte: new Date(desde as string) };
    if (hasta) where.fechaIngreso = { ...where.fechaIngreso, lte: new Date(hasta as string) };
    if (centro) where.centro = { contains: centro as string, mode: 'insensitive' };

    const episodiosDB = await prisma.episodio.findMany({
      where,
      include: {
        paciente: true,
        grd: true, // ¡Crucial! Trae las reglas (peso, precio, cortes)
      },
      orderBy: { fechaIngreso: 'asc' },
    });
    console.log(`📊 Datos encontrados: ${episodiosDB.length} registros`);

    // 2. Aplicar Cálculos
    const rows = episodiosDB.map(e => {
      const calculos = calcularValores(e);
      return {
        // Datos del episodio
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
        // Datos del paciente
        rut: e.paciente?.rut,
        nombre: e.paciente?.nombre,
        // Datos del GRD
        ir_grd: e.grd?.codigo,
        peso: e.grd?.peso,
        // Datos Calculados
        ...calculos,
        VALIDADO: 'SÍ', // Marcar como validado (lógica de ejemplo)
        grupo_norma_sn: 'S', // Lógica de ejemplo
        doc_necesaria: '', // Lógica de ejemplo
      };
    });

    // 3. Armar el Excel (como antes)
    const headers = [/* ... (headers de la imagen 'image_da1fad.png') ... */];
    // (Asegúrate que tu array de 'headers' coincida con la imagen)
    const sheetData: any[][] = [headers];

    rows.forEach((row) => {
      sheetData.push([
        '',
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
        0, // MONTO RN (Tu schema lo tiene en episodio, ajústalo si es necesario)
        Number(row.demora_rescate_dias) || '',
        Number(row.pago_demora_rescate) || 0,
        Number(row.pago_outlier_sup) || 0,
        row.doc_necesaria || '',
        row.inlierOutlier || '',
        row.grupo_norma_sn || '',
        Number(row.diasEstada) || '',
        Number(row.precioBaseTramo) || 0,
        Number(row.valorGrd) || 0,
        Number(row.montoFinal) || 0
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'FONASA');
    
    // 4. Generar Buffer
    const buf = XLSX

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

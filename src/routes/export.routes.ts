import { Router, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middlewares/auth';
import { prisma } from '../db/client';
import type { Prisma } from '@prisma/client';
import { uploadToCloudinary } from '../config/cloudinary';
import { logFileDownload } from '../utils/logger';

const router = Router();

// --- Funciones Helper (sin cambios) ---
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

// --- Lógica de Cálculo (sin cambios) ---
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

// --- Endpoint de Exportación (¡MODIFICADO CON UPLOAD ASÍNCRONO!) ---
router.get('/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const { filtros, desde, hasta, centro } = req.query;
    console.log('📤 Iniciando exportación con filtros:', { filtros, desde, hasta, centro });

    const where: Prisma.EpisodioWhereInput = {};

    // Lógica de filtro de Gestión (validado)
    if (typeof filtros === 'string' && filtros.length > 0) {
      const filtrosArray = filtros.split(',');
      const whereValidado: Prisma.EpisodioWhereInput[] = [];

      if (filtrosArray.includes('validados')) {
        whereValidado.push({ validado: true });
      }
      if (filtrosArray.includes('no-validados')) {
        whereValidado.push({ validado: false });
      }
      if (filtrosArray.includes('pendientes')) {
        whereValidado.push({ validado: null });
      }
      
      if (whereValidado.length > 0) {
        where.OR = whereValidado;
      }
    } else {
      console.warn('Exportación detenida: No se seleccionaron filtros de estado.');
      return res.status(400).json({ message: 'Debe seleccionar al menos un filtro de estado (Aprobados, Rechazados o Pendientes)' });
    }

    // (Lógica de filtros de fecha y centro)
    if (desde || hasta) {
      const fechaFilter: Prisma.DateTimeFilter = {};
      if (desde) fechaFilter.gte = new Date(desde as string);
      if (hasta) fechaFilter.lte = new Date(hasta as string);
      where.fechaIngreso = fechaFilter;
    }
    if (centro) where.centro = { contains: centro as string, mode: 'insensitive' };

    // (Obtención de datos de Prisma)
    const episodiosDB = await prisma.episodio.findMany({
      where,
      include: {
        paciente: true,
        grd: true,
      },
      orderBy: { fechaIngreso: 'asc' },
    });
    console.log(`📊 Datos encontrados: ${episodiosDB.length} registros`);

    if (episodiosDB.length === 0) {
      return res.status(404).json({ message: 'No se encontraron episodios con los filtros seleccionados' });
    }

    // (Mapeo de filas)
    const rows = episodiosDB.map((e) => {
      const calculos = calcularValores(e);
      let estadoValidado = 'Pendiente';
      if (e.validado === true) {
        estadoValidado = 'Aprobado';
      } else if (e.validado === false) {
        estadoValidado = 'Rechazado';
      }
      return { ...e, ...calculos, VALIDADO: estadoValidado, paciente: e.paciente || {}, grd: e.grd || {}, grupo_norma_sn: e.grupoEnNorma ? 'S' : 'N', doc_necesaria: e.documentacion ? JSON.stringify(e.documentacion) : '' };
    });

    // (Creación de la hoja de Excel)
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
        'manual', row.VALIDADO || '', row.centro || '', row.numeroFolio || '', row.episodioCmdb || '',
        row.paciente.rut || '', row.paciente.nombre || '', row.tipoEpisodio || '',
        toExcelDate(row.fechaIngreso), toExcelDate(row.fechaAlta), row.servicioAlta || '', row.estadoRn || '',
        row.atSn ? 'S' : 'N', row.atDetalle || '', Number(row.montoAt) || 0, row.tipoAlta || '',
        row.grd.codigo || '', Number(row.grd.peso) || 0, Number(row.montoRn) || 0,
        Number(row.diasDemoraRescate) || 0, Number(row.pagoDemoraRescate) || 0, Number(row.pagoOutlierSuperior) || 0,
        row.doc_necesaria || '', row.inlierOutlier || '', row.grupo_norma_sn || '', Number(row.diasEstada) || 0,
        Number(row.precioBaseTramo) || 0, Number(row.valorGrd) || 0, Number(row.montoFinal) || 0,
      ]);
    });
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, 'FONASA');

    // Generar Buffer
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const fileName = `grd_export_${new Date().toISOString().slice(0, 10)}.xlsx`;

    // ===================================================================
    // =================== ¡AQUÍ ESTÁ LA MAGIA DEL 101%! ==================
    // ===================================================================
    // Inicia la subida a Cloudinary pero NO LA ESPERA (fire-and-forget)
    // Esto permite que la descarga del usuario comience de inmediato.
    if (typeof uploadToCloudinary === 'function') {
      console.log('☁️ Iniciando subida asíncrona a Cloudinary...');
      uploadToCloudinary(buf, { 
        folder: 'grd_exports', // Carpeta en Cloudinary
        public_id: fileName,    // Nombre del archivo
        resource_type: 'raw'    // 'raw' es para archivos no-media (como Excel)
      })
      .then(result => {
        // La subida terminó en segundo plano
        console.log(`✅ Exportación subida a Cloudinary: ${result.secure_url}`);
        // Aquí podrías guardar 'result.secure_url' en una nueva tabla 'Exportaciones' si quisieras
      })
      .catch(err => {
        // ¡Importante! Si la subida en segundo plano falla, solo lo logueamos.
        // No podemos enviar un error al usuario porque ya le enviamos el archivo.
        console.error('❌ Error en subida asíncrona a Cloudinary:', err);
      });
    }
    // ===================================================================

    // (Tu lógica de Log de descarga está perfecta)
    const userId = parseInt(req.user!.id);
    await logFileDownload(
      userId,
      fileName,
      'xlsx',
      buf.length,
      { filtros, desde, hasta, centro, totalEpisodios: episodiosDB.length }
    );
    
    // Enviar archivo como descarga al usuario INMEDIATAMENTE
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buf);

  } catch (err: any) {
    console.error('Error en export route:', err);
    return res.status(500).json({ message: 'Error generando export' });
  }
});

// Ruta de Info (sin cambios, pero actualizada con el filtro)
router.get('/export/info', (_req: Request, res: Response) => {
  res.json({
    endpoint: '/api/export',
    method: 'GET',
    description: 'Exporta datos procesados en formato Excel FONASA',
    authentication: 'Requiere autenticación',
    parameters: {
      filtros: { type: 'string', format: 'validados,pendientes,no-validados' },
      desde: { type: 'string', format: 'YYYY-MM-DD' },
      hasta: { type: 'string', format: 'YYYY-MM-DD' },
      centro: { type: 'string' },
    },
  });
});

export default router;
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

// --- Endpoint de Exportación (¡MODIFICADO!) ---
router.get('/export', requireAuth, async (req: Request, res: Response) => {
  try {
    // 1. OBTENEMOS LOS FILTROS DEL FRONTEND
    const { desde, hasta, centro, filtros } = req.query;
    console.log('📤 Iniciando exportación con filtros:', { filtros, desde, hasta, centro });

    const where: Prisma.EpisodioWhereInput = {};

    // 2. ¡LÓGICA DE FILTRO DE GESTIÓN (VALIDADO)!
    // Tu frontend envía: 'validados', 'no-validados', 'pendientes'
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

    // (Tu lógica de filtros de fecha y centro estaba perfecta)
    if (desde || hasta) {
      const fechaFilter: Prisma.DateTimeFilter = {};
      if (desde) fechaFilter.gte = new Date(desde as string);
      if (hasta) fechaFilter.lte = new Date(hasta as string);
      where.fechaIngreso = fechaFilter;
    }
    if (centro) where.centro = { contains: centro as string, mode: 'insensitive' };

    // 3. BUSCAMOS EN LA BASE DE DATOS CON TODOS LOS FILTROS APLICADOS
    const episodiosDB = await prisma.episodio.findMany({
      where, // <-- ¡Aquí se aplican los filtros!
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

    const rows = episodiosDB.map((e) => {
      const calculos = calcularValores(e);
      
      // 4. ¡LÓGICA DE VALIDADO CORREGIDA!
      let estadoValidado = 'Pendiente';
      if (e.validado === true) {
        estadoValidado = 'Aprobado';
      } else if (e.validado === false) {
        estadoValidado = 'Rechazado';
      }
      
      return {
        ...e,
        ...calculos,
        VALIDADO: estadoValidado, // <-- Usamos el valor real
        paciente: e.paciente || {}, // Prevenir nulls
        grd: e.grd || {}, // Prevenir nulls
        grupo_norma_sn: e.grupoEnNorma ? 'S' : 'N',
        doc_necesaria: e.documentacion ? JSON.stringify(e.documentacion) : '',
      };
    });

    // (Cabeceras sin cambios)
    const headers = [
      'Tipo dato', 'VALIDADO', 'Centro', 'N° Folio', 'Episodio', 'Rut Paciente', 'Nombre Paciente',
      'TIPO EPISODIO', 'Fecha de ingreso', 'Fecha Alta', 'Servicios de alta', 'ESTADO RN', 'AT (S/N)',
      'AT detalle', 'Monto AT', 'Tipo de Alta', 'IR - GRD', 'PESO', 'MONTO RN', 'Dias de demora rescate desde Hospital',
      'Pago demora rescate', 'Pago por outlier superior', 'DOCUMENTACIÓN NECESARIA', 'Inlier/outlier',
      'Grupo dentro de norma S/N', 'Dias de Estada', 'Precio Base por tramo correspondiente', 'Valor GRD', 'Monto Final'
    ];

    const sheetData: any[][] = [headers];

    // 5. ¡DATOS CORREGIDOS AL ESCRIBIR!
    rows.forEach((row) => {
      sheetData.push([
        'manual', // Tipo dato ejemplo
        row.VALIDADO || '', // <-- ¡AHORA SÍ ES EL VALOR REAL!
        row.centro || '',
        row.numeroFolio || '',
        row.episodioCmdb || '',
        row.paciente.rut || '',
        row.paciente.nombre || '',
        row.tipoEpisodio || '',
        toExcelDate(row.fechaIngreso),
        toExcelDate(row.fechaAlta),
        row.servicioAlta || '',
        row.estadoRn || '',
        row.atSn ? 'S' : 'N',
        row.atDetalle || '',
        Number(row.montoAt) || 0,
        row.tipoAlta || '',
        row.grd.codigo || '',
        Number(row.grd.peso) || 0,
        Number(row.montoRn) || 0,
        Number(row.diasDemoraRescate) || 0,
        Number(row.pagoDemoraRescate) || 0,
        Number(row.pagoOutlierSuperior) || 0,
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
    const fileName = `grd_export_${new Date().toISOString().slice(0, 10)}.xlsx`;

    // ===================================================================
    // =================== ¡LÓGICA 101% (V2) CORREGIDA! ==================
    // ===================================================================
    // Ya no usamos el `if (req.query.upload === 'true')`
    // Ahora, SIEMPRE intentamos subir a Cloudinary en segundo plano.

    if (typeof uploadToCloudinary === 'function') {
      console.log('☁️ Iniciando subida asíncrona a Cloudinary...');
      
      // Usamos una función asíncrona autoejecutable (IIFE)
      // Esto le dice a TypeScript: "Sé que no estoy esperando esta promesa,
      // pero está bien, déjala correr en segundo plano".
      (async () => {
        try {
          const result = await uploadToCloudinary(buf, { 
            folder: 'grd_exports',
            public_id: fileName,
            resource_type: 'raw'
          });
          console.log(`✅ Exportación subida a Cloudinary: ${result.secure_url}`);
        } catch (err) {
          // Si esto falla, solo lo logueamos. El usuario ya tiene su archivo.
          console.error('❌ Error en subida asíncrona a Cloudinary:', err);
        }
      })(); // Los () al final la ejecutan inmediatamente

    } else {
      console.warn('⚠️ La función uploadToCloudinary no está disponible. Saltando subida.');
    }
    // ===================================================================

    // Enviar archivo como descarga (Tu lógica original estaba bien)
    const userId = parseInt(req.user!.id);
    await logFileDownload(
      userId,
      fileName,
      'xlsx',
      buf.length,
      { desde, hasta, centro, filtros, totalEpisodios: episodiosDB.length }
    );
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buf);

  } catch (err: any) {
    console.error('Error en export route:', err);
    // Asegurarse de enviar un JSON en caso de error
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Error generando export' });
    }
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
      filtros: { type: 'string', format: 'validados,pendientes,no-validados' },
      desde: { type: 'string', format: 'YYYY-MM-DD' },
      hasta: { type: 'string', format: 'YYYY-MM-DD' },
      centro: { type: 'string' },
    },
  });
});

export default router;
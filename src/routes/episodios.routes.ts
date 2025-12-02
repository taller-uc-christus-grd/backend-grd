import { Router, Request, Response } from 'express';
import Joi from 'joi';
import multer from 'multer';
import * as path from 'path';
// import * as fs from 'fs'; // No se necesita para memoryStorage
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import { requireAuth, requireRole } from '../middlewares/auth';
import { prisma } from '../db/client'; // ¡Importante! Conecta con la DB
import { Prisma } from '@prisma/client';
import { Readable } from 'stream';
import { uploadToCloudinary } from '../config/cloudinary';
import cloudinary from '../config/cloudinary';

const router = Router();

// --- Configuración de Multer (AHORA EN MEMORIA) ---
const storage = multer.memoryStorage();

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'text/csv', 'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const fileExtension = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo CSV y Excel.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50MB Límite
});

// Mapeo de campos del frontend a la base de datos
const fieldMapping: Record<string, string> = {
  estadoRN: 'estadoRn',
  montoAT: 'montoAt',
  montoRN: 'montoRn',
  pagoDemora: 'pagoDemoraRescate',
  pagoOutlierSup: 'pagoOutlierSuperior',
  at: 'atSn', // 'at' del frontend se mapea a 'atSn' en la BD
  validado: 'validado',
};

// Función para mapear campos del frontend a la base de datos
function mapFieldsToDB(data: any): any {
  const mapped: any = {};
  for (const [key, value] of Object.entries(data)) {
    const dbKey = fieldMapping[key] || key;
    mapped[dbKey] = value;
  }
  return mapped;
}

// Funciones de cálculo (deben estar antes de normalizeEpisodeResponse)

// Función para calcular valorGRD como peso * precioBaseTramo
function calcularValorGRD(
  peso: number | null | undefined,
  precioBaseTramo: number | null | undefined
): number {
  const pesoNum = peso ?? 0;
  const precioNum = precioBaseTramo ?? 0;
  
  if (pesoNum === 0 || precioNum === 0) {
    return 0;
  }
  
  return pesoNum * precioNum;
}

// Función para calcular montoFinal según la fórmula de negocio
function calcularMontoFinal(
  valorGRD: number | null | undefined,
  montoAT: number | null | undefined,
  pagoOutlierSup: number | null | undefined,
  pagoDemora: number | null | undefined
): number {
  const vGRD = valorGRD ?? 0;
  const mAT = montoAT ?? 0;
  const pOutlier = pagoOutlierSup ?? 0;
  const pDemora = pagoDemora ?? 0;
  
  return vGRD + mAT + pOutlier + pDemora;
}

/**
 * Calcula los días de estadía basándose en fecha de ingreso y fecha de alta
 */
function calcularDiasEstada(
  fechaIngreso: Date | null | undefined,
  fechaAlta: Date | null | undefined
): number {
  if (!fechaIngreso || !fechaAlta) return 0;
  const diff = Math.round((fechaAlta.getTime() - fechaIngreso.getTime()) / 86400000);
  return diff >= 0 ? diff : 0;
}

/**
 * Calcula automáticamente si un episodio es Inlier o Outlier
 * basándose en los días de estadía vs punto corte superior/inferior del GRD
 * @param diasEstada Días de estadía del episodio
 * @param puntoCorteInf Punto corte inferior del GRD
 * @param puntoCorteSup Punto corte superior del GRD
 * @returns 'Inlier', 'Outlier Superior', 'Outlier Inferior' o null si no se puede determinar
 */
function calcularInlierOutlier(
  diasEstada: number | null | undefined,
  puntoCorteInf: number | null | undefined,
  puntoCorteSup: number | null | undefined
): string | null {
  if (diasEstada === null || diasEstada === undefined) {
    return null;
  }
  
  const puntoInf = puntoCorteInf !== null && puntoCorteInf !== undefined ? Number(puntoCorteInf) : null;
  const puntoSup = puntoCorteSup !== null && puntoCorteSup !== undefined ? Number(puntoCorteSup) : null;
  
  // Si no hay puntos de corte, no se puede determinar
  if (puntoInf === null && puntoSup === null) {
    return null;
  }
  
  // Outlier Superior: días de estadía > punto corte superior
  if (puntoSup !== null && diasEstada > puntoSup) {
    return 'Outlier Superior';
  }
  
  // Outlier Inferior: días de estadía < punto corte inferior
  if (puntoInf !== null && diasEstada < puntoInf) {
    return 'Outlier Inferior';
  }
  
  // En cualquier otro caso es Inlier
  return 'Inlier';
}

/**
 * Calcula el tramo basado en el peso GRD para convenios con sistema de tramos (FNS012, FNS026)
 * @param pesoGRD Peso GRD del episodio
 * @returns 'T1', 'T2', 'T3' o null si no se puede determinar
 */
function calcularTramo(pesoGRD: number | null | undefined): 'T1' | 'T2' | 'T3' | null {
  if (pesoGRD === null || pesoGRD === undefined) {
    return null; // No se puede determinar el tramo sin peso
  }
  
  if (pesoGRD >= 0 && pesoGRD <= 1.5) {
    return 'T1';
  } else if (pesoGRD > 1.5 && pesoGRD <= 2.5) {
    return 'T2';
  } else if (pesoGRD > 2.5) {
    return 'T3';
  }
  
  return null; // Peso negativo (no debería ocurrir)
}

/**
 * Obtiene el precio base por tramo basándose en el convenio y el peso GRD
 * @param convenio Código del convenio (FNS012, FNS026, FNS019, CH0041)
 * @param pesoGRD Peso GRD del episodio
 * @returns Precio base calculado o null si no se puede determinar
 */
async function obtenerPrecioBaseTramo(
  convenio: string | null | undefined,
  pesoGRD: number | null | undefined
): Promise<number | null> {
  // Validar que el convenio esté presente
  if (!convenio || typeof convenio !== 'string' || convenio.trim() === '') {
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ obtenerPrecioBaseTramo: Convenio no proporcionado o inválido');
    }
    return null;
  }

  const convenioNormalizado = convenio.trim().toUpperCase();
  
  // Determinar si el convenio usa tramos o precio único
  const conveniosConTramos = ['FNS012', 'FNS026'];
  const conveniosPrecioUnico = ['FNS019', 'CH0041'];
  
  if (conveniosConTramos.includes(convenioNormalizado)) {
    // Calcular tramo basado en peso GRD
    const tramo = calcularTramo(pesoGRD);
    if (!tramo) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: No se pudo determinar el tramo para convenio ${convenioNormalizado} con peso GRD ${pesoGRD}`);
      }
      return null; // No se puede determinar el tramo
    }
    
    // Buscar en precios_convenios (sin validar fechas)
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenioNormalizado,
        tramo: tramo
      },
      orderBy: {
        createdAt: 'desc' // Si hay múltiples, tomar el más reciente
      }
    });
    
    if (!precioRegistro || precioRegistro.precio === null || precioRegistro.precio === undefined) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: No se encontró precio para convenio ${convenioNormalizado} y tramo ${tramo}`);
      }
      return null;
    }
    
    const precio = typeof precioRegistro.precio === 'number' 
      ? precioRegistro.precio 
      : parseFloat(String(precioRegistro.precio));
    
    if (isNaN(precio) || !isFinite(precio)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: Precio inválido para convenio ${convenioNormalizado} y tramo ${tramo}: ${precioRegistro.precio}`);
      }
      return null;
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ obtenerPrecioBaseTramo: Precio encontrado para ${convenioNormalizado} ${tramo}: ${precio}`);
    }
    
    return precio;
    
  } else if (conveniosPrecioUnico.includes(convenioNormalizado)) {
    // Buscar precio único (ignorar tramo y fechas)
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenioNormalizado
      },
      orderBy: {
        createdAt: 'desc' // Si hay múltiples, tomar el más reciente
      }
    });
    
    if (!precioRegistro || precioRegistro.precio === null || precioRegistro.precio === undefined) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: No se encontró precio para convenio ${convenioNormalizado}`);
      }
      return null;
    }
    
    const precio = typeof precioRegistro.precio === 'number' 
      ? precioRegistro.precio 
      : parseFloat(String(precioRegistro.precio));
    
    if (isNaN(precio) || !isFinite(precio)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ obtenerPrecioBaseTramo: Precio inválido para convenio ${convenioNormalizado}: ${precioRegistro.precio}`);
      }
      return null;
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ obtenerPrecioBaseTramo: Precio encontrado para ${convenioNormalizado}: ${precio}`);
    }
    
    return precio;
  }
  
  // Si el convenio no está en ninguna de las listas, retornar null
  if (process.env.NODE_ENV === 'development') {
    console.warn(`⚠️ obtenerPrecioBaseTramo: Convenio desconocido: ${convenioNormalizado}`);
  }
  return null;
}

/**
 * Obtiene el "Monto día espera" para CH0041 según la fecha de admisión
 * Consulta PrecioConvenio buscando el rango (fechaAdmision - fechaFin) que contiene la fecha del episodio
 */
async function obtenerMontoDiaEsperaCH0041(fechaIngreso: Date | null | undefined): Promise<number | null> {
  if (!fechaIngreso) return null;

  try {
    const fechaComparar = new Date(fechaIngreso);
    fechaComparar.setHours(0, 0, 0, 0);

    // Buscar en PrecioConvenio todos los registros de CH0041 con rango de fechas
    const registros = await prisma.precioConvenio.findMany({
      where: {
        convenio: 'CH0041',
        fechaAdmision: { not: null },
        fechaFin: { not: null },
      },
      orderBy: { fechaAdmision: 'asc' },
    });

    if (!registros || registros.length === 0) {
      console.warn('⚠️ CH0041: No hay rangos configurados en PrecioConvenio');
      return null;
    }

    // Buscar el rango que contiene la fecha de ingreso
    for (const reg of registros) {
      if (reg.fechaAdmision && reg.fechaFin) {
        const inicio = new Date(reg.fechaAdmision);
        const fin = new Date(reg.fechaFin);
        inicio.setHours(0, 0, 0, 0);
        fin.setHours(23, 59, 59, 999);

        // Si la fecha ingreso cae dentro del rango
        if (fechaComparar >= inicio && fechaComparar <= fin) {
          const monto = Number(reg.precio ?? 0);
          if (!isNaN(monto) && isFinite(monto) && monto > 0) {
            console.log(`✅ CH0041: Monto ${monto} para fecha ${fechaComparar.toISOString().split('T')[0]} (rango: ${inicio.toISOString().split('T')[0]} a ${fin.toISOString().split('T')[0]})`);
            return monto;
          }
        }
      }
    }

    console.warn(`⚠️ CH0041: No se encontró rango para fecha ${fechaComparar.toISOString().split('T')[0]}`);
    return null;
  } catch (err) {
    console.error('obtenerMontoDiaEsperaCH0041 - error:', err);
    return null;
  }
}

/**
 * Calcula el pago por demora de rescate (US-12)
 * 
 * CH0041: diasDemora × montoDiaEspera (desde PrecioConvenio)
 * FNS012/FNS026/FNS019: ((pesoGrd × precioBaseTramo) / diasPercentil75) × diasDemora
 */
async function calcularPagoDemoraRescate(params: {
  convenio?: string | null;
  diasDemora?: number | null;
  pagoDemoraInput?: number | null;
  pesoGrd?: number | null;
  precioBaseTramo?: number | null;
  grdId?: number | null;
  fechaIngreso?: Date | null;
}): Promise<number> {
  const { convenio, diasDemora, pagoDemoraInput, pesoGrd, precioBaseTramo, grdId, fechaIngreso } = params;
  
  const dias = typeof diasDemora === 'number' && diasDemora > 0 ? diasDemora : 0;
  const conv = (convenio || '').toString().trim().toUpperCase();

  if (dias === 0) {
    return (typeof pagoDemoraInput === 'number' && !isNaN(pagoDemoraInput)) ? pagoDemoraInput : 0;
  }

  try {
    // ========== CH0041 ==========
    if (conv === 'CH0041') {
      const montoDia = await obtenerMontoDiaEsperaCH0041(fechaIngreso);
      if (!montoDia || isNaN(montoDia)) {
        console.warn('⚠️ CH0041: No se encontró montoDiaEspera. Usando input o 0.');
        return (typeof pagoDemoraInput === 'number' && !isNaN(pagoDemoraInput)) ? pagoDemoraInput : 0;
      }
      const resultado = dias * montoDia;
      console.log(`✅ CH0041: ${dias} días × ${montoDia} = ${resultado}`);
      return resultado;
    }

    // ========== FNS012 / FNS026 / FNS019 ==========
    if (conv === 'FNS012' || conv === 'FNS026' || conv === 'FNS019') {
      let diasP75: number | null = null;
      
      // Opción 1: Priorizar percentil75 desde GRD si está disponible
      if (grdId) {
        const grd = await prisma.grd.findUnique({ where: { id: grdId } });
        if (grd) {
          // Priorizar percentil75 si está disponible
          if (grd.percentil75) {
            diasP75 = Number(grd.percentil75);
            console.log(`✅ ${conv}: Usando percentil75 desde GRD: ${diasP75}`);
          } else if (grd.puntoCorteSup) {
            diasP75 = Number(grd.puntoCorteSup);
            console.log(`ℹ️ ${conv}: Usando puntoCorteSup como fallback: ${diasP75}`);
          }
        }
      }
      
      // Opción 2: Fallback desde ConfiguracionSistema si es necesario
      if (!diasP75) {
        const cfg = await prisma.configuracionSistema.findUnique({ 
          where: { clave: 'diasPercentil75' } 
        });
        if (cfg && cfg.valor) {
          diasP75 = parseFloat(cfg.valor);
        }
      }
      
      // Si aún no hay valor, usar 1 para evitar división por cero
      if (!diasP75 || isNaN(diasP75) || diasP75 <= 0) {
        console.warn(`⚠️ ${conv}: diasPercentil75 no disponible, usando 1.`);
        diasP75 = 1;
      }

      const peso = Number(pesoGrd ?? 0);
      const precio = Number(precioBaseTramo ?? 0);
      const factor = (peso * precio) / diasP75;
      const resultado = factor * dias;
      
      console.log(`✅ ${conv}: ((${peso} × ${precio}) / ${diasP75}) × ${dias} = ${resultado}`);
      return resultado;
    }

    // ========== DEFAULT ==========
    return (typeof pagoDemoraInput === 'number' && !isNaN(pagoDemoraInput)) ? pagoDemoraInput : 0;
  } catch (err) {
    console.error('calcularPagoDemoraRescate - error:', err);
    return (typeof pagoDemoraInput === 'number' && !isNaN(pagoDemoraInput)) ? pagoDemoraInput : 0;
  }
}

/**
 * Calcula el pago por outlier superior (US-11) - SOLO para FNS012
 * 
 * Fórmula:
 * Pago Outlier = (Días post carencia × Peso GRD × Precio Base) / Días percentil 75
 * 
 * Donde:
 * - Período de carencia = Punto corte superior + Percentil 50
 * - Días post carencia = Estancia total - Período de carencia
 * - Días percentil 75 = Grd.puntoCorteSup (valor Z para percentil 75)
 */
async function calcularPagoOutlierSuperior(params: {
  convenio?: string | null;
  diasEstada?: number | null;
  pesoGrd?: number | null;
  precioBase?: number | null;
  grdId?: number | null;
  inlierOutlier?: string | null;
}): Promise<number> {
  const { convenio, diasEstada, pesoGrd, precioBase, grdId, inlierOutlier } = params;
  
  const conv = (convenio || '').toString().trim().toUpperCase();
  
  // Solo aplicar para FNS012
  if (conv !== 'FNS012') {
    return 0;
  }
  
  // Determinar si es outlier superior basándose en inlierOutlier
  const esOutlierSuperior = inlierOutlier === 'Outlier Superior';
  
  console.log(`🔍 calcularPagoOutlierSuperior - Verificando condiciones:`, {
    convenio: conv,
    esFNS012: conv === 'FNS012',
    esOutlierSuperior,
    inlierOutlier,
    diasEstada,
    pesoGrd,
    precioBase,
    grdId
  });
  
  if (!esOutlierSuperior) {
    console.log(`ℹ️ FNS012: No se calcula pago outlier porque inlierOutlier = ${inlierOutlier} (no es "Outlier Superior")`);
    return 0;
  }
  
  try {
    // Obtener datos del GRD
    let puntoCorteSuperíor: number | null = null;
    let percentil50: number | null = null;
    let percentil75: number | null = null;
    
    if (grdId) {
      const grd = await prisma.grd.findUnique({ where: { id: grdId } });
      if (grd) {
        if (grd.puntoCorteSup) puntoCorteSuperíor = Number(grd.puntoCorteSup);
        // Obtener percentil50 desde GRD (prioridad)
        if (grd.percentil50) percentil50 = Number(grd.percentil50);
        // Obtener percentil75 desde GRD (prioridad)
        if (grd.percentil75) percentil75 = Number(grd.percentil75);
        
        console.log(`📊 GRD encontrado:`, {
          puntoCorteSup: puntoCorteSuperíor,
          percentil50: percentil50,
          percentil75: percentil75,
          puntoCorteInf: grd.puntoCorteInf
        });
      }
    }
    
    // Fallback desde ConfiguracionSistema si es necesario
    if (puntoCorteSuperíor === null) {
      const cfgSup = await prisma.configuracionSistema.findUnique({
        where: { clave: 'puntoCorteSuperior' }
      });
      if (cfgSup && cfgSup.valor) puntoCorteSuperíor = parseFloat(cfgSup.valor);
    }
    
    // Fallback: Si no hay percentil50 en GRD, intentar desde ConfiguracionSistema
    if (percentil50 === null || percentil50 <= 0) {
      const cfgP50 = await prisma.configuracionSistema.findUnique({
        where: { clave: 'percentil50' }
      });
      if (cfgP50 && cfgP50.valor) {
        percentil50 = parseFloat(cfgP50.valor);
        console.log(`✅ Percentil 50 obtenido de ConfiguracionSistema: ${percentil50}`);
      } else {
        console.warn('⚠️ FNS012: percentil50 no disponible ni en GRD ni en ConfiguracionSistema');
      }
    }
    
    // Fallback: Si no hay percentil75 en GRD, usar puntoCorteSup
    if (percentil75 === null || percentil75 <= 0) {
      if (puntoCorteSuperíor && puntoCorteSuperíor > 0) {
        percentil75 = puntoCorteSuperíor;
        console.log(`ℹ️ Usando puntoCorteSup como percentil75: ${percentil75}`);
      } else {
        // Último fallback: ConfiguracionSistema
        const cfgP75 = await prisma.configuracionSistema.findUnique({
          where: { clave: 'diasPercentil75' }
        });
        if (cfgP75 && cfgP75.valor) {
          percentil75 = parseFloat(cfgP75.valor);
        }
      }
    }
    
    // Si faltan valores críticos, retornar 0
    if (puntoCorteSuperíor === null || puntoCorteSuperíor <= 0) {
      console.warn('⚠️ FNS012: puntoCorteSuperior no disponible');
      return 0;
    }
    
    if (percentil50 === null || percentil50 <= 0) {
      console.warn('⚠️ FNS012: percentil50 no disponible - no se puede calcular pago outlier');
      return 0;
    }
    
    if (percentil75 === null || percentil75 <= 0) {
      console.warn('⚠️ FNS012: percentil75 no disponible, usando 1');
      percentil75 = 1;
    }
    
    // Validar parámetros
    const dias = typeof diasEstada === 'number' && diasEstada > 0 ? diasEstada : 0;
    const peso = typeof pesoGrd === 'number' && pesoGrd > 0 ? pesoGrd : 0;
    const precio = typeof precioBase === 'number' && precioBase > 0 ? precioBase : 0;
    
    // Si no hay días, peso o precio, retornar 0
    if (dias === 0 || peso === 0 || precio === 0) {
      console.log(`ℹ️ FNS012 Outlier: Retornando 0 (días: ${dias}, peso: ${peso}, precio: ${precio})`);
      return 0;
    }
    
    // Calcular período de carencia
    const periodoCarencia = puntoCorteSuperíor + percentil50;
    console.log(`📊 FNS012 Outlier - Período de carencia: ${puntoCorteSuperíor} + ${percentil50} = ${periodoCarencia}`);
    
    // Calcular días post carencia
    const diasPostCarencia = Math.max(0, dias - periodoCarencia);
    
    if (diasPostCarencia <= 0) {
      console.log(`ℹ️ FNS012 Outlier: Episodio dentro del período de carencia (${dias} ≤ ${periodoCarencia}). Retornando 0.`);
      return 0;
    }
    
    // Aplicar fórmula: (Días post carencia × Peso GRD × Precio Base) / Días percentil 75
    const pagoOutlier = (diasPostCarencia * peso * precio) / percentil75;
    
    console.log(`✅ FNS012 Outlier: (${diasPostCarencia} × ${peso} × ${precio}) / ${percentil75} = ${pagoOutlier}`);
    
    return pagoOutlier;
  } catch (err) {
    console.error('calcularPagoOutlierSuperior - error:', err);
    return 0;
  }
}


// Función para normalizar datos de episodio antes de enviar al frontend
function normalizeEpisodeResponse(episode: any): any {
  // Log temporal para verificar que se está ejecutando
  const episodioId = episode.episodioCmdb || episode.id;
  console.log(`📝 [normalizeEpisodeResponse] Procesando episodio ${episodioId}, inlierOutlier="${episode.inlierOutlier}"`);
  // Normalizar campo 'at': SIEMPRE devolver "S" o "N" (string)
  let atValue: string;
  if (episode.atSn === true || episode.atSn === 'S' || episode.atSn === 's') {
    atValue = 'S';
  } else {
    atValue = 'N';
  }

  // Normalizar estadoRN: string válido o null (nunca undefined o "")
  let estadoRN: string | null = null;
  if (episode.estadoRn && ['Aprobado', 'Pendiente', 'Rechazado'].includes(episode.estadoRn)) {
    estadoRN = episode.estadoRn;
  }

  // Helper para convertir a número seguro
  const toNumber = (value: any): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      if (isNaN(value) || !isFinite(value)) return null;
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (isNaN(parsed) || !isFinite(parsed)) return null;
      return parsed;
    }
    // Si es Decimal de Prisma
    if (value && typeof value.toNumber === 'function') {
      const num = value.toNumber();
      if (isNaN(num) || !isFinite(num)) return null;
      return num;
    }
    return null;
  };

  // Helper para convertir a entero seguro
  const toInteger = (value: any): number | null => {
    const num = toNumber(value);
    return num !== null ? Math.floor(num) : null;
  };

  // Normalizar atDetalle: siempre string o null (nunca undefined o "")
  let atDetalle: string | null = null;
  if (episode.atDetalle !== null && episode.atDetalle !== undefined) {
    if (typeof episode.atDetalle === 'string' && episode.atDetalle.trim() !== '') {
      atDetalle = episode.atDetalle;
    }
    // Si es null explícitamente, mantenerlo como null
    // Si es undefined, mantenerlo como null (no undefined)
  }

  // Normalizar documentacion
  let documentacion: string | null = null;
  if (episode.documentacion) {
    if (typeof episode.documentacion === 'string') {
      documentacion = episode.documentacion;
    } else if (typeof episode.documentacion === 'object' && episode.documentacion !== null) {
      if ('texto' in episode.documentacion) {
        documentacion = episode.documentacion.texto as string;
      } else {
        documentacion = JSON.stringify(episode.documentacion);
      }
    }
  }

  // SIEMPRE recalcular valorGRD = peso * precioBaseTramo
  const peso = toNumber(episode.pesoGrd) ?? 0;
  const precioBaseTramo = toNumber(episode.precioBaseTramo) ?? 0;
  const valorGRDCalculado = calcularValorGRD(peso, precioBaseTramo);

  // SIEMPRE recalcular montoFinal = valorGRD + montoAT + pagoOutlierSup + pagoDemora
  const montoAT = toNumber(episode.montoAt) ?? 0;
  const pagoOutlierSup = toNumber(episode.pagoOutlierSuperior) ?? 0;
  const pagoDemora = toNumber(episode.pagoDemoraRescate) ?? 0;
  const montoFinalCalculado = calcularMontoFinal(
    valorGRDCalculado,
    montoAT,
    pagoOutlierSup,
    pagoDemora
  );

  const result = {
    episodio: episode.episodioCmdb || '',
    rut: episode.paciente?.rut || '',
    nombre: episode.paciente?.nombre || '',
    fechaIngreso: episode.fechaIngreso ? episode.fechaIngreso.toISOString().split('T')[0] : null,
    fechaAlta: episode.fechaAlta ? episode.fechaAlta.toISOString().split('T')[0] : null,
    servicioAlta: episode.servicioAlta || '',
    
    // Campos editables por finanzas (NORMALIZADOS)
    estadoRN, // string válido o null
    at: atValue, // SIEMPRE "S" o "N"
    atDetalle, // SIEMPRE string o null (nunca undefined o "")
    montoAT: toNumber(episode.montoAt), // SIEMPRE number o null
    montoRN: toNumber(episode.montoRn), // SIEMPRE number o null
    diasDemoraRescate: toInteger(episode.diasDemoraRescate), // SIEMPRE integer o null
    pagoDemora: toNumber(episode.pagoDemoraRescate), // SIEMPRE number o null
    pagoOutlierSup: toNumber(episode.pagoOutlierSuperior), // SIEMPRE number o null
    precioBaseTramo: toNumber(episode.precioBaseTramo), // SIEMPRE number o null
    valorGRD: valorGRDCalculado, // SIEMPRE calculado como peso * precioBaseTramo
    montoFinal: montoFinalCalculado, // SIEMPRE calculado automáticamente
    documentacion, // string o null
    
    // Campo editable por gestión
    validado: episode.validado ?? null, // boolean | null (null = Pendiente, true = Aprobado, false = Rechazado)
    
    // Campos de solo lectura
    grdCodigo: episode.grd?.codigo || '',
    peso: toNumber(episode.grd?.peso), // "Peso Medio [Norma IR]" - viene del modelo Grd
    pesoGrd: (() => {
      const pesoGrdValue = toNumber(episode.pesoGrd);
      const episodioId = episode.episodioCmdb || episode.id;
      console.log(`📤 [normalizeEpisodeResponse] Episodio ${episodioId}: pesoGrd = ${pesoGrdValue} (tipo: ${typeof pesoGrdValue})`);
      console.log(`   episode.pesoGrd raw: ${episode.pesoGrd} (tipo: ${typeof episode.pesoGrd})`);
      return pesoGrdValue;
    })(), // "Peso GRD Medio (Todos)" - viene del modelo Episodio
    // RECALCULAR inlierOutlier automáticamente si tenemos los datos necesarios
    inlierOutlier: (() => {
      // Calcular días de estadía desde fechas si no está guardado
      let diasEstada = toInteger(episode.diasEstada);
      if (diasEstada === null && episode.fechaIngreso && episode.fechaAlta) {
        diasEstada = calcularDiasEstada(episode.fechaIngreso, episode.fechaAlta);
      }
      
      // Si tenemos días de estadía y GRD con puntos de corte, recalcular
      if (diasEstada !== null && diasEstada !== undefined && episode.grd) {
        const puntoCorteInf = episode.grd.puntoCorteInf ? Number(episode.grd.puntoCorteInf) : null;
        const puntoCorteSup = episode.grd.puntoCorteSup ? Number(episode.grd.puntoCorteSup) : null;
        
        if (puntoCorteInf !== null && puntoCorteSup !== null) {
          const inlierOutlierCalculado = calcularInlierOutlier(diasEstada, puntoCorteInf, puntoCorteSup);
          if (inlierOutlierCalculado !== null) {
            console.log(`📊 [normalizeEpisodeResponse] Inlier/Outlier recalculado: ${inlierOutlierCalculado} (días: ${diasEstada}, puntoInf: ${puntoCorteInf}, puntoSup: ${puntoCorteSup})`);
            return inlierOutlierCalculado;
          }
        }
      }
      
      // Si no se pudo recalcular, usar el valor guardado o cadena vacía
      return episode.inlierOutlier || '';
    })(),
    // Calcular "Grupo dentro de norma S/N" basado en "Inlier/Outlier": true si es "Inlier", false en cualquier otro caso
    grupoDentroNorma: (() => {
      // Usar el valor calculado arriba
      const inlierValue = (() => {
        let diasEstada = toInteger(episode.diasEstada);
        if (diasEstada === null && episode.fechaIngreso && episode.fechaAlta) {
          diasEstada = calcularDiasEstada(episode.fechaIngreso, episode.fechaAlta);
        }
        
        if (diasEstada !== null && diasEstada !== undefined && episode.grd) {
          const puntoCorteInf = episode.grd.puntoCorteInf ? Number(episode.grd.puntoCorteInf) : null;
          const puntoCorteSup = episode.grd.puntoCorteSup ? Number(episode.grd.puntoCorteSup) : null;
          
          if (puntoCorteInf !== null && puntoCorteSup !== null) {
            return calcularInlierOutlier(diasEstada, puntoCorteInf, puntoCorteSup);
          }
        }
        
        return episode.inlierOutlier;
      })();
      
      // Log para TODOS los episodios temporalmente para debug
      const episodioId = episode.episodioCmdb || episode.id;
      console.log(`🔍 [grupoDentroNorma] episodio=${episodioId}, inlierValue="${inlierValue}", tipo=${typeof inlierValue}`);
      
      if (!inlierValue) {
        console.log(`   → Retornando false (valor vacío/null)`);
        return false;
      }
      
      // Convertir a string y normalizar: trim, lowercase, y normalizar espacios
      const normalized = String(inlierValue).trim().toLowerCase().replace(/\s+/g, ' ');
      // Comparar exactamente con "inlier"
      const isInlier = normalized === 'inlier';
      
      console.log(`   → normalized="${normalized}", isInlier=${isInlier}, retornando ${isInlier}`);
      
      return isInlier;
    })(),
    // Calcular "En norma" basado en "Inlier/Outlier": "Si" si es "Inlier", "No" en cualquier otro caso
    // Si "Inlier/Outlier" está vacío, "En norma" también debe estar vacío (null)
    enNorma: (() => {
      const inlierValue = episode.inlierOutlier;
      
      // Si no hay valor o está vacío, devolver null (vacío)
      if (!inlierValue) {
        return null;
      }
      
      // Convertir a string si no lo es (por si viene como otro tipo)
      const stringValue = typeof inlierValue === 'string' 
        ? inlierValue 
        : String(inlierValue);
      
      // Normalizar: trim y lowercase
      const normalized = stringValue.trim().toLowerCase();
      
      // Si está vacío después de trim o es "-", devolver null (vacío)
      if (normalized === '' || normalized === '-') {
        return null;
      }
      
      // Comparar exactamente con "inlier" (case-insensitive)
      if (normalized === 'inlier') {
        return 'Si';
      }
      
      // Cualquier otro caso (outlier superior, inferior, etc.) es "No"
      return 'No';
    })(),
    diasEstada: toInteger(episode.diasEstada), // SIEMPRE integer o null
    
    // Otros campos del episodio
    centro: episode.centro || null,
    numeroFolio: episode.numeroFolio || null,
    tipoEpisodio: episode.tipoEpisodio || '',
    tipoAlta: episode.tipoAlta || null,
    convenio: episode.convenio || '', // Misma lógica que tipoEpisodio
    id: episode.id,
  };
  
  // Log para verificar que enNorma está en el resultado (solo primeros 5 para no saturar)
  const episodioIdLog = episode.episodioCmdb || episode.id;
  if (episodioIdLog && String(episodioIdLog).slice(-1) <= '5') {
    console.log(`✅ [normalizeEpisodeResponse] episodio=${episodioIdLog}, enNorma="${result.enNorma}", tipo=${typeof result.enNorma}, tieneEnNorma=${'enNorma' in result}`);
  }
  
  return result;
}

// Esquema Joi para validación (lo mantenemos)
const episodioSchema = Joi.object({
  centro: Joi.string().optional().allow(null),
  numeroFolio: Joi.string().optional().allow(null),
  episodioCmdb: Joi.string().optional().allow(null),
  idDerivacion: Joi.string().optional().allow(null),
  tipoEpisodio: Joi.string().optional().allow(null),
  fechaIngreso: Joi.date().optional().allow(null),
  fechaAlta: Joi.date().optional().allow(null),
  servicioAlta: Joi.string().optional().allow(null),
  estadoRn: Joi.string().optional().allow(null),
  // Campos del frontend (camelCase con mayúsculas)
  estadoRN: Joi.string().optional().allow(null), // Alias para estadoRn
  validado: Joi.boolean().optional().allow(null),
  atSn: Joi.boolean().optional().allow(null),
  at: Joi.boolean().optional().allow(null), // Alias para atSn
  atDetalle: Joi.string().optional().allow(null),
  montoAt: Joi.number().optional().allow(null),
  montoAT: Joi.number().optional().allow(null), // Alias para montoAt
  tipoAlta: Joi.string().optional().allow(null),
  pesoGrd: Joi.number().optional().allow(null),
  montoRn: Joi.number().optional().allow(null),
  montoRN: Joi.number().optional().allow(null), // Alias para montoRn
  diasDemoraRescate: Joi.number().integer().optional().allow(null),
  pagoDemoraRescate: Joi.number().optional().allow(null),
  pagoDemora: Joi.number().optional().allow(null), // Alias para pagoDemoraRescate
  pagoOutlierSuperior: Joi.number().optional().allow(null),
  pagoOutlierSup: Joi.number().optional().allow(null), // Alias para pagoOutlierSuperior
  documentacion: Joi.object().optional().allow(null), // Asumiendo JSON
  inlierOutlier: Joi.string().optional().allow(null),
  grupoEnNorma: Joi.boolean().optional().allow(null),
  diasEstada: Joi.number().integer().optional().allow(null),
  precioBaseTramo: Joi.number().optional().allow(null),
  valorGrd: Joi.number().optional().allow(null),
  montoFinal: Joi.number().optional().allow(null),
  facturacionTotal: Joi.number().optional().allow(null),
  especialidad: Joi.string().optional().allow(null),
  anio: Joi.number().integer().optional().allow(null),
  mes: Joi.number().integer().optional().allow(null),
  convenio: Joi.string().optional().allow(null), // Código del convenio (ej: 'FNS012', 'FNS026', 'FNS019', 'CH0041')
  pacienteId: Joi.number().integer().optional().allow(null),
  grdId: Joi.number().integer().optional().allow(null),
});

// Listar episodios (AHORA DESDE PRISMA)
router.get('/episodios', requireAuth, async (req: Request, res: Response) => {
  try {
    const convenio = req.query.convenio as string | undefined;

    // Construir filtro where
    const where: Prisma.EpisodioWhereInput = {};
    
    // Filtro por convenio (para usuarios de finanzas y codificador)
    // Normalizar rol del usuario para comparación
    const userRole = req.user?.role || '';
    const normalizedRole = userRole
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, '');
    const isFinanzas = normalizedRole === 'FINANZAS';
    const isCodificador = normalizedRole === 'CODIFICADOR';
    
    // Aplicar filtro de convenio si el usuario es de finanzas o codificador
    if ((isFinanzas || isCodificador) && convenio && convenio.trim() !== '') {
      where.convenio = {
        contains: convenio.trim(),
        mode: 'insensitive', // Búsqueda case-insensitive
      };
    }

    const episodios = await prisma.episodio.findMany({
      where,
      include: {
        paciente: { select: { id: true, nombre: true, rut: true } },
        grd: { select: { id: true, codigo: true, descripcion: true, peso: true } },
      },
      orderBy: {
        id: 'desc',
      },
    });
    res.json({ total: episodios.length, data: episodios });
  } catch (error: any) {
    console.error('Error al listar episodios:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({ 
      error: 'Error al listar episodios',
      message: error?.message || 'Error desconocido'
    });
  }
});

// Endpoint para obtener metadata de episodios
router.get('/episodios/meta', requireAuth, async (_req: Request, res: Response) => {
  try {
    const count = await prisma.episodio.count();
    const lastEpisode = await prisma.episodio.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    
    return res.json({
      count,
      lastImportedAt: lastEpisode?.createdAt ? lastEpisode.createdAt.toISOString() : null,
    });
  } catch (error: any) {
    console.error('Error al obtener metadata:', error);
    console.error('Stack:', error?.stack);
    return res.status(500).json({ 
      error: 'Error al obtener metadata',
      message: error?.message || 'Error desconocido'
    });
  }
});

// Endpoint para obtener episodios finales (con paginación)
router.get('/episodios/final', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;
    const convenio = req.query.convenio as string | undefined;

    // Construir filtro where
    const where: Prisma.EpisodioWhereInput = {};
    
    // Filtro por convenio (para usuarios de finanzas y codificador)
    // Normalizar rol del usuario para comparación
    const userRole = req.user?.role || '';
    const normalizedRole = userRole
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, '');
    const isFinanzas = normalizedRole === 'FINANZAS';
    const isCodificador = normalizedRole === 'CODIFICADOR';
    
    // Aplicar filtro de convenio si el usuario es de finanzas o codificador
    if ((isFinanzas || isCodificador) && convenio && convenio.trim() !== '') {
      where.convenio = {
        contains: convenio.trim(),
        mode: 'insensitive', // Búsqueda case-insensitive
      };
    }

    const [episodes, total] = await Promise.all([
      prisma.episodio.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          paciente: true,
          grd: true,
        },
      orderBy: {
        id: 'desc',
      },
      }),
      prisma.episodio.count({ where }),
    ]);

    // Recalcular precioBaseTramo, valorGRD y montoFinal para todos los episodios
    // Esto asegura que siempre se usen los precios más recientes de convenios
    for (const episode of episodes) {
      if (episode.convenio) {
        const pesoGRD = episode.pesoGrd ? Number(episode.pesoGrd) : null;
        const precioCalculado = await obtenerPrecioBaseTramo(episode.convenio, pesoGRD);
        
        if (precioCalculado !== null) {
          // Recalcular valorGRD y montoFinal
          const valorGRDCalculado = calcularValorGRD(pesoGRD, precioCalculado);
          const montoAT = episode.montoAt ? Number(episode.montoAt) : 0;
          const pagoOutlierSup = episode.pagoOutlierSuperior ? Number(episode.pagoOutlierSuperior) : 0;
          const pagoDemora = episode.pagoDemoraRescate ? Number(episode.pagoDemoraRescate) : 0;
          const montoFinalCalculado = calcularMontoFinal(valorGRDCalculado, montoAT, pagoOutlierSup, pagoDemora);
          
          // Solo actualizar en BD si los valores cambiaron (para evitar escrituras innecesarias)
          const precioActual = episode.precioBaseTramo ? Number(episode.precioBaseTramo) : null;
          const valorGRDActual = episode.valorGrd ? Number(episode.valorGrd) : null;
          const montoFinalActual = episode.montoFinal ? Number(episode.montoFinal) : null;
          
          const necesitaActualizar = 
            precioActual !== precioCalculado ||
            Math.abs((valorGRDActual ?? 0) - valorGRDCalculado) > 0.01 ||
            Math.abs((montoFinalActual ?? 0) - montoFinalCalculado) > 0.01;
          
          if (necesitaActualizar) {
            await prisma.episodio.update({
              where: { id: episode.id },
              data: {
                precioBaseTramo: precioCalculado,
                valorGrd: valorGRDCalculado,
                montoFinal: montoFinalCalculado
              }
            });
          }
          
          // Actualizar el objeto en memoria para esta respuesta
          episode.precioBaseTramo = precioCalculado as any;
          episode.valorGrd = valorGRDCalculado as any;
          episode.montoFinal = montoFinalCalculado as any;
        }
      }
    }

    // Helper para convertir Decimal a Number
    const toNumber = (value: any): number => {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseFloat(value) || 0;
      if (value && typeof value.toNumber === 'function') return value.toNumber();
      return 0;
    };

    // Log para debug: verificar convenio en los primeros episodios
    if (episodes.length > 0) {
      const primeros3 = episodes.slice(0, 3);
      primeros3.forEach((e: any) => {
        console.log(`📋 Episodio ${e.episodioCmdb}: convenio en BD = "${e.convenio || 'null/undefined'}"`);
        console.log(`   Tipo: ${typeof e.convenio}, Tiene campo: ${'convenio' in e}`);
      });
    }
    
    // Transformar al formato esperado por el frontend usando normalización
    // Usar la función normalizeEpisodeResponse para cada episodio
    const items = episodes.map((e: any, idx: number) => {
      const normalized = normalizeEpisodeResponse(e);
      
      // Log para verificar que convenio se normaliza correctamente
      if (idx < 3) {
        console.log(`🔄 Normalizado episodio ${normalized.episodio}: convenio = "${normalized.convenio || 'null/undefined'}"`);
      }
      
      // El endpoint /final tiene un formato ligeramente diferente, ajustar campos
      // IMPORTANTE: Asegurar que atDetalle siempre esté presente (null o string, nunca undefined)
      // Si es undefined, establecerlo explícitamente como null para que se incluya en el JSON
      const atDetalleValue = (normalized.atDetalle !== undefined && normalized.atDetalle !== null) 
        ? normalized.atDetalle 
        : null;
      
      // DEBUG: Verificar que atDetalle está presente
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 GET /episodios/final - Episodio ${e.episodioCmdb || e.id}:`, {
          atDetalleEnBD: e.atDetalle,
          atDetalleNormalizado: normalized.atDetalle,
          atDetalleValue: atDetalleValue,
          tipo: typeof normalized.atDetalle,
          keysEnNormalized: Object.keys(normalized).filter(k => k.includes('at'))
        });
      }
      
      // Construir el objeto de respuesta explícitamente para asegurar que atDetalle esté presente
      const itemResponse: any = {
        episodio: normalized.episodio,
        nombre: normalized.nombre,
        rut: normalized.rut,
        centro: normalized.centro || '',
        folio: normalized.numeroFolio || '',
        tipoEpisodio: normalized.tipoEpisodio || '',
        fechaIngreso: normalized.fechaIngreso || '',
        fechaAlta: normalized.fechaAlta || '',
        servicioAlta: normalized.servicioAlta || '',
        convenio: normalized.convenio || '', // Convenio bajo el cual se calcula el episodio - misma lógica que tipoEpisodio
        grdCodigo: normalized.grdCodigo,
        peso: normalized.peso || 0, // Para compatibilidad con el formato anterior
        pesoGrd: (() => {
          const pesoGrdValue = normalized.pesoGrd || null;
          const episodioId = normalized.episodio || e.episodioCmdb || e.id;
          if (idx < 3) {
            console.log(`📤 [GET /episodios/final] Episodio ${episodioId} (idx ${idx}): pesoGrd = ${pesoGrdValue} (tipo: ${typeof pesoGrdValue})`);
            console.log(`   normalized.pesoGrd raw: ${normalized.pesoGrd} (tipo: ${typeof normalized.pesoGrd})`);
            console.log(`   e.pesoGrd raw (desde BD): ${e.pesoGrd} (tipo: ${typeof e.pesoGrd})`);
          }
          return pesoGrdValue;
        })(), // Campo "Peso GRD Medio (Todos)" - requerido por el frontend
        montoRN: normalized.montoRN || 0, // Para compatibilidad con el formato anterior
        inlierOutlier: normalized.inlierOutlier || '',
        // Agregar campos normalizados adicionales si el frontend los necesita
        validado: normalized.validado,
        estadoRN: normalized.estadoRN,
        at: normalized.at,
        atDetalle: atDetalleValue, // ⚠️ CRÍTICO: Incluir atDetalle en la respuesta (siempre null o string, nunca undefined)
        montoAT: normalized.montoAT,
        motivoEgreso: normalized.tipoAlta || null, // Mapeo de tipoAlta a motivoEgreso para el frontend
        diasDemoraRescate: normalized.diasDemoraRescate,
        pagoDemora: normalized.pagoDemora,
        pagoOutlierSup: normalized.pagoOutlierSup,
        precioBaseTramo: normalized.precioBaseTramo,
        valorGRD: normalized.valorGRD,
        montoFinal: normalized.montoFinal,
        documentacion: normalized.documentacion,
        grupoDentroNorma: normalized.grupoDentroNorma,
        enNorma: normalized.enNorma || null, // Si está vacío, mantener null (no forzar 'No')
        diasEstada: normalized.diasEstada,
        id: normalized.id,
      };
      
      // VERIFICACIÓN FINAL: Asegurar que atDetalle esté presente en el objeto
      if (!('atDetalle' in itemResponse)) {
        itemResponse.atDetalle = null;
        console.warn(`⚠️ atDetalle no estaba presente en itemResponse para episodio ${e.episodioCmdb || e.id}. Agregado como null.`);
      }
      
      return itemResponse;
    });

    // Log para verificar la respuesta final que se envía al frontend
    if (items.length > 0) {
      const primerItem = items[0];
      console.log(`📤 Respuesta /episodios/final - Primer item:`, {
        episodio: primerItem.episodio,
        convenio: primerItem.convenio,
        tieneConvenio: 'convenio' in primerItem,
        todasLasKeys: Object.keys(primerItem).slice(0, 15)
      });
    }

    return res.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: any) {
    console.error('Error al obtener episodios finales:', error);
    console.error('Stack:', error?.stack);
    return res.status(500).json({ 
      error: 'Error al obtener episodios finales',
      message: error?.message || 'Error desconocido'
    });
  }
});

// ===================================================================
// ==================== ENDPOINTS DE DOCUMENTOS =====================
// IMPORTANTE: Estas rutas deben ir ANTES de /episodios/:id para evitar conflictos
// ===================================================================

// Helper para buscar episodio de forma flexible (por episodioCmdb o id interno)
// El frontend puede enviar el campo "episodio" (episodioCmdb) como string numérico
async function findEpisodioFlexibleForDocuments(identifier: string) {
  const idNum = parseInt(identifier);
  let episodio;

  // Intentar buscar primero por episodioCmdb (el campo que usa el frontend)
  episodio = await prisma.episodio.findFirst({
    where: { episodioCmdb: identifier },
    select: { id: true },
  });

  // Si no se encuentra por episodioCmdb y el ID es numérico, intentar por id interno
  if (!episodio && !isNaN(idNum)) {
    episodio = await prisma.episodio.findUnique({
      where: { id: idNum },
      select: { id: true },
    });
  }

  return episodio;
}

// Configuración de Multer para documentos (usando memoryStorage para Cloudinary)
const documentosStorage = multer.memoryStorage();
const documentosUpload = multer({
  storage: documentosStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB límite
});

/**
 * POST /api/episodios/:episodioId/documentos
 * Sube un archivo a Cloudinary y lo asocia al episodio
 * Body: FormData con file y episodioId
 * Response: DocumentoCloudinary
 */
router.post(
  '/episodios/:episodioId/documentos',
  requireAuth,
  documentosUpload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const { episodioId } = req.params;

      if (!req.file) {
        return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
      }

      // Buscar episodio de forma flexible (por episodioCmdb o id interno)
      const episodio = await findEpisodioFlexibleForDocuments(episodioId);

      if (!episodio) {
        return res.status(404).json({ error: 'Episodio no encontrado' });
      }

      // Usar el ID interno del episodio encontrado
      const episodioIdInterno = episodio.id;

      // Preparar nombre del archivo (sin extensión para public_id)
      const originalName = req.file.originalname;
      const extension = path.extname(originalName);
      const nombreSinExtension = path.basename(originalName, extension);
      // Limpiar nombre para que sea válido en Cloudinary (eliminar caracteres especiales)
      const nombreArchivoLimpio = nombreSinExtension.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Estructura según especificación: folder: episodios/{episodioId}, public_id: episodios/{episodioId}/{nombreArchivo}
      // Usar el ID interno para la estructura de carpetas en Cloudinary
      const folder = `episodios/${episodioIdInterno}`;
      const publicId = `episodios/${episodioIdInterno}/${nombreArchivoLimpio}`;

      // Subir archivo a Cloudinary
      const result: any = await uploadToCloudinary(req.file.buffer, {
        folder: folder,
        public_id: publicId,
        resource_type: 'auto', // Detecta automáticamente el tipo (PDF, imagen, etc.)
      });

      // Guardar en la base de datos usando el ID interno
      const documento = await prisma.documentoCloudinary.create({
        data: {
          nombre: originalName,
          publicId: result.public_id,
          url: result.secure_url,
          formato: extension.substring(1).toLowerCase(), // Sin el punto
          tamano: req.file.size,
          episodioId: episodioIdInterno,
        },
      });

      // Formatear respuesta según tipo DocumentoCloudinary
      const response = {
        id: documento.id,
        nombre: documento.nombre,
        publicId: documento.publicId,
        url: documento.url,
        formato: documento.formato,
        tamano: documento.tamano,
        uploadedAt: documento.uploadedAt.toISOString(),
      };

      res.status(201).json(response);
    } catch (error: any) {
      console.error('Error subiendo documento:', error);
      res.status(500).json({
        error: 'Error interno al subir el documento',
        message: error.message || 'Error desconocido',
      });
    }
  }
);

/**
 * GET /api/episodios/:episodioId/documentos
 * Obtiene todos los documentos de un episodio
 * Response: Array de DocumentoCloudinary
 */
router.get('/episodios/:episodioId/documentos', requireAuth, async (req: Request, res: Response) => {
  try {
    const { episodioId } = req.params;

    // Buscar episodio de forma flexible (por episodioCmdb o id interno)
    const episodio = await findEpisodioFlexibleForDocuments(episodioId);

    if (!episodio) {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }

    // Usar el ID interno del episodio encontrado
    const episodioIdInterno = episodio.id;

    // Obtener documentos del episodio
    const documentos = await prisma.documentoCloudinary.findMany({
      where: { episodioId: episodioIdInterno },
      orderBy: { uploadedAt: 'desc' },
    });

    // Formatear respuesta según tipo DocumentoCloudinary
    const response = documentos.map((doc) => ({
      id: doc.id,
      nombre: doc.nombre,
      publicId: doc.publicId,
      url: doc.url,
      formato: doc.formato,
      tamano: doc.tamano,
      uploadedAt: doc.uploadedAt.toISOString(),
    }));

    res.json(response);
  } catch (error: any) {
    console.error('Error obteniendo documentos:', error);
    res.status(500).json({
      error: 'Error interno al obtener documentos',
      message: error.message || 'Error desconocido',
    });
  }
});

/**
 * DELETE /api/episodios/:episodioId/documentos/:documentoId
 * Elimina un documento de Cloudinary usando public_id
 * Response: 204 No Content
 */
router.delete(
  '/episodios/:episodioId/documentos/:documentoId',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { episodioId, documentoId } = req.params;

      // Buscar episodio de forma flexible (por episodioCmdb o id interno)
      const episodio = await findEpisodioFlexibleForDocuments(episodioId);

      if (!episodio) {
        return res.status(404).json({ error: 'Episodio no encontrado' });
      }

      // Usar el ID interno del episodio encontrado
      const episodioIdInterno = episodio.id;

      // Buscar el documento
      const documento = await prisma.documentoCloudinary.findUnique({
        where: { id: parseInt(documentoId) },
      });

      if (!documento) {
        return res.status(404).json({ error: 'Documento no encontrado' });
      }

      // Verificar que el documento pertenezca al episodio
      if (documento.episodioId !== episodioIdInterno) {
        return res.status(400).json({ error: 'El documento no pertenece a este episodio' });
      }

      // Determinar el resource_type basado en el formato del archivo
      // PDFs y documentos se suben como 'raw', imágenes como 'image', videos como 'video'
      const formato = documento.formato?.toLowerCase() || '';
      let resourceType: 'image' | 'video' | 'raw' = 'raw'; // Por defecto raw
      
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(formato)) {
        resourceType = 'image';
      } else if (['mp4', 'mov', 'avi', 'webm'].includes(formato)) {
        resourceType = 'video';
      }
      // PDFs, DOCX, XLSX, etc. son 'raw' (por defecto)

      // Eliminar de Cloudinary usando public_id y resource_type
      let cloudinaryDeleted = false;
      try {
        const result = await cloudinary.uploader.destroy(documento.publicId, {
          resource_type: resourceType,
        });
        
        // El resultado de destroy puede ser { result: 'ok' } o { result: 'not found' }
        cloudinaryDeleted = result.result === 'ok';
        
        if (!cloudinaryDeleted) {
          console.warn(`Documento no encontrado en Cloudinary: ${documento.publicId} (result: ${result.result})`);
          // Continuamos con la eliminación de BD aunque no esté en Cloudinary
        }
      } catch (cloudinaryError: any) {
        console.error('Error eliminando de Cloudinary:', cloudinaryError);
        // Continuar con la eliminación de la BD aunque falle en Cloudinary
        // (el archivo puede no existir ya en Cloudinary o haber un error de conexión)
      }

      // Eliminar de la base de datos
      await prisma.documentoCloudinary.delete({
        where: { id: parseInt(documentoId) },
      });

      // Si se eliminó correctamente de Cloudinary, devolver 204
      // Si no estaba en Cloudinary pero se eliminó de BD, también 204
      res.status(204).send();
    } catch (error: any) {
      console.error('Error eliminando documento:', error);
      res.status(500).json({
        error: 'Error interno al eliminar documento',
        message: error.message || 'Error desconocido',
      });
    }
  }
);

// ===================================================================
// RUTAS GENÉRICAS DE EPISODIOS (deben ir después de las específicas)
// ===================================================================

// Obtener episodio por id (AHORA DESDE PRISMA) - Soporta ID numérico o episodioCmdb
router.get('/episodios/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'ID es requerido' });
    }
    
    // Buscar episodio de forma flexible: primero por episodioCmdb, luego por id interno
    // El frontend puede enviar el campo "episodio" (episodioCmdb) como string numérico
    const idNum = parseInt(id);
    let episodio;
    
    // Intentar buscar primero por episodioCmdb (el campo que usa el frontend)
    episodio = await prisma.episodio.findFirst({
      where: { episodioCmdb: id },
      include: {
        paciente: true,
        grd: {
          select: {
            id: true,
            codigo: true,
            descripcion: true,
            peso: true,
            puntoCorteInf: true,
            puntoCorteSup: true,
          },
        },
        diagnosticos: true,
        respaldos: true,
      },
    });

    // Si no se encuentra por episodioCmdb y el ID es numérico, intentar por id interno
    if (!episodio && !isNaN(idNum)) {
      episodio = await prisma.episodio.findUnique({
        where: { id: idNum },
        include: {
          paciente: true,
          grd: {
            select: {
              id: true,
              codigo: true,
              descripcion: true,
              peso: true,
              puntoCorteInf: true,
              puntoCorteSup: true,
            },
          },
          diagnosticos: true,
          respaldos: true,
        },
      });
    }

    if (!episodio) {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }
    
    // Recalcular precioBaseTramo si es necesario (lazy calculation)
    if (!episodio.precioBaseTramo && episodio.convenio) {
      const pesoGRD = episodio.pesoGrd ? Number(episodio.pesoGrd) : null;
      const precioCalculado = await obtenerPrecioBaseTramo(episodio.convenio, pesoGRD);
      if (precioCalculado !== null) {
        // Actualizar en la base de datos
        episodio = await prisma.episodio.update({
          where: { id: episodio.id },
          data: { precioBaseTramo: precioCalculado },
          include: {
            paciente: true,
            grd: true,
            diagnosticos: true,
            respaldos: true,
          },
        });
      }
    }
    
    // Normalizar respuesta antes de enviar
    const normalized = normalizeEpisodeResponse(episodio);
    res.json(normalized);
  } catch (error: any) {
    console.error('Error al obtener episodio:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({ 
      error: 'Error al obtener episodio',
      message: error?.message || 'Error desconocido'
    });
  }
});

// Crear episodio (AHORA EN PRISMA)
router.post('/episodios', requireAuth, async (req: Request, res: Response) => {
  try {
    const { error, value } = episodioSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
    }

    const record = await prisma.episodio.create({
      data: value,
    });

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear episodio' });
  }
});

// Actualizar episodio (AHORA EN PRISMA) - PUT para actualización completa
router.put('/episodios/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { error, value } = episodioSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
    }

    // Buscar episodio de forma flexible: primero por episodioCmdb, luego por id interno
    const idNum = parseInt(id);
    let episodioId: number;

    // Intentar buscar primero por episodioCmdb (el campo que usa el frontend)
    let existing = await prisma.episodio.findFirst({
      where: { episodioCmdb: id },
      select: { id: true },
    });

    // Si no se encuentra por episodioCmdb y el ID es numérico, intentar por id interno
    if (!existing && !isNaN(idNum)) {
      existing = await prisma.episodio.findUnique({
        where: { id: idNum },
        select: { id: true },
      });
    }

    if (!existing) {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }

    episodioId = existing.id;

    const updated = await prisma.episodio.update({
      where: { id: episodioId },
      data: value,
      include: {
        paciente: true,
        grd: true,
        diagnosticos: true,
        respaldos: true,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Episodio no encontrado' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar episodio' });
  }
});

// Esquema de validación específico para campos de codificador (PATCH)
// Permite editar: 'at', 'atDetalle', 'diasDemoraRescate', 'pagoDemora', 'montoRN', 'pagoOutlierSup'
// y para casos fuera de norma: 'valorGRD' y 'montoFinal'
const codificadorSchema = Joi.object({
  at: Joi.alternatives().try(
    Joi.boolean(),
    Joi.string().valid('S', 's', 'N', 'n')
  ).optional(),
  atDetalle: Joi.string().allow(null, '').optional(),
  documentacion: Joi.string().allow(null, '').optional(),
  diasDemoraRescate: Joi.alternatives().try(
    Joi.number().integer().min(0),
    Joi.string().pattern(/^\d+$/).min(0)
  ).optional(),
  pagoDemora: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).allow(null).optional(),
  montoRN: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  pagoOutlierSup: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).allow(null).optional(),
  valorGRD: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  montoFinal: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
}).unknown(false); // No permitir campos desconocidos

// Esquema de validación específico para campos de gestión (PATCH)
// Gestión puede editar 'at', 'atDetalle', 'precioBaseTramo'
const gestionSchema = Joi.object({
  at: Joi.alternatives().try(
    Joi.boolean(),
    Joi.string().valid('S', 's', 'N', 'n')
  ).optional(),
  atDetalle: Joi.string().allow(null, '').optional(),
  precioBaseTramo: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
}).unknown(false); // No permitir campos desconocidos

// Esquema de validación específico para campos de finanzas (PATCH)
// Validamos con nombres del frontend, luego mapeamos a nombres de BD
// NOTA: 'at' y 'atDetalle' NO están permitidos para finanzas
const finanzasSchema = Joi.object({
  estadoRN: Joi.string().valid('Aprobado', 'Pendiente', 'Rechazado').allow(null, '').optional(),
  // montoAT NO es editable - se autocompleta automáticamente cuando se edita atDetalle
  // Removido del esquema de finanzas
  montoRN: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  diasDemoraRescate: Joi.alternatives().try(
    Joi.number().integer().min(0),
    Joi.string().pattern(/^\d+$/).min(0)
  ).optional(),
  pagoDemora: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).allow(null).optional(),
  pagoOutlierSup: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).allow(null).optional(),
  precioBaseTramo: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  valorGRD: Joi.alternatives().try(       // 👈 NUEVO
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(),
  montoFinal: Joi.alternatives().try(
    Joi.number().min(0),
    Joi.string().pattern(/^\d+(\.\d+)?$/).min(0)
  ).optional(), // Se ignora, se calcula automáticamente
  // documentacion NO es editable para finanzas - solo para codificador
}).unknown(false); // No permitir campos desconocidos

// Mapeo completo de campos del frontend a la base de datos para finanzas
// IMPORTANTE: montoAT NO está incluido - no es editable para finanzas
const finanzasFieldMapping: Record<string, string> = {
  estadoRN: 'estadoRn',
  montoRN: 'montoRn',
  pagoDemora: 'pagoDemoraRescate',
  pagoOutlierSup: 'pagoOutlierSuperior',
  valorGRD: 'valorGrd', // NUEVO: para override manual
};

// Mapeo de campos del frontend a la base de datos para codificador
const codificadorFieldMapping: Record<string, string> = {
  at: 'atSn',
  atDetalle: 'atDetalle',
  documentacion: 'documentacion',
  diasDemoraRescate: 'diasDemoraRescate',
  pagoDemora: 'pagoDemoraRescate',
  montoRN: 'montoRn',
  pagoOutlierSup: 'pagoOutlierSuperior',
  valorGRD: 'valorGrd',
  montoFinal: 'montoFinal',
};

// Actualizar episodio parcialmente (PATCH) - Funcionalidad de Finanzas, Gestión y Codificador
router.patch('/episodios/:id', 
  requireAuth, 
  // Permitir a finanzas, gestion y codificador
  requireRole(['finanzas', 'FINANZAS', 'gestion', 'GESTION', 'codificador', 'CODIFICADOR']), 
  async (req: Request, res: Response) => {
  // DEBUG: Verificar que el código se está ejecutando
  console.log('🔍 PATCH /episodios/:id - Código actualizado con codificador - VERSIÓN 2.0');
  console.log('🔍 Roles permitidos en requireRole:', ['finanzas', 'FINANZAS', 'gestion', 'GESTION', 'codificador', 'CODIFICADOR']);
  try {
    const { id } = req.params;
    
    // Obtener rol del usuario y normalizarlo
    const userRole = req.user?.role || '';
    console.log('🔍 Rol del usuario recibido:', userRole);
    const normalizedRole = userRole
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, '');
    const isCodificador = normalizedRole === 'CODIFICADOR';
    const isFinanzas = normalizedRole === 'FINANZAS';
    const isGestion = normalizedRole === 'GESTION';
    
    // Log detallado para debug
    console.log('🔍 Normalización de rol:', {
      userRole,
      normalizedRole,
      isCodificador,
      isFinanzas,
      isGestion
    });
    
    // Log para debug
    console.log('🔍 PATCH /episodios/:id - Información del usuario:', {
      userRole: userRole,
      normalizedRole: normalizedRole,
      isCodificador: isCodificador,
      isFinanzas: isFinanzas,
      isGestion: isGestion,
      userId: req.user?.id
    });
    
    // Ignorar valorGRD si viene en el request (se calculará automáticamente)
    const requestBody = { ...req.body };
    delete requestBody.valorGRD;
    
    // Verificar qué campos se están intentando actualizar
    // IMPORTANTE: montoAT siempre viene junto con at o atDetalle, pero NO se considera un campo editable
    // Es solo una consecuencia automática de editar at o atDetalle
    const camposATEditables = ['at', 'atDetalle'];
    const camposOverrideManual = ['valorGRD', 'montoFinal']; // Campos para override manual en casos fuera de norma
    const camposCodificadorEspeciales = ['documentacion']; // Campos editables solo por codificador
    const camposEditablesEnPayload = camposATEditables.filter(campo => campo in requestBody);
    const camposOverrideEnPayload = camposOverrideManual.filter(campo => campo in requestBody);
    const camposCodificadorEnPayload = camposCodificadorEspeciales.filter(campo => campo in requestBody);
    const otrosCampos = Object.keys(requestBody).filter(
      campo => !camposATEditables.includes(campo) && 
               !camposOverrideManual.includes(campo) && 
               !camposCodificadorEspeciales.includes(campo) &&
               campo !== 'montoAT' && 
               campo !== 'validado'
    );
    const userRoleUpper = userRole.toUpperCase();
    
    console.log('🔐 Verificando permisos para PATCH /api/episodios/:id:', {
      rol: userRole,
      camposATEditables: camposEditablesEnPayload,
      camposOverride: camposOverrideEnPayload,
      camposCodificador: camposCodificadorEnPayload,
      otrosCampos: otrosCampos,
      montoATEnPayload: 'montoAT' in requestBody,
      payloadCompleto: requestBody
    });
    
    // CASO 0.5: Si está intentando editar 'documentacion', permitir SOLO codificador
    if (camposCodificadorEnPayload.length > 0) {
      if (!isCodificador) {
        console.log('❌ Acceso denegado: Usuario intenta editar documentacion pero no es codificador. Rol:', userRole);
        return res.status(403).json({
          message: `Acceso denegado: Solo el rol codificador puede editar el campo documentacion. Rol actual: "${userRole}".`,
          error: 'FORBIDDEN',
          campos: camposCodificadorEnPayload,
          rolActual: userRole,
          camposRequeridos: ['documentacion']
        });
      }
      console.log('✅ Permiso concedido para', userRole, 'editando documentacion:', camposCodificadorEnPayload);
    }
    
    // CASO 1: Si está intentando editar 'at' o 'atDetalle' directamente, permitir SOLO codificador y gestion
    // ⚠️ IMPORTANTE: Finanzas NO puede editar estos campos
    // ⚠️ IMPORTANTE: Incluso si montoAT viene junto, es parte de la autocompletación/limpieza automática
    if (camposEditablesEnPayload.length > 0) {
      const rolesPermitidosParaAT = ['CODIFICADOR', 'GESTION'];
      if (!rolesPermitidosParaAT.includes(userRoleUpper)) {
        console.log('❌ Acceso denegado: Usuario intenta editar AT/AT Detalle pero no es codificador ni gestion. Rol:', userRole);
        return res.status(403).json({
          message: `Acceso denegado: Solo los roles codificador y gestion pueden editar los campos AT(S/N) y AT Detalle. Rol actual: "${userRole}". Finanzas no tiene permisos para editar estos campos.`,
          error: 'FORBIDDEN',
          campos: camposEditablesEnPayload,
          rolActual: userRole,
          camposRequeridos: ['at', 'atDetalle']
        });
      }
      // Si el rol es CODIFICADOR o GESTION y está editando at o atDetalle, permitir
      // Incluso si montoAT viene en el payload, es aceptable porque se autocompleta
      console.log('✅ Permiso concedido para', userRole, 'editando AT/AT Detalle:', camposEditablesEnPayload);
    }
    
    // CASO 1.5: Si está intentando editar valorGRD o montoFinal (override manual), permitir finanzas y codificador
    // Estos campos solo son editables para casos fuera de norma (se valida más adelante)
    if (camposOverrideEnPayload.length > 0) {
      const rolesPermitidosParaOverride = ['FINANZAS', 'CODIFICADOR'];
      if (!rolesPermitidosParaOverride.includes(userRoleUpper)) {
        return res.status(403).json({
          message: `Acceso denegado: Solo los roles finanzas y codificador pueden hacer override manual de valorGRD y montoFinal. Rol actual: "${userRole}".`,
          error: 'FORBIDDEN',
          campos: camposOverrideEnPayload,
          rolActual: userRole,
          camposRequeridos: ['valorGRD', 'montoFinal']
        });
      }
      console.log('✅ Permiso concedido para', userRole, 'editando override manual:', camposOverrideEnPayload);
    }
    
    // CASO 2: Si está intentando editar otros campos (pero NO at ni atDetalle ni override), permitir finanzas y gestion
    if (otrosCampos.length > 0) {
      const rolesPermitidosParaOtros = ['FINANZAS', 'GESTION'];
      if (!rolesPermitidosParaOtros.includes(userRoleUpper)) {
        return res.status(403).json({
          message: `Acceso denegado: Rol del usuario "${userRole}" no está permitido para editar estos campos.`,
          error: 'FORBIDDEN',
          rolActual: userRole,
          campos: otrosCampos
        });
      }
      console.log(' Permiso concedido para', userRole, 'editando:', otrosCampos);
    }
    
    // CASO ESPECIAL: Si el payload contiene montoAT, rechazar explícitamente
    // montoAT NO es editable - solo se autocompleta automáticamente cuando codificador/gestión edita atDetalle
    // Finanzas NO puede editar montoAT ni ningún campo relacionado con AT
    if ('montoAT' in requestBody) {
      // Solo permitir si viene junto con atDetalle y el usuario es codificador o gestión
      if (camposEditablesEnPayload.includes('atDetalle') && (isCodificador || isGestion)) {
        // Permitir - montoAT se autocompletará automáticamente en el backend
        console.log('✅ montoAT permitido porque viene con atDetalle y usuario es codificador/gestión');
      } else {
        // Rechazar - finanzas no puede editar montoAT
        return res.status(403).json({
          message: 'Acceso denegado: El campo montoAT no puede editarse directamente. Solo se autocompleta automáticamente cuando codificador o gestión edita AT Detalle. Finanzas no tiene permisos para editar este campo.',
          error: 'FORBIDDEN',
          rolActual: userRole
        });
      }
    }
    
    console.log(' Permisos verificados correctamente. Procediendo con actualización...');

    // NOTA: Las validaciones de permisos para AT y AT Detalle ya se hicieron arriba en CASO 1
    // Aquí solo logueamos para confirmar que codificador y gestión pueden editar
    const camposSolicitados = Object.keys(requestBody);
    const intentaEditarAT = camposSolicitados.includes('at');
    const intentaEditarATDetalle = camposSolicitados.includes('atDetalle');
    
    if (intentaEditarAT && (isCodificador || isGestion)) {
      console.log(`✅ Confirmado: Usuario ${isCodificador ? 'codificador' : 'gestion'} puede editar campo AT (S/N)`);
    }
    
    if (intentaEditarATDetalle && (isCodificador || isGestion)) {
      console.log(`✅ Confirmado: Usuario ${isCodificador ? 'codificador' : 'gestion'} puede editar campo AT Detalle`);
    }

    // 2. MODIFICACIÓN: "Rescatar" el campo 'validado' (de gestión) ANTES de la validación
    const validadoValue = requestBody.validado;
    // Lo quitamos temporalmente para que los esquemas no lo eliminen con stripUnknown
    delete requestBody.validado; 

    // Validar campos según el rol del usuario
    let validatedValue: any = {};
    if (Object.keys(requestBody).length > 0) {
      let schema;
      let errorMessagePrefix = '';
      
      // Usar normalizedRole para consistencia (ya está normalizado arriba)
      if (isCodificador) {
        // Codificador puede editar 'at', 'atDetalle', y para casos fuera de norma: 'valorGRD' y 'montoFinal'
        schema = codificadorSchema;
        errorMessagePrefix = 'Error de validación (codificador)';
        console.log('✅ Usando esquema de codificador para validación');
      } else if (isGestion) {
        // Gestión puede editar 'at', 'atDetalle', y 'precioBaseTramo'
        schema = gestionSchema;
        errorMessagePrefix = 'Error de validación (gestión)';
        console.log('✅ Usando esquema de gestión para validación');
      } else {
        // Finanzas usa el esquema de finanzas (sin 'at' y 'atDetalle')
        schema = finanzasSchema;
        errorMessagePrefix = 'Error de validación (finanzas)';
        
        // Verificar que Finanzas no intente editar 'at' o 'atDetalle'
        // IMPORTANTE: Finanzas NO puede editar AT ni AT Detalle, solo codificador y gestión
        if ('at' in requestBody || 'atDetalle' in requestBody) {
          console.log('❌ Finanzas intenta editar AT o AT Detalle - DENEGADO');
          return res.status(403).json({
            message: 'Acceso denegado: Solo los roles codificador y gestion pueden editar los campos AT(S/N) y AT Detalle. Finanzas no tiene permisos para editar estos campos.',
            error: 'FORBIDDEN',
            campos: ['at', 'atDetalle'].filter(c => c in requestBody),
            rolActual: userRole
          });
        }
      }
      
      const { error, value } = schema.validate(requestBody, {
        stripUnknown: true,
        abortEarly: false,
        presence: 'optional',
      });
      
      if (error) {
        const errorDetails = error.details.map((d: Joi.ValidationErrorItem) => {
          // Mensajes más descriptivos
          if (d.path[0] === 'estadoRN') {
            return 'Estado inválido. Use: Aprobado, Pendiente o Rechazado';
          }
          if (d.type === 'number.min') {
            return `${d.path[0]} debe ser mayor o igual a 0`;
          }
          return d.message;
        });
        
        return res.status(400).json({
          message: errorDetails[0] || 'Datos inválidos',
          error: 'ValidationError',
          field: error.details[0]?.path[0] || 'unknown',
        });
      }
      
      validatedValue = value || {};
    }

    // 3. MODIFICACIÓN: Re-inyectar 'validado' DESPUÉS de la validación
    if (validadoValue !== undefined) {
      const userRoleUpper = (req.user?.role || '').toUpperCase();

      // Solo FINANZAS puede cambiar el campo "validado"
      if (userRoleUpper !== 'FINANZAS') {
        return res.status(403).json({
          message: 'Solo el rol FINANZAS puede aprobar/rechazar episodios (campo "validado").',
          error: 'FORBIDDEN',
          field: 'validado',
        });
      }

      // Validar tipo del valor
      if (typeof validadoValue === 'boolean' || validadoValue === null) {
        validatedValue.validado = validadoValue;
      } else {
        return res.status(400).json({
          message: 'El campo "validado" debe ser true, false o null.',
          error: 'ValidationError',
          field: 'validado',
        });
      }
    }

    // 4. MODIFICACIÓN: Mover este chequeo DESPUÉS de la re-inyección de 'validado'
    // Si no hay campos para actualizar (ni de finanzas, ni 'validado'), retornar error
    if (Object.keys(validatedValue).length === 0) {
      return res.status(400).json({ 
        message: 'No se proporcionaron campos para actualizar',
        error: 'ValidationError'
      });
    }


    // Mapear campos del frontend a nombres de la base de datos
    const updateData: any = {};
    
    // Mapeo común para campos compartidos (at, atDetalle, precioBaseTramo) - usado por codificador y gestión
    const commonFieldMapping: Record<string, string> = {
      at: 'atSn',
      atDetalle: 'atDetalle', // Agregado para que gestión también pueda mapear atDetalle
      precioBaseTramo: 'precioBaseTramo', // Agregado para que gestión pueda mapear precioBaseTramo
    };
    
    // Determinar qué mapeo usar según el rol
    // Gestión usa el mismo mapeo que codificador para AT y AT Detalle, pero también necesita precioBaseTramo
    const fieldMappingToUse = (isCodificador || isGestion) ? codificadorFieldMapping : finanzasFieldMapping;
    
    for (const [key, value] of Object.entries(validatedValue)) {
      
      // 5. MODIFICACIÓN: Añadir 'validado' al mapeo
      if (key === 'validado') {
        updateData.validado = value; // Se llama igual en la DB
        continue; // Saltar el resto del loop para esta clave
      }

      // Usar mapeo común, mapeo de codificador o mapeo de finanzas según corresponda
      const dbKey = commonFieldMapping[key] || fieldMappingToUse[key] || key;
      
      // Normalizar campos antes de guardar
      if (dbKey === 'atSn') {
        // Normalizar 'at': aceptar boolean o "S"/"N", convertir a boolean para BD
        // IMPORTANTE: Siempre asignar un valor (true o false), nunca dejar undefined
        const atValueStr = String(value || '').trim().toUpperCase();
        if (value === true || atValueStr === 'S' || atValueStr === 'SÍ' || atValueStr === 'SI' || atValueStr === 'YES') {
          updateData.atSn = true;
          console.log(`✅ AT normalizado a true (desde: ${value})`);
        } else {
          // Cualquier otro valor (false, 'N', null, undefined, etc.) se convierte a false
          updateData.atSn = false;
          console.log(`✅ AT normalizado a false (desde: ${value})`);
        }
      } else if (dbKey === 'estadoRn') {
        // Normalizar estadoRN: vacío o inválido → null
        if (value && typeof value === 'string' && ['Aprobado', 'Pendiente', 'Rechazado'].includes(value)) {
          updateData.estadoRn = value;
        } else {
          updateData.estadoRn = null;
        }
      } else if (key.match(/^(montoAT|montoRN|pagoDemora|pagoOutlierSup|precioBaseTramo|montoFinal|diasDemoraRescate)$/i)) {
        // valorGRD NO debe procesarse aquí - se ignora y se calcula después
        // Convertir strings numéricos a números (si es string)
        // Si ya es número, dejarlo como está
        if (typeof value === 'string') {
          const numValue = dbKey === 'diasDemoraRescate' ? parseInt(value, 10) : parseFloat(value);
          if (!isNaN(numValue) && isFinite(numValue)) {
            updateData[dbKey] = dbKey === 'diasDemoraRescate' ? Math.floor(numValue) : numValue;
          } else {
            // Si no se puede convertir, usar null
            updateData[dbKey] = null;
          }
        } else if (typeof value === 'number') {
          // Si ya es número, asegurar que sea entero para diasDemoraRescate
          updateData[dbKey] = dbKey === 'diasDemoraRescate' ? Math.floor(value) : value;
        } else {
          updateData[dbKey] = value;
        }
      } else if (dbKey === 'documentacion') {
        // documentacion: puede ser string o null, se procesará más adelante
        updateData[dbKey] = value;
      } else {
        updateData[dbKey] = value;
      }
    }


    // Validaciones de reglas de negocio
    // Si at === false (o 'N'), atDetalle debe ser null y montoAT debe ser 0
    // IMPORTANTE: Cuando at = 'N', siempre limpiar atDetalle y montoAT, incluso si vienen en el payload
    if (updateData.atSn === false) {
      updateData.atDetalle = null;
      updateData.montoAt = 0;
      console.log('🧹 Limpiando atDetalle y montoAT porque AT = N');
    }

    // Validación y autocompletado de montoAT cuando se actualiza atDetalle
    // IMPORTANTE: El frontend NO envía montoAT cuando guarda atDetalle - solo envía atDetalle
    // El backend DEBE autocompletar montoAT automáticamente consultando ajustes_tecnologia
    let ajusteTecnologiaEncontrado: any = null;
    
    if (updateData.atDetalle !== undefined) {
      const atDetalle = updateData.atDetalle;
      
      if (atDetalle && typeof atDetalle === 'string' && atDetalle.trim() !== '') {
        // Buscar el ajuste de tecnología correspondiente (una sola búsqueda)
        ajusteTecnologiaEncontrado = await prisma.ajusteTecnologia.findFirst({
          where: {
            at: atDetalle.trim(),
          },
        });

        // Validación: verificar que atDetalle exista en ajustes_tecnologia.at
        if (!ajusteTecnologiaEncontrado) {
          return res.status(400).json({
            error: 'ValidationError',
            message: `El valor de atDetalle "${atDetalle}" no existe en la tabla de ajustes de tecnología`,
          });
        }
        
        // Autocompletar montoAT automáticamente si se encontró el ajuste y tiene monto válido
        if (ajusteTecnologiaEncontrado.monto !== null && ajusteTecnologiaEncontrado.monto !== undefined) {
          // SIEMPRE autocompletar montoAT (el frontend no lo envía cuando guarda atDetalle)
          updateData.montoAt = ajusteTecnologiaEncontrado.monto;
          console.log(`💰 Autocompletado montoAT: ${ajusteTecnologiaEncontrado.monto} para atDetalle: "${atDetalle}"`);
        } else {
          // Si el ajuste existe pero el monto es null/undefined, establecer montoAT a 0
          updateData.montoAt = 0;
          console.warn(`⚠️ Ajuste encontrado pero monto es null para atDetalle: "${atDetalle}". Estableciendo montoAT a 0.`);
        }
      } else {
        // Si atDetalle es null o vacío, establecer montoAT a 0
        updateData.montoAt = 0;
        console.log(`🧹 atDetalle es null/vacío. Estableciendo montoAT a 0.`);
      }
    }

    // Manejar documentacion: Prisma espera Json (objeto/array), no string
    // Si el frontend envía un string, intentar parsearlo como JSON
    if (updateData.documentacion !== undefined && updateData.documentacion !== null) {
      if (typeof updateData.documentacion === 'string') {
        // Si es string vacío, convertir a null
        if (updateData.documentacion.trim() === '') {
          updateData.documentacion = null;
        } else {
          // Intentar parsear el string como JSON
          try {
            updateData.documentacion = JSON.parse(updateData.documentacion);
          } catch {
            // Si no es JSON válido, guardarlo como objeto con el texto
            updateData.documentacion = { texto: updateData.documentacion };
          }
        }
      }
      // Si ya es objeto/array, dejarlo así
    }

    // Buscar episodio de forma flexible: primero por episodioCmdb, luego por id interno
    // El frontend puede enviar el campo "episodio" (episodioCmdb) como string numérico
    const idNum = parseInt(id);
    let episodio;

    // 6. MODIFICACIÓN: Priorizar la búsqueda por 'id' numérico, ya que el frontend
    // debería estar enviando el 'id' de la DB (ej. 123) y no el 'episodioCmdb' (ej. EP001)
    if (!isNaN(idNum)) {
      episodio = await prisma.episodio.findUnique({
        where: { id: idNum },
        include: {
          paciente: true,
          grd: {
            select: {
              id: true,
              codigo: true,
              descripcion: true,
              peso: true,
              puntoCorteInf: true,
              puntoCorteSup: true,
            },
          },
          diagnosticos: true,
          respaldos: true,
        },
      });
    }

    // Si no se encuentra por id interno (como fallback), intentar por episodioCmdb
    if (!episodio) {
      episodio = await prisma.episodio.findFirst({
        where: { episodioCmdb: id },
        include: {
          paciente: true,
          grd: {
            select: {
              id: true,
              codigo: true,
              descripcion: true,
              peso: true,
              puntoCorteInf: true,
              puntoCorteSup: true,
            },
          },
          diagnosticos: true,
          respaldos: true,
        },
      });
    }


    if (!episodio) {
      // Log para debugging
      console.log(`🔍 PATCH /api/episodios/${id}: Episodio no encontrado`);
      console.log(`   - Buscado por id interno: ${idNum}`);
      console.log(`   - Buscado por episodioCmdb: "${id}"`);
      
      return res.status(404).json({
        message: `El episodio ${id} no fue encontrado`,
        error: 'NotFound'
      });
    }

    // Log para debugging (solo en desarrollo)
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ PATCH /api/episodios/${id}: Episodio encontrado`);
      console.log(`   - ID interno: ${episodio.id}`);
      console.log(`   - episodioCmdb: ${episodio.episodioCmdb}`);
    }

    // Obtener valores actuales del episodio
    const pesoActual = episodio.pesoGrd ? Number(episodio.pesoGrd) : null;
    const precioBaseTramoActual = episodio.precioBaseTramo ? Number(episodio.precioBaseTramo) : null;
    const convenioActual = episodio.convenio;
    const montoATActual = episodio.montoAt ? Number(episodio.montoAt) : 0;
    const pagoOutlierSupActual = episodio.pagoOutlierSuperior ? Number(episodio.pagoOutlierSuperior) : 0;
    const pagoDemoraActual = episodio.pagoDemoraRescate ? Number(episodio.pagoDemoraRescate) : 0;
        // Caso fuera de norma (override manual permitido)
    const esFueraDeNorma = episodio.grupoEnNorma === false;

    // Determinar valores finales (nuevos o actuales)
    // NOTA: pesoGrd NO es editable por finanzas, siempre usar el valor actual
    const peso = pesoActual;
    const convenio = updateData.convenio !== undefined ? updateData.convenio : convenioActual;
    
    // RECALCULAR precioBaseTramo automáticamente si:
    // 1. Cambió el peso (puede cambiar el tramo para FNS012/FNS026)
    // 2. Cambió el convenio
    // 3. precioBaseTramo es null y hay convenio
    // IMPORTANTE: Si viene precioBaseTramo en el request y NO hay cambios de peso/convenio, 
    // se guarda el valor editado manualmente (para finanzas y gestión)
    const pesoCambio = updateData.pesoGrd !== undefined && updateData.pesoGrd !== pesoActual;
    const convenioCambio = updateData.convenio !== undefined && updateData.convenio !== convenioActual;
    const precioBaseTramoEditado = updateData.precioBaseTramo !== undefined;
    const necesitaRecalculo = pesoCambio || convenioCambio || (!precioBaseTramoActual && convenio && !precioBaseTramoEditado);
    
    let precioBaseTramo: number | null = precioBaseTramoActual;
    if (necesitaRecalculo && convenio) {
      // Recalcular automáticamente solo si cambió peso/convenio o si no hay valor
      const pesoParaCalculo = pesoCambio && updateData.pesoGrd !== undefined 
        ? Number(updateData.pesoGrd) 
        : peso;
      precioBaseTramo = await obtenerPrecioBaseTramo(convenio, pesoParaCalculo);
      if (precioBaseTramo !== null) {
        updateData.precioBaseTramo = precioBaseTramo;
        if (process.env.NODE_ENV === 'development') {
          console.log(`💰 Precio base recalculado automáticamente para episodio ${episodio.id}: ${precioBaseTramo} (convenio: ${convenio}, peso: ${pesoParaCalculo})`);
        }
      }
    } else if (precioBaseTramoEditado && !necesitaRecalculo) {
      // Si viene precioBaseTramo en el request y NO necesita recálculo, guardar el valor editado manualmente
      // Esto permite a finanzas y gestión editar manualmente el precio base
      const precioEditado = typeof updateData.precioBaseTramo === 'number' 
        ? updateData.precioBaseTramo 
        : parseFloat(String(updateData.precioBaseTramo));
      if (!isNaN(precioEditado) && isFinite(precioEditado) && precioEditado >= 0) {
        precioBaseTramo = precioEditado;
        updateData.precioBaseTramo = precioEditado;
        if (process.env.NODE_ENV === 'development') {
          console.log(`✅ Precio base editado manualmente para episodio ${episodio.id}: ${precioEditado} (guardado sin recalcular)`);
        }
      } else {
        // Si el valor no es válido, eliminar del updateData y mantener el actual
        delete updateData.precioBaseTramo;
        console.warn(`⚠️ precioBaseTramo enviado no es válido, manteniendo valor actual`);
      }
    }
    
    // Usar el precio calculado para los cálculos siguientes
    // Asegurar que precioBaseTramo sea un número válido (no null) para los cálculos
    const precioBaseTramoParaCalculo: number = (precioBaseTramo !== null && !isNaN(precioBaseTramo) && precioBaseTramo >= 0) 
      ? precioBaseTramo 
      : 0;
    const montoAT = updateData.montoAt !== undefined ? (updateData.montoAt ?? 0) : montoATActual;
    const pagoOutlierSup = updateData.pagoOutlierSuperior !== undefined ? (updateData.pagoOutlierSuperior ?? 0) : pagoOutlierSupActual;
    const pagoDemora = updateData.pagoDemoraRescate !== undefined ? (updateData.pagoDemoraRescate ?? 0) : pagoDemoraActual;

    // ¿Hay overrides manuales?
    const tieneOverrideValorGRD = esFueraDeNorma && updateData.valorGrd !== undefined && updateData.valorGrd !== null;
    const tieneOverrideMontoFinal = esFueraDeNorma && updateData.montoFinal !== undefined && updateData.montoFinal !== null;

    // PASO 1: valorGRD
    let valorGRDFinal: number;
    if (tieneOverrideValorGRD) {
      // Si FINANZAS manda valorGRD en caso fuera de norma, lo respetamos
      const v = typeof updateData.valorGrd === 'string'
        ? parseFloat(updateData.valorGrd)
        : Number(updateData.valorGrd);
      valorGRDFinal = !isNaN(v) && isFinite(v) ? v : 0;
    } else {
      // Caso normal: lo calculamos
      valorGRDFinal = calcularValorGRD(peso ?? 0, precioBaseTramoParaCalculo);
    }
    updateData.valorGrd = valorGRDFinal;

    // PASO 2: Calcular pagoDemoraRescate AUTOMÁTICAMENTE (siempre, incluso si diasDemoraRescate no cambió)
    // Usar el valor más nuevo disponible
    const diasParaCalculo = updateData.diasDemoraRescate !== undefined
      ? Number(updateData.diasDemoraRescate ?? 0)
      : (episodio.diasDemoraRescate ? Number(episodio.diasDemoraRescate) : 0);

    const pagoDemoraCalculado = await calcularPagoDemoraRescate({
      convenio,
      diasDemora: diasParaCalculo,
      pagoDemoraInput: pagoDemora,
      pesoGrd: peso,
      precioBaseTramo: precioBaseTramoParaCalculo,
      grdId: episodio.grdId ?? null,
      fechaIngreso: episodio.fechaIngreso
    });

    // IMPORTANTE: SIEMPRE actualizar pagoDemoraRescate, incluso si no cambió
    updateData.pagoDemoraRescate = pagoDemoraCalculado;
    console.log(`💰 Pago demora SIEMPRE recalculado: ${pagoDemoraCalculado} (convenio: ${convenio}, días: ${diasParaCalculo})`);

    // PASO 2.6: Recalcular inlierOutlier y diasEstada automáticamente SIEMPRE ANTES de calcular pago outlier
    // Esto asegura que el campo se actualice en la base de datos y que tengamos el valor correcto para calcular pago outlier
    const fechaIngreso = episodio.fechaIngreso;
    const fechaAlta = episodio.fechaAlta;
    const diasEstada = calcularDiasEstada(fechaIngreso, fechaAlta);
    
    let inlierOutlierCalculado: string | null = null;
    // Calcular inlier/outlier basándose en días de estadía vs punto corte del GRD
    if (episodio.grd) {
      const puntoCorteInf = episodio.grd.puntoCorteInf ? Number(episodio.grd.puntoCorteInf) : null;
      const puntoCorteSup = episodio.grd.puntoCorteSup ? Number(episodio.grd.puntoCorteSup) : null;
      inlierOutlierCalculado = calcularInlierOutlier(diasEstada, puntoCorteInf, puntoCorteSup);
      
      if (inlierOutlierCalculado !== null) {
        updateData.inlierOutlier = inlierOutlierCalculado;
        updateData.diasEstada = diasEstada;
        console.log(`✅ Inlier/Outlier recalculado y actualizado en BD: ${inlierOutlierCalculado} (días: ${diasEstada}, puntoInf: ${puntoCorteInf}, puntoSup: ${puntoCorteSup})`);
      }
    }

    // PASO 2.5: Calcular pagoOutlierSuperior AUTOMÁTICAMENTE (SOLO FNS012, SIEMPRE)
    // IMPORTANTE: Usar el inlierOutlier calculado arriba para determinar si es outlier superior
    const esOutlierSuperior = inlierOutlierCalculado === 'Outlier Superior';
    const pagoOutlierCalculado = await calcularPagoOutlierSuperior({
      convenio,
      diasEstada: diasEstada ?? episodio.diasEstada ?? null,
      pesoGrd: peso,
      precioBase: precioBaseTramoParaCalculo,
      grdId: episodio.grdId ?? null,
      inlierOutlier: inlierOutlierCalculado
    });

    // IMPORTANTE: SIEMPRE actualizar pagoOutlierSuperior (solo FNS012 si está fuera de norma)
    // Si no es FNS012 o no está fuera de norma, será 0 (correcto)
    updateData.pagoOutlierSuperior = pagoOutlierCalculado;
    console.log(`💰 Pago outlier SIEMPRE recalculado: ${pagoOutlierCalculado} (convenio: ${convenio}, FNS012: ${convenio === 'FNS012'}, outlier superior: ${esOutlierSuperior}, inlierOutlier: ${inlierOutlierCalculado})`);

    // PASO 3: montoFinal (SIEMPRE recalcular)
    const pagoDemoraParaMonto = updateData.pagoDemoraRescate ?? 0;
    const pagoOutlierParaMonto = updateData.pagoOutlierSuperior ?? 0;

    let montoFinalFinal: number;
    if (tieneOverrideMontoFinal) {
      const m = typeof updateData.montoFinal === 'string'
        ? parseFloat(updateData.montoFinal)
        : Number(updateData.montoFinal);
      montoFinalFinal = !isNaN(m) && isFinite(m) ? m : 0;
      console.log(`⚠️ Override manual de montoFinal: ${montoFinalFinal}`);
    } else {
      montoFinalFinal = calcularMontoFinal(
        valorGRDFinal,
        montoAT,
        pagoOutlierParaMonto,
        pagoDemoraParaMonto
      );
      console.log(`✅ montoFinal SIEMPRE recalculado: ${montoFinalFinal}`);
    }
    updateData.montoFinal = montoFinalFinal;

    // Actualizar el episodio
    const updated = await prisma.episodio.update({
      where: { id: episodio.id },
      data: updateData,
      include: {
        paciente: true,
        grd: true,
        diagnosticos: true,
        respaldos: true,
      },
    });

    // Normalizar y formatear respuesta según especificaciones
    const response = normalizeEpisodeResponse(updated);

    res.json(response);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        message: `El episodio ${req.params.id} no fue encontrado`,
        error: 'NotFound'
      });
    }
    console.error('Error al actualizar episodio:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      message: 'Error del servidor. Por favor, intenta nuevamente más tarde.',
      error: 'InternalServerError'
    });
  }
});

// Helper functions para procesamiento de archivos
type RawRow = Record<string, string>;

function isEmpty(value?: any): boolean {
  if (value === undefined || value === null) return true;
  const v = typeof value === 'string' ? value.trim() : String(value).trim();
  return v === '' || v.toLowerCase() === 'null';
}

function isNumeric(value?: any): boolean {
  if (value === undefined || value === null) return false;
  return !isNaN(Number(value));
}

function isValidDate(value?: any): boolean {
  if (value === undefined || value === null) return false;
  const d = value instanceof Date ? value : new Date(value);
  return !isNaN(d.getTime());
}

function cleanString(value?: any): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value);
  const out = s.replace(/\s+/g, ' ').trim();
  return out === '' ? null : out;
}

// Helper para buscar columna "Convenio" de manera flexible
// Prioriza "Convenios (cod)" sobre "Convenios (des)" cuando hay múltiples columnas
function findConvenioValue(row: RawRow): string | null {
  // PRIMERA PRIORIDAD: Buscar específicamente columnas con "(cod)" que tengan valor
  // Esto asegura que encontremos "Convenios (cod)" antes que "Convenios (des)"
  const todasLasKeys = Object.keys(row);
  
  // Log para debug: mostrar todas las columnas relacionadas con convenio
  const columnasConvenio = todasLasKeys.filter(k => {
    const normalized = k.toLowerCase().trim();
    return normalized.includes('convenio');
  });
  
  if (columnasConvenio.length > 0) {
    console.log(`🔍 Columnas relacionadas con Convenio encontradas:`, columnasConvenio);
    columnasConvenio.forEach(k => {
      const valor = row[k];
      console.log(`   "${k}" = "${valor}" (tipo: ${typeof valor}, limpio: "${cleanString(valor)}")`);
    });
  }
  
  // Buscar primero columnas que contengan "(cod)" y tengan valor
  // Normalizar espacios múltiples y comparar de manera flexible
  for (const key of todasLasKeys) {
    if (key) {
      // Normalizar: convertir a minúsculas, quitar espacios al inicio/fin, y normalizar espacios múltiples
      const normalized = key.toLowerCase().trim().replace(/\s+/g, ' ');
      // Priorizar columnas que contengan "(cod)" o " cod" (con o sin paréntesis)
      if (normalized.includes('convenio') && (normalized.includes('(cod)') || normalized.includes(' cod'))) {
        const rawValue = row[key];
        if (rawValue !== undefined && rawValue !== null) {
          const value = cleanString(rawValue);
          if (value) {
            console.log(`✅ Encontrado Convenio (prioridad cod) en columna "${key}": "${value}"`);
            return value;
          } else if (rawValue === '' || (typeof rawValue === 'string' && rawValue.trim() === '')) {
            // Si el valor es cadena vacía explícita, retornar cadena vacía (no null)
            console.log(`✅ Encontrado Convenio (prioridad cod, vacío) en columna "${key}": ""`);
            return '';
          } else {
            console.log(`⚠️ Columna "${key}" encontrada pero sin valor (valor raw: "${row[key]}")`);
          }
        }
      }
    }
  }
  
  // SEGUNDA PRIORIDAD: Buscar por nombres exactos que contengan "(cod)"
  // Incluir variaciones con diferentes números de espacios
  const nombresExactosConCod = [
    'Convenios (cod)',
    'Convenios  (cod)', // Con dos espacios
    'Convenios   (cod)', // Con tres espacios
    'Convenios(cod)',
    'CONVENIOS (COD)',
    'convenios (cod)',
    'Convenio (cod)',
    'Convenio(cod)',
  ];
  
  for (const nombreExacto of nombresExactosConCod) {
    if (nombreExacto in row) {
      const value = cleanString(row[nombreExacto]);
      if (value) {
        console.log(`✅ Encontrado Convenio (exacto con cod) en columna "${nombreExacto}": "${value}"`);
        return value;
      }
    }
  }
  
  // Buscar también con normalización de espacios (por si hay más de 3 espacios)
  for (const key of todasLasKeys) {
    if (key) {
      const normalized = key.toLowerCase().trim().replace(/\s+/g, ' ');
      // Buscar coincidencia exacta después de normalizar
      if (normalized === 'convenios (cod)' || normalized === 'convenio (cod)') {
        const value = cleanString(row[key]);
        if (value) {
          console.log(`✅ Encontrado Convenio (normalizado) en columna "${key}": "${value}"`);
          return value;
        }
      }
    }
  }
  
  // TERCERA PRIORIDAD: Buscar otras variaciones de convenio (sin "(cod)" específico)
  // Incluir búsqueda case-insensitive y con diferentes espacios
  for (const key of todasLasKeys) {
    if (key) {
      const normalized = key.toLowerCase().trim().replace(/\s+/g, ' ');
      if (normalized.includes('convenio') && !normalized.includes('(des)') && !normalized.includes(' des')) {
        // Aceptar valores incluso si están vacíos (pero no null/undefined)
        const rawValue = row[key];
        if (rawValue !== undefined && rawValue !== null) {
          const value = cleanString(rawValue);
          // Si hay valor, retornarlo; si está vacío pero la columna existe, retornar cadena vacía
          if (value) {
            console.log(`✅ Encontrado Convenio (flexible) en columna "${key}": "${value}"`);
            return value;
          } else if (rawValue === '' || (typeof rawValue === 'string' && rawValue.trim() === '')) {
            // Si el valor es cadena vacía explícita, retornar cadena vacía (no null)
            console.log(`✅ Encontrado Convenio (flexible, vacío) en columna "${key}": ""`);
            return '';
          }
        }
      }
    }
  }
  
  // CUARTA PRIORIDAD: Buscar nombres exactos sin "(cod)"
  const nombresExactosSinCod = [
    'Convenio',
    'Convenios',
    'CONVENIO',
    'CONVENIOS'
  ];
  
  for (const nombreExacto of nombresExactosSinCod) {
    if (nombreExacto in row) {
      const value = cleanString(row[nombreExacto]);
      if (value) {
        console.log(`✅ Encontrado Convenio (exacto sin cod) en columna "${nombreExacto}": "${value}"`);
        return value;
      }
    }
  }
  
  // Log solo si realmente no se encontró nada
  if (todasLasKeys.length > 0) {
    const columnasConvenio = todasLasKeys.filter(k => k.toLowerCase().includes('convenio'));
    if (columnasConvenio.length > 0) {
      console.log(`⚠️ No se encontró columna Convenio con valor. Columnas relacionadas encontradas: ${columnasConvenio.join(', ')}`);
      columnasConvenio.forEach(col => {
        console.log(`   "${col}" = "${row[col]}" (vacío: ${!cleanString(row[col])})`);
      });
    } else {
      console.log(`⚠️ No se encontró columna Convenio. Columnas disponibles: ${todasLasKeys.slice(0, 15).join(', ')}...`);
    }
  }
  return null;
}

// Helper para buscar columna "Peso GRD Medio (Todos)" - SOLO esta columna exacta
function findPesoGRDMedioTodos(row: RawRow): number | null {
  const todasLasKeys = Object.keys(row);
  const episodioCmdb = cleanString(row['Episodio CMBD']);
  
  console.log(`🔍 [findPesoGRDMedioTodos] Buscando EXACTAMENTE "Peso GRD Medio (Todos)" para episodio: ${episodioCmdb}`);
  
  // PRIMERO: Buscar nombre exacto (case-sensitive primero)
  if ('Peso GRD Medio (Todos)' in row) {
    const value = row['Peso GRD Medio (Todos)'];
    console.log(`   ✅ ENCONTRADO (exacto case-sensitive): "Peso GRD Medio (Todos)" = "${value}"`);
    if (isNumeric(value)) {
      const numValue = parseFloat(String(value));
      if (!isNaN(numValue) && isFinite(numValue)) {
        console.log(`   ✅ VALOR: ${numValue}`);
        return numValue;
      }
    }
  }
  
  // SEGUNDO: Buscar con normalización estricta (solo variaciones de espacios y case)
  for (const key of todasLasKeys) {
    if (key) {
      // Normalizar: quitar espacios extra, pero mantener la estructura
      const normalized = key.trim().replace(/\s+/g, ' ');
      // Comparar normalizado (case-insensitive) pero estructura exacta
      const targetNormalized = 'Peso GRD Medio (Todos)'.trim().replace(/\s+/g, ' ');
      
      if (normalized.toLowerCase() === targetNormalized.toLowerCase()) {
        const value = row[key];
        console.log(`   ✅ ENCONTRADO (normalizado): "${key}" = "${value}"`);
        if (isNumeric(value)) {
          const numValue = parseFloat(String(value));
          if (!isNaN(numValue) && isFinite(numValue)) {
            console.log(`   ✅ VALOR: ${numValue}`);
            return numValue;
          }
        }
      }
    }
  }
  
  // Mostrar TODAS las columnas que contienen "peso" o "grd" para debugging
  const columnasPeso = todasLasKeys.filter(k => {
    const normalized = k.toLowerCase().trim();
    return normalized.includes('peso') || normalized.includes('grd');
  });
  
  console.log(`   ❌ NO se encontró "Peso GRD Medio (Todos)". Columnas relacionadas (${columnasPeso.length}):`);
  columnasPeso.forEach(col => {
    const valor = row[col];
    console.log(`      "${col}" = "${valor}" (numérico: ${isNumeric(valor)})`);
  });
  
  return null;
}

// ===================================================================
// =================== ¡MODIFICACIÓN 1: validateRow! ===================
// ===================================================================
// Se elimina la validación de GRD. Solo validamos duplicados de Episodio y campos requeridos.
async function validateRow(row: RawRow, index: number): Promise<boolean> {
  const requiredFields = ['Episodio CMBD', 'Hospital (Descripción)', 'RUT', 'IR GRD (Código)'];
  const missing = requiredFields.filter((f) => isEmpty(row[f]));
  
  if (missing.length > 0) {
    console.log(`Fila ${index} rechazada: Campos faltantes: ${missing.join(', ')}`);
    return false;
  }

  // Validación de duplicados - convertir a string para asegurar compatibilidad con Prisma
  const episodioCmdb = cleanString(row['Episodio CMBD']);
  if (episodioCmdb) {
    const existing = await prisma.episodio.findFirst({
      where: { episodioCmdb: episodioCmdb },
    });
    if (existing) {
      console.log(`Fila ${index} rechazada: Duplicado de Episodio CMBD ${episodioCmdb}`);
      return false;
    }
  } else {
    console.log(`Fila ${index} rechazada: Episodio CMBD está vacío`);
    return false;
  }
  
  // Validar que el GRD no esté vacío (pero no que exista, eso lo hace processRow)
  const grdCode = cleanString(row['IR GRD (Código)']);
  if (!grdCode) {
    console.log(`Fila ${index} rechazada: IR GRD (Código) está vacío`);
    return false;
  }

  if (!isValidDate(row['Fecha Ingreso completa']) || !isValidDate(row['Fecha Completa'])) {
    console.log(`Fila ${index} rechazada: Fecha inválida`);
    return false;
  }

  return true;
}

// ===================================================================
// ================== ¡MODIFICACIÓN 2: processRow! ===================
// ===================================================================
// Se usa prisma.grd.upsert() para crear el GRD si no existe.
async function processRow(row: RawRow, rowIndex?: number) {
  // Log muy visible para confirmar que el código se ejecuta
  console.log('========================================');
  console.log(`🔄 PROCESANDO FILA ${rowIndex || '?'} - Episodio: ${row['Episodio CMBD']}`);
  console.log('========================================');
  
  const rut = cleanString(row['RUT']);
  const nombre = cleanString(row['Nombre']);
  const grdCode = cleanString(row['IR GRD (Código)'])!;

  // 1. Crea o actualiza el Paciente (Upsert)
  const paciente = await prisma.paciente.upsert({
    where: { rut: rut || 'SIN-RUT' },
    update: {
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']) || cleanString(row['Sexo (Desc)']), // Cuidado con dobles espacios
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
    create: {
      rut: rut || 'SIN-RUT',
      nombre,
      sexo: cleanString(row['Sexo  (Desc)']) || cleanString(row['Sexo (Desc)']),
      edad: isNumeric(row['Edad en años']) ? Number(row['Edad en años']) : null,
    },
  });

  // 2. ¡NUEVO! Crea o actualiza el GRD (Upsert)
  const grdRule = await prisma.grd.upsert({
    where: { codigo: grdCode },
    // Si ya existe, actualiza sus datos con los de esta fila
    update: {
      // Usamos el nombre de columna que vimos en la imagen/frontend
      peso: isNumeric(row['Peso Medio [Norma IR]'])
        ? parseFloat(row['Peso Medio [Norma IR]'])
        : undefined,
      // Aquí puedes agregar más campos si los tienes, ej:
      // precioBaseTramo: isNumeric(row['Precio Base']) ? parseFloat(row['Precio Base']) : undefined,
    },
    // Si no existe, créalo
    create: {
      codigo: grdCode,
      // Usamos el motivo de egreso como descripción, o un placeholder
      descripcion: cleanString(row['Motivo Egreso (Descripción)']) || `GRD ${grdCode}`,
      peso: isNumeric(row['Peso Medio [Norma IR]'])
        ? parseFloat(row['Peso Medio [Norma IR]'])
        : undefined,
    },
  });

  // 3. Crea el Episodio, ahora SÍ podemos vincular el grdId
  // Buscar columna "Convenio" de manera flexible
  // Log detallado ANTES de buscar para ver qué columnas tiene el row
  const todasLasKeys = Object.keys(row);
  const keysConvenio = todasLasKeys.filter(k => k.toLowerCase().includes('convenio'));
  if (keysConvenio.length > 0) {
    console.log(`🔍 Buscando Convenio para episodio ${cleanString(row['Episodio CMBD'])}:`);
    keysConvenio.forEach(k => {
      const valor = row[k];
      console.log(`   Columna: "${k}" = "${valor}" (tipo: ${typeof valor}, vacío: ${!cleanString(valor)})`);
    });
  }
  
  const convenioValue = findConvenioValue(row);
  if (convenioValue) {
    console.log(`💾 ✅ Guardando Convenio para episodio ${cleanString(row['Episodio CMBD'])}: "${convenioValue}"`);
  } else {
    // Log detallado si no se encuentra
    console.log(`⚠️ ❌ No se encontró Convenio para episodio ${cleanString(row['Episodio CMBD'])} - se guardará como cadena vacía`);
    if (keysConvenio.length > 0) {
      console.log(`   Columnas relacionadas encontradas pero sin valor:`, keysConvenio);
      keysConvenio.forEach(k => {
        console.log(`     "${k}" = "${row[k]}" (raw: ${JSON.stringify(row[k])})`);
      });
    } else {
      console.log(`   No se encontraron columnas relacionadas con "convenio" en el row`);
      console.log(`   Primeras 20 columnas del row:`, todasLasKeys.slice(0, 20));
    }
  }

  // Preparar el valor de convenio - SIEMPRE debe ser string (nunca null)
  // Si convenioValue es null, usar cadena vacía; si es cadena vacía, mantenerla; si tiene valor, limpiarlo
  let convenioFinal = '';
  if (convenioValue !== null && convenioValue !== undefined) {
    if (typeof convenioValue === 'string' && convenioValue.trim() === '') {
      convenioFinal = ''; // Mantener cadena vacía explícita
    } else {
      const cleaned = cleanString(convenioValue);
      convenioFinal = cleaned || ''; // Si cleanString devuelve null, usar cadena vacía
    }
  }
  console.log(`🔧 Convenio final preparado: "${convenioFinal}" (tipo: ${typeof convenioFinal}, original: "${convenioValue}")`);

  // Construir el objeto de datos - convenio se trata igual que cualquier otro campo
  const episodioData: any = {
    centro: cleanString(row['Hospital (Descripción)']),
    numeroFolio: cleanString(row['ID Derivación']),
    episodioCmdb: cleanString(row['Episodio CMBD']),
    tipoEpisodio: cleanString(row['Tipo Actividad']) || '',
    fechaIngreso: new Date(row['Fecha Ingreso completa']),
    fechaAlta: new Date(row['Fecha Completa']),
    servicioAlta: cleanString(row['Servicio Egreso (Descripción)']) || '',
    montoRn: isNumeric(row['Facturación Total del episodio'])
      ? parseFloat(row['Facturación Total del episodio'])
      : 0,
    // Mapear pesoGrd SOLO desde "Peso GRD Medio (Todos)" - sin validaciones, sin fallbacks
    pesoGrd: (() => {
      const episodioCmdb = cleanString(row['Episodio CMBD']);
      
      // PRIMERO: Intentar nombre exacto
      if ('Peso GRD Medio (Todos)' in row) {
        const value = row['Peso GRD Medio (Todos)'];
        console.log(`📊 [MAPEO pesoGrd] Episodio ${episodioCmdb}: Columna exacta "Peso GRD Medio (Todos)" = "${value}"`);
        if (isNumeric(value)) {
          const numValue = parseFloat(String(value));
          if (!isNaN(numValue) && isFinite(numValue)) {
            console.log(`   ✅ Usando valor: ${numValue}`);
            return numValue;
          }
        }
      }
      
      // SEGUNDO: Búsqueda flexible
      console.log(`📊 [MAPEO pesoGrd] Episodio ${episodioCmdb}: No se encontró nombre exacto, buscando flexible...`);
      const pesoGRD = findPesoGRDMedioTodos(row);
      
      if (pesoGRD !== null) {
        console.log(`   ✅ Valor encontrado (flexible): ${pesoGRD}`);
        return pesoGRD;
      }
      
      console.log(`   ❌ NO se encontró "Peso GRD Medio (Todos)" para episodio ${episodioCmdb}. Retornando null.`);
      return null;
    })(),
    // inlierOutlier se calculará automáticamente después, NO usar el valor del archivo maestro
    diasEstada: (() => {
      // Calcular días de estadía desde las fechas del archivo maestro
      const fechaIngreso = new Date(row['Fecha Ingreso completa']);
      const fechaAlta = new Date(row['Fecha Completa']);
      const diasEstada = Math.round((fechaAlta.getTime() - fechaIngreso.getTime()) / 86400000);
      return diasEstada >= 0 ? diasEstada : null;
    })(),
    // Convenio es un campo requerido - SIEMPRE debe ser string (nunca null)
    // Misma lógica que tipoEpisodio: siempre string, cadena vacía si no hay valor
    convenio: convenioFinal,
    // Vinculamos las entidades
    pacienteId: paciente.id,
    grdId: grdRule.id,
  };

  // ===========================
  // Calcular precioBaseTramo
  // ===========================
  let precioBaseTramoCalculado: number | null = null;
  const pesoParaCalculo =
    episodioData.pesoGrd !== undefined && episodioData.pesoGrd !== null
      ? Number(episodioData.pesoGrd)
      : null;

  if (convenioFinal && pesoParaCalculo !== null) {
    try {
      precioBaseTramoCalculado = await obtenerPrecioBaseTramo(convenioFinal, pesoParaCalculo);
      if (precioBaseTramoCalculado !== null) {
        episodioData.precioBaseTramo = precioBaseTramoCalculado;
        console.log(
          `💰 Precio base calculado para episodio ${episodioData.episodioCmdb}: ${precioBaseTramoCalculado} (convenio: ${convenioFinal}, peso: ${pesoParaCalculo})`
        );
      } else {
        console.warn(
          `⚠️ No se pudo calcular precio base para episodio ${episodioData.episodioCmdb} (convenio: ${convenioFinal}, peso: ${pesoParaCalculo})`
        );
      }
    } catch (err) {
      console.error(
        `❌ Error calculando precioBaseTramo para episodio ${episodioData.episodioCmdb}:`,
        (err as any)?.message || err
      );
    }
  }

  // Log detallado para debug
  console.log(`💾 Datos del episodio antes de crear:`, {
    episodioCmdb: episodioData.episodioCmdb,
    convenio: episodioData.convenio,
    convenioValue: convenioValue,
    tipoConvenio: typeof episodioData.convenio,
    tieneConvenio: 'convenio' in episodioData,
    todasLasKeys: Object.keys(episodioData),
    // Verificar que convenio esté presente y sea string
    convenioEnData: episodioData.convenio,
    convenioEsString: typeof episodioData.convenio === 'string',
    convenioLength: episodioData.convenio?.length,
    precioBaseTramo: episodioData.precioBaseTramo ?? null,
  });

  // Verificar explícitamente que convenio esté en el objeto antes de crear
  if (!('convenio' in episodioData)) {
    console.error(`❌ ERROR: convenio NO está en episodioData antes de crear!`);
    episodioData.convenio = ''; // Forzar que esté presente
  }
  if (typeof episodioData.convenio !== 'string') {
    console.error(`❌ ERROR: convenio no es string, es ${typeof episodioData.convenio}. Convirtiendo...`);
    episodioData.convenio = String(episodioData.convenio || '');
  }

  // Calcular inlier/outlier automáticamente ANTES de crear el episodio
  // NO usar el valor del archivo maestro, calcularlo basándose en días de estadía vs punto corte del GRD
  let inlierOutlierCalculado: string | null = null;
  const diasEstadaCalculados = episodioData.diasEstada;
  
  if (grdRule && diasEstadaCalculados !== null && diasEstadaCalculados !== undefined) {
    const puntoCorteInf = grdRule.puntoCorteInf ? Number(grdRule.puntoCorteInf) : null;
    const puntoCorteSup = grdRule.puntoCorteSup ? Number(grdRule.puntoCorteSup) : null;
    
    inlierOutlierCalculado = calcularInlierOutlier(diasEstadaCalculados, puntoCorteInf, puntoCorteSup);
    
    console.log(`📊 Inlier/Outlier calculado automáticamente: ${inlierOutlierCalculado} (días: ${diasEstadaCalculados}, puntoInf: ${puntoCorteInf}, puntoSup: ${puntoCorteSup})`);
  }
  
  // Agregar inlierOutlier calculado al objeto de datos
  if (inlierOutlierCalculado !== null) {
    episodioData.inlierOutlier = inlierOutlierCalculado;
  }

  const episodioCreado = await prisma.episodio.create({
    data: episodioData,
    include: {
      paciente: true,
      grd: true,
    },
  });
  
  // Log detallado del episodio creado
  console.log(`📦 Episodio creado - ID: ${episodioCreado.id}, Episodio: ${episodioCreado.episodioCmdb}`);
  console.log(`   Convenio en objeto creado: "${episodioCreado.convenio || 'null/undefined'}"`);
  console.log(`   Precio base tramo guardado: ${episodioCreado.precioBaseTramo ?? 'null'}`);
  console.log(`   Inlier/Outlier calculado: ${episodioCreado.inlierOutlier ?? 'null'}`);
  console.log(`   ⚠️ pesoGrd guardado en BD: ${episodioCreado.pesoGrd ?? 'null'} (tipo: ${typeof episodioCreado.pesoGrd})`);
  console.log(`   ⚠️ peso en Grd: ${episodioCreado.grd?.peso ?? 'null'} (tipo: ${typeof episodioCreado.grd?.peso})`);
  
  // Verificar qué valor se usó del archivo maestro
  const pesoGRDEnArchivo = findPesoGRDMedioTodos(row);
  const pesoMedioNormaEnArchivo = isNumeric(row['Peso Medio [Norma IR]']) ? parseFloat(row['Peso Medio [Norma IR]']) : null;
  console.log(`   📊 VALORES EN ARCHIVO MAESTRO:`);
  console.log(`      - "Peso GRD Medio (Todos)": ${pesoGRDEnArchivo ?? 'NO ENCONTRADO'}`);
  console.log(`      - "Peso Medio [Norma IR]": ${pesoMedioNormaEnArchivo ?? 'NO ENCONTRADO'}`);
  console.log(`   📊 VALORES GUARDADOS EN BD:`);
  console.log(`      - episodio.pesoGrd: ${episodioCreado.pesoGrd ?? 'null'}`);
  console.log(`      - grd.peso: ${episodioCreado.grd?.peso ?? 'null'}`);
  
  return episodioCreado;
}

// Endpoint de importación de episodios (formato esperado por el frontend)
router.post('/episodios/import', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  console.log('📥 ========== INICIO IMPORTACIÓN ==========');
  console.log('📁 Archivo recibido:', req.file?.originalname, 'Tamaño:', req.file?.size, 'bytes');
  
  const errorRecords: any[] = [];
  const validRecords: RawRow[] = [];

  try {
    if (!req.file) {
      console.log('❌ No se proporcionó ningún archivo');
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    const replace = req.body.replace === 'true';
    if (replace) {
      console.log('REEMPLAZANDO DATOS: Eliminando episodios anteriores...');
      // ¡CUIDADO! Esto borra todo.
      // Para evitar borrar en cascada Pacientes o Grds (si están enlazados),
      // es más seguro borrar solo los episodios.
      await prisma.episodio.deleteMany({});
      // Si quisieras borrar todo:
      // await prisma.episodio.deleteMany({});
      // await prisma.paciente.deleteMany({});
      // await prisma.grd.deleteMany({}); // <-- No recomendado si quieres mantener el catálogo
    }

    const fileBuffer = req.file.buffer;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let data: RawRow[] = [];

    // Parsear archivo desde el buffer de memoria
    if (ext === '.csv') {
      await new Promise<void>((resolve, reject) => {
        Readable.from(fileBuffer)
          .pipe(csv())
          .on('data', (row) => data.push(row as RawRow))
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet) as RawRow[];
      
      // Log para debug: verificar columnas del archivo
      if (data.length > 0) {
        const firstRow = data[0];
        const columnas = Object.keys(firstRow);
        console.log('📊 Columnas encontradas en el archivo (primeras 20):', columnas.slice(0, 20));
        
        // Buscar todas las columnas relacionadas con convenio
        const columnasConvenio = columnas.filter(c => {
          const normalized = c.toLowerCase().trim();
          return normalized.includes('convenio') || normalized.includes('convenios');
        });
        
        if (columnasConvenio.length > 0) {
          console.log(`✅ Columnas Convenio encontradas (${columnasConvenio.length}):`, columnasConvenio);
          columnasConvenio.forEach(col => {
            console.log(`   "${col}" = "${firstRow[col]}" (tipo: ${typeof firstRow[col]})`);
          });
          
          // Verificar que findConvenioValue la encuentre
          const testValue = findConvenioValue(firstRow);
          console.log(`   Test findConvenioValue: "${testValue}"`);
          
          if (!testValue) {
            console.log('⚠️ findConvenioValue NO encontró el valor, pero la columna existe!');
            console.log('   Revisando manualmente...');
            columnasConvenio.forEach(col => {
              const value = cleanString(firstRow[col]);
              if (value) {
                console.log(`   💡 Valor encontrado manualmente en "${col}": "${value}"`);
              }
            });
          }
        } else {
          console.log('⚠️ No se encontró columna Convenio en el archivo');
          console.log('   Buscando manualmente en todas las columnas...');
          columnas.forEach(col => {
            if (col.toLowerCase().includes('conven') || col.toLowerCase().includes('cod')) {
              console.log(`   Columna relacionada encontrada: "${col}" = "${firstRow[col]}"`);
            }
          });
        }
      }
    }

    // Validar y procesar filas
    let index = 0;
    const createdEpisodes: any[] = [];
    
    for (const row of data) {
      index++;
      // Usamos el validateRow modificado
      const isValid = await validateRow(row, index); 
      if (isValid) {
        validRecords.push(row);
        try {
          // Usamos el processRow modificado (pasar el índice para logs)
          const episode = await processRow(row, index);
          createdEpisodes.push(episode);
        } catch (err: any) {
          console.error(`Error procesando fila ${index}:`, err.message);
          errorRecords.push({
            fila: index,
            error: err.message || 'Error al procesar fila',
          });
        }
      } else {
        // El error ya se logueó en validateRow
        errorRecords.push({
          fila: index,
          error: 'Fila inválida o duplicada (ver logs del servidor para detalle)',
        });
      }
    }

    // Helper para convertir Decimal a Number
    const toNumber = (value: any): number => {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseFloat(value) || 0;
      if (value && typeof value.toNumber === 'function') return value.toNumber();
      return 0;
    };

    // Log para verificar los episodios antes de mapear
    if (createdEpisodes.length > 0) {
      const primerEpisodio = createdEpisodes[0];
      console.log(`🔍 Antes de mapear respuesta - Primer episodio:`, {
        id: primerEpisodio.id,
        episodioCmdb: primerEpisodio.episodioCmdb,
        convenio: primerEpisodio.convenio,
        tieneConvenio: 'convenio' in primerEpisodio,
        tipoConvenio: typeof primerEpisodio.convenio,
        todasLasKeys: Object.keys(primerEpisodio).slice(0, 15)
      });
    }

    // Formato de respuesta esperado por el frontend
    const response = {
      summary: {
        total: data.length,
        valid: createdEpisodes.length,
        errors: errorRecords.length,
      },
      episodes: createdEpisodes.map((e, idx) => {
        // Asegurar que convenio siempre esté presente - misma lógica que tipoEpisodio
        // Usar cadena vacía en lugar de null para consistencia
        const convenioValue = (e.convenio !== undefined && e.convenio !== null && e.convenio !== '') 
          ? String(e.convenio).trim() 
          : '';
        
        // Log para los primeros 3 episodios
        if (idx < 3) {
          console.log(`🔄 Mapeando episodio ${idx + 1}:`, {
            id: e.id,
            episodioCmdb: e.episodioCmdb,
            convenioEnObjeto: e.convenio,
            tieneConvenio: 'convenio' in e,
            tipoConvenio: typeof e.convenio,
            convenioValue: convenioValue,
            todasLasKeys: Object.keys(e).slice(0, 20)
          });
        }
        
        // Usar normalizeEpisodeResponse para calcular inlierOutlier y otros campos calculados
        const normalized = normalizeEpisodeResponse(e);
        
        // Construir el objeto mapeado asegurando que convenio siempre esté presente
        const mapped: any = {
          episodio: e.episodioCmdb || '',
          nombre: e.paciente?.nombre || '',
          rut: e.paciente?.rut || '',
          centro: e.centro || '',
          folio: e.numeroFolio || '',
          tipoEpisodio: e.tipoEpisodio || '',
          fechaIngreso: e.fechaIngreso ? e.fechaIngreso.toISOString().split('T')[0] : '',
          // ===================================================================
          // ======================= ¡AQUÍ ESTÁ LA CORRECCIÓN! =================
          // ===================================================================
          fechaAlta: e.fechaAlta ? e.fechaAlta.toISOString().split('T')[0] : '', // <-- ANTES DECÍA [MAIN]
          servicioAlta: e.servicioAlta || '',
          grdCodigo: e.grd?.codigo || '',
          peso: normalized.peso || null, // "Peso Medio [Norma IR]" - viene del modelo Grd
          pesoGrd: normalized.pesoGrd || null, // "Peso GRD Medio (Todos)" - viene del modelo Episodio
          montoRN: toNumber(e.montoRn),
          inlierOutlier: normalized.inlierOutlier, // Campo calculado automáticamente: "Outlier Superior" o "Inlier"
          enNorma: normalized.enNorma || null, // Campo calculado: "Si" si es Inlier, "No" si es Outlier, null si inlierOutlier está vacío
          id: e.id, // Incluir ID para poder editar después
        };
        
        // Asegurar que convenio siempre esté presente - misma lógica que tipoEpisodio
        mapped.convenio = convenioValue || ''; // Convenio bajo el cual se calcula el episodio - siempre incluido
        
        // Verificar que convenio esté en el objeto mapeado
        if (idx === 0) {
          console.log(`✅ Objeto mapeado - tiene convenio: ${'convenio' in mapped}, valor: "${mapped.convenio}"`);
          console.log(`   Keys del objeto mapeado:`, Object.keys(mapped));
        }
        
        return mapped;
      }),
      // Opcional: enviar los primeros 50 errores al frontend
      errorDetails: errorRecords.slice(0, 50),
    };

    // Log para verificar la respuesta final
    if (response.episodes.length > 0) {
      const primerEpisodioRespuesta = response.episodes[0];
      console.log(`📤 Respuesta final - Primer episodio:`, {
        episodio: primerEpisodioRespuesta.episodio,
        convenio: primerEpisodioRespuesta.convenio,
        tieneConvenio: 'convenio' in primerEpisodioRespuesta,
        todasLasKeys: Object.keys(primerEpisodioRespuesta)
      });
    }

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('Error al importar episodios:', error);
    console.error('Stack:', error?.stack);
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: error?.message || 'Error procesando archivo',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

export default router;


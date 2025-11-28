import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as path from 'path';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middlewares/auth';
import { prisma } from '../db/client';
import { Readable } from 'stream';
import { Prisma } from '@prisma/client';

const router = Router();

// --- Configuración de Multer (EN MEMORIA) ---
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

interface NormaRow {
  GRD?: string;
  'Peso Total'?: string;
  'Punto Corte Inferior'?: string;
  'Punto Corte Superior'?: string;
  // Campos opcionales adicionales que puedan venir en el archivo
  [key: string]: any;
}

// Función auxiliar para convertir string a número Decimal para Prisma
function parseDecimal(value: string | undefined, defaultValue: number = 0): number {
  if (!value) return defaultValue;
  // Reemplazar comas por puntos y eliminar espacios
  const cleaned = value.toString().replace(',', '.').replace(/\s/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Wrapper para manejar errores en handlers async
const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Middleware para manejar errores de Multer
const handleMulterError = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'Archivo demasiado grande', 
        message: 'El archivo excede el tamaño máximo permitido (50MB)' 
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        error: 'Demasiados archivos', 
        message: 'Solo se permite un archivo a la vez' 
      });
    }
    return res.status(400).json({ 
      error: 'Error al procesar el archivo', 
      message: err.message 
    });
  }
  if (err) {
    // Error del fileFilter u otro error de Multer
    return res.status(400).json({ 
      error: 'Error al procesar el archivo', 
      message: err.message || 'Tipo de archivo no permitido' 
    });
  }
  next();
};

// Endpoint GET para obtener información sobre la Norma Minsal
router.get('/catalogs/norma-minsal', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  try {
    const count = await prisma.grd.count();
    const latestUpdate = await prisma.grd.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    });

    return res.json({
      version: 'latest',
      totalRecords: count,
      lastUpdated: latestUpdate?.createdAt || null,
      status: 'active'
    });
  } catch (error: any) {
    console.error('Error obteniendo información de Norma Minsal:', error);
    return res.status(500).json({
      error: 'Error al obtener información',
      message: error?.message || 'Error desconocido'
    });
  }
}));

// Endpoint de importación de Norma Minsal
// Ruta completa: POST /api/catalogs/norma-minsal/import
router.post('/catalogs/norma-minsal/import', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  console.log('📋 Iniciando procesamiento de archivo...');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Content-Length:', req.headers['content-length']);
  
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      console.error('❌ Error de Multer:', err);
      console.error('Error code:', err?.code);
      console.error('Error message:', err?.message);
      return handleMulterError(err, req, res, next);
    }
    console.log('✅ Archivo procesado por Multer correctamente');
    next();
  });
}, asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  console.log('\n\n🎯 ========== INICIO IMPORTACIÓN NORMA MINSAL ==========');
  console.log(`📁 Archivo recibido: ${req.file?.originalname || 'NO HAY ARCHIVO'}`);
  console.log(`📏 Tamaño: ${req.file?.size || 0} bytes`);
  console.log('==================================================\n');
  
  const errorRecords: any[] = [];
  const successRecords: any[] = [];

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    // Log para identificar si viene de local o producción
    const origin = req.get('origin') || req.get('referer') || 'unknown';
    const host = req.get('host') || 'unknown';
    console.log('📥 Iniciando importación de Norma Minsal...');
    console.log('🌐 Origen de la petición:', origin);
    console.log('🌐 Host del backend:', host);
    console.log('📁 Archivo:', req.file.originalname, 'Tamaño:', req.file.size, 'bytes');

    const replace = req.body.replace === 'true';

    if (replace) {
      console.log('REEMPLAZANDO DATOS: Actualizando normas anteriores...');
      // No eliminamos los GRDs porque pueden tener episodios vinculados
      // En su lugar, el upsert actualizará los campos (puntoCorteSup, puntoCorteInf, peso, etc.)
      // Esto asegura que los GRDs existentes se actualicen con los nuevos valores de la norma
    }

    const fileBuffer = req.file.buffer;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let data: NormaRow[] = [];

    // Parsear archivo desde el buffer de memoria
    try {
      if (ext === '.csv') {
        await new Promise<void>((resolve, reject) => {
          Readable.from(fileBuffer)
            .pipe(csv())
            .on('data', (row) => data.push(row as NormaRow))
            .on('end', resolve)
            .on('error', (err) => {
              console.error('Error parseando CSV:', err);
              reject(err);
            });
        });
      } else {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('El archivo Excel no contiene hojas');
        }
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        data = XLSX.utils.sheet_to_json(worksheet) as NormaRow[];
      }
    } catch (parseError: any) {
      console.error('Error parseando archivo:', parseError);
      return res.status(400).json({
        error: 'Error al parsear el archivo',
        message: parseError.message || 'Formato de archivo inválido'
      });
    }

    if (data.length === 0) {
      return res.status(400).json({ error: 'El archivo está vacío o no contiene datos válidos' });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 INICIANDO IMPORTACIÓN DE NORMA MINSAL - ${data.length} registros`);
    console.log(`${'='.repeat(80)}\n`);
    
    // Log de las primeras filas para debugging
    if (data.length > 0) {
      console.log('📋 Primera fila de ejemplo:', JSON.stringify(data[0], null, 2));
      console.log('📋 Claves de la primera fila:', Object.keys(data[0]));
      
      // Buscar específicamente las columnas de puntos de corte
      const primeraFila = data[0];
      const todasLasKeys = Object.keys(primeraFila);
      const columnasPuntoCorte = todasLasKeys.filter(k => 
        k.toLowerCase().includes('punto') && k.toLowerCase().includes('corte')
      );
      console.log('\n🔍 Columnas relacionadas con "Punto Corte":', columnasPuntoCorte);
      columnasPuntoCorte.forEach(col => {
        console.log(`   "${col}" = "${primeraFila[col]}" (tipo: ${typeof primeraFila[col]})`);
      });
      
      // Buscar también variaciones
      const todasLasColumnas = todasLasKeys.map(k => ({ nombre: k, valor: primeraFila[k] }));
      console.log('\n📊 Todas las columnas de la primera fila:');
      todasLasColumnas.slice(0, 20).forEach(col => {
        console.log(`   "${col.nombre}" = "${col.valor}"`);
      });
    }

    // Procesar cada fila
    for (let index = 0; index < data.length; index++) {
      const row = data[index];
      
      // Función auxiliar para convertir cualquier valor a string de forma segura
      const safeString = (value: any): string | null => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number') return String(value).trim();
        try {
          return String(value).trim();
        } catch (e) {
          return null;
        }
      };
      
      // Buscar el campo GRD de forma flexible (puede venir con diferentes nombres o espacios)
      let grdValue: any = null;
      
      // Intentar diferentes nombres posibles
      const possibleKeys = ['GRD', 'grd', 'Grd', 'GRD ', ' GRD', 'GRD Código', 'Código GRD'];
      for (const key of possibleKeys) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
          grdValue = row[key];
          break;
        }
      }
      
      // Si no encontramos GRD, intentar buscar cualquier campo que contenga "GRD"
      if (!grdValue) {
        for (const key in row) {
          if (key && (key.toUpperCase().includes('GRD') || key.toLowerCase().includes('grd'))) {
            const value = row[key];
            if (value !== undefined && value !== null && value !== '') {
              grdValue = value;
              break;
            }
          }
        }
      }
      
      // Convertir a string de forma segura
      const codigo = safeString(grdValue);

      // Validar que tenga código GRD
      if (!codigo || codigo === '') {
        errorRecords.push({
          fila: index + 1,
          error: 'Código GRD faltante o vacío',
          registro: row,
        });
        continue;
      }

      // Función auxiliar para buscar columnas de forma flexible
      const getColumnValue = (possibleNames: string[]): string | undefined => {
        // Primero buscar coincidencia exacta
        for (const name of possibleNames) {
          const value = row[name];
          if (value !== undefined && value !== null && value !== '') {
            if (index < 3) {
              console.log(`   ✅ Encontrada columna exacta "${name}" = "${value}"`);
            }
            return String(value);
          }
        }
        // Buscar por nombre parcial (case-insensitive y sin espacios extra)
        for (const key in row) {
          const keyNormalized = key.trim().toLowerCase().replace(/\s+/g, ' ');
          for (const name of possibleNames) {
            const nameNormalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
            // Buscar coincidencia exacta normalizada o parcial
            if (keyNormalized === nameNormalized || keyNormalized.includes(nameNormalized) || nameNormalized.includes(keyNormalized)) {
              const value = row[key];
              if (value !== undefined && value !== null && value !== '') {
                if (index < 3) {
                  console.log(`   ✅ Encontrada columna por coincidencia parcial "${key}" = "${value}" (buscando: "${name}")`);
                }
                return String(value);
              }
            }
          }
        }
        if (index < 3) {
          console.log(`   ❌ No se encontró ninguna columna para: ${possibleNames.join(', ')}`);
        }
        return undefined;
      };

      // Parsear valores numéricos usando la función auxiliar
      const peso = parseDecimal(getColumnValue(['Peso Total', 'Peso', 'PESO TOTAL', 'PESO']));
      
      // Buscar punto de corte inferior - incluir variaciones con y sin espacios
      const pci = parseDecimal(getColumnValue([
        'Punto Corte Inferior',
        'Punto Corte Inf', 
        'PCI', 
        'Punto Corte Inferior (días)',
        'Punto Corte Inferior ',
        ' Punto Corte Inferior',
        'PUNTO CORTE INFERIOR',
        'Punto corte inferior'
      ]));
      
      // Buscar punto de corte superior - incluir variaciones con y sin espacios
      const pcs = parseDecimal(getColumnValue([
        'Punto Corte Superior',
        'Punto Corte Sup', 
        'PCS', 
        'Punto Corte Superior (días)',
        'Punto Corte Superior ',
        ' Punto Corte Superior',
        'PUNTO CORTE SUPERIOR',
        'Punto corte superior'
      ]));
      
      // Log para los primeros 5 registros para verificar que se están encontrando los valores
      if (index < 5) {
        console.log(`📊 Procesando fila ${index + 1} - GRD: ${codigo}`, {
          peso,
          pci,
          pcs,
          tienePeso: peso > 0,
          tienePCI: pci > 0 || pci !== 0,
          tienePCS: pcs > 0 || pcs !== 0,
          rowKeys: Object.keys(row).slice(0, 10), // Primeras 10 columnas para debug
        });
      }

      // Validar que los valores numéricos sean válidos
      // IMPORTANTE: pci y pcs pueden ser 0, pero deben existir para poder calcular
      if (peso === 0 && pci === 0 && pcs === 0) {
        // Log detallado para los primeros errores
        if (index < 5) {
          console.log(`⚠️ Fila ${index + 1} - Todos los valores son cero:`, {
            peso,
            pci,
            pcs,
            codigo,
            rowKeys: Object.keys(row).slice(0, 15),
          });
        }
        errorRecords.push({
          fila: index + 1,
          error: 'Todos los valores numéricos son cero o inválidos',
          registro: row,
        });
        continue;
      }
      
      // Validar específicamente que los puntos de corte existan (pueden ser 0 pero deben estar definidos)
      if (pci === 0 && pcs === 0) {
        // Log detallado para los primeros errores
        if (index < 5) {
          console.log(`⚠️ Fila ${index + 1} - Puntos de corte son cero:`, {
            pci,
            pcs,
            codigo,
            peso,
          });
        }
      }

      // Calcular precio base (similar al script loadNorma.ts)
      // Si el CSV tiene una columna de precio, usarla; sino calcular
      const precioBaseEjemplo = (peso * 1000000) + 500000;

      // Preparar datos para upsert - Prisma acepta números directamente para Decimal
      const dataToUpsert: Prisma.GrdUncheckedCreateInput = {
        codigo: codigo,
        descripcion: `Descripción de ${codigo}`, // El CSV no suele tener descripción
        peso: peso,
        puntoCorteInf: pci,
        puntoCorteSup: pcs,
        precioBaseTramo: precioBaseEjemplo,
      };

      try {
        const grdActualizado = await prisma.grd.upsert({
          where: { codigo: codigo },
          update: dataToUpsert,
          create: dataToUpsert,
        });

        // Verificar que los valores se guardaron correctamente
        const grdVerificado = await prisma.grd.findUnique({
          where: { codigo: codigo },
          select: { codigo: true, puntoCorteInf: true, puntoCorteSup: true, peso: true },
        });

        // Log para los primeros 5 GRDs para verificar que se guardaron
        if (index < 5) {
          console.log(`✅ GRD ${codigo} guardado/actualizado:`, {
            codigo: grdVerificado?.codigo,
            puntoCorteInf: grdVerificado?.puntoCorteInf,
            puntoCorteSup: grdVerificado?.puntoCorteSup,
            peso: grdVerificado?.peso,
            tipoPuntoCorteInf: typeof grdVerificado?.puntoCorteInf,
            tipoPuntoCorteSup: typeof grdVerificado?.puntoCorteSup,
          });
        }

        successRecords.push({
          fila: index + 1,
          codigo: codigo,
          peso: peso,
          puntoCorteInf: pci,
          puntoCorteSup: pcs,
        });
      } catch (e: any) {
        console.error(`Error procesando GRD ${codigo}:`, e.message);
        console.error('Stack:', e.stack);
        console.error('Error code:', e.code);
        console.error('Error name:', e.name);
        
        // Si es un error de conexión a la base de datos, detener el proceso
        if (e.code === 'P1001' || e.code === 'P1002' || e.message?.includes('connect')) {
          throw new Error(`Error de conexión a la base de datos: ${e.message}`);
        }
        
        errorRecords.push({
          fila: index + 1,
          error: `Error al guardar: ${e.message}`,
          registro: row,
        });
      }
    }

    // Formato de respuesta
    const response = {
      success: true,
      summary: {
        total: data.length,
        valid: successRecords.length,
        errors: errorRecords.length,
      },
      grds: successRecords,
      // Opcional: enviar los primeros 50 errores al frontend
      errorDetails: errorRecords.slice(0, 50),
    };

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ IMPORTACIÓN COMPLETADA: ${successRecords.length} exitosos, ${errorRecords.length} errores`);
    console.log(`${'='.repeat(80)}\n`);
    
    // Verificar que los valores se guardaron correctamente - verificar algunos GRDs aleatorios
    if (successRecords.length > 0) {
      const primeros5 = successRecords.slice(0, 5);
      console.log('🔍 Verificando que los valores se guardaron correctamente...\n');
      for (const record of primeros5) {
        const grdVerificado = await prisma.grd.findUnique({
          where: { codigo: record.codigo },
          select: { codigo: true, puntoCorteInf: true, puntoCorteSup: true, peso: true },
        });
        if (grdVerificado) {
          console.log(`✅ GRD ${record.codigo} verificado en BD:`, {
            puntoCorteInf: grdVerificado.puntoCorteInf,
            puntoCorteSup: grdVerificado.puntoCorteSup,
            peso: grdVerificado.peso,
            tipoPuntoCorteInf: typeof grdVerificado.puntoCorteInf,
            tipoPuntoCorteSup: typeof grdVerificado.puntoCorteSup,
          });
        } else {
          console.error(`❌ GRD ${record.codigo} NO encontrado en BD después de guardar!`);
        }
      }
      console.log('\n');
    }
    
    return res.status(200).json(response);
  } catch (error: any) {
    console.error('❌ Error al importar Norma Minsal:', error);
    console.error('Stack:', error?.stack);
    console.error('Error name:', error?.name);
    console.error('Error code:', error?.code);
    console.error('Error type:', typeof error);
    
    // Si es un error de Prisma, dar más información
    if (error?.code) {
      console.error('Prisma error code:', error.code);
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Error de duplicado',
          message: 'Ya existe un GRD con ese código',
          details: error.meta
        });
      }
      // Errores de conexión a la base de datos
      if (error.code === 'P1001' || error.code === 'P1002' || error.code === 'P1000') {
        return res.status(503).json({
          error: 'Error de conexión a la base de datos',
          message: 'No se pudo conectar con la base de datos. Por favor, intenta más tarde.',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }

    // Si es un error de sintaxis o parseo
    if (error instanceof SyntaxError) {
      return res.status(400).json({
        error: 'Error de formato',
        message: 'El archivo tiene un formato inválido',
        details: error.message
      });
    }

    // Si no se envió respuesta, usar el error handler global
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Error interno del servidor',
        message: error?.message || 'Error procesando archivo',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      });
    }
    // Si ya se envió respuesta, pasar el error al error handler global
    next(error);
  }
}));

export default router;


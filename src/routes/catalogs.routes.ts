import { Router, Request, Response } from 'express';
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

// Endpoint de importación de Norma Minsal
// Ruta completa: POST /api/catalogs/norma-minsal/import
router.post('/catalogs/norma-minsal/import', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  const errorRecords: any[] = [];
  const successRecords: any[] = [];

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    console.log('📥 Iniciando importación de Norma Minsal...');
    console.log('Archivo:', req.file.originalname, 'Tamaño:', req.file.size, 'bytes');

    const replace = req.body.replace === 'true';

    if (replace) {
      console.log('REEMPLAZANDO DATOS: Eliminando normas anteriores...');
      // Opcional: eliminar todos los GRDs antes de importar
      // Esto es peligroso si hay episodios vinculados, así que lo comentamos por defecto
      // await prisma.grd.deleteMany({});
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

    console.log(`Procesando ${data.length} registros de Norma Minsal...`);

    // Procesar cada fila
    for (let index = 0; index < data.length; index++) {
      const row = data[index];
      const codigo = row.GRD?.trim();

      // Validar que tenga código GRD
      if (!codigo) {
        errorRecords.push({
          fila: index + 1,
          error: 'Código GRD faltante o vacío',
          registro: row,
        });
        continue;
      }

      // Parsear valores numéricos usando la función auxiliar
      const peso = parseDecimal(row['Peso Total']);
      const pci = parseDecimal(row['Punto Corte Inferior']);
      const pcs = parseDecimal(row['Punto Corte Superior']);

      // Validar que los valores numéricos sean válidos (al menos uno debe ser mayor a 0)
      if (peso === 0 && pci === 0 && pcs === 0) {
        errorRecords.push({
          fila: index + 1,
          error: 'Todos los valores numéricos son cero o inválidos',
          registro: row,
        });
        continue;
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
        await prisma.grd.upsert({
          where: { codigo: codigo },
          update: dataToUpsert,
          create: dataToUpsert,
        });

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

    console.log(`✅ Importación completada: ${successRecords.length} exitosos, ${errorRecords.length} errores`);
    return res.status(200).json(response);
  } catch (error: any) {
    console.error('❌ Error al importar Norma Minsal:', error);
    console.error('Stack:', error?.stack);
    console.error('Error name:', error?.name);
    console.error('Error code:', error?.code);
    
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
    }

    return res.status(500).json({
      error: 'Error interno del servidor',
      message: error?.message || 'Error procesando archivo',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

export default router;


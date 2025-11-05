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

// Endpoint de importación de Norma Minsal
// Ruta completa: POST /api/catalogs/norma-minsal/import
router.post('/catalogs/norma-minsal/import', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  const errorRecords: any[] = [];
  const successRecords: any[] = [];

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

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
    if (ext === '.csv') {
      await new Promise<void>((resolve, reject) => {
        Readable.from(fileBuffer)
          .pipe(csv())
          .on('data', (row) => data.push(row as NormaRow))
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet) as NormaRow[];
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

      // Parsear valores numéricos (reemplazar comas por puntos para decimales)
      const peso = parseFloat(row['Peso Total']?.replace(',', '.') || '0');
      const pci = parseFloat(row['Punto Corte Inferior']?.replace(',', '.') || '0');
      const pcs = parseFloat(row['Punto Corte Superior']?.replace(',', '.') || '0');

      // Validar que los valores numéricos sean válidos
      if (isNaN(peso) || isNaN(pci) || isNaN(pcs)) {
        errorRecords.push({
          fila: index + 1,
          error: 'Valores numéricos inválidos (Peso, Punto Corte Inferior o Superior)',
          registro: row,
        });
        continue;
      }

      // Calcular precio base (similar al script loadNorma.ts)
      // Si el CSV tiene una columna de precio, usarla; sino calcular
      const precioBaseEjemplo = (peso * 1000000) + 500000;

      // Preparar datos para upsert
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

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('Error al importar Norma Minsal:', error);
    console.error('Stack:', error?.stack);
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: error?.message || 'Error procesando archivo',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

export default router;


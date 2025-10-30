import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import Joi from 'joi';

const router = Router();

// Multer configuration
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      cb(null, UPLOAD_DIR);
    } catch (err) {
      cb(err as Error, UPLOAD_DIR);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'text/csv',
    'application/csv',
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
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

// Schema validation
const episodeSchema = Joi.object({
  paciente_id: Joi.string().required().min(1),
  fecha_ingreso: Joi.date().required(),
  fecha_egreso: Joi.date().allow(null).optional(),
  diagnostico_principal: Joi.string().required().min(1),
  edad: Joi.number().integer().min(0).max(120).required(),
  sexo: Joi.string().valid('M', 'F', 'Masculino', 'Femenino').required()
});

// Upload endpoint
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  let filePath: string | null = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No se proporcionó ningún archivo',
        message: 'Debe enviar un archivo CSV o Excel'
      });
    }

    filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({
        error: 'Formato de archivo no soportado',
        message: 'Solo se aceptan archivos CSV y Excel (.csv, .xlsx, .xls)'
      });
    }

    let processedData: any;

    if (ext === '.csv') {
      const results: any[] = [];
      const errors: any[] = [];

      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(filePath!)
          .pipe(csv())
          .on('data', (row) => {
            const { error } = episodeSchema.validate(row, { abortEarly: true });
            if (error) {
              errors.push({ row: results.length + 1, error: error.message, data: row });
            } else {
              results.push(row);
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });

      processedData = { results, errors };
    } else {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      const results: any[] = [];
      const errors: any[] = [];

      data.forEach((row: any, i: number) => {
        const { error } = episodeSchema.validate(row, { abortEarly: true });
        if (error) {
          errors.push({ row: i + 1, error: error.message, data: row });
        } else {
          results.push(row);
        }
      });

      processedData = { results, errors };
    }

    const response = {
      success: true,
      message: 'Archivo procesado exitosamente',
      summary: {
        total_rows: processedData.results.length + processedData.errors.length,
        valid_rows: processedData.results.length,
        invalid_rows: processedData.errors.length,
        file_name: req.file.originalname,
        processed_at: new Date().toISOString()
      },
      data: processedData.results,
      errors: processedData.errors
    };

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return res.json(response);

  } catch (error: any) {
    console.error('Error general procesando archivo:', error);
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: process.env.NODE_ENV === 'development' ? error?.message : 'Error procesando archivo'
    });
  }
});

router.get('/upload/info', (_req: Request, res: Response) => {
  res.json({
    endpoint: '/api/upload',
    method: 'POST',
    description: 'Sube CSV/Excel con datos clínicos',
    accepted_formats: ['CSV (.csv)', 'Excel (.xlsx, .xls)'],
    max_file_size: '10MB'
  });
});

export default router;


import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middlewares/auth';
import { prisma } from '../db/client';
import { uploadToCloudinary } from '../config/cloudinary';

const router = Router();

// Configurar Multer para que guarde en memoria (buffer)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Límite de 10MB
});

/**
 * POST /api/episodios/:id/respaldo
 * Sube un archivo de respaldo (PDF, Epicrisis, etc.) y lo asocia a un episodio.
 */
router.post(
  '/episodios/:id/respaldo',
  requireAuth,
  upload.single('file'), // 'file' debe ser el nombre del campo en el FormData
  async (req: Request, res: Response) => {
    
    const { id: episodioId } = req.params;
    const userId = req.user?.id; // De requireAuth

    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    try {
      // 1. Verificar que el episodio exista
      const episodio = await prisma.episodio.findUnique({
        where: { id: parseInt(episodioId) },
      });

      if (!episodio) {
        return res.status(404).json({ error: 'Episodio no encontrado' });
      }

      // 2. Subir el archivo a Cloudinary
      const originalName = req.file.originalname;
      const public_id = `ep${episodioId}_${Date.now()}_${originalName.split('.')[0]}`;

      const result: any = await uploadToCloudinary(req.file.buffer, {
        folder: `grd_respaldos/${episodioId}`, // Carpeta en Cloudinary
        public_id: public_id,
        resource_type: 'auto', // Detecta PDF, DOCX, etc. como 'raw'
      });

      // 3. Guardar la referencia en la base de datos
      const nuevoRespaldo = await prisma.respaldo.create({
        data: {
          filename: originalName,
          storagePath: result.secure_url, // Guardamos la URL segura
          fileType: req.file.mimetype,
          sizeBytes: req.file.size,
          episodioId: parseInt(episodioId),
          uploadedBy: parseInt(userId),
        },
      });

      res.status(201).json(nuevoRespaldo);

    } catch (error: any) {
      console.error('Error subiendo respaldo:', error);
      res.status(500).json({ error: 'Error interno al subir el archivo', details: error.message });
    }
  }
);

/**
 * GET /api/episodios/:id/respaldos
 * Obtiene la lista de respaldos de un episodio.
 */
router.get('/episodios/:id/respaldos', requireAuth, async (req: Request, res: Response) => {
  const { id: episodioId } = req.params;

  try {
    const respaldos = await prisma.respaldo.findMany({
      where: { episodioId: parseInt(episodioId) },
      orderBy: { uploadedAt: 'desc' },
      include: {
        usuario: { // Incluye quién lo subió
          select: { id: true, nombre: true, email: true }
        }
      }
    });

    res.json(respaldos);

  } catch (error: any) {
    console.error('Error listando respaldos:', error);
    res.status(500).json({ error: 'Error interno', details: error.message });
  }
});

export default router;
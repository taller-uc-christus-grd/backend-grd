import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { requireAuth, requireRole } from '../middlewares/auth';
import { prisma } from '../db/client';

const router = Router();

// Esquema de validación para crear ajuste por tecnología (campos opcionales para permitir guardar campo por campo)
const createAjusteTecnologiaSchema = Joi.object({
  at: Joi.string().optional().allow(null, '').default(''),
  monto: Joi.number().min(0).optional().allow(null).default(0),
});

// Esquema de validación para actualizar ajuste por tecnología (parcial)
const updateAjusteTecnologiaSchema = Joi.object({
  at: Joi.string().optional().allow(null, ''),
  monto: Joi.number().min(0).optional().allow(null),
});

// GET /api/ajustes-tecnologia - Listar todos los ajustes por tecnología
// Disponible para todos los usuarios autenticados (para el dropdown en la vista de Episodios)
router.get('/ajustes-tecnologia', requireAuth, async (_req: Request, res: Response) => {
  try {
    const ajustes = await prisma.ajusteTecnologia.findMany({
      orderBy: {
        at: 'asc', // Ordenar alfabéticamente por 'at'
      },
    });

    // Filtrar solo ajustes que tengan 'at' no vacío (no null, no undefined, no string vacío)
    const ajustesFiltrados = ajustes.filter(ajuste => 
      ajuste.at && typeof ajuste.at === 'string' && ajuste.at.trim() !== ''
    );

    res.json(ajustesFiltrados);
  } catch (error: any) {
    console.error('Error al listar ajustes por tecnología:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      error: 'Error al listar ajustes por tecnología',
      message: error?.message || 'Error desconocido',
    });
  }
});

// POST /api/ajustes-tecnologia - Crear nuevo ajuste por tecnología
router.post('/ajustes-tecnologia', requireAuth, requireRole(['finanzas', 'gestion']), async (req: Request, res: Response) => {
  try {
    // Validar datos
    const { error, value } = createAjusteTecnologiaSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({
        error: 'Error de validación',
        details: error.details.map((d) => d.message),
      });
    }

    // Crear el ajuste por tecnología
    const ajuste = await prisma.ajusteTecnologia.create({
      data: {
        at: value.at || '',
        monto: value.monto ?? 0,
      },
    });

    res.status(201).json(ajuste);
  } catch (error: any) {
    console.error('Error al crear ajuste por tecnología:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      error: 'Error al crear ajuste por tecnología',
      message: error?.message || 'Error desconocido',
    });
  }
});

// PATCH /api/ajustes-tecnologia/:id - Actualizar ajuste por tecnología
router.patch('/ajustes-tecnologia/:id', requireAuth, requireRole(['finanzas', 'gestion']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validar datos (parcial)
    const { error, value } = updateAjusteTecnologiaSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({
        error: 'Error de validación',
        details: error.details.map((d) => d.message),
      });
    }

    // Preparar datos para actualizar
    const updateData: any = {};
    
    if (value.at !== undefined) updateData.at = value.at || '';
    if (value.monto !== undefined) updateData.monto = value.monto ?? 0;

    // Actualizar el ajuste por tecnología
    const ajuste = await prisma.ajusteTecnologia.update({
      where: { id },
      data: updateData,
    });

    res.json(ajuste);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        error: 'Ajuste por tecnología no encontrado',
        message: `No se encontró un ajuste por tecnología con id: ${req.params.id}`,
      });
    }
    
    console.error('Error al actualizar ajuste por tecnología:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      error: 'Error al actualizar ajuste por tecnología',
      message: error?.message || 'Error desconocido',
    });
  }
});

// DELETE /api/ajustes-tecnologia/:id - Eliminar ajuste por tecnología
router.delete('/ajustes-tecnologia/:id', requireAuth, requireRole(['finanzas', 'gestion']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que existe
    const ajuste = await prisma.ajusteTecnologia.findUnique({
      where: { id },
    });

    if (!ajuste) {
      return res.status(404).json({
        error: 'Ajuste por tecnología no encontrado',
        message: `No se encontró un ajuste por tecnología con id: ${id}`,
      });
    }

    // Eliminar
    await prisma.ajusteTecnologia.delete({
      where: { id },
    });

    res.status(200).json({
      message: 'Ajuste por tecnología eliminado correctamente',
      id,
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        error: 'Ajuste por tecnología no encontrado',
        message: `No se encontró un ajuste por tecnología con id: ${req.params.id}`,
      });
    }
    
    console.error('Error al eliminar ajuste por tecnología:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      error: 'Error al eliminar ajuste por tecnología',
      message: error?.message || 'Error desconocido',
    });
  }
});

export default router;


import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { requireAuth, requireRole } from '../middlewares/auth';
import { prisma } from '../db/client';

const router = Router();

// Función auxiliar para convertir fecha de DD-MM-YYYY a Date (puede retornar null)
function parseDate(dateString: string | Date | null | undefined): Date | null {
  if (!dateString) {
    return null;
  }
  
  if (dateString instanceof Date) {
    return dateString;
  }
  
  // Si es string vacío
  if (typeof dateString === 'string' && dateString.trim() === '') {
    return null;
  }
  
  // Si viene en formato DD-MM-YYYY
  if (typeof dateString === 'string' && dateString.includes('-')) {
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Los meses en JS son 0-indexed
      const year = parseInt(parts[2], 10);
      
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month, day);
      }
    }
  }
  
  // Si viene en formato ISO (YYYY-MM-DD)
  const date = new Date(dateString);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  return null;
}

// Función auxiliar para formatear fecha a DD-MM-YYYY
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

// Esquema de validación para crear precio de convenio (campos opcionales para permitir guardar campo por campo)
const createPrecioConvenioSchema = Joi.object({
  aseguradora: Joi.string().optional().allow(null, '').default(''),
  nombre_asegi: Joi.string().optional().allow(null, '').default(''),
  convenio: Joi.string().optional().allow(null, '').default(''),
  descr_convenio: Joi.string().optional().allow(null, '').default(''),
  tipoAsegurad: Joi.string().optional().allow(null, '').default(''),
  tipoConvenio: Joi.string().optional().allow(null, '').default(''),
  tramo: Joi.string().optional().allow(null, ''),
  fechaAdmision: Joi.alternatives().try(
    Joi.date().allow(null),
    Joi.string().pattern(/^\d{2}-\d{2}-\d{4}$/).allow(null, ''), // DD-MM-YYYY
    Joi.string().isoDate().allow(null, '') // YYYY-MM-DD o ISO
  ).optional().allow(null),
  fechaFin: Joi.alternatives().try(
    Joi.date().allow(null),
    Joi.string().pattern(/^\d{2}-\d{2}-\d{4}$/).allow(null, ''), // DD-MM-YYYY
    Joi.string().isoDate().allow(null, '') // YYYY-MM-DD o ISO
  ).optional().allow(null),
  precio: Joi.number().min(0).optional().allow(null).default(0),
}).custom((value, helpers) => {
  // Validar que fechaFin >= fechaAdmision solo si ambas están presentes y no son null
  if (value.fechaAdmision && value.fechaFin) {
    try {
      const fechaAdmision = parseDate(value.fechaAdmision);
      const fechaFin = parseDate(value.fechaFin);
      
      // Verificar que ambas fechas no sean null antes de comparar
      if (fechaAdmision && fechaFin && fechaFin < fechaAdmision) {
        return helpers.error('custom.dateRange', { message: 'fechaFin debe ser mayor o igual a fechaAdmision' });
      }
    } catch (error) {
      // Si hay error al parsear, dejar que Joi maneje la validación
    }
  }
  
  return value;
}, 'Validación de rango de fechas');

// Esquema de validación para actualizar precio de convenio (parcial)
const updatePrecioConvenioSchema = Joi.object({
  aseguradora: Joi.string().optional(),
  nombre_asegi: Joi.string().optional(),
  convenio: Joi.string().optional(),
  descr_convenio: Joi.string().optional(),
  tipoAsegurad: Joi.string().optional(),
  tipoConvenio: Joi.string().optional(),
  tramo: Joi.string().optional().allow(null, ''),
  fechaAdmision: Joi.alternatives().try(
    Joi.date(),
    Joi.string().pattern(/^\d{2}-\d{2}-\d{4}$/), // DD-MM-YYYY
    Joi.string().isoDate() // YYYY-MM-DD o ISO
  ).optional(),
  fechaFin: Joi.alternatives().try(
    Joi.date(),
    Joi.string().pattern(/^\d{2}-\d{2}-\d{4}$/), // DD-MM-YYYY
    Joi.string().isoDate() // YYYY-MM-DD o ISO
  ).optional(),
  precio: Joi.number().min(0).optional().allow(null),
}).custom((value, helpers) => {
  // Validar que fechaFin >= fechaAdmision si ambas están presentes y no son null
  if (value.fechaAdmision && value.fechaFin) {
    try {
      const fechaAdmision = parseDate(value.fechaAdmision);
      const fechaFin = parseDate(value.fechaFin);
      
      // Verificar que ambas fechas no sean null antes de comparar
      if (fechaAdmision && fechaFin && fechaFin < fechaAdmision) {
        return helpers.error('custom.dateRange', { message: 'fechaFin debe ser mayor o igual a fechaAdmision' });
      }
    } catch (error) {
      // Si hay error al parsear, dejar que Joi maneje la validación
    }
  }
  
  return value;
}, 'Validación de rango de fechas');

// GET /api/precios-convenios - Listar todos los precios de convenios
router.get('/precios-convenios', requireAuth, requireRole(['finanzas', 'gestion']), async (_req: Request, res: Response) => {
  try {
    const preciosConvenios = await prisma.precioConvenio.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Formatear fechas para la respuesta (manejar fechas null)
    const formatted = preciosConvenios.map((pc) => ({
      ...pc,
      fechaAdmision: pc.fechaAdmision ? pc.fechaAdmision.toISOString() : null,
      fechaFin: pc.fechaFin ? pc.fechaFin.toISOString() : null,
      createdAt: pc.createdAt.toISOString(),
      updatedAt: pc.updatedAt.toISOString(),
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error('Error al listar precios de convenios:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      error: 'Error al listar precios de convenios',
      message: error?.message || 'Error desconocido',
    });
  }
});

// POST /api/precios-convenios - Crear nuevo precio de convenio
router.post('/precios-convenios', requireAuth, requireRole(['finanzas', 'gestion']), async (req: Request, res: Response) => {
  try {
    // Validar datos
    const { error, value } = createPrecioConvenioSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({
        error: 'Error de validación',
        details: error.details.map((d) => d.message),
      });
    }

    // Convertir fechas (pueden ser null)
    const fechaAdmision = parseDate(value.fechaAdmision);
    const fechaFin = parseDate(value.fechaFin);

    // Crear el precio de convenio
    const precioConvenio = await prisma.precioConvenio.create({
      data: {
        aseguradora: value.aseguradora || '',
        nombre_asegi: value.nombre_asegi || '',
        convenio: value.convenio || '',
        descr_convenio: value.descr_convenio || '',
        tipoAsegurad: value.tipoAsegurad || '',
        tipoConvenio: value.tipoConvenio || '',
        tramo: value.tramo || null,
        fechaAdmision: fechaAdmision || null,
        fechaFin: fechaFin || null,
        precio: value.precio ?? 0,
      },
    });

    // Formatear respuesta (manejar fechas null)
    res.status(201).json({
      ...precioConvenio,
      fechaAdmision: precioConvenio.fechaAdmision ? precioConvenio.fechaAdmision.toISOString() : null,
      fechaFin: precioConvenio.fechaFin ? precioConvenio.fechaFin.toISOString() : null,
      createdAt: precioConvenio.createdAt.toISOString(),
      updatedAt: precioConvenio.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error al crear precio de convenio:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      error: 'Error al crear precio de convenio',
      message: error?.message || 'Error desconocido',
    });
  }
});

// PATCH /api/precios-convenios/:id - Actualizar precio de convenio
router.patch('/precios-convenios/:id', requireAuth, requireRole(['finanzas', 'gestion']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validar datos (parcial)
    const { error, value } = updatePrecioConvenioSchema.validate(req.body, {
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
    
    if (value.aseguradora !== undefined) updateData.aseguradora = value.aseguradora || '';
    if (value.nombre_asegi !== undefined) updateData.nombre_asegi = value.nombre_asegi || '';
    if (value.convenio !== undefined) updateData.convenio = value.convenio || '';
    if (value.descr_convenio !== undefined) updateData.descr_convenio = value.descr_convenio || '';
    if (value.tipoAsegurad !== undefined) updateData.tipoAsegurad = value.tipoAsegurad || '';
    if (value.tipoConvenio !== undefined) updateData.tipoConvenio = value.tipoConvenio || '';
    if (value.tramo !== undefined) updateData.tramo = value.tramo || null;
    if (value.fechaAdmision !== undefined) {
      const fechaParsed = parseDate(value.fechaAdmision);
      updateData.fechaAdmision = fechaParsed || null;
    }
    if (value.fechaFin !== undefined) {
      const fechaParsed = parseDate(value.fechaFin);
      updateData.fechaFin = fechaParsed || null;
    }
    if (value.precio !== undefined) updateData.precio = value.precio ?? 0;

    // Validar rango de fechas si ambas están presentes (y no son null)
    const fechaAdmisionToValidate = updateData.fechaAdmision !== undefined ? updateData.fechaAdmision : null;
    const fechaFinToValidate = updateData.fechaFin !== undefined ? updateData.fechaFin : null;
    
    if (fechaAdmisionToValidate !== null && fechaFinToValidate !== null) {
      // Ambas fechas están presentes en el update
      if (fechaFinToValidate < fechaAdmisionToValidate) {
        return res.status(400).json({
          error: 'Error de validación',
          message: 'fechaFin debe ser mayor o igual a fechaAdmision',
        });
      }
    } else if (fechaAdmisionToValidate !== null || fechaFinToValidate !== null) {
      // Solo una fecha está siendo actualizada, obtener la otra de la BD
      const existing = await prisma.precioConvenio.findUnique({ where: { id } });
      if (existing) {
        const fechaAdmision = fechaAdmisionToValidate !== null ? fechaAdmisionToValidate : existing.fechaAdmision;
        const fechaFin = fechaFinToValidate !== null ? fechaFinToValidate : existing.fechaFin;
        
        // Solo validar si ambas fechas no son null
        if (fechaAdmision && fechaFin && fechaFin < fechaAdmision) {
          return res.status(400).json({
            error: 'Error de validación',
            message: 'fechaFin debe ser mayor o igual a fechaAdmision',
          });
        }
      }
    }

    // Actualizar el precio de convenio
    const precioConvenio = await prisma.precioConvenio.update({
      where: { id },
      data: updateData,
    });

    // Formatear respuesta (manejar fechas null)
    res.json({
      ...precioConvenio,
      fechaAdmision: precioConvenio.fechaAdmision ? precioConvenio.fechaAdmision.toISOString() : null,
      fechaFin: precioConvenio.fechaFin ? precioConvenio.fechaFin.toISOString() : null,
      createdAt: precioConvenio.createdAt.toISOString(),
      updatedAt: precioConvenio.updatedAt.toISOString(),
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        error: 'Precio de convenio no encontrado',
        message: `No se encontró un precio de convenio con id: ${req.params.id}`,
      });
    }
    
    console.error('Error al actualizar precio de convenio:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      error: 'Error al actualizar precio de convenio',
      message: error?.message || 'Error desconocido',
    });
  }
});

// DELETE /api/precios-convenios/:id - Eliminar precio de convenio
router.delete('/precios-convenios/:id', requireAuth, requireRole(['finanzas', 'gestion']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que existe
    const precioConvenio = await prisma.precioConvenio.findUnique({
      where: { id },
    });

    if (!precioConvenio) {
      return res.status(404).json({
        error: 'Precio de convenio no encontrado',
        message: `No se encontró un precio de convenio con id: ${id}`,
      });
    }

    // Eliminar
    await prisma.precioConvenio.delete({
      where: { id },
    });

    res.status(200).json({
      message: 'Precio de convenio eliminado correctamente',
      id,
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        error: 'Precio de convenio no encontrado',
        message: `No se encontró un precio de convenio con id: ${req.params.id}`,
      });
    }
    
    console.error('Error al eliminar precio de convenio:', error);
    console.error('Stack:', error?.stack);
    res.status(500).json({
      error: 'Error al eliminar precio de convenio',
      message: error?.message || 'Error desconocido',
    });
  }
});

export default router;


import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middlewares/auth';

const router = Router();

// Store simple in-memory (reemplazar por DB en producción)
const episodios = new Map<string, any>();

// Esquema Joi para validación
const episodioSchema = Joi.object({
  paciente_id: Joi.string().trim().required(),
  fecha_ingreso: Joi.string().isoDate().required(),
  diagnostico_principal: Joi.string().trim().required(),
  edad: Joi.number().integer().min(0).required(),
  sexo: Joi.string().valid('M', 'F', 'Masculino', 'Femenino').required(),
  fecha_egreso: Joi.string().isoDate().optional().allow('', null),
  diagnostico_secundario: Joi.string().optional().allow('', null),
  procedimiento: Joi.string().optional().allow('', null),
  peso: Joi.number().optional().allow(null),
  talla: Joi.number().optional().allow(null),
  dias_estancia: Joi.number().integer().optional().allow(null)
});

// Listar episodios
router.get('/episodios', requireAuth, (_req: Request, res: Response) => {
  const list = Array.from(episodios.values());
  res.json({ total: list.length, data: list });
});

// Obtener episodio por id
router.get('/episodios/:id', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  if (!episodios.has(id)) {
    return res.status(404).json({ error: 'Episodio no encontrado' });
  }
  res.json(episodios.get(id));
});

// Crear episodio
router.post('/episodios', requireAuth, (req: Request, res: Response) => {
  const { error, value } = episodioSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ 
      error: 'Validation error', 
      details: error.details.map(d => d.message) 
    });
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const record = { id, ...value, createdAt, updatedAt: createdAt };
  episodios.set(id, record);

  res.status(201).json({ success: true, data: record });
});

// Actualizar episodio
router.put('/episodios/:id', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  if (!episodios.has(id)) {
    return res.status(404).json({ error: 'Episodio no encontrado' });
  }

  const { error, value } = episodioSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    return res.status(400).json({ 
      error: 'Validation error', 
      details: error.details.map(d => d.message) 
    });
  }

  const existing = episodios.get(id);
  const updatedAt = new Date().toISOString();
  const updated = { ...existing, ...value, updatedAt };
  episodios.set(id, updated);

  res.json({ success: true, data: updated });
});

// Eliminar episodio
router.delete('/episodios/:id', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  if (!episodios.has(id)) {
    return res.status(404).json({ error: 'Episodio no encontrado' });
  }
  episodios.delete(id);
  res.json({ success: true, message: 'Episodio eliminado' });
});

export default router;


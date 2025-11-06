import { Router } from 'express';
import { getLogs } from '../controllers/logs.controller';
import { requireAuth, requireRole } from '../middlewares/auth';

const router = Router();

// Obtener logs del sistema (solo admin)
router.get('/', requireAuth, requireRole(['ADMIN']), getLogs);

export default router;


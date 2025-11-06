import { Router } from 'express';
import { getConfig, getConfigByKey, updateConfig } from '../controllers/config.controller';
import { requireAuth, requireRole } from '../middlewares/auth';

const router = Router();

// Todas las rutas requieren autenticación y rol admin
router.get('/', requireAuth, requireRole(['ADMIN']), getConfig);
router.get('/:clave', requireAuth, requireRole(['ADMIN']), getConfigByKey);
router.put('/', requireAuth, requireRole(['ADMIN']), updateConfig);

export default router;


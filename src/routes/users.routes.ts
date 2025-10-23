import { Router } from 'express';
import { listUsers, updateUser, deleteUser } from '../controllers/users.controller';
import { requireAuth, requireRole } from '../middlewares/auth';

const router = Router();
router.get('/', requireAuth, requireRole(['ADMIN']), listUsers);
router.put('/:id', requireAuth, requireRole(['ADMIN']), updateUser);
router.delete('/:id', requireAuth, requireRole(['ADMIN']), deleteUser);
export default router;
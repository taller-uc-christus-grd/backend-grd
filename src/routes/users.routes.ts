import { Router } from 'express';
import { listUsers, createUser, updateUser, deleteUser, toggleUserStatus } from '../controllers/users.controller';
import { requireAuth, requireRole } from '../middlewares/auth';

const router = Router();

router.get('/',    requireAuth, requireRole(['ADMIN']), listUsers);
router.post('/',   requireAuth, requireRole(['ADMIN']), createUser);
router.put('/:id', requireAuth, requireRole(['ADMIN']), updateUser);
router.patch('/:id/status', requireAuth, requireRole(['ADMIN']), toggleUserStatus);
router.delete('/:id', requireAuth, requireRole(['ADMIN']), deleteUser);

export default router;
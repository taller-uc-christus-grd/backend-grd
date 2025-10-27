import { Router } from 'express';
import { login, signup, me } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth';

const router = Router();
// Deja /signup para dev/QA; en prod crea usuarios con POST /usuarios (ADMIN).
router.post('/signup', signup);
router.post('/login', login);
router.get('/me', requireAuth, me);

export default router;
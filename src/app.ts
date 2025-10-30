import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';

const app = express();

app.use(express.json());
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.get('/health', (_req, res) => res.json({ ok: true, message: 'Servidor GRD activo 🚀' }));

app.use('/auth', authRoutes);
app.use('/usuarios', usersRoutes);

// 404
app.use((req, res) => res.status(404).json({ message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` }));

export default app;
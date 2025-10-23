import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './middlewares/error';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, message: 'Servidor GRD activo' });
});

app.use('/auth', authRoutes);
app.use('/usuarios', usersRoutes);

app.use(errorHandler);
export default app;
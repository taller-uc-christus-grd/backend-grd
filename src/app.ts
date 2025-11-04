import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import exportRoutes from './routes/export.routes';
import uploadRoutes from './routes/upload.routes';
import episodiosRoutes from './routes/episodios.routes';
import respaldosRoutes from './routes/respaldos.routes';
import { errorHandler } from './middlewares/error';

dotenv.config();

const app = express();

// Trust proxy (para rate limiting detrás de proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:3000']; // Default para desarrollo local

app.use(cors({ 
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Log CORS configuration en desarrollo
if (process.env.NODE_ENV !== 'production') {
  console.log('🌐 CORS configurado para:', corsOrigins);
}

// Rate limiting
app.use(rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { error: 'Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde.' }
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ 
    ok: true, 
    message: 'Servidor GRD activo 🚀',
    timestamp: new Date().toISOString(),
    service: 'backend-grd'
  });
});

// API Routes
app.use('/api/auth', authRoutes); // Cambiado de /auth a /api/auth para coincidir con el frontend
app.use('/api/users', usersRoutes); // Cambiado de /usuarios a /api/users para coincidir con el frontend
app.use('/api', exportRoutes);
app.use('/api', uploadRoutes);
app.use('/api', episodiosRoutes);
app.use('/api', respaldosRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Ruta no encontrada', 
    path: req.originalUrl,
    method: req.method
  });
});

// Error handler (debe ir al final)
app.use(errorHandler);

export default app;
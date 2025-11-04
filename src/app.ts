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
import { prisma } from './db/client';

dotenv.config();

const app = express();

// Trust proxy (para rate limiting detrás de proxy)
app.set('trust proxy', 1);

// CORS configuration - DEBE IR ANTES DE HELMET
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:3000']; // Default para desarrollo local

app.use(cors({ 
  origin: (origin, callback) => {
    // Permitir peticiones sin origen (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Verificar si el origen está en la lista permitida
    if (corsOrigins.includes('*') || corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('🚫 Origen no permitido:', origin);
      console.warn('🌐 Orígenes permitidos:', corsOrigins);
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Log CORS configuration (siempre mostrar para debugging)
console.log('🌐 CORS configurado para:', corsOrigins);
console.log('🌐 NODE_ENV:', process.env.NODE_ENV || 'development');

// Security middleware - Configurar Helmet para no bloquear CORS
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting - Excluir peticiones OPTIONS (preflight)
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { error: 'Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde.' },
  skip: (req) => req.method === 'OPTIONS' // No limitar peticiones OPTIONS
});

app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', async (_req, res) => {
  const health = {
    ok: true,
    message: 'Servidor GRD activo 🚀',
    timestamp: new Date().toISOString(),
    service: 'backend-grd',
    database: 'unknown' as 'connected' | 'disconnected' | 'unknown',
    environment: process.env.NODE_ENV || 'development',
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    hasJwtSecret: !!process.env.JWT_SECRET,
    corsOrigin: process.env.CORS_ORIGIN || 'not configured'
  };

  // Verificar conexión a la base de datos
  try {
    await prisma.$queryRaw`SELECT 1`;
    health.database = 'connected';
  } catch (error: any) {
    health.database = 'disconnected';
    health.ok = false;
    health.message = 'Servidor activo pero base de datos desconectada';
    console.error('❌ Error al verificar conexión a la base de datos:', error?.message || error);
  }

  const statusCode = health.ok ? 200 : 503;
  res.status(statusCode).json(health);
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
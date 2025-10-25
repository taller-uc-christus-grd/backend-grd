// app.js (fusionado y ordenado)
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const exportRoutes = require('./routes/export');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// Si hay proxy/reverse-proxy (Nginx/Heroku/Cloudflare)
app.set('trust proxy', 1);

// Seguridad
app.use(helmet());

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'])
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde.' },
});
app.use(limiter);

// Parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Salud
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'backend-grd'
  });
});

// Rutas (ambas bajo /api)
app.use('/api', exportRoutes);  // debe exponer internamente /export
app.use('/api', uploadRoutes);  // debe exponer internamente /upload

// 404 (después de rutas)
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.originalUrl });
});

// Errores (al final del todo)
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El archivo es demasiado grande', maxSize: '10MB' });
  }

  res.status(500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📤 Export endpoint: http://localhost:${PORT}/api/export`);
  console.log(`📁 Upload endpoint: http://localhost:${PORT}/api/upload`);
});

module.exports = app;


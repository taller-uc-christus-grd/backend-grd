import dotenv from 'dotenv';
dotenv.config();

import app from './app';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 GRD Backend escuchando en http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Login endpoint: http://localhost:${PORT}/api/auth/login`);
});

// Manejar errores del servidor
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;

  switch (error.code) {
    case 'EACCES':
      console.error(`❌ ${bind} requiere privilegios elevados`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`❌ ${bind} ya está en uso`);
      console.error(`💡 Solución: Detén el proceso que está usando el puerto ${PORT} con uno de estos comandos:`);
      console.error(`   • kill $(lsof -ti:${PORT})`);
      console.error(`   • kill -9 $(lsof -ti:${PORT})  (si el anterior no funciona)`);
      console.error(`   • O cambia el puerto en tu archivo .env: PORT=3001`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});

// Mantener el proceso vivo y manejar señales de terminación
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM recibido, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT recibido, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

// Manejar errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
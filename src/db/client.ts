import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? process.env.PRISMA_LOG_QUERIES === 'true' 
      ? ['query', 'error', 'warn'] 
      : ['error', 'warn'] // Solo errores y warnings, no queries (muy verboso)
    : ['error'],
  errorFormat: 'pretty',
});

// Conectar a la base de datos de manera asíncrona (no bloquea)
prisma.$connect()
  .then(() => {
    console.log('✅ Conectado a la base de datos');
  })
  .catch((error) => {
    console.error('❌ Error al conectar con la base de datos:', error?.message || error);
    if (!process.env.DATABASE_URL) {
      console.error('⚠️  DATABASE_URL no está configurada');
    } else {
      console.error('⚠️  DATABASE_URL está configurada pero la conexión falló');
    }
  });

// Manejar desconexión graceful
let isShuttingDown = false;
const gracefulShutdown = async () => {
  if (isShuttingDown) return; // Evitar múltiples desconexiones
  isShuttingDown = true;
  
  try {
    await prisma.$disconnect();
    console.log('👋 Desconectado de la base de datos');
  } catch (error) {
    console.error('❌ Error al desconectar de la base de datos:', error);
  }
};

// Solo manejar señales de terminación, no beforeExit (se dispara incorrectamente)
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
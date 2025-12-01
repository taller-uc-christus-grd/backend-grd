// Setup global para tests
import dotenv from 'dotenv';

// Cargar variables de entorno de prueba
dotenv.config({ path: '.env.test' });

// Mock de Prisma Client
jest.mock('../db/client', () => {
  const mockPrisma = {
    usuario: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    logSistema: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    configuracionSistema: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  return { prisma: mockPrisma };
});

// Mock de logger
jest.mock('../utils/logger', () => ({
  logLogin: jest.fn().mockResolvedValue(undefined),
  logAdminAction: jest.fn().mockResolvedValue(undefined),
  createLog: jest.fn().mockResolvedValue(undefined),
}));

// Configurar variables de entorno para tests
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';


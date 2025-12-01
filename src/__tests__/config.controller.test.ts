import { Request, Response } from 'express';
import {
  getConfig,
  getConfigByKey,
  updateConfig,
} from '../controllers/config.controller';
import { prisma } from '../db/client';
import { logAdminAction } from '../utils/logger';

// Mock de dependencias
jest.mock('../utils/logger');

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockLogAdminAction = logAdminAction as jest.MockedFunction<typeof logAdminAction>;

describe('Config Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      body: {},
      params: {},
      query: {},
      user: { id: '1', role: 'admin' },
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  });

  describe('getConfig', () => {
    it('debe retornar todas las configuraciones del sistema', async () => {
      const mockConfigs = [
        {
          clave: 'maxFileSizeMB',
          valor: '10',
          tipo: 'number',
          descripcion: 'Tamaño máximo de archivo en MB',
        },
        {
          clave: 'sessionTimeout',
          valor: '30',
          tipo: 'number',
          descripcion: 'Timeout de sesión en minutos',
        },
        {
          clave: 'enableNotifications',
          valor: 'true',
          tipo: 'boolean',
          descripcion: 'Habilitar notificaciones',
        },
        {
          clave: 'allowedOrigins',
          valor: '["http://localhost:3000"]',
          tipo: 'json',
          descripcion: 'Orígenes permitidos',
        },
      ];

      (mockPrisma.configuracionSistema.findMany as jest.Mock).mockResolvedValue(mockConfigs);

      await getConfig(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.configuracionSistema.findMany).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({
        maxFileSizeMB: 10,
        sessionTimeout: 30,
        enableNotifications: true,
        allowedOrigins: ['http://localhost:3000'],
      });
    });


    it('debe manejar errores al obtener configuraciones', async () => {
      (mockPrisma.configuracionSistema.findMany as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await getConfig(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Error obteniendo configuración del sistema',
      });
    });

    it('debe manejar JSON inválido en configuraciones', async () => {
      const mockConfigs = [
        {
          clave: 'invalidJson',
          valor: '{invalid json}',
          tipo: 'json',
          descripcion: 'JSON inválido',
        },
      ];

      (mockPrisma.configuracionSistema.findMany as jest.Mock).mockResolvedValue(mockConfigs);

      await getConfig(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalled();
    });
  });

  describe('getConfigByKey', () => {
    it('debe retornar una configuración específica por clave', async () => {
      mockRequest.params = { clave: 'maxFileSizeMB' };

      const mockConfig = {
        clave: 'maxFileSizeMB',
        valor: '10',
        tipo: 'number',
        descripcion: 'Tamaño máximo de archivo en MB',
      };

      (mockPrisma.configuracionSistema.findUnique as jest.Mock).mockResolvedValue(mockConfig);

      await getConfigByKey(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.configuracionSistema.findUnique).toHaveBeenCalledWith({
        where: { clave: 'maxFileSizeMB' },
      });
      expect(mockResponse.json).toHaveBeenCalledWith({
        clave: 'maxFileSizeMB',
        valor: 10,
        tipo: 'number',
      });
    });

    it('debe retornar error 404 si la configuración no existe', async () => {
      mockRequest.params = { clave: 'nonExistent' };

      (mockPrisma.configuracionSistema.findUnique as jest.Mock).mockResolvedValue(null);

      await getConfigByKey(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Configuración no encontrada',
      });
    });

  });

  describe('updateConfig', () => {
    it('debe actualizar configuraciones exitosamente', async () => {
      mockRequest.body = {
        configuracion: {
          maxFileSizeMB: 20,
          sessionTimeout: 60,
        },
      };

      const mockUpdatedConfigs = [
        {
          clave: 'maxFileSizeMB',
          valor: '20',
          tipo: 'number',
        },
        {
          clave: 'sessionTimeout',
          valor: '60',
          tipo: 'number',
        },
      ];

      (mockPrisma.configuracionSistema.upsert as jest.Mock).mockResolvedValue({});
      (mockPrisma.configuracionSistema.findMany as jest.Mock).mockResolvedValue(mockUpdatedConfigs);

      await updateConfig(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.configuracionSistema.upsert).toHaveBeenCalledTimes(2);
      expect(mockLogAdminAction).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({
        maxFileSizeMB: 20,
        sessionTimeout: 60,
      });
    });

    it('debe retornar error 400 si falta el objeto configuracion', async () => {
      mockRequest.body = {};

      await updateConfig(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Se requiere objeto configuracion',
      });
    });


    it('debe manejar errores al actualizar configuración', async () => {
      mockRequest.body = {
        configuracion: {
          maxFileSizeMB: 20,
        },
      };

      (mockPrisma.configuracionSistema.upsert as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await updateConfig(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Error actualizando configuración del sistema',
      });
    });
  });
});


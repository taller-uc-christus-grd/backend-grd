import { Request, Response } from 'express';
import { getLogs } from '../controllers/logs.controller';
import { prisma } from '../db/client';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Logs Controller', () => {
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

  describe('getLogs', () => {
    it('debe retornar logs del sistema sin filtros', async () => {
      const mockLogs = [
        {
          id: 1,
          level: 'info',
          message: 'Test log message',
          action: 'Test action',
          endpoint: '/api/test',
          metadata: { ip: '127.0.0.1' },
          createdAt: new Date('2024-01-01'),
          usuario: {
            id: 1,
            nombre: 'Test User',
            email: 'test@example.com',
          },
        },
      ];

      (mockPrisma.logSistema.findMany as jest.Mock).mockResolvedValue(mockLogs);
      (mockPrisma.logSistema.count as jest.Mock).mockResolvedValue(1);

      await getLogs(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.logSistema.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: 'desc' },
          take: 100,
          skip: 0,
        })
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        logs: expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            user: 'test@example.com',
            userName: 'Test User',
            action: 'Test action',
            type: 'info',
            ip: '127.0.0.1',
          }),
        ]),
        total: 1,
        limit: 100,
        offset: 0,
      });
    });

    it('debe filtrar logs por nivel', async () => {
      mockRequest.query = { level: 'error' };

      const mockLogs = [
        {
          id: 1,
          level: 'error',
          message: 'Error log message',
          action: 'Error action',
          endpoint: '/api/error',
          metadata: { ip: '127.0.0.1' },
          createdAt: new Date('2024-01-01'),
          usuario: null,
        },
      ];

      (mockPrisma.logSistema.findMany as jest.Mock).mockResolvedValue(mockLogs);
      (mockPrisma.logSistema.count as jest.Mock).mockResolvedValue(1);

      await getLogs(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.logSistema.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { level: 'error' },
        })
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          logs: expect.arrayContaining([
            expect.objectContaining({
              type: 'error',
            }),
          ]),
        })
      );
    });

    it('debe manejar logs con metadata sin ip', async () => {
      const mockLogs = [
        {
          id: 1,
          level: 'info',
          message: 'Test log',
          action: 'Test action',
          endpoint: '/api/test',
          metadata: { other: 'data' },
          createdAt: new Date('2024-01-01'),
          usuario: null,
        },
      ];

      (mockPrisma.logSistema.findMany as jest.Mock).mockResolvedValue(mockLogs);
      (mockPrisma.logSistema.count as jest.Mock).mockResolvedValue(1);

      await getLogs(mockRequest as Request, mockResponse as Response);

      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.logs[0].ip).toBe('N/A');
    });


    it('debe manejar errores al obtener logs', async () => {
      (mockPrisma.logSistema.findMany as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await getLogs(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Error obteniendo logs del sistema',
      });
    });

  });
});


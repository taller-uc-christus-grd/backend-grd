import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { signup, login, me } from '../controllers/auth.controller';
import { prisma } from '../db/client';
import { logLogin } from '../utils/logger';
import { signToken } from '../utils/jwt';

// Mock de dependencias
jest.mock('bcryptjs');
jest.mock('../utils/jwt');
jest.mock('../utils/logger');

const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockLogLogin = logLogin as jest.MockedFunction<typeof logLogin>;
const mockSignToken = signToken as jest.MockedFunction<typeof signToken>;

describe('Auth Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    // Resetear mocks
    jest.clearAllMocks();

    // Mock de Request
    mockRequest = {
      body: {},
      ip: '127.0.0.1',
      user: undefined,
    };

    // Mock de Response
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe('signup', () => {
    it('debe crear un usuario exitosamente', async () => {
      const userData = {
        nombre: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      };

      mockRequest.body = userData;
      mockBcrypt.hash.mockResolvedValue('hashedPassword' as never);
      mockSignToken.mockReturnValue('mockToken');
      
      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.usuario.create as jest.Mock).mockResolvedValue({
        id: 1,
        nombre: 'Test User',
        email: 'test@example.com',
        rol: 'CODIFICADOR',
        activo: true,
      });

      await signup(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(mockBcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(mockPrisma.usuario.create).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'mockToken',
          user: expect.objectContaining({
            email: 'test@example.com',
          }),
        })
      );
    });

    it('debe retornar error 400 si faltan campos obligatorios', async () => {
      mockRequest.body = { email: 'test@example.com' };

      await signup(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'nombre, email y password son obligatorios',
      });
    });

    it('debe retornar error 409 si el usuario ya existe', async () => {
      const userData = {
        nombre: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      };

      mockRequest.body = userData;
      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        email: 'test@example.com',
      });

      await signup(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'El usuario ya existe',
      });
    });
  });

  describe('login', () => {
    it('debe hacer login exitosamente con credenciales válidas', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
      };

      mockRequest.body = loginData;
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockSignToken.mockReturnValue('mockToken');

      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        nombre: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hashedPassword',
        rol: 'CODIFICADOR',
        activo: true,
      });

      (mockPrisma.usuario.update as jest.Mock).mockResolvedValue({
        id: 1,
        lastAccessAt: new Date(),
      });

      await login(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        select: expect.any(Object),
      });
      expect(mockBcrypt.compare).toHaveBeenCalledWith('password123', 'hashedPassword');
      expect(mockLogLogin).toHaveBeenCalledWith(1, true, '127.0.0.1', 'test@example.com');
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'mockToken',
          user: expect.objectContaining({
            email: 'test@example.com',
          }),
        })
      );
    });

    it('debe retornar error 400 si faltan email o password', async () => {
      mockRequest.body = { email: 'test@example.com' };

      await login(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'email y password son obligatorios',
      });
    });

    it('debe retornar error 401 si el usuario no existe', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
      };

      mockRequest.body = loginData;
      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Credenciales inválidas',
      });
      expect(mockLogLogin).toHaveBeenCalledWith(null, false, '127.0.0.1', 'test@example.com');
    });

    it('debe retornar error 401 si la contraseña es incorrecta', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      mockRequest.body = loginData;
      mockBcrypt.compare.mockResolvedValue(false as never);

      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        nombre: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hashedPassword',
        rol: 'CODIFICADOR',
        activo: true,
      });

      await login(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Credenciales inválidas',
      });
      expect(mockLogLogin).toHaveBeenCalledWith(1, false, '127.0.0.1', 'test@example.com');
    });

    it('debe retornar error 403 si el usuario está inactivo', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
      };

      mockRequest.body = loginData;

      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        nombre: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hashedPassword',
        rol: 'CODIFICADOR',
        activo: false,
      });

      await login(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Usuario inactivo. Contacta al administrador.',
      });
      expect(mockLogLogin).toHaveBeenCalledWith(1, false, '127.0.0.1', 'test@example.com');
    });
  });

  describe('me', () => {
    it('debe retornar la información del usuario autenticado', async () => {
      mockRequest.user = { id: '1', role: 'codificador' };

      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        nombre: 'Test User',
        email: 'test@example.com',
        rol: 'CODIFICADOR',
      });

      await me(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: expect.any(Object),
      });
      expect(mockResponse.json).toHaveBeenCalledWith({
        user: expect.objectContaining({
          id: '1',
          nombre: 'Test User',
          email: 'test@example.com',
        }),
      });
    });

    it('debe retornar error 404 si el usuario no existe', async () => {
      mockRequest.user = { id: '999', role: 'codificador' };

      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue(null);

      await me(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Usuario no encontrado',
      });
    });
  });
});


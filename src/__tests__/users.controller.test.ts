import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  toggleUserStatus,
} from '../controllers/users.controller';
import { prisma } from '../db/client';
import { logAdminAction } from '../utils/logger';

// Mock de dependencias
jest.mock('bcryptjs');
jest.mock('../utils/logger');

const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockLogAdminAction = logAdminAction as jest.MockedFunction<typeof logAdminAction>;

describe('Users Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      body: {},
      params: {},
      user: { id: '1', role: 'admin' },
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  });

  describe('listUsers', () => {
    it('debe retornar la lista de usuarios', async () => {
      const mockUsers = [
        {
          id: 1,
          nombre: 'User 1',
          email: 'user1@example.com',
          rol: 'CODIFICADOR',
          activo: true,
          lastAccessAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          nombre: 'User 2',
          email: 'user2@example.com',
          rol: 'ADMIN',
          activo: true,
          lastAccessAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (mockPrisma.usuario.findMany as jest.Mock).mockResolvedValue(mockUsers);

      await listUsers(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.usuario.findMany).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            email: 'user1@example.com',
            rol: 'codificador',
          }),
        ])
      );
    });

    it('debe manejar errores al listar usuarios', async () => {
      (mockPrisma.usuario.findMany as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await listUsers(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Error listando usuarios',
      });
    });
  });

  describe('createUser', () => {
    it('debe crear un usuario exitosamente', async () => {
      const userData = {
        nombre: 'New User',
        email: 'newuser@example.com',
        password: 'password123',
        rol: 'CODIFICADOR',
        activo: true,
      };

      mockRequest.body = userData;
      mockBcrypt.hash.mockResolvedValue('hashedPassword' as never);

      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.usuario.create as jest.Mock).mockResolvedValue({
        id: 3,
        nombre: 'New User',
        email: 'newuser@example.com',
        rol: 'CODIFICADOR',
        activo: true,
        lastAccessAt: null,
        createdAt: new Date(),
      });

      await createUser(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { email: 'newuser@example.com' },
      });
      expect(mockBcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(mockPrisma.usuario.create).toHaveBeenCalled();
      expect(mockLogAdminAction).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('debe retornar error 400 si faltan campos obligatorios', async () => {
      mockRequest.body = { email: 'test@example.com' };

      await createUser(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'nombre, email y password son obligatorios',
      });
    });

    it('debe retornar error 409 si el usuario ya existe', async () => {
      const userData = {
        nombre: 'New User',
        email: 'existing@example.com',
        password: 'password123',
      };

      mockRequest.body = userData;
      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        email: 'existing@example.com',
      });

      await createUser(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'El usuario ya existe',
      });
    });
  });

  describe('updateUser', () => {
    it('debe actualizar un usuario exitosamente', async () => {
      mockRequest.params = { id: '1' };
      mockRequest.body = {
        nombre: 'Updated Name',
        email: 'updated@example.com',
      };

      (mockPrisma.usuario.update as jest.Mock).mockResolvedValue({
        id: 1,
        nombre: 'Updated Name',
        email: 'updated@example.com',
        rol: 'CODIFICADOR',
        activo: true,
        lastAccessAt: null,
        updatedAt: new Date(),
      });

      await updateUser(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          nombre: 'Updated Name',
          email: 'updated@example.com',
        }),
        select: expect.any(Object),
      });
      expect(mockLogAdminAction).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('debe actualizar la contraseña si se proporciona', async () => {
      mockRequest.params = { id: '1' };
      mockRequest.body = { password: 'newpassword123' };
      mockBcrypt.hash.mockResolvedValue('newHashedPassword' as never);

      (mockPrisma.usuario.update as jest.Mock).mockResolvedValue({
        id: 1,
        nombre: 'Test User',
        email: 'test@example.com',
        rol: 'CODIFICADOR',
        activo: true,
        lastAccessAt: null,
        updatedAt: new Date(),
      });

      await updateUser(mockRequest as Request, mockResponse as Response);

      expect(mockBcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
      expect(mockPrisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          passwordHash: 'newHashedPassword',
        }),
        select: expect.any(Object),
      });
    });

    it('debe retornar error 404 si el usuario no existe', async () => {
      mockRequest.params = { id: '999' };
      mockRequest.body = { nombre: 'Updated Name' };

      (mockPrisma.usuario.update as jest.Mock).mockRejectedValue({
        code: 'P2025',
      });

      await updateUser(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Usuario no encontrado',
      });
    });
  });

  describe('deleteUser', () => {
    it('debe eliminar un usuario exitosamente', async () => {
      mockRequest.params = { id: '1' };

      (mockPrisma.usuario.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        email: 'test@example.com',
      });
      (mockPrisma.usuario.delete as jest.Mock).mockResolvedValue({
        id: 1,
      });

      await deleteUser(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(mockPrisma.usuario.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(mockLogAdminAction).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(204);
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('debe retornar error 404 si el usuario no existe', async () => {
      mockRequest.params = { id: '999' };

      (mockPrisma.usuario.delete as jest.Mock).mockRejectedValue({
        code: 'P2025',
      });

      await deleteUser(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Usuario no encontrado',
      });
    });
  });

  describe('toggleUserStatus', () => {
    it('debe cambiar el estado de un usuario exitosamente', async () => {
      mockRequest.params = { id: '1' };
      mockRequest.body = { activo: false };

      (mockPrisma.usuario.update as jest.Mock).mockResolvedValue({
        id: 1,
        nombre: 'Test User',
        email: 'test@example.com',
        rol: 'CODIFICADOR',
        activo: false,
        lastAccessAt: null,
        updatedAt: new Date(),
      });

      await toggleUserStatus(mockRequest as Request, mockResponse as Response);

      expect(mockPrisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { activo: false },
        select: expect.any(Object),
      });
      expect(mockLogAdminAction).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('debe retornar error 400 si falta el campo activo', async () => {
      mockRequest.params = { id: '1' };
      mockRequest.body = {};

      await toggleUserStatus(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'El campo activo es obligatorio',
      });
    });

    it('debe retornar error 404 si el usuario no existe', async () => {
      mockRequest.params = { id: '999' };
      mockRequest.body = { activo: false };

      (mockPrisma.usuario.update as jest.Mock).mockRejectedValue({
        code: 'P2025',
      });

      await toggleUserStatus(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Usuario no encontrado',
      });
    });
  });
});


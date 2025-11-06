import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/client';
import { logAdminAction } from '../utils/logger';

export async function listUsers(req: Request, res: Response) {
  try {
    const users = await prisma.usuario.findMany({
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        createdAt: true,
        updatedAt: true
      }
    });
    const usersLowercase = users.map(u => ({ ...u, rol: u.rol.toLowerCase() }));
    
    // No logueamos listUsers porque se llama frecuentemente al cargar la página
    // Solo logueamos acciones que modifican datos (crear, editar, eliminar)
    
    return res.json(usersLowercase);
  } catch (error: any) {
    console.error('Error listando usuarios:', error);
    return res.status(500).json({ message: 'Error listando usuarios' });
  }
}

export async function createUser(req: Request, res: Response) {
  try {
    const { nombre, email, password, rol, activo } = req.body as {
      nombre: string;
      email: string;
      password: string;
      rol?: string;
      activo?: boolean;
    };

    if (!nombre || !email || !password) {
      return res.status(400).json({ message: 'nombre, email y password son obligatorios' });
    }

    const existe = await prisma.usuario.findUnique({ where: { email } });
    if (existe) {
      return res.status(409).json({ message: 'El usuario ya existe' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const usuario = await prisma.usuario.create({
      data: {
        nombre,
        email,
        passwordHash,
        rol: rol || 'CODIFICADOR',
        activo: activo !== undefined ? activo : true
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        createdAt: true
      }
    });

    // Log de acción administrativa
    const userId = parseInt(req.user!.id);
    await logAdminAction(userId, 'Usuario creado', `Nuevo usuario: ${email} con rol ${rol || 'CODIFICADOR'}`, {
      createdUserId: usuario.id,
      createdUserEmail: email,
      role: rol || 'CODIFICADOR'
    });

    return res.status(201).json({ ...usuario, rol: usuario.rol.toLowerCase() });
  } catch (error: any) {
    console.error('Error creando usuario:', error);
    return res.status(500).json({ message: 'Error creando usuario' });
  }
}

export async function updateUser(req: Request, res: Response) {
  try {
  const { id } = req.params;
    const { nombre, email, rol, password, activo } = req.body as {
      nombre?: string;
      email?: string;
      rol?: string;
      password?: string;
      activo?: boolean;
    };

    const data: any = {};
    if (nombre !== undefined) data.nombre = nombre;
    if (email !== undefined) data.email = email;
    if (rol !== undefined) data.rol = rol;
    if (activo !== undefined) data.activo = activo;
    if (password) data.passwordHash = await bcrypt.hash(password, 10);

    const usuario = await prisma.usuario.update({
      where: { id: parseInt(id) },
      data,
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        updatedAt: true
      }
    });

    // Log de acción administrativa
    const userId = parseInt(req.user!.id);
    await logAdminAction(userId, 'Usuario actualizado', `Usuario ID ${id} actualizado`, {
      updatedUserId: parseInt(id),
      changes: Object.keys(data)
    });

    return res.json({ ...usuario, rol: usuario.rol.toLowerCase() });;
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    console.error('Error actualizando usuario:', error);
    return res.status(500).json({ message: 'Error actualizando usuario' });
  }
}

export async function deleteUser(req: Request, res: Response) {
  try {
  const { id } = req.params;
    const deletedUser = await prisma.usuario.findUnique({ where: { id: parseInt(id) } });
    await prisma.usuario.delete({ where: { id: parseInt(id) } });
    
    // Log de acción administrativa
    const userId = parseInt(req.user!.id);
    await logAdminAction(userId, 'Usuario eliminado', `Usuario ID ${id} eliminado`, {
      deletedUserId: parseInt(id),
      deletedUserEmail: deletedUser?.email
    });
    
    return res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    console.error('Error eliminando usuario:', error);
    return res.status(500).json({ message: 'Error eliminando usuario' });
  }
}

export async function toggleUserStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { activo } = req.body as {
      activo?: boolean;
    };

    if (activo === undefined) {
      return res.status(400).json({ message: 'El campo activo es obligatorio' });
    }

    const usuario = await prisma.usuario.update({
      where: { id: parseInt(id) },
      data: { activo },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
        updatedAt: true
      }
    });

    // Log de acción administrativa
    const userId = parseInt(req.user!.id);
    await logAdminAction(userId, 'Estado de usuario cambiado', `Usuario ID ${id} ${activo ? 'activado' : 'desactivado'}`, {
      updatedUserId: parseInt(id),
      newStatus: activo
    });

    return res.json({ ...usuario, rol: usuario.rol.toLowerCase() });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    console.error('Error cambiando estado del usuario:', error);
    return res.status(500).json({ message: 'Error cambiando estado del usuario' });
  }
}

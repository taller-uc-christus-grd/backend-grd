import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { signToken } from '../utils/jwt';
import { prisma } from '../db/client';

// Las constantes 'ROLES' y 'Rol' se eliminaron ya que no se usaban.

export async function signup(req: Request, res: Response) {
  try {
    const { nombre, email, password, rol } = req.body as {
      nombre: string;
      email: string;
      password: string;
      rol?: string;
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
        rol: rol || 'CODIFICADOR' // El rol es un string, coherente con el schema
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true
      }
    });

    const token = signToken({ id: usuario.id.toString(), role: usuario.rol });
    // Convertir el rol a minúsculas y usar 'role' en lugar de 'rol' para coincidir con el frontend
    const roleLower = usuario.rol.toLowerCase();
    return res.status(201).json({
      token,
      user: {
        id: usuario.id.toString(), // Asegurar que sea string
        nombre: usuario.nombre,
        email: usuario.email,
        role: roleLower, // Cambiado de 'rol' a 'role' para coincidir con el frontend
      }
    });
  } catch (error: any) {
    console.error('Error en signup:', error);
    return res.status(500).json({ message: 'Error en signup' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body as {
      email: string;
      password: string;
    };

    if (!email || !password) {
      return res.status(400).json({ message: 'email y password son obligatorios' });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: {
        id: true,
        nombre: true,
        email: true,
        passwordHash: true,
        rol: true,
        activo: true
      }
    });

    if (!usuario) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Verificar si el usuario está inactivo
    if (!usuario.activo) {
      return res.status(403).json({ message: 'Usuario inactivo. Contacta al administrador.' });
    }

    const passwordValido = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValido) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const token = signToken({ id: usuario.id.toString(), role: usuario.rol });
    // Convertir el rol a minúsculas y usar 'role' en lugar de 'rol' para coincidir con el frontend
    const roleLower = usuario.rol.toLowerCase();
    return res.json({
      token,
      user: {
        id: usuario.id.toString(), // Asegurar que sea string
        nombre: usuario.nombre,
        email: usuario.email,
        role: roleLower, // Cambiado de 'rol' a 'role' para coincidir con el frontend
      }
    });
  } catch (error: any) {
    console.error('❌ Error en login:', {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      name: error?.name,
      body: req.body
    });
    return res.status(500).json({ 
      message: 'Error en login',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
}

export async function me(req: Request, res: Response) {
  // Simplemente obtenemos el usuario del token y lo devolvemos
  // (El token ya tiene el rol correcto, pero si lo buscáramos en la DB, haríamos .toLowerCase())
  const userPayload = req.user;
  
  // Para asegurar coherencia, buscamos al usuario
  const usuario = await prisma.usuario.findUnique({
    where: { id: parseInt(req.user!.id) },
    select: { id: true, nombre: true, email: true, rol: true }
  });

  if (!usuario) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }

  return res.json({
    user: {
      id: usuario.id.toString(), // Asegurar que sea string
      nombre: usuario.nombre,
      email: usuario.email,
      role: usuario.rol.toLowerCase(), // Cambiado de 'rol' a 'role' para coincidir con el frontend
    },
  });
}
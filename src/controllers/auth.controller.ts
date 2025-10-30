import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { signToken } from '../utils/jwt';
import { prisma } from '../db/client';

const ROLES = ['ADMIN', 'CODIFICADOR', 'FINANZAS', 'GESTION'] as const;
type Rol = typeof ROLES[number];

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
        rol: rol || 'CODIFICADOR'
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
    return res.status(201).json({
      token,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol
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

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const passwordValido = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValido) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const token = signToken({ id: usuario.id.toString(), role: usuario.rol });
    return res.json({
      token,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol
      }
    });
  } catch (error: any) {
    console.error('Error en login:', error);
    return res.status(500).json({ message: 'Error en login' });
  }
}

export function me(req: Request, res: Response) {
  return res.json({ user: req.user });
}
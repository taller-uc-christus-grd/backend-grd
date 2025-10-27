import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { signToken } from '../utils/jwt';

const prisma = new PrismaClient();

export async function signup(req: Request, res: Response) {
  try {
    const { name, email, password, role } = req.body as { name:string; email:string; password:string; role?:Role };
    if (!name || !email || !password) return res.status(400).json({ message: 'name, email y password son obligatorios' });
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ message: 'El usuario ya existe' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, password: hashed, role: role || Role.CODIFICADOR } });
    const token = signToken({ id: user.id, role: user.role });
    return res.status(201).json({ token, user: { id:user.id, name:user.name, email:user.email, role:user.role } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Error en signup' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body as { email:string; password:string };
    if (!email || !password) return res.status(400).json({ message: 'email y password son obligatorios' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }
    const token = signToken({ id: user.id, role: user.role });
    return res.json({ token, user: { id:user.id, name:user.name, email:user.email, role:user.role } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Error en login' });
  }
}

export function me(req: Request, res: Response) {
  return res.json({ user: req.user });
}
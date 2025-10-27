import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

export async function listUsers(_req: Request, res: Response) {
  const users = await prisma.user.findMany({ select:{id:true,name:true,email:true,role:true,createdAt:true} });
  res.json(users);
}

export async function createUser(req: Request, res: Response) {
  try {
    const { name, email, password, role } = req.body as { name:string; email:string; password:string; role?:Role };
    if (!name || !email || !password) return res.status(400).json({ message: 'name, email y password son obligatorios' });
    const exist = await prisma.user.findUnique({ where: { email } });
    if (exist) return res.status(409).json({ message: 'El usuario ya existe' });
    const hashed = await bcrypt.hash(password, 10);
    const u = await prisma.user.create({
      data:{ name,email,password:hashed,role:role||Role.CODIFICADOR },
      select:{id:true,name:true,email:true,role:true,createdAt:true}
    });
    res.status(201).json(u);
  } catch (e) {
    console.error(e); res.status(500).json({ message: 'Error creando usuario' });
  }
}

export async function updateUser(req: Request, res: Response) {
  const { id } = req.params;
  const { name, email, role, password } = req.body as { name?:string; email?:string; role?:Role; password?:string };
  const data:any = {};
  if (name) data.name = name;
  if (email) data.email = email;
  if (role) data.role = role;
  if (password) data.password = await bcrypt.hash(password, 10);
  const u = await prisma.user.update({ where:{ id }, data, select:{id:true,name:true,email:true,role:true} });
  res.json(u);
}

export async function deleteUser(req: Request, res: Response) {
  const { id } = req.params;
  await prisma.user.delete({ where: { id } });
  res.status(204).send();
}
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { signToken } from '../utils/jwt';
import { prisma } from '../db/client';
import { logLogin } from '../utils/logger';

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

    // Normalizar el rol: eliminar tildes, espacios, convertir a minúsculas para el token
    const normalizeRoleForToken = (rol: string): string => {
      return rol
        .toLowerCase()
        .normalize('NFD') // Descompone caracteres con tildes (é -> e + ´)
        .replace(/[\u0300-\u036f]/g, '') // Elimina los diacríticos (tildes)
        .trim() // Elimina espacios al inicio y final
        .replace(/\s+/g, ''); // Elimina espacios internos
    };
    
    const roleNormalized = normalizeRoleForToken(usuario.rol);
    const token = signToken({ id: usuario.id.toString(), role: roleNormalized });
    
    return res.status(201).json({
      token,
      user: {
        id: usuario.id.toString(), // Asegurar que sea string
        nombre: usuario.nombre,
        email: usuario.email,
        role: roleNormalized, // Rol normalizado (sin tildes, sin espacios, minúsculas)
      }
    });
  } catch (error: any) {
    console.error('Error en signup:', error);
    return res.status(500).json({ message: 'Error en signup' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    console.log('🔐 Iniciando proceso de login...');
    const { email, password } = req.body as {
      email: string;
      password: string;
    };
    console.log(`📧 Email recibido: ${email}`);

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
      // Log de intento de login con email inexistente
      // No tenemos userId, así que creamos un log sin userId
      await logLogin(null, false, req.ip, email);
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Verificar si el usuario está inactivo
    if (!usuario.activo) {
      // Log de intento de login con usuario inactivo
      await logLogin(usuario.id, false, req.ip, email);
      return res.status(403).json({ message: 'Usuario inactivo. Contacta al administrador.' });
    }

    const passwordValido = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValido) {
      // Log de intento fallido
      await logLogin(usuario.id, false, req.ip, email);
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Actualizar fecha de último acceso (solo en login exitoso)
    // Envolvemos en try-catch para que no rompa el login si falla
    try {
      const now = new Date();
      console.log(`🔄 Intentando actualizar lastAccessAt para usuario ${usuario.id} (${usuario.email}) a las ${now.toISOString()}`);
      
      const updated = await prisma.usuario.update({
        where: { id: usuario.id },
        data: { lastAccessAt: now },
        select: { id: true, lastAccessAt: true }
      });
      
      console.log(`✅ lastAccessAt actualizado exitosamente para usuario ${usuario.id} (${usuario.email})`);
      console.log(`   Valor actualizado: ${updated.lastAccessAt?.toISOString()}`);
    } catch (updateError: any) {
      // Log del error pero no rompemos el flujo del login
      console.error('⚠️ Error al actualizar lastAccessAt:', {
        userId: usuario.id,
        email: usuario.email,
        error: updateError?.message,
        code: updateError?.code,
        meta: updateError?.meta,
        stack: updateError?.stack
      });
      // Si el error es porque la columna no existe, es un problema de migración
      if (updateError?.code === 'P2025' || updateError?.message?.includes('Unknown column') || updateError?.code === 'P2002') {
        console.error('❌ CRÍTICO: La columna lastAccessAt no existe o hay un problema de migración. Ejecuta la migración en producción.');
      }
    }

    // Log de login exitoso
    await logLogin(usuario.id, true, req.ip, usuario.email);

    // Normalizar el rol: eliminar tildes, espacios, convertir a minúsculas para el token
    const normalizeRoleForToken = (rol: string): string => {
      return rol
        .toLowerCase()
        .normalize('NFD') // Descompone caracteres con tildes (é -> e + ´)
        .replace(/[\u0300-\u036f]/g, '') // Elimina los diacríticos (tildes)
        .trim() // Elimina espacios al inicio y final
        .replace(/\s+/g, ''); // Elimina espacios internos
    };
    
    const roleNormalized = normalizeRoleForToken(usuario.rol);
    const token = signToken({ id: usuario.id.toString(), role: roleNormalized });
    
    return res.json({
      token,
      user: {
        id: usuario.id.toString(), // Asegurar que sea string
        nombre: usuario.nombre,
        email: usuario.email,
        role: roleNormalized, // Rol normalizado (sin tildes, sin espacios, minúsculas)
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
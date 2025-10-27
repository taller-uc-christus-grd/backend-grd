import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(name: string, email: string, role: Role) {
  const password = await bcrypt.hash('cualquier_contraseña', 10);
  await prisma.user.upsert({
    where: { email },
    update: { name, role },
    create: { name, email, role, password },
  });
  console.log(`✓ ${email} (${role}) creado con clave: cualquier_contraseña`);
}

async function main() {
  await upsertUser('Admin', 'admin@ucchristus.cl', Role.ADMIN);
  await upsertUser('Codificador GRD', 'codificador@ucchristus.cl', Role.CODIFICADOR);
  await upsertUser('Finanzas', 'finanzas@ucchristus.cl', Role.FINANZAS);
  await upsertUser('Gestión', 'gestion@ucchristus.cl', Role.GESTION);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
import dotenv from 'dotenv';
dotenv.config(); // <-- IMPORTANTE: Cargar variables de .env

import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---- 1. seed de usuarios base ----
// (Modificado para usar strings de ROL, como lo corregimos antes)
async function upsertUser(name: string, email: string, role: string) {
  const passwordHash = await bcrypt.hash('cualquier_contraseña', 10);

  // ¡¡¡CORRECCIÓN AQUÍ!!! -> de 'user' a 'usuario'
  await prisma.usuario.upsert({
    where: { email },
    update: { nombre: name, rol: role },
    create: {
      nombre: name,
      email,
      rol: role,
      passwordHash,
      activo: true,
    },
  });

  console.log(` Usuario ${email} (${role}) listo`);
}

async function seedUsers() {
  await upsertUser('Admin', 'admin@ucchristus.cl', 'ADMIN');
  await upsertUser('Codificador GRD', 'codificador@ucchristus.cl', 'CODIFICADOR');
  await upsertUser('Finanzas', 'finanzas@ucchristus.cl', 'FINANZAS');
  await upsertUser('Gestión', 'gestion@ucchristus.cl', 'GESTION');
}

// ---- 2. seed de datos clínico-administrativos ----
async function seedClinico() {
  // nos aseguramos de que exista al menos un GRD base
  // (Asumimos que 'loadNorma.ts' ya se ejecutó, pero creamos uno por si acaso)
  const grd = await prisma.grd.upsert({
    where: { codigo: '41023' },
    update: {},
    create: {
      codigo: '41023',
      descripcion: 'PH VENTILACIÓN MECÁNICA PROLONGADA SIN TRAQUEOSTOMÍA W/MCC',
      peso: 5.8207,
      precioBaseTramo: 120000,
      puntoCorteInf: 0,
      puntoCorteSup: 0,
    },
  });

  for (let i = 0; i < 20; i++) {
    const paciente = await prisma.paciente.create({
      data: {
        rut: `${faker.number.int({ min: 7000000, max: 26000000 })}-${faker.helpers.arrayElement(['K', '1', '2', '3'])}`,
        nombre: faker.person.fullName(),
        edad: faker.number.int({ min: 0, max: 90 }),
        sexo: faker.person.sexType(),
      },
    });

    await prisma.episodio.create({
      data: {
        centro: 'Clínica San Carlos de Apoquindo',
        numeroFolio: faker.string.numeric(7),
        episodioCmdb: faker.string.numeric(10),
        tipoEpisodio: faker.helpers.arrayElement(['Hospitalización', 'Urgencia']),
        fechaIngreso: faker.date.past(),
        fechaAlta: faker.date.recent(),
        servicioAlta: faker.helpers.arrayElement(['NEONATOLOGÍA', 'CUIDADOS INTENSIVOS']),
        montoAt: faker.number.int({ min: 0, max: 10000 }),
        tipoAlta: 'Normal',
        pesoGrd: 11.8584,
        montoRn: faker.number.int({ min: 5000, max: 100000 }),
        inlierOutlier: faker.helpers.arrayElement(['Inlier', 'Outlier Superior']),
        montoFinal: faker.number.int({ min: 5000, max: 120000 }),
        pacienteId: paciente.id,
        grdId: grd.id,
      },
    });
  }

  console.log('Dataset clínico sintético insertado.');
}

// ---- 3. main ----
async function main() {
  await seedUsers();
  // await seedClinico(); // Opcional: Comenta esto si no quieres datos de episodios falsos
}

main()
  .then(() => {
    console.log('Seed completo.');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
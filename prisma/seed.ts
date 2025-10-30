import { PrismaClient, Role } from '@prisma/client';
import { faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---- 1. seed de usuarios base ----
async function upsertUser(name: string, email: string, role: Role) {
  const passwordHash = await bcrypt.hash('cualquier_contraseña', 10);

  await prisma.user.upsert({
    where: { email },
    update: { name, role },
    create: {
      name,
      email,
      role,
      password: passwordHash,
    },
  });

  console.log(` Usuario ${email} (${role}) listo`);
}

async function seedUsers() {
  await upsertUser('Admin', 'admin@ucchristus.cl', Role.ADMIN);
  await upsertUser('Codificador GRD', 'codificador@ucchristus.cl', Role.CODIFICADOR);
  await upsertUser('Finanzas', 'finanzas@ucchristus.cl', Role.FINANZAS);
  await upsertUser('Gestión', 'gestion@ucchristus.cl', Role.GESTION);
}

// ---- 2. seed de datos clínico-administrativos ----
async function seedClinico() {
  // nos aseguramos de que exista al menos un GRD base
  const grd = await prisma.grd.upsert({
    where: { codigo: '41023' },
    update: {},
    create: {
      codigo: '41023',
      descripcion: 'PH VENTILACIÓN MECÁNICA PROLONGADA SIN TRAQUEOSTOMÍA W/MCC',
      // si tu schema usa Decimal de Prisma en JS puro:
      // peso: new Prisma.Decimal("5.8207"),
      peso: 5.8207,
      precioBaseTramo: 120000,
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
  await seedClinico();
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

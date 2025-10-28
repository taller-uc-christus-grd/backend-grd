import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

async function main() {
  for (let i = 0; i < 20; i++) {
    const paciente = await prisma.paciente.create({
      data: {
        rut: `${faker.number.int({ min: 7000000, max: 26000000 })}-${faker.helpers.arrayElement(["K", "1", "2", "3"])}`,
        nombre: faker.person.fullName(),
        edad: faker.number.int({ min: 0, max: 90 }),
        sexo: faker.person.sexType(),
      },
    });

    const grd = await prisma.grd.upsert({
      where: { codigo: "41023" },
      update: {},
      create: {
        codigo: "41023",
        descripcion: "PH VENTILACIÓN MECÁNICA PROLONGADA SIN TRAQUEOSTOMÍA W/MCC",
        peso: new Prisma.Decimal("5.8207"),
        precioBaseTramo: new Prisma.Decimal("120000"),
      },
    });

    await prisma.episodio.create({
      data: {
        centro: "Clínica San Carlos de Apoquindo",
        numeroFolio: faker.string.numeric(7),
        episodioCmdb: faker.string.numeric(10),
        tipoEpisodio: faker.helpers.arrayElement(["Hospitalización", "Urgencia"]),
        fechaIngreso: faker.date.past(),
        fechaAlta: faker.date.recent(),
        servicioAlta: faker.helpers.arrayElement(["NEONATOLOGÍA", "CUIDADOS INTENSIVOS"]),
        montoAt: new Prisma.Decimal(faker.number.int({ min: 0, max: 10000 })),
        tipoAlta: "Normal",
        pesoGrd: new Prisma.Decimal("11.8584"),
        montoRn: new Prisma.Decimal(faker.number.int({ min: 5000, max: 100000 })),
        inlierOutlier: faker.helpers.arrayElement(["Inlier", "Outlier Superior"]),
        montoFinal: new Prisma.Decimal(faker.number.int({ min: 5000, max: 120000 })),
        pacienteId: paciente.id,
        grdId: grd.id,
      },
    });
  }
}

main()
  .then(() => {
    console.log("✅ Dataset sintético insertado correctamente.");
  })
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());

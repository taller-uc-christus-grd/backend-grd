/**
 * Validación de integridad referencial y duplicados – GRD
 * Ejecutar: npx ts-node src/scripts/validateIntegrity.ts
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();
const reportPath = "data/qa_report.json";

async function validateFKs() {
  const invalidFKs = await prisma.$queryRawUnsafe(`
    SELECT e.id, e.paciente_id, e.grd_id
    FROM "Episodio" e
    LEFT JOIN "Paciente" p ON e.paciente_id = p.id
    LEFT JOIN "GRD" g ON e.grd_id = g.id
    WHERE p.id IS NULL OR g.id IS NULL;
  `);
  return invalidFKs as any[];
}

async function validateDuplicates() {
  const duplicates = await prisma.$queryRawUnsafe(`
    SELECT episodio_cmdb, COUNT(*) as total
    FROM "Episodio"
    GROUP BY episodio_cmdb
    HAVING COUNT(*) > 1;
  `);
  return duplicates as any[];
}

async function validateNulls() {
  const nulls = await prisma.$queryRawUnsafe(`
    SELECT id, episodio_cmdb
    FROM "Episodio"
    WHERE fecha_ingreso IS NULL
       OR fecha_alta IS NULL
       OR centro IS NULL;
  `);
  return nulls as any[];
}

async function runValidation() {
  console.log("🔍 Iniciando validación de integridad...");

  const invalidFKs = await validateFKs();
  const duplicates = await validateDuplicates();
  const nulls = await validateNulls();

  const report = {
    timestamp: new Date().toISOString(),
    resumen: {
      fk_invalidas: invalidFKs.length,
      duplicados: duplicates.length,
      campos_nulos: nulls.length,
    },
    detalles: {
      invalidFKs,
      duplicates,
      nulls,
    },
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.table(report.resumen);
  console.log(`📝 Reporte QA generado en: ${reportPath}`);

  if (invalidFKs.length || duplicates.length || nulls.length) {
    console.warn("⚠️  Se detectaron problemas de integridad. Revisar reporte.");
  } else {
    console.log("✅ Integridad validada correctamente.");
  }

  await prisma.$disconnect();
}

runValidation().catch((e) => {
  console.error("❌ Error en validación:", e);
  prisma.$disconnect();
});

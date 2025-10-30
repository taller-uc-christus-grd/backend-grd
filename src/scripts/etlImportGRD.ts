/**
 * ETL Importación GRD con control de calidad de datos
 * - Limpieza, validación y registro de errores
 */

import fs from "fs";
import csv from "csv-parser";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const errorLogPath = "data/error_log.json";
const validRecords: any[] = [];
const errorRecords: any[] = [];

type Row = Record<string, string>;

function isEmpty(value?: string | null): boolean {
  return !value || value.trim() === "" || value.toLowerCase() === "null";
}

function isNumeric(value?: string | null): boolean {
  return value !== undefined && value !== null && !isNaN(Number(value));
}

function isValidDate(value?: string | null): boolean {
  return value ? !isNaN(new Date(value).getTime()) : false;
}

function cleanString(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim();
}

async function validateRow(row: Row, index: number): Promise<boolean> {
  const requiredFields = ["Episodio CMBD", "Hospital (Descripción)", "RUT", "IR GRD (Código)"];
  const missing = requiredFields.filter((f) => isEmpty(row[f]));

  if (missing.length > 0) {
    errorRecords.push({
      fila: index,
      error: `Campos faltantes: ${missing.join(", ")}`,
      registro: row,
    });
    return false;
  }

  // Validación de duplicados
  const existing = await prisma.episodio.findFirst({
    where: { episodioCmdb: row["Episodio CMBD"] },
  });
  if (existing) {
    errorRecords.push({
      fila: index,
      error: `Duplicado detectado: Episodio CMBD ${row["Episodio CMBD"]}`,
    });
    return false;
  }

  // Validaciones adicionales
  if (!isValidDate(row["Fecha Ingreso completa"]) || !isValidDate(row["Fecha Completa"])) {
    errorRecords.push({
      fila: index,
      error: "Fecha inválida en ingreso o alta",
    });
    return false;
  }

  return true;
}

async function processRow(row: Row) {
  // Limpieza básica
  const rut = cleanString(row["RUT"]);
  const nombre = cleanString(row["Nombre"]);

  const paciente = await prisma.paciente.upsert({
    where: { rut: rut || "SIN-RUT" },
    update: {},
    create: {
      rut: rut || "SIN-RUT",
      nombre,
      sexo: cleanString(row["Sexo  (Desc)"]),
      edad: isNumeric(row["Edad en años"]) ? Number(row["Edad en años"]) : null,
    },
  });

  const grd = await prisma.grd.upsert({
    where: { codigo: row["IR GRD (Código)"] },
    update: {},
    create: {
      codigo: row["IR GRD (Código)"],
      descripcion: row["IR GRD"],
      peso: isNumeric(row["Peso GRD Medio (Todos)"]) ? new Prisma.Decimal(row["Peso GRD Medio (Todos)"]) : null,
    },
  });

  await prisma.episodio.create({
    data: {
      centro: cleanString(row["Hospital (Descripción)"]),
      numeroFolio: cleanString(row["ID Derivación"]),
      episodioCmdb: cleanString(row["Episodio CMBD"]),
      tipoEpisodio: cleanString(row["Tipo Actividad"]),
      fechaIngreso: new Date(row["Fecha Ingreso completa"]),
      fechaAlta: new Date(row["Fecha Completa"]),
      servicioAlta: cleanString(row["Servicio Egreso (Descripción)"]),
      montoRn: isNumeric(row["Facturación Total del episodio"])
        ? new Prisma.Decimal(row["Facturación Total del episodio"])
        : new Prisma.Decimal(0),
      pesoGrd: isNumeric(row["Peso GRD Medio (Todos)"])
        ? new Prisma.Decimal(row["Peso GRD Medio (Todos)"])
        : new Prisma.Decimal(0),
      inlierOutlier: cleanString(row["IR Alta Inlier / Outlier"]),
      pacienteId: paciente.id,
      grdId: grd.id,
    },
  });
}

async function runETL(filePath: string) {
  let index = 0;

  console.log(`🚀 Iniciando carga ETL desde: ${filePath}`);
  fs.createReadStream(filePath)
    .pipe(csv({ separator: "," }))
    .on("data", async (row) => {
      index++;
      const isValid = await validateRow(row, index);
      if (isValid) validRecords.push(row);
    })
    .on("end", async () => {
      console.log(`📦 Registros válidos: ${validRecords.length}`);
      console.log(`⚠️  Registros con error: ${errorRecords.length}`);

      // Guardar log de errores
      if (errorRecords.length > 0) {
        fs.writeFileSync(errorLogPath, JSON.stringify(errorRecords, null, 2), "utf-8");
        console.log(`📝 Log de errores guardado en: ${errorLogPath}`);
      }

      for (const row of validRecords) {
        try {
          await processRow(row);
        } catch (err: any) {
          errorRecords.push({
            error: `Error procesando fila: ${err.message}`,
            registro: row,
          });
        }
      }

      console.log("✅ ETL completado con control de calidad");
      await prisma.$disconnect();
    });
}

runETL("data/Base_GRD.csv").catch((e) => {
  console.error(e);
  prisma.$disconnect();
});

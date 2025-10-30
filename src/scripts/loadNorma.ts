/**
 * Script para cargar la "Norma Minsal" (reglas GRD) a la base de datos.
 * Carga precios, pesos y puntos de corte en la tabla `Grd`.
 * Ejecutar UNA VEZ antes de usar el sistema: npx ts-node src/scripts/loadNorma.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const normaMinsalPath = path.join(__dirname, '..', '..', 'data', 'norma-minsal.csv');

interface NormaRow {
  GRD: string;
  'Peso Total': string;
  'Punto Corte Inferior': string;
  'Punto Corte Superior': string;
  // Añadiremos un precio base de ejemplo, ya que no está en tu CSV
}

async function runImport() {
  console.log('Iniciando carga de Norma Minsal...');
  const records: NormaRow[] = [];

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(normaMinsalPath)
      .pipe(csv())
      .on('data', (row) => records.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`Leídos ${records.length} registros desde ${normaMinsalPath}`);
  let updated = 0;

  for (const row of records) {
    const codigo = row.GRD?.trim();
    if (!codigo) continue; // Si no hay código GRD, saltar

    // --- CORRECCIÓN AQUÍ ---
    // Simplemente parseamos como número. Prisma lo manejará.
    const peso = parseFloat(row['Peso Total']?.replace(',', '.') || '0');
    const pci = parseFloat(row['Punto Corte Inferior']?.replace(',', '.') || '0');
    const pcs = parseFloat(row['Punto Corte Superior']?.replace(',', '.') || '0');
    
    const precioBaseEjemplo = (peso * 1000000) + 500000;

    // --- CORRECCIÓN AQUÍ ---
    // Dejamos que TypeScript infiera el tipo, no usamos 'Prisma.GrdCreateInput'
    const data: Prisma.GrdUncheckedCreateInput = {
      codigo: codigo,
      descripcion: `Descripción de ${codigo}`, // El CSV no la tiene
      peso: peso,
      puntoCorteInf: pci,
      puntoCorteSup: pcs,
      precioBaseTramo: precioBaseEjemplo,
    };

    try {
      await prisma.grd.upsert({
        where: { codigo: codigo },
        update: data,
        create: data,
      });
      updated++;
    } catch (e: any) {
      console.error(`Error procesando GRD ${codigo}: ${e.message}`);
    }
  }

  console.log(`Carga de Norma Minsal completa. ${updated} registros actualizados/creados.`);
}

runImport()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
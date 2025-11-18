/*
  Warnings:

  - You are about to drop the column `comentariosGestion` on the `Episodio` table. All the data in the column will be lost.
  - You are about to drop the column `fechaRevision` on the `Episodio` table. All the data in the column will be lost.
  - You are about to drop the column `revisadoPor` on the `Episodio` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Episodio" DROP COLUMN "comentariosGestion",
DROP COLUMN "fechaRevision",
DROP COLUMN "revisadoPor";

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "lastAccessAt" TIMESTAMP(3);

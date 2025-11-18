-- AlterTable
ALTER TABLE "Episodio" ADD COLUMN     "comentariosGestion" TEXT,
ADD COLUMN     "fechaRevision" TIMESTAMP(3),
ADD COLUMN     "revisadoPor" TEXT,
ADD COLUMN     "validado" BOOLEAN;

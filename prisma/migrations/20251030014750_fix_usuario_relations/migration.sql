/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."User";

-- DropEnum
DROP TYPE "public"."Role";

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" VARCHAR(50) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paciente" (
    "id" SERIAL NOT NULL,
    "rut" TEXT,
    "nombre" TEXT,
    "edad" INTEGER,
    "sexo" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grd" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT,
    "peso" DECIMAL(10,4),
    "precioBaseTramo" DECIMAL(14,2),
    "puntoCorteInf" DECIMAL(65,30),
    "puntoCorteSup" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Grd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episodio" (
    "id" SERIAL NOT NULL,
    "centro" TEXT,
    "numeroFolio" VARCHAR(100),
    "episodioCmdb" VARCHAR(100),
    "idDerivacion" VARCHAR(100),
    "tipoEpisodio" TEXT,
    "fechaIngreso" TIMESTAMP(3),
    "fechaAlta" TIMESTAMP(3),
    "servicioAlta" TEXT,
    "estadoRn" TEXT,
    "atSn" BOOLEAN,
    "atDetalle" TEXT,
    "montoAt" DECIMAL(14,2),
    "tipoAlta" TEXT,
    "pesoGrd" DECIMAL(10,4),
    "montoRn" DECIMAL(14,2),
    "diasDemoraRescate" INTEGER,
    "pagoDemoraRescate" DECIMAL(14,2),
    "pagoOutlierSuperior" DECIMAL(14,2),
    "documentacion" JSONB,
    "inlierOutlier" TEXT,
    "grupoEnNorma" BOOLEAN,
    "diasEstada" INTEGER,
    "precioBaseTramo" DECIMAL(14,2),
    "valorGrd" DECIMAL(14,2),
    "montoFinal" DECIMAL(16,2),
    "facturacionTotal" DECIMAL(16,2),
    "especialidad" TEXT,
    "anio" INTEGER,
    "mes" INTEGER,
    "pacienteId" INTEGER,
    "grdId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episodio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnostico" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(50),
    "descripcion" TEXT,
    "esPrincipal" BOOLEAN DEFAULT false,
    "episodioId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Diagnostico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Respaldo" (
    "id" SERIAL NOT NULL,
    "filename" TEXT,
    "storagePath" TEXT,
    "fileType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "episodioId" INTEGER,
    "uploadedBy" INTEGER,

    CONSTRAINT "Respaldo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogSistema" (
    "id" SERIAL NOT NULL,
    "endpoint" TEXT,
    "action" TEXT,
    "level" TEXT,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,

    CONSTRAINT "LogSistema_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Paciente_rut_key" ON "Paciente"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "Grd_codigo_key" ON "Grd"("codigo");

-- CreateIndex
CREATE INDEX "Episodio_numeroFolio_idx" ON "Episodio"("numeroFolio");

-- CreateIndex
CREATE INDEX "Episodio_episodioCmdb_idx" ON "Episodio"("episodioCmdb");

-- CreateIndex
CREATE INDEX "Episodio_pacienteId_idx" ON "Episodio"("pacienteId");

-- CreateIndex
CREATE INDEX "Episodio_fechaIngreso_idx" ON "Episodio"("fechaIngreso");

-- CreateIndex
CREATE INDEX "LogSistema_userId_idx" ON "LogSistema"("userId");

-- AddForeignKey
ALTER TABLE "Episodio" ADD CONSTRAINT "Episodio_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episodio" ADD CONSTRAINT "Episodio_grdId_fkey" FOREIGN KEY ("grdId") REFERENCES "Grd"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnostico" ADD CONSTRAINT "Diagnostico_episodioId_fkey" FOREIGN KEY ("episodioId") REFERENCES "Episodio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Respaldo" ADD CONSTRAINT "Respaldo_episodioId_fkey" FOREIGN KEY ("episodioId") REFERENCES "Episodio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Respaldo" ADD CONSTRAINT "Respaldo_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogSistema" ADD CONSTRAINT "LogSistema_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

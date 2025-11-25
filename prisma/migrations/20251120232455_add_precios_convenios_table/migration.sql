-- CreateTable
CREATE TABLE "PrecioConvenio" (
    "id" TEXT NOT NULL,
    "aseguradora" TEXT NOT NULL,
    "nombre_asegi" TEXT NOT NULL,
    "convenio" TEXT NOT NULL,
    "descr_convenio" TEXT NOT NULL,
    "tipoAsegurad" TEXT NOT NULL,
    "tipoConvenio" TEXT NOT NULL,
    "tramo" TEXT,
    "fechaAdmision" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "precio" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrecioConvenio_pkey" PRIMARY KEY ("id")
);

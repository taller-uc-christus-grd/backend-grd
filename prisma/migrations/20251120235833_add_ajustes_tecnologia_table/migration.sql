-- CreateTable
CREATE TABLE "AjusteTecnologia" (
    "id" TEXT NOT NULL,
    "at" TEXT DEFAULT '',
    "monto" DOUBLE PRECISION DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AjusteTecnologia_pkey" PRIMARY KEY ("id")
);

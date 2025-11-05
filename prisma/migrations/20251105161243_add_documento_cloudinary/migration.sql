-- CreateTable
CREATE TABLE "DocumentoCloudinary" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "formato" TEXT,
    "tamano" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "episodioId" INTEGER NOT NULL,

    CONSTRAINT "DocumentoCloudinary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoCloudinary_publicId_key" ON "DocumentoCloudinary"("publicId");

-- CreateIndex
CREATE INDEX "DocumentoCloudinary_episodioId_idx" ON "DocumentoCloudinary"("episodioId");

-- AddForeignKey
ALTER TABLE "DocumentoCloudinary" ADD CONSTRAINT "DocumentoCloudinary_episodioId_fkey" FOREIGN KEY ("episodioId") REFERENCES "Episodio"("id") ON DELETE CASCADE ON UPDATE CASCADE;


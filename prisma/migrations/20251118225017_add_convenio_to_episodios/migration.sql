-- AlterTable
-- Agregar convenio si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'Episodio' AND column_name = 'convenio') THEN
        ALTER TABLE "Episodio" ADD COLUMN "convenio" VARCHAR(100);
    END IF;
END $$;

-- Agregar validado si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'Episodio' AND column_name = 'validado') THEN
        ALTER TABLE "Episodio" ADD COLUMN "validado" BOOLEAN;
    END IF;
END $$;

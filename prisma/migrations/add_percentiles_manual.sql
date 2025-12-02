-- Migración manual para agregar campos de percentiles a la tabla Grd
-- Ejecutar este script directamente en Railway o en la base de datos PostgreSQL

-- Agregar columnas de percentiles
ALTER TABLE "Grd" 
ADD COLUMN IF NOT EXISTS "percentil25" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "percentil50" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "percentil75" DECIMAL(10,2);

-- Verificar que las columnas se agregaron correctamente
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'Grd' 
AND column_name IN ('percentil25', 'percentil50', 'percentil75');


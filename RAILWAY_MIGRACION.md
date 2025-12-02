# Migración de Percentiles en Railway

## Problema
La base de datos en Railway no tiene las columnas `percentil25`, `percentil50`, `percentil75` en la tabla `Grd`.

## Solución: Ejecutar Migración Manual

### Opción 1: Usar el Script SQL Directo (Más Rápido)

1. **Abrir el terminal de Railway** o conectarte a la base de datos PostgreSQL

2. **Ejecutar el script SQL:**
   ```sql
   ALTER TABLE "Grd" 
   ADD COLUMN IF NOT EXISTS "percentil25" DECIMAL(10,2),
   ADD COLUMN IF NOT EXISTS "percentil50" DECIMAL(10,2),
   ADD COLUMN IF NOT EXISTS "percentil75" DECIMAL(10,2);
   ```

   O usar el archivo: `prisma/migrations/add_percentiles_manual.sql`

3. **Verificar que se agregaron:**
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns
   WHERE table_name = 'Grd' 
   AND column_name IN ('percentil25', 'percentil50', 'percentil75');
   ```

### Opción 2: Usar Prisma Migrate (Recomendado)

1. **En Railway, abrir el terminal o usar el CLI:**

   ```bash
   # Conectarse a Railway
   railway link
   
   # Ejecutar migración
   railway run npx prisma migrate deploy
   
   # Regenerar cliente
   railway run npx prisma generate
   ```

2. **O desde tu máquina local (si tienes acceso a la BD de Railway):**

   ```bash
   # Obtener DATABASE_URL de Railway
   railway variables
   
   # Ejecutar migración
   DATABASE_URL="[URL_DE_RAILWAY]" npx prisma migrate deploy
   ```

### Opción 3: Desde el Dashboard de Railway

1. Ir a tu proyecto en Railway
2. Abrir la base de datos PostgreSQL
3. Ir a la pestaña "Query" o "SQL Editor"
4. Pegar y ejecutar:
   ```sql
   ALTER TABLE "Grd" 
   ADD COLUMN IF NOT EXISTS "percentil25" DECIMAL(10,2),
   ADD COLUMN IF NOT EXISTS "percentil50" DECIMAL(10,2),
   ADD COLUMN IF NOT EXISTS "percentil75" DECIMAL(10,2);
   ```

## Después de la Migración

1. **Actualizar el código** para que incluya los percentiles en el upsert (ya está listo, solo necesita descomentarse)

2. **Recargar la Norma Minsal** - Los percentiles se guardarán automáticamente

3. **Verificar** que los cálculos funcionen correctamente

## Verificación

Después de ejecutar la migración, verifica que las columnas existen:

```sql
SELECT 
  column_name, 
  data_type, 
  numeric_precision, 
  numeric_scale,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'Grd' 
AND column_name IN ('percentil25', 'percentil50', 'percentil75')
ORDER BY column_name;
```

Deberías ver 3 filas con los datos de las columnas.


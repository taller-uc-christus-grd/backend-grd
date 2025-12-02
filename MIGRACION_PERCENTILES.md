# Migración de Percentiles - Instrucciones

## Problema Resuelto

El código ahora funciona **sin** los campos de percentiles en la base de datos. Los percentiles se leerán del archivo pero **NO se guardarán** hasta que se ejecute la migración.

## Cómo Ejecutar la Migración

### Opción 1: Script Automático (Recomendado)

```bash
cd backend-grd
./scripts/ejecutar-migracion-percentiles.sh
```

### Opción 2: Manual

```bash
cd backend-grd

# 1. Verificar que la BD esté corriendo
# Asegúrate de que PostgreSQL esté disponible en localhost:5432

# 2. Ejecutar la migración
npx prisma migrate dev --name add_percentiles_to_grd

# 3. Regenerar el cliente de Prisma
npx prisma generate
```

## Después de la Migración

Una vez ejecutada la migración:

1. **Los percentiles se guardarán automáticamente** cuando cargues la Norma Minsal
2. **El cálculo de pago outlier superior funcionará correctamente** usando el percentil50 desde la BD
3. **El cálculo de pago demora rescate usará percentil75** cuando esté disponible

## Estado Actual

- ✅ **Carga de Norma Minsal**: Funciona (sin guardar percentiles por ahora)
- ✅ **Carga de Archivo Maestro**: Funciona
- ⏳ **Percentiles**: Se guardarán después de la migración
- ⏳ **Cálculo Outlier**: Usará percentil50 después de la migración

## Nota Importante

El código está diseñado para funcionar **con o sin** los campos de percentiles. Esto significa que:

- Si la migración **NO se ha ejecutado**: El código funciona pero no guarda/usa percentiles
- Si la migración **SÍ se ha ejecutado**: El código guarda y usa percentiles automáticamente

No necesitas cambiar nada en el código después de ejecutar la migración.


#!/bin/bash

# Script para ejecutar la migración de percentiles
# Uso: ./scripts/ejecutar-migracion-percentiles.sh

echo "🔄 Ejecutando migración para agregar campos de percentiles a la tabla Grd..."

# Verificar que la BD esté disponible
echo "📡 Verificando conexión a la base de datos..."
npx prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "❌ Error: No se puede conectar a la base de datos."
    echo "   Por favor, asegúrate de que PostgreSQL esté corriendo en localhost:5432"
    exit 1
fi

echo "✅ Conexión a la base de datos exitosa"

# Ejecutar la migración
echo "🚀 Ejecutando migración..."
npx prisma migrate dev --name add_percentiles_to_grd

if [ $? -eq 0 ]; then
    echo "✅ Migración ejecutada exitosamente"
    echo "🔄 Regenerando cliente de Prisma..."
    npx prisma generate
    echo "✅ Cliente de Prisma regenerado"
    echo ""
    echo "📝 NOTA: Después de ejecutar la migración, los percentiles se guardarán automáticamente"
    echo "   cuando se cargue la Norma Minsal nuevamente."
else
    echo "❌ Error al ejecutar la migración"
    exit 1
fi


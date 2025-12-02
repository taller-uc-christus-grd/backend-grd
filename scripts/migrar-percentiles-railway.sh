#!/bin/bash

# Script para ejecutar migración de percentiles en Railway
# Uso: ./scripts/migrar-percentiles-railway.sh

echo "🚀 Migración de Percentiles para Railway"
echo "========================================"
echo ""

# Verificar si estamos en Railway o local
if [ -n "$RAILWAY_ENVIRONMENT" ]; then
    echo "✅ Detectado entorno Railway"
    DB_URL="$DATABASE_URL"
else
    echo "⚠️  Entorno local detectado"
    if [ -z "$DATABASE_URL" ]; then
        echo "❌ Error: DATABASE_URL no está configurado"
        echo "   Por favor, configura DATABASE_URL o usa Railway CLI"
        exit 1
    fi
    DB_URL="$DATABASE_URL"
fi

echo ""
echo "📊 Ejecutando migración SQL..."
echo ""

# Ejecutar migración SQL
psql "$DB_URL" <<EOF
-- Agregar columnas de percentiles
ALTER TABLE "Grd" 
ADD COLUMN IF NOT EXISTS "percentil25" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "percentil50" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "percentil75" DECIMAL(10,2);

-- Verificar que se agregaron
SELECT 
    column_name, 
    data_type, 
    numeric_precision, 
    numeric_scale
FROM information_schema.columns
WHERE table_name = 'Grd' 
AND column_name IN ('percentil25', 'percentil50', 'percentil75')
ORDER BY column_name;
EOF

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migración ejecutada exitosamente"
    echo ""
    echo "🔄 Regenerando cliente de Prisma..."
    npx prisma generate
    
    if [ $? -eq 0 ]; then
        echo "✅ Cliente de Prisma regenerado"
        echo ""
        echo "📝 Próximos pasos:"
        echo "   1. Reiniciar la aplicación en Railway"
        echo "   2. Recargar la Norma Minsal para que se guarden los percentiles"
        echo "   3. Los cálculos usarán automáticamente los percentiles"
    else
        echo "❌ Error al regenerar cliente de Prisma"
        exit 1
    fi
else
    echo "❌ Error al ejecutar la migración"
    exit 1
fi


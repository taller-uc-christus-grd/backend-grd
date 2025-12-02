#!/bin/bash

# Script rápido para crear la base de datos (asume que PostgreSQL ya está instalado)

echo "🔧 Configurando base de datos 'grd'"
echo ""

# Verificar que PostgreSQL está corriendo
if ! pg_isready -h localhost -p 5432 &> /dev/null; then
    echo "❌ PostgreSQL no está corriendo"
    echo ""
    echo "Inicia PostgreSQL con:"
    echo "  brew services start postgresql@14"
    echo "  # O si usas PostgreSQL.app, simplemente ábrelo"
    exit 1
fi

echo "✅ PostgreSQL está corriendo"
echo ""

# Crear base de datos
echo "📝 Creando base de datos 'grd'..."
createdb grd 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Base de datos 'grd' creada exitosamente"
elif [ $? -eq 1 ]; then
    echo "⚠️  La base de datos 'grd' ya existe"
else
    echo "❌ Error al crear la base de datos"
    echo ""
    echo "Intenta crear la base de datos manualmente:"
    echo "  psql postgres"
    echo "  CREATE DATABASE grd;"
    echo "  \\q"
    exit 1
fi

echo ""
echo "✅ Listo! Ahora ejecuta:"
echo "  npm run prisma:migrate"
echo "  npx prisma generate"
echo "  npm run dev"
echo ""


#!/bin/bash

# Script para configurar la base de datos local

echo "🔧 Configurando base de datos local para Backend GRD"
echo ""

# Verificar si PostgreSQL está instalado
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL no está instalado o no está en el PATH"
    echo ""
    echo "Para instalar PostgreSQL en macOS:"
    echo "  brew install postgresql@14"
    echo "  brew services start postgresql@14"
    echo ""
    exit 1
fi

echo "✅ PostgreSQL encontrado"
echo ""

# Leer configuración del .env
DB_URL=$(grep DATABASE_URL .env | cut -d '=' -f2 | tr -d '"')
DB_NAME=$(echo $DB_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
DB_USER=$(echo $DB_URL | sed -n 's/.*:\/\/\([^:]*\).*/\1/p')
DB_PASS=$(echo $DB_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\).*/\1/p')

echo "📋 Configuración detectada:"
echo "   Base de datos: $DB_NAME"
echo "   Usuario: $DB_USER"
echo ""

# Intentar crear la base de datos
echo "🔨 Creando base de datos '$DB_NAME'..."
createdb $DB_NAME 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Base de datos '$DB_NAME' creada exitosamente"
elif [ $? -eq 1 ]; then
    echo "⚠️  La base de datos '$DB_NAME' ya existe"
else
    echo "❌ Error al crear la base de datos"
    echo ""
    echo "Intenta crear la base de datos manualmente:"
    echo "  psql postgres"
    echo "  CREATE DATABASE $DB_NAME;"
    echo "  \\q"
    exit 1
fi

echo ""
echo "✅ Configuración completada!"
echo ""
echo "Próximos pasos:"
echo "  1. Ejecutar migraciones: npm run prisma:migrate"
echo "  2. Generar Prisma Client: npx prisma generate"
echo "  3. (Opcional) Poblar datos: npm run seed"
echo "  4. Iniciar servidor: npm run dev"
echo ""



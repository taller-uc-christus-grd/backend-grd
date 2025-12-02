#!/bin/bash

# Script para instalar y configurar PostgreSQL localmente

echo "🔧 Instalando PostgreSQL para Backend GRD"
echo ""

# Verificar Homebrew
if ! command -v brew &> /dev/null; then
    echo "❌ Homebrew no está instalado"
    echo "Instala Homebrew desde: https://brew.sh"
    exit 1
fi

echo "✅ Homebrew encontrado"
echo ""

# Instalar PostgreSQL
echo "📦 Instalando PostgreSQL 14..."
brew install postgresql@14

if [ $? -ne 0 ]; then
    echo "❌ Error al instalar PostgreSQL"
    exit 1
fi

echo ""
echo "✅ PostgreSQL instalado"
echo ""

# Iniciar servicio
echo "🚀 Iniciando servicio PostgreSQL..."
brew services start postgresql@14

if [ $? -ne 0 ]; then
    echo "❌ Error al iniciar PostgreSQL"
    exit 1
fi

echo ""
echo "⏳ Esperando a que PostgreSQL esté listo..."
sleep 3

# Verificar que está corriendo
if pg_isready -h localhost -p 5432 &> /dev/null; then
    echo "✅ PostgreSQL está corriendo"
else
    echo "⚠️  PostgreSQL puede no estar listo aún, espera unos segundos más"
fi

echo ""
echo "📝 Creando base de datos 'grd'..."
createdb grd 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Base de datos 'grd' creada"
elif [ $? -eq 1 ]; then
    echo "⚠️  La base de datos 'grd' ya existe"
else
    echo "⚠️  No se pudo crear la base de datos automáticamente"
    echo ""
    echo "Créala manualmente:"
    echo "  psql postgres"
    echo "  CREATE DATABASE grd;"
    echo "  \\q"
fi

echo ""
echo "✅ Configuración completada!"
echo ""
echo "Próximos pasos:"
echo "  1. Ejecutar migraciones: npm run prisma:migrate"
echo "  2. Generar Prisma Client: npx prisma generate"
echo "  3. Iniciar servidor: npm run dev"
echo ""


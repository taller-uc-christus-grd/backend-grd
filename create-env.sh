#!/bin/bash
# Script para crear el archivo .env en el directorio backend-grd
# Ejecuta este script desde el directorio backend-grd

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
    echo "⚠️  El archivo .env ya existe. ¿Deseas sobrescribirlo? (s/N)"
    read -r response
    if [ "$response" != "s" ] && [ "$response" != "S" ]; then
        echo "Operación cancelada."
        exit 0
    fi
fi

cat > "$ENV_FILE" << 'EOF'
# Base de datos PostgreSQL
# Usa las credenciales del docker-compose.yml
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/grd?schema=public

# JWT Secret para autenticación
# IMPORTANTE: Cambia esto en producción por un valor seguro y aleatorio
JWT_SECRET=dev-secret-key-change-in-production-2024

# CORS - Orígenes permitidos
# Para desarrollo local, permite el frontend en localhost:5173 (Vite)
# Para producción, reemplaza con la URL real de tu frontend
CORS_ORIGIN=http://localhost:5173,http://localhost:3000

# Puerto del servidor
PORT=3000

# Host del servidor
HOST=0.0.0.0

# Entorno
NODE_ENV=development

# Cloudinary (para almacenamiento de documentos)
# Obtén estas credenciales desde https://cloudinary.com/console
# Si no usas Cloudinary, puedes dejar estos valores vacíos (pero el sistema puede fallar al subir documentos)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
EOF

echo "✅ Archivo .env creado exitosamente en:"
echo "$(pwd)/$ENV_FILE"
echo ""
echo "📋 Variables configuradas:"
echo "  - DATABASE_URL: postgresql://postgres:postgres@localhost:5432/grd"
echo "  - JWT_SECRET: configurado"
echo "  - CORS_ORIGIN: http://localhost:5173,http://localhost:3000"
echo "  - PORT: 3000"
echo "  - NODE_ENV: development"
echo ""
echo "⚠️  IMPORTANTE: Las credenciales de Cloudinary están vacías."
echo "   Si necesitas subir documentos, configura CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET"


# Script para crear el archivo .env en el directorio backend-grd
# Ejecuta este script desde el directorio backend-grd

$envContent = @"
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
"@

$envPath = Join-Path $PSScriptRoot ".env"

if (Test-Path $envPath) {
    Write-Host "⚠️  El archivo .env ya existe. ¿Deseas sobrescribirlo? (S/N)" -ForegroundColor Yellow
    $response = Read-Host
    if ($response -ne "S" -and $response -ne "s") {
        Write-Host "Operación cancelada." -ForegroundColor Red
        exit
    }
}

try {
    $envContent | Out-File -FilePath $envPath -Encoding utf8 -NoNewline
    Write-Host "✅ Archivo .env creado exitosamente en:" -ForegroundColor Green
    Write-Host $envPath -ForegroundColor Cyan
    Write-Host "`n📋 Variables configuradas:" -ForegroundColor Yellow
    Write-Host "  - DATABASE_URL: postgresql://postgres:postgres@localhost:5432/grd" -ForegroundColor White
    Write-Host "  - JWT_SECRET: configurado" -ForegroundColor White
    Write-Host "  - CORS_ORIGIN: http://localhost:5173,http://localhost:3000" -ForegroundColor White
    Write-Host "  - PORT: 3000" -ForegroundColor White
    Write-Host "  - NODE_ENV: development" -ForegroundColor White
    Write-Host "`n⚠️  IMPORTANTE: Las credenciales de Cloudinary están vacías." -ForegroundColor Yellow
    Write-Host "   Si necesitas subir documentos, configura CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET" -ForegroundColor Yellow
} catch {
    Write-Host "❌ Error al crear el archivo .env:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}


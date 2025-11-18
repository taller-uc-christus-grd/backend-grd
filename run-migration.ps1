# Script para ejecutar migración y regenerar Prisma
Write-Host "Generando cliente de Prisma..." -ForegroundColor Green
npx prisma generate

Write-Host "`nAplicando migración a la base de datos..." -ForegroundColor Green
npx prisma migrate deploy

Write-Host "`n¡Migración completada!" -ForegroundColor Green


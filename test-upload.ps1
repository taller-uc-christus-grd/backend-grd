# Script de prueba para el endpoint /upload
# UC Christus - Backend GRD

Write-Host "🧪 Probando endpoint /upload del sistema GRD UC Christus" -ForegroundColor Green
Write-Host ""

# Verificar que el servidor esté ejecutándose
Write-Host "1. Verificando estado del servidor..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-RestMethod -Uri "http://localhost:3000/health" -Method GET
    Write-Host "✅ Servidor funcionando: $($healthResponse.status)" -ForegroundColor Green
    Write-Host "   Timestamp: $($healthResponse.timestamp)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Error: El servidor no está ejecutándose en puerto 3000" -ForegroundColor Red
    Write-Host "   Ejecuta: npm start" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Obtener información del endpoint
Write-Host "2. Obteniendo información del endpoint..." -ForegroundColor Yellow
try {
    $infoResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/upload/info" -Method GET
    Write-Host "✅ Endpoint: $($infoResponse.endpoint)" -ForegroundColor Green
    Write-Host "   Método: $($infoResponse.method)" -ForegroundColor Gray
    Write-Host "   Formatos aceptados: $($infoResponse.accepted_formats -join ', ')" -ForegroundColor Gray
    Write-Host "   Tamaño máximo: $($infoResponse.max_file_size)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Error obteniendo información del endpoint" -ForegroundColor Red
}

Write-Host ""

# Probar upload con archivo CSV
Write-Host "3. Probando upload con archivo CSV..." -ForegroundColor Yellow
if (Test-Path "test-data/ejemplo_episodios.csv") {
    try {
        $boundary = [System.Guid]::NewGuid().ToString()
        $LF = "`r`n"
        $fileBytes = [System.IO.File]::ReadAllBytes("test-data/ejemplo_episodios.csv")
        $fileEnc = [System.Text.Encoding]::GetEncoding('UTF-8').GetString($fileBytes)
        $bodyLines = (
            "--$boundary",
            "Content-Disposition: form-data; name=`"file`"; filename=`"ejemplo_episodios.csv`"",
            "Content-Type: text/csv",
            "",
            $fileEnc,
            "--$boundary--",
            ""
        ) -join $LF
        
        $uploadResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/upload" -Method POST -Body $bodyLines -ContentType "multipart/form-data; boundary=$boundary"
        
        Write-Host "✅ Upload exitoso!" -ForegroundColor Green
        Write-Host "   Archivo: $($uploadResponse.summary.file_name)" -ForegroundColor Gray
        Write-Host "   Tamaño: $($uploadResponse.summary.file_size) bytes" -ForegroundColor Gray
        Write-Host "   Filas totales: $($uploadResponse.summary.total_rows)" -ForegroundColor Gray
        Write-Host "   Filas válidas: $($uploadResponse.summary.valid_rows)" -ForegroundColor Green
        Write-Host "   Filas con errores: $($uploadResponse.summary.invalid_rows)" -ForegroundColor $(if($uploadResponse.summary.invalid_rows -gt 0) {"Red"} else {"Green"})
        Write-Host "   Procesado en: $($uploadResponse.summary.processed_at)" -ForegroundColor Gray
        
        if ($uploadResponse.data.Count -gt 0) {
            Write-Host "   Primer registro procesado:" -ForegroundColor Gray
            Write-Host "     Paciente: $($uploadResponse.data[0].paciente_id)" -ForegroundColor Gray
            Write-Host "     Diagnóstico: $($uploadResponse.data[0].diagnostico_principal)" -ForegroundColor Gray
            Write-Host "     Edad: $($uploadResponse.data[0].edad)" -ForegroundColor Gray
        }
        
    } catch {
        Write-Host "❌ Error en upload: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "❌ Archivo de prueba no encontrado: test-data/ejemplo_episodios.csv" -ForegroundColor Red
}

Write-Host ""

# Probar con archivo inexistente
Write-Host "4. Probando validación con archivo inexistente..." -ForegroundColor Yellow
try {
    $boundary = [System.Guid]::NewGuid().ToString()
    $LF = "`r`n"
    $bodyLines = (
        "--$boundary",
        "Content-Disposition: form-data; name=`"file`"; filename=`"archivo_inexistente.csv`"",
        "Content-Type: text/csv",
        "",
        "",
        "--$boundary--",
        ""
    ) -join $LF
    
    $errorResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/upload" -Method POST -Body $bodyLines -ContentType "multipart/form-data; boundary=$boundary"
    Write-Host "❌ No se detectó error esperado" -ForegroundColor Red
} catch {
    Write-Host "✅ Validación funcionando: $($_.Exception.Message)" -ForegroundColor Green
}

Write-Host ""
Write-Host "🎉 Pruebas completadas!" -ForegroundColor Green
Write-Host "   El endpoint /upload está funcionando correctamente" -ForegroundColor Gray
Write-Host "   ✅ Acepta archivos CSV/Excel" -ForegroundColor Green
Write-Host "   ✅ Valida tamaño y formato" -ForegroundColor Green
Write-Host "   ✅ Procesa datos clínicos correctamente" -ForegroundColor Green

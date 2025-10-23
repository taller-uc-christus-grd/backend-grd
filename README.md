# Backend GRD - UC Christus (Export)

Sistema backend para la exportación de datos clínicos de episodios GRD (Grupos Relacionados por Diagnóstico) para UC Christus.

## 🚀 Características

- **Endpoint `/export`** para exportar datos procesados a formato Excel FONASA
- **29 columnas** según especificación FONASA
- **Filtros de consulta** (fechas, centro, validación)
- **Autenticación y permisos** (middleware preparado)
- **Manejo de errores** robusto
- **Rate limiting** y seguridad con Helmet
- **CORS** configurado

## 📋 Requisitos

- Node.js >= 16.0.0
- npm o yarn

## 🛠️ Instalación

1. Clonar el repositorio:
```bash
git clone <repository-url>
cd backend-grd
```

2. Instalar dependencias:
```bash
npm install
```

3. Ejecutar en modo desarrollo:
```bash
npm run dev
```

4. Ejecutar en producción:
```bash
npm start
```

## 📡 Endpoints

### GET /api/export

Exporta datos procesados a formato Excel FONASA.

**Parámetros de consulta:**
- `desde` (opcional): Fecha de inicio (YYYY-MM-DD)
- `hasta` (opcional): Fecha de fin (YYYY-MM-DD)
- `centro` (opcional): Filtrar por centro médico
- `validado` (opcional): Filtrar por estado de validación (SÍ/NO)

**Autenticación requerida:**
- Headers: `Authorization: Bearer <token>`
- Permisos: `canExportFonasa`

**Ejemplo de uso:**
```bash
curl -X GET \
  "http://localhost:3000/api/export?desde=2024-01-01&hasta=2024-01-31&centro=Hospital UC Christus&validado=SÍ" \
  -H "Authorization: Bearer <token>" \
  --output fonasa_export.xlsx
```

**Respuesta:**
- Archivo Excel con 29 columnas según formato FONASA
- Nombre de archivo: `FONASA_export_YYYYMMDDTHHMMSS.xlsx`

### GET /health

Health check del servicio.

### GET /api/export/info

Información sobre el endpoint de exportación.

## 🔧 Configuración

### Variables de entorno

```bash
PORT=3000                          # Puerto del servidor
NODE_ENV=development               # Entorno (development/production)
ALLOWED_ORIGINS=http://localhost:3000  # Orígenes permitidos para CORS
```

## 📊 Estructura de Datos

### Formato Excel FONASA (29 columnas)

El archivo exportado incluye las siguientes columnas:

1. Unnamed: 0
2. VALIDADO
3. Centro
4. N° Folio
5. Episodio
6. Rut Paciente
7. Nombre Paciente
8. TIPO EPISODIO
9. Fecha de ingreso
10. Fecha Alta
11. Servicios de alta
12. ESTADO RN
13. AT (S/N)
14. AT detalle
15. Monto AT
16. Tipo de Alta
17. IR - GRD
18. PESO
19. MONTO RN
20. Dias de demora rescate desde Hospital
21. Pago demora rescate
22. Pago por outlier superior
23. DOCUMENTACIÓN NECESARIA
24. Inlier/outlier
25. Grupo dentro de norma S/N
26. Dias de Estada
27. Precio Base por tramo correspondiente
28. Valor GRD
29. Monto Final

## 🧪 Testing

```bash
npm test
```

## 📝 Logs

El sistema registra:
- Archivos procesados
- Errores de validación
- Errores de procesamiento
- Exportaciones realizadas
- Métricas de rendimiento

## 🔒 Seguridad

- **Rate limiting**: Máximo 100 requests por 15 minutos
- **Helmet**: Headers de seguridad
- **CORS**: Configuración de orígenes permitidos
- **Validación de archivos**: Tipos y tamaños permitidos
- **Autenticación**: Middleware para endpoints protegidos
- **Limpieza de archivos**: Archivos temporales se eliminan automáticamente

## 🚨 Manejo de errores

- Validación de formato de archivo
- Validación de tamaño de archivo
- Validación de datos por fila
- Limpieza automática de archivos temporales
- Respuestas de error detalladas
- Logging de errores de exportación

## 📈 Monitoreo

- Health check endpoint
- Logs estructurados
- Métricas de procesamiento
- Tracking de errores
- Métricas de exportación

## 🔄 Flujo de Trabajo

1. **Datos procesados**: Los datos ya deben estar procesados y almacenados
2. **Filtros**: Aplicar filtros de consulta según necesidades
3. **Exportación**: Usar `/api/export` para generar archivos Excel FONASA

## 🤝 Contribución

1. Fork el proyecto
2. Crear una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear un Pull Request

## 📄 Licencia

MIT License - ver archivo LICENSE para detalles.
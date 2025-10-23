# Backend GRD - UC Christus

Sistema backend para el procesamiento de datos clínicos de episodios GRD (Grupos Relacionados por Diagnóstico) para UC Christus.

## 🚀 Características

- **Endpoint `/upload`** para recibir archivos CSV/Excel con datos clínicos
- **Validación de archivos** (tamaño máximo 10MB, formatos CSV/Excel)
- **Procesamiento automático** de datos de episodios clínicos
- **Validación de datos** con esquemas Joi
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

### POST /api/upload

Sube un archivo CSV o Excel con datos clínicos de episodios.

**Parámetros:**
- `file` (multipart/form-data): Archivo CSV o Excel

**Formatos soportados:**
- CSV (.csv)
- Excel (.xlsx, .xls)

**Tamaño máximo:** 10MB

**Campos requeridos:**
- `paciente_id`: ID único del paciente
- `fecha_ingreso`: Fecha de ingreso (YYYY-MM-DD)
- `diagnostico_principal`: Diagnóstico principal
- `edad`: Edad del paciente
- `sexo`: Sexo (M/F, Masculino/Femenino)

**Campos opcionales:**
- `fecha_egreso`: Fecha de egreso
- `diagnostico_secundario`: Diagnóstico secundario
- `procedimiento`: Procedimiento realizado
- `peso`: Peso del paciente
- `talla`: Talla del paciente
- `dias_estancia`: Días de estancia

**Ejemplo de uso:**
```bash
curl -X POST \
  http://localhost:3000/api/upload \
  -H 'Content-Type: multipart/form-data' \
  -F 'file=@datos_episodios.csv'
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Archivo procesado exitosamente",
  "summary": {
    "total_rows": 100,
    "valid_rows": 95,
    "invalid_rows": 5,
    "file_name": "datos_episodios.csv",
    "file_size": 2048576,
    "processed_at": "2024-01-15T10:30:00.000Z"
  },
  "data": [...],
  "errors": [...]
}
```

### GET /api/upload/info

Obtiene información sobre el endpoint de upload.

### GET /health

Health check del servicio.

## 🔧 Configuración

### Variables de entorno

```bash
PORT=3000                          # Puerto del servidor
NODE_ENV=development               # Entorno (development/production)
ALLOWED_ORIGINS=http://localhost:3000  # Orígenes permitidos para CORS
```

## 📊 Estructura de datos

### Ejemplo de archivo CSV

```csv
paciente_id,fecha_ingreso,fecha_egreso,diagnostico_principal,diagnostico_secundario,edad,sexo,peso,talla
P001,2024-01-01,2024-01-05,Neumonía,Diabetes,65,M,70,170
P002,2024-01-02,,Infarto agudo,Hipertensión,58,F,65,160
```

### Ejemplo de archivo Excel

| paciente_id | fecha_ingreso | fecha_egreso | diagnostico_principal | edad | sexo |
|-------------|---------------|--------------|----------------------|-----|------|
| P001        | 2024-01-01    | 2024-01-05   | Neumonía             | 65  | M    |
| P002        | 2024-01-02    |              | Infarto agudo        | 58  | F    |

## 🧪 Testing

```bash
npm test
```

## 📝 Logs

El sistema registra:
- Archivos procesados
- Errores de validación
- Errores de procesamiento
- Métricas de rendimiento

## 🔒 Seguridad

- **Rate limiting**: Máximo 100 requests por 15 minutos
- **Helmet**: Headers de seguridad
- **CORS**: Configuración de orígenes permitidos
- **Validación de archivos**: Tipos y tamaños permitidos
- **Limpieza de archivos**: Archivos temporales se eliminan automáticamente

## 🚨 Manejo de errores

- Validación de formato de archivo
- Validación de tamaño de archivo
- Validación de datos por fila
- Limpieza automática de archivos temporales
- Respuestas de error detalladas

## 📈 Monitoreo

- Health check endpoint
- Logs estructurados
- Métricas de procesamiento
- Tracking de errores

## 🤝 Contribución

1. Fork el proyecto
2. Crear una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear un Pull Request

## 📄 Licencia

MIT License - ver archivo LICENSE para detalles.
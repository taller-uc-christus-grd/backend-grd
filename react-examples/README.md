# React Frontend para GRD UC Christus

Frontend en React para interactuar con el endpoint `/upload` del sistema GRD.

## 🚀 Características

- **Componente de Upload** completo con validaciones
- **Interfaz intuitiva** para carga de archivos CSV/Excel
- **Validación en tiempo real** de archivos
- **Visualización de resultados** detallada
- **Manejo de errores** robusto
- **Diseño responsive** y profesional

## 📦 Instalación

```bash
cd react-examples
npm install
```

## 🏃‍♂️ Ejecución

```bash
# Modo desarrollo
npm run dev

# Construir para producción
npm run build
```

## 🔗 Configuración

El frontend se ejecuta en `http://localhost:3001` y se conecta automáticamente al backend en `http://localhost:3000` a través del proxy configurado en Vite.

## 📋 Uso

1. **Seleccionar archivo**: Click en "Seleccionar archivo CSV/Excel"
2. **Validación automática**: El sistema valida tipo y tamaño
3. **Subir archivo**: Click en "Subir Archivo"
4. **Ver resultados**: Visualizar datos procesados y errores

## 🎯 Funcionalidades

### Validaciones del Cliente
- ✅ Tipos de archivo permitidos (.csv, .xlsx, .xls)
- ✅ Tamaño máximo 10MB
- ✅ Interfaz de usuario intuitiva

### Respuesta del Servidor
- ✅ Procesamiento de datos clínicos
- ✅ Validación de campos requeridos
- ✅ Estadísticas detalladas
- ✅ Manejo de errores por fila

## 🔧 Personalización

### Cambiar URL del Backend
En `vite.config.js`:
```javascript
proxy: {
  '/api': {
    target: 'http://tu-backend-url:puerto',
    changeOrigin: true,
    secure: false
  }
}
```

### Personalizar Estilos
Los estilos están incluidos en el componente usando `styled-jsx`. Puedes modificar los estilos directamente en `FileUploadComponent.jsx`.

## 📊 Estructura de Datos Esperada

### Campos Requeridos
- `paciente_id`: ID único del paciente
- `fecha_ingreso`: Fecha de ingreso
- `diagnostico_principal`: Diagnóstico principal
- `edad`: Edad del paciente
- `sexo`: Sexo (M/F, Masculino/Femenino)

### Campos Opcionales
- `fecha_egreso`: Fecha de egreso
- `diagnostico_secundario`: Diagnóstico secundario
- `procedimiento`: Procedimiento realizado
- `peso`: Peso del paciente
- `talla`: Talla del paciente
- `dias_estancia`: Días de estancia

## 🧪 Testing

Para probar el componente:

1. Asegúrate de que el backend esté ejecutándose en puerto 3000
2. Ejecuta el frontend: `npm run dev`
3. Abre `http://localhost:3001`
4. Sube un archivo CSV/Excel de prueba

## 🔒 Seguridad

- Validación de tipos de archivo en el cliente
- Validación de tamaño en el cliente
- Validación completa en el servidor
- CORS configurado correctamente
- Rate limiting en el backend

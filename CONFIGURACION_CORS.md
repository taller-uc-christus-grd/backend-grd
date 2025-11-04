# Configuración de CORS para Backend GRD

## 🔧 Configuración Actual

El backend está configurado para aceptar peticiones desde múltiples orígenes a través de la variable de entorno `CORS_ORIGIN`.

## 📝 Variables de Entorno Requeridas

En tu archivo `.env` o en Railway, debes configurar:

```env
CORS_ORIGIN=https://conectagrd.netlify.app,http://localhost:5173
```

**Importante:** Puedes especificar múltiples orígenes separados por comas.

## 🚀 Configuración en Railway (Producción)

1. Ve a tu proyecto en Railway
2. Navega a **Variables** o **Environment Variables**
3. Agrega o actualiza la variable:
   - **Key**: `CORS_ORIGIN`
   - **Value**: `https://conectagrd.netlify.app,http://localhost:5173`
   - (URL de producción: https://conectagrd.netlify.app)

## ✅ Verificación

El backend está configurado con:
- `credentials: true` - Permite enviar cookies y credenciales
- Múltiples orígenes soportados (separados por comas)
- Métodos: GET, POST, PUT, PATCH, DELETE, OPTIONS (default de cors)

## 🔍 Si tienes problemas de CORS

1. Verifica que la variable `CORS_ORIGIN` esté configurada correctamente
2. Asegúrate de incluir el protocolo (`https://` o `http://`)
3. No incluyas la barra final (`/`) en la URL
4. En desarrollo local, incluye `http://localhost:5173`
5. En producción, incluye la URL completa de tu frontend en Netlify


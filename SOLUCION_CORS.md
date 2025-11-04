# Solución de Error CORS

## 🔴 Error Actual

```
Access to XMLHttpRequest at 'https://backend-grd-production.up.railway.app/api/auth/login' 
from origin 'https://conectagrd.netlify.app' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## ✅ Solución

### 1. Configurar Variable de Entorno en Railway

En Railway, ve a tu proyecto → **Variables** y agrega/actualiza:

**Key**: `CORS_ORIGIN`  
**Value**: `https://conectagrd.netlify.app`

**Importante**: 
- No incluyas la barra final `/`
- Usa `https://` (no `http://`)
- Si necesitas múltiples orígenes, sepáralos con comas:
  ```
  https://conectagrd.netlify.app,http://localhost:5173
  ```

### 2. Verificar que el Backend Esté Desplegado

Después de agregar la variable, Railway debería hacer deploy automáticamente. Si no:
1. Ve a **Deployments** en Railway
2. Haz clic en **Redeploy** si es necesario

### 3. Verificar los Logs de Railway

Después del deploy, revisa los logs. Deberías ver:
```
🌐 CORS configurado para: [ 'https://conectagrd.netlify.app' ]
🌐 NODE_ENV: production
```

Si ves `http://localhost:5173` en los logs, significa que la variable `CORS_ORIGIN` no está configurada correctamente.

### 4. Verificar que Funcione

1. Abre tu frontend: `https://conectagrd.netlify.app`
2. Abre la consola del navegador (F12)
3. Intenta hacer login
4. Si aún hay error, revisa los logs del backend en Railway

## 🔍 Debugging

### Verificar CORS Manualmente

Puedes probar el endpoint directamente con curl:

```bash
curl -X OPTIONS https://backend-grd-production.up.railway.app/api/auth/login \
  -H "Origin: https://conectagrd.netlify.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  -v
```

Deberías ver en la respuesta:
```
< HTTP/1.1 204 No Content
< Access-Control-Allow-Origin: https://conectagrd.netlify.app
< Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
< Access-Control-Allow-Headers: Content-Type,Authorization
< Access-Control-Allow-Credentials: true
```

### Problemas Comunes

1. **La variable no se aplicó**: Reinicia el servicio en Railway
2. **URL incorrecta**: Verifica que la URL en `CORS_ORIGIN` sea exactamente `https://conectagrd.netlify.app`
3. **Cache**: A veces Railway cachea las variables. Espera unos minutos o haz redeploy

## 📝 Checklist

- [ ] Variable `CORS_ORIGIN` configurada en Railway
- [ ] Valor: `https://conectagrd.netlify.app`
- [ ] Deploy realizado después de agregar la variable
- [ ] Logs muestran la URL correcta
- [ ] Petición OPTIONS responde correctamente


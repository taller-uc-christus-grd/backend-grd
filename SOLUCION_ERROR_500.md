# Solución para Error 500 en Login - Railway Deployment

## 🔴 Problema

Al intentar iniciar sesión en producción, se recibe un error 500:
```
backend-grd-production.up.railway.app/api/auth/login:1  
Failed to load resource: the server responded with a status of 500
```

## 🔍 Diagnóstico

### Paso 1: Verificar el Health Check

Primero, verifica el endpoint de salud para ver el estado del servidor:

```bash
curl https://backend-grd-production.up.railway.app/health
```

La respuesta debería incluir información sobre:
- Estado de la conexión a la base de datos
- Variables de entorno configuradas
- Configuración de CORS

Si ves `"database": "disconnected"`, el problema es la conexión a la base de datos.

### Paso 2: Verificar los Logs en Railway

1. Ve a tu proyecto en Railway
2. Haz clic en tu servicio backend
3. Ve a la pestaña **Logs**
4. Busca errores que contengan:
   - `❌ Error en login:`
   - `❌ Error al conectar con la base de datos:`
   - `DATABASE_URL no está configurada`

## ✅ Soluciones

### 1. Verificar Variables de Entorno en Railway

Ve a tu proyecto en Railway → **Variables** y asegúrate de tener estas variables configuradas:

#### Variables Requeridas:

```env
# URL de conexión a PostgreSQL (Railway puede generarla automáticamente)
DATABASE_URL=postgresql://usuario:password@host:puerto/database?schema=public

# Secreto para JWT (genera uno seguro)
JWT_SECRET=tu-secreto-muy-seguro-aqui

# Origen del frontend para CORS
CORS_ORIGIN=https://conectagrd.netlify.app

# Puerto (Railway lo asigna automáticamente, pero puedes configurarlo)
PORT=3000

# Entorno
NODE_ENV=production
```

**Importante:**
- Si Railway tiene un servicio de PostgreSQL, debería crear automáticamente la variable `DATABASE_URL`. Verifica que esté conectado.
- Si no hay variable `DATABASE_URL`, conecta un servicio de PostgreSQL o crea una base de datos externa y añade la URL manualmente.

### 2. Configurar Build y Start Commands en Railway

**⚠️ IMPORTANTE:** Las migraciones NO se ejecutan durante el build porque la base de datos no está disponible en esa fase. En su lugar, se ejecutan automáticamente al iniciar el servidor.

**Configuración en Railway:**

1. Ve a tu proyecto en Railway → **Settings** → **Deploy**
2. Configura el **Build Command**:
   ```
   npm run build
   ```
   
   Este comando generará Prisma Client y compilará TypeScript.

3. Configura el **Start Command**:
   ```
   npm run start:prod
   ```
   
   Este comando ejecutará automáticamente las migraciones pendientes y luego iniciará el servidor.

**Nota:** Si prefieres ejecutar las migraciones manualmente, puedes usar `npm start` como Start Command, pero entonces tendrás que ejecutar las migraciones manualmente después de cada deploy (ver opción B abajo).

### 3. Ejecutar Migraciones de Prisma

#### Opción A: Automático (Recomendado) ✅

Si configuraste el Start Command como `npm run start:prod` (ver paso 2), las migraciones se ejecutarán automáticamente cada vez que el servidor se inicie. **Esta es la opción recomendada.**

**Cómo funciona:**
- El script `start:prod` ejecuta `prisma migrate deploy` primero
- Luego inicia el servidor con `node dist/index.js`
- Si hay migraciones pendientes, se aplicarán automáticamente antes de iniciar

#### Opción B: Manual

Si prefieres ejecutar las migraciones manualmente:

1. Ve a la pestaña **Deployments** en Railway
2. Haz clic en los tres puntos del último deployment
3. Selecciona **Open Shell**
4. Ejecuta:
   ```bash
   npm run prisma:migrate:deploy
   ```
   O directamente:
   ```bash
   npx prisma migrate deploy
   ```

**Nota:** En producción, siempre usa `prisma migrate deploy` (no `prisma migrate dev`).

### 4. Verificar la Conexión a la Base de Datos

Si la base de datos está desconectada, verifica:

1. **PostgreSQL está corriendo:** En Railway, ve a tu servicio de PostgreSQL y verifica que esté activo
2. **DATABASE_URL es correcta:** Verifica que la URL tenga el formato correcto:
   ```
   postgresql://usuario:password@host:puerto/database?schema=public
   ```
3. **Las credenciales son correctas:** Verifica que el usuario y contraseña sean correctos
4. **El firewall permite la conexión:** Si usas una base de datos externa, verifica que Railway pueda acceder a ella

### 5. Regenerar Prisma Client

Si Prisma Client no está generado correctamente:

1. Abre un shell en Railway (como en el paso 3.1)
2. Ejecuta:
   ```bash
   npx prisma generate
   ```
3. Reinicia el servicio

## 🔧 Mejoras Implementadas

El código ahora incluye:

1. ✅ **Mejor logging:** El controlador de login ahora registra información detallada sobre los errores
2. ✅ **Health check mejorado:** El endpoint `/health` verifica la conexión a la base de datos
3. ✅ **Script postinstall:** Prisma Client se genera automáticamente después de `npm install`
4. ✅ **Script start:prod:** Ejecuta automáticamente las migraciones antes de iniciar el servidor en producción
5. ✅ **Manejo de errores mejorado:** Los errores ahora se registran con más detalle para debugging

## 📝 Checklist de Verificación

Antes de reportar un problema, verifica:

- [ ] Variable `DATABASE_URL` está configurada en Railway
- [ ] Variable `JWT_SECRET` está configurada en Railway
- [ ] Variable `CORS_ORIGIN` está configurada en Railway
- [ ] El Build Command en Railway está configurado como `npm run build`
- [ ] El Start Command en Railway está configurado como `npm run start:prod`
- [ ] El servicio de PostgreSQL está activo en Railway (si aplica)
- [ ] Las migraciones de Prisma se han ejecutado (automáticamente con `npm run start:prod` o manualmente)
- [ ] Prisma Client está generado (se ejecuta automáticamente con `postinstall` y `build`)
- [ ] El endpoint `/health` muestra `"database": "connected"`
- [ ] Los logs en Railway no muestran errores de conexión a la base de datos

## 🆘 Si el Problema Persiste

1. **Revisa los logs detallados:**
   - En Railway, ve a **Logs**
   - Busca líneas que comiencen con `❌ Error en login:`
   - Copia el mensaje de error completo

2. **Verifica el endpoint de health:**
   ```bash
   curl https://backend-grd-production.up.railway.app/health
   ```
   Revisa qué información muestra sobre el estado del sistema.

3. **Prueba la conexión a la base de datos manualmente:**
   - Abre un shell en Railway
   - Ejecuta: `npx prisma db pull` o `npx prisma studio` para verificar la conexión

4. **Verifica que el código esté actualizado:**
   - Asegúrate de que el último commit incluya todas las mejoras de logging
   - Verifica que Railway haya hecho deploy del código más reciente

## 📞 Información para Soporte

Si necesitas ayuda, proporciona:

1. Respuesta completa del endpoint `/health`
2. Logs de Railway (especialmente errores relacionados con login)
3. Variables de entorno configuradas (sin mostrar valores sensibles)
4. Estado del servicio de PostgreSQL en Railway

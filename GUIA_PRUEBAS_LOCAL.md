# 🧪 Guía de Pruebas en Local - Frontend y Backend

## 📋 Requisitos Previos

1. **Node.js** >= 16.0.0 instalado
2. **PostgreSQL** instalado y corriendo
3. **npm** o **yarn** instalado

---

## 🔧 Configuración del Backend

### 1. Instalar Dependencias

```bash
cd backend-grd
npm install
```

### 2. Configurar Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto `backend-grd`:

```env
# URL de conexión a tu base de datos PostgreSQL
DATABASE_URL="postgresql://usuario:password@localhost:5432/grd?schema=public"

# Puerto donde correrá el backend (default: 3000)
PORT=3000

# Secreto para firmar los JSON Web Tokens
JWT_SECRET=tu-secreto-muy-seguro-aqui-12345

# Origen del frontend (para CORS)
CORS_ORIGIN=http://localhost:5173

# Entorno
NODE_ENV=development
```

**Nota**: Reemplaza `usuario` y `password` con tus credenciales de PostgreSQL.

### 3. Ejecutar Migraciones de Base de Datos

```bash
npm run prisma:migrate
```

Esto creará todas las tablas necesarias en tu base de datos.

### 4. (Opcional) Poblar Base de Datos con Datos de Prueba

```bash
npm run seed
```

Esto creará usuarios y episodios de prueba.

---

## 🚀 Ejecutar el Backend

En el directorio `backend-grd`:

```bash
npm run dev
```

Deberías ver:
```
🚀 GRD Backend escuchando en http://localhost:3000
📡 Health check: http://localhost:3000/health
🔐 Login endpoint: http://localhost:3000/api/auth/login
🌐 CORS configurado para: [ 'http://localhost:5173', 'http://localhost:3000' ]
```

El backend estará corriendo en **http://localhost:3000**

---

## 🎨 Configuración del Frontend

### 1. Navegar al Directorio del Frontend

Si tienes el frontend en un repositorio separado:

```bash
cd ../frontend-grd  # o la ruta donde esté tu frontend
```

### 2. Instalar Dependencias

```bash
npm install
```

### 3. Configurar Variables de Entorno

Crea un archivo `.env` en el frontend (si usa Vite, será `.env.local`):

```env
VITE_API_URL=http://localhost:3000
```

### 4. Ejecutar el Frontend

```bash
npm run dev
```

El frontend debería estar corriendo en **http://localhost:5173** (o el puerto que configure tu proyecto).

---

## 🧪 Probar el Endpoint PATCH /api/episodios/:id

### Opción 1: Usando el Frontend

1. Abre el frontend en http://localhost:5173
2. Inicia sesión con un usuario que tenga rol `finanzas`
3. Navega a la vista de episodios
4. Edita un campo editable (ej: `estadoRN`, `montoAT`, etc.)
5. Guarda los cambios
6. Verifica en la consola del navegador (F12) que la petición se haya realizado correctamente

### Opción 2: Usando Postman

#### Paso 1: Obtener Token JWT

**Request:**
```
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{
  "email": "finanzas@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "1",
    "nombre": "Usuario Finanzas",
    "email": "finanzas@example.com",
    "role": "finanzas"
  }
}
```

#### Paso 2: Probar PATCH /api/episodios/:id

**Request:**
```
PATCH http://localhost:3000/api/episodios/1022626645
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "estadoRN": "Aprobado"
}
```

**Response exitosa (200 OK):**
```json
{
  "episodio": "1022626645",
  "rut": "12.345.678-9",
  "nombre": "Juan Pérez",
  "estadoRN": "Aprobado",
  "montoAT": 18000,
  "montoRN": 150000,
  "montoFinal": 198000,
  ...
}
```

### Opción 3: Usando cURL

#### Ejemplo 1: Actualizar estadoRN

```bash
# Primero, obtener el token
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"finanzas@example.com","password":"password123"}' \
  | jq -r '.token')

# Luego, actualizar el episodio
curl -X PATCH http://localhost:3000/api/episodios/1022626645 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"estadoRN":"Aprobado"}'
```

#### Ejemplo 2: Actualizar montoAT

```bash
curl -X PATCH http://localhost:3000/api/episodios/1022626645 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"montoAT":18000}'
```

#### Ejemplo 3: Actualizar múltiples campos

```bash
curl -X PATCH http://localhost:3000/api/episodios/1022626645 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "at": true,
    "atDetalle": "BASTON-ADULTO",
    "montoAT": 18000
  }'
```

### Opción 4: Usando JavaScript/Fetch en la Consola del Navegador

Abre la consola del navegador (F12) en el frontend y ejecuta:

```javascript
// 1. Obtener token (si no lo tienes)
const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'finanzas@example.com',
    password: 'password123'
  })
});
const { token } = await loginResponse.json();

// 2. Actualizar episodio
const updateResponse = await fetch('http://localhost:3000/api/episodios/1022626645', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    estadoRN: 'Aprobado'
  })
});

const updatedEpisode = await updateResponse.json();
console.log('Episodio actualizado:', updatedEpisode);
```

---

## 📝 Casos de Prueba Recomendados

### 1. ✅ Actualizar estadoRN
```json
{
  "estadoRN": "Aprobado"
}
```
**Verificar**: Que `estadoRN` se actualice correctamente

### 2. ✅ Actualizar montoAT y verificar cálculo de montoFinal
```json
{
  "montoAT": 18000
}
```
**Verificar**: 
- Que `montoAT` se actualice
- Que `montoFinal` se recalcule automáticamente

### 3. ✅ Actualizar at a false y verificar atDetalle
```json
{
  "at": false
}
```
**Verificar**: Que `atDetalle` se convierta en `null` automáticamente

### 4. ✅ Actualizar múltiples campos
```json
{
  "estadoRN": "Aprobado",
  "montoAT": 18000,
  "diasDemoraRescate": 5
}
```
**Verificar**: Que todos los campos se actualicen correctamente

### 5. ❌ Probar con rol incorrecto
Usar un token de usuario con rol `admin` o `codificador`.
**Verificar**: Que retorne 403 Forbidden

### 6. ❌ Probar con estadoRN inválido
```json
{
  "estadoRN": "Aprobadoo"
}
```
**Verificar**: Que retorne 400 Bad Request con mensaje de error

### 7. ❌ Probar con episodio inexistente
```json
PATCH /api/episodios/999999999
{
  "estadoRN": "Aprobado"
}
```
**Verificar**: Que retorne 404 Not Found

### 8. ❌ Probar sin token
Hacer la petición sin el header `Authorization`.
**Verificar**: Que retorne 401 Unauthorized

---

## 🔍 Verificar que Todo Funciona

### 1. Health Check del Backend

```bash
curl http://localhost:3000/health
```

Debería retornar:
```json
{
  "ok": true,
  "message": "Servidor GRD activo 🚀",
  "database": "connected",
  ...
}
```

### 2. Verificar que el Episodio se Actualizó

```bash
curl -X GET http://localhost:3000/api/episodios/1022626645 \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Ver Logs del Backend

En la terminal donde corre `npm run dev`, deberías ver:
- Las peticiones entrantes
- Errores (si los hay)
- Confirmación de CORS

---

## 🐛 Solución de Problemas Comunes

### Error: "Cannot find module"
```bash
npm install
```

### Error: "Database connection failed"
- Verifica que PostgreSQL esté corriendo
- Verifica las credenciales en `.env`
- Verifica que la base de datos exista: `CREATE DATABASE grd;`

### Error: "CORS error"
- Verifica que `CORS_ORIGIN` en `.env` incluya `http://localhost:5173`
- Reinicia el backend después de cambiar `.env`

### Error: "404 Not Found" en PATCH
- Verifica que el endpoint esté registrado: `PATCH /api/episodios/:id`
- Verifica que el ID del episodio exista en la BD
- Verifica que el token JWT sea válido

### Error: "403 Forbidden"
- Verifica que el usuario tenga rol `finanzas` o `FINANZAS`
- Verifica que el token JWT sea válido y no haya expirado

---

## 📚 Recursos Adicionales

- **Documentación del endpoint**: Ver `ESPECIFICACION_BACKEND_FINANZAS.md`
- **Endpoints disponibles**: Ver `ENDPOINTS_BACKEND.md`
- **Solución CORS**: Ver `SOLUCION_CORS.md`

---

## ✅ Checklist de Verificación

- [ ] Backend corriendo en http://localhost:3000
- [ ] Frontend corriendo en http://localhost:5173 (o puerto configurado)
- [ ] Base de datos PostgreSQL conectada
- [ ] Usuario con rol `finanzas` creado
- [ ] Token JWT obtenido correctamente
- [ ] PATCH /api/episodios/:id funciona correctamente
- [ ] Cálculo de `montoFinal` funciona automáticamente
- [ ] Validaciones de campos funcionan
- [ ] Manejo de errores funciona (400, 401, 403, 404, 500)

---

**¡Listo para probar!** 🚀


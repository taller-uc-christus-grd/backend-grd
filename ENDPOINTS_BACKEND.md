# Endpoints del Backend GRD - Documentación para Frontend

## 🔐 Endpoints de Autenticación

### Base URL
```
Producción: https://backend-grd-production.up.railway.app
Desarrollo: http://localhost:3000
```

### 1. POST `/api/auth/login`

**Descripción:** Iniciar sesión con email y contraseña.

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "email": "usuario@ejemplo.com",
  "password": "contraseña123"
}
```

**⚠️ IMPORTANTE:** 
- Los campos deben ser exactamente `email` y `password` (no `username`, `emailAddress`, `pass`, etc.)
- El email debe existir en la base de datos
- El usuario debe estar activo (`activo: true`)
- La contraseña debe ser correcta

**Response Exitoso (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "1",
    "nombre": "Juan Pérez",
    "email": "usuario@ejemplo.com",
    "role": "admin"  // ⚠️ Nota: es "role" (minúsculas), no "rol"
  }
}
```

**Response Error 400 (Bad Request):**
```json
{
  "message": "email y password son obligatorios"
}
```

**Response Error 401 (Unauthorized):**
```json
{
  "message": "Credenciales inválidas"
}
```
*Nota: Este error se devuelve si:*
- El usuario no existe
- El usuario existe pero está inactivo (`activo: false`)
- La contraseña es incorrecta

**Response Error 500 (Internal Server Error):**
```json
{
  "message": "Error en login"
}
```

---

### 2. POST `/api/auth/signup`

**Descripción:** Registrar un nuevo usuario (solo para desarrollo/QA).

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "nombre": "Juan Pérez",
  "email": "usuario@ejemplo.com",
  "password": "contraseña123",
  "rol": "CODIFICADOR"  // Opcional: "ADMIN", "CODIFICADOR", "FINANZAS", "GESTION"
}
```

**Response Exitoso (201):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "1",
    "nombre": "Juan Pérez",
    "email": "usuario@ejemplo.com",
    "role": "codificador"  // ⚠️ Nota: es "role" (minúsculas)
  }
}
```

**Response Error 409 (Conflict):**
```json
{
  "message": "El usuario ya existe"
}
```

---

### 3. GET `/api/auth/me`

**Descripción:** Obtener información del usuario autenticado.

**Headers:**
```
Authorization: Bearer <token>
```

**Response Exitoso (200):**
```json
{
  "user": {
    "id": "1",
    "nombre": "Juan Pérez",
    "email": "usuario@ejemplo.com",
    "role": "admin"  // ⚠️ Nota: es "role" (minúsculas)
  }
}
```

**Response Error 401 (Unauthorized):**
```json
{
  "message": "Falta token Bearer"
}
```
o
```json
{
  "message": "Token inválido o expirado"
}
```

---

## 👥 Endpoints de Usuarios

### 4. GET `/api/users`

**Descripción:** Listar todos los usuarios (solo ADMIN).

**Headers:**
```
Authorization: Bearer <token>
```

**Response Exitoso (200):**
```json
[
  {
    "id": 1,
    "nombre": "Juan Pérez",
    "email": "usuario@ejemplo.com",
    "rol": "ADMIN",
    "activo": true
  }
]
```

---

### 5. POST `/api/users`

**Descripción:** Crear un nuevo usuario (solo ADMIN).

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "nombre": "Juan Pérez",
  "email": "usuario@ejemplo.com",
  "password": "contraseña123",
  "rol": "CODIFICADOR"
}
```

---

## 📋 Otros Endpoints

### Health Check

**GET `/health`**

**Response:**
```json
{
  "ok": true,
  "message": "Servidor GRD activo 🚀",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "service": "backend-grd",
  "database": "connected",
  "environment": "production",
  "hasDatabaseUrl": true,
  "hasJwtSecret": true,
  "corsOrigin": "https://conectagrd.netlify.app"
}
```

---

## 🔍 Verificación de Endpoints en el Frontend

Para verificar que el frontend esté usando los endpoints correctos, asegúrate de que:

### ✅ Login

1. **URL correcta:**
   ```javascript
   // ✅ CORRECTO
   const url = 'https://backend-grd-production.up.railway.app/api/auth/login';
   
   // ❌ INCORRECTO
   const url = 'https://backend-grd-production.up.railway.app/auth/login';  // Falta /api
   const url = 'https://backend-grd-production.up.railway.app/api/login';   // Falta /auth
   ```

2. **Método correcto:**
   ```javascript
   // ✅ CORRECTO
   method: 'POST'
   ```

3. **Headers correctos:**
   ```javascript
   // ✅ CORRECTO
   headers: {
     'Content-Type': 'application/json'
   }
   ```

4. **Body correcto:**
   ```javascript
   // ✅ CORRECTO
   body: JSON.stringify({
     email: 'usuario@ejemplo.com',
     password: 'contraseña123'
   })
   
   // ❌ INCORRECTO
   body: JSON.stringify({
     username: 'usuario@ejemplo.com',  // Debe ser "email"
     pass: 'contraseña123'             // Debe ser "password"
   })
   ```

5. **Manejo de respuesta:**
   ```javascript
   // ✅ CORRECTO - El backend devuelve:
   {
     token: "...",
     user: {
       id: "1",
       nombre: "...",
       email: "...",
       role: "admin"  // ⚠️ Es "role", no "rol"
     }
   }
   ```

### ✅ Usar el token en peticiones autenticadas

```javascript
// ✅ CORRECTO
headers: {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
}

// ❌ INCORRECTO
headers: {
  'Authorization': token,  // Falta "Bearer "
  'token': token           // Debe ser "Authorization"
}
```

---

## 🐛 Solución de Problemas Comunes

### Error 401 en Login

**Posibles causas:**

1. **Credenciales incorrectas**
   - Verifica que el email y contraseña sean correctos
   - Verifica que el usuario exista en la base de datos
   - Verifica que el usuario esté activo (`activo: true`)

2. **Body incorrecto**
   - Verifica que uses `email` y `password` (no otros nombres)
   - Verifica que el Content-Type sea `application/json`

3. **Endpoint incorrecto**
   - Verifica que uses `/api/auth/login` (no `/auth/login` o `/api/login`)

### Error CORS

Si recibes errores de CORS:

1. Verifica que la variable `CORS_ORIGIN` esté configurada en Railway
2. Verifica que el origen sea exactamente `https://conectagrd.netlify.app`
3. Verifica los logs del backend para ver qué orígenes están permitidos

---

## 📝 Ejemplo de Código Frontend (JavaScript/TypeScript)

```typescript
// Función de login
async function login(email: string, password: string) {
  try {
    const response = await fetch(
      'https://backend-grd-production.up.railway.app/api/auth/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Importante para CORS con credentials
        body: JSON.stringify({
          email,  // ⚠️ Debe ser "email"
          password,  // ⚠️ Debe ser "password"
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error en login');
    }

    const data = await response.json();
    // data.token - Token JWT
    // data.user.id - ID del usuario (string)
    // data.user.nombre - Nombre del usuario
    // data.user.email - Email del usuario
    // data.user.role - Rol del usuario (minúsculas: "admin", "codificador", etc.)
    
    return data;
  } catch (error) {
    console.error('Error en login:', error);
    throw error;
  }
}

// Función para obtener información del usuario autenticado
async function getMe(token: string) {
  try {
    const response = await fetch(
      'https://backend-grd-production.up.railway.app/api/auth/me',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,  // ⚠️ Importante: "Bearer " antes del token
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al obtener usuario');
    }

    const data = await response.json();
    return data.user;
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    throw error;
  }
}
```

---

## ✅ Checklist de Verificación Frontend

Antes de reportar problemas, verifica:

- [ ] URL del endpoint: `https://backend-grd-production.up.railway.app/api/auth/login`
- [ ] Método: `POST`
- [ ] Header `Content-Type: application/json`
- [ ] Body tiene exactamente `email` y `password` (no otros nombres)
- [ ] El email es correcto y existe en la base de datos
- [ ] El usuario está activo en la base de datos
- [ ] La contraseña es correcta
- [ ] Estás manejando la respuesta correctamente (el campo es `role`, no `rol`)
- [ ] Para peticiones autenticadas, usas `Authorization: Bearer <token>`

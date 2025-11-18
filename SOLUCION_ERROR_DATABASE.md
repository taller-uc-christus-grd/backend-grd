# Solución: Error de Autenticación de Base de Datos

## Error
```
P1000: Authentication failed against database server, 
the provided database credentials for `usuario` are not valid.
```

## Causa
El archivo `.env` tiene credenciales incorrectas o está usando un usuario diferente al configurado en la base de datos.

## Solución

### Paso 1: Verificar tu archivo .env

Abre el archivo `backend-grd/.env` y verifica que tenga estas credenciales:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/grd?schema=public
```

**IMPORTANTE**: 
- Usuario: `postgres` (no `usuario`)
- Contraseña: `postgres`
- Base de datos: `grd`
- Puerto: `5432`

### Paso 2: Si usas Docker Compose

Si estás usando el `docker-compose.yml` incluido, las credenciales son:
- **Usuario**: `postgres`
- **Contraseña**: `postgres`
- **Base de datos**: `grd`

Asegúrate de que el contenedor esté corriendo:
```bash
cd backend-grd
docker compose up -d
```

### Paso 3: Si usas una base de datos diferente

Si tienes una base de datos PostgreSQL existente con credenciales diferentes, actualiza el `.env` con tus credenciales reales:

```env
DATABASE_URL=postgresql://TU_USUARIO:TU_PASSWORD@localhost:5432/TU_BASE_DE_DATOS?schema=public
```

### Paso 4: Crear el archivo .env correcto

Si no tienes el archivo `.env` o tiene credenciales incorrectas, créalo con este contenido:

**Opción A: Usando bash**
```bash
cd backend-grd
cat > .env << 'EOF'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/grd?schema=public
JWT_SECRET=dev-secret-key-change-in-production-2024
CORS_ORIGIN=http://localhost:5173,http://localhost:3000
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
EOF
```

**Opción B: Copiar desde .env.example**
```bash
cd backend-grd
cp .env.example .env
# Luego edita el .env y verifica que DATABASE_URL sea correcta
```

**Opción C: Crear manualmente**
1. Crea un archivo llamado `.env` en el directorio `backend-grd`
2. Copia y pega este contenido:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/grd?schema=public
JWT_SECRET=dev-secret-key-change-in-production-2024
CORS_ORIGIN=http://localhost:5173,http://localhost:3000
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

### Paso 5: Verificar la conexión

Después de corregir el `.env`, prueba la conexión:

```bash
cd backend-grd
npm run prisma:generate
```

Si sigue fallando, verifica:
1. ✅ Que la base de datos esté corriendo (si usas Docker: `docker compose ps`)
2. ✅ Que el puerto 5432 esté disponible
3. ✅ Que las credenciales en `.env` coincidan con las de tu base de datos

## Formato correcto de DATABASE_URL

```
postgresql://[USUARIO]:[CONTRASEÑA]@[HOST]:[PUERTO]/[BASE_DE_DATOS]?schema=public
```

Ejemplo para Docker Compose:
```
postgresql://postgres:postgres@localhost:5432/grd?schema=public
```


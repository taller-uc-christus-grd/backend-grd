# Configuración Local - Backend GRD

## Configuración de Base de Datos Local

El archivo `.env` ha sido configurado para usar una base de datos PostgreSQL local.

### Pasos para configurar PostgreSQL localmente:

1. **Instalar PostgreSQL** (si no lo tienes):
   ```bash
   # macOS con Homebrew
   brew install postgresql@14
   brew services start postgresql@14
   
   # O descarga desde: https://www.postgresql.org/download/
   ```

2. **Crear la base de datos**:
   ```bash
   # Conectar a PostgreSQL
   psql postgres
   
   # Crear usuario (si no existe)
   CREATE USER postgres WITH PASSWORD 'postgres';
   
   # Crear base de datos
   CREATE DATABASE grd;
   
   # Dar permisos
   GRANT ALL PRIVILEGES ON DATABASE grd TO postgres;
   \q
   ```

3. **Ajustar el archivo `.env`** si tu configuración es diferente:
   ```env
   DATABASE_URL="postgresql://usuario:password@localhost:5432/grd?schema=public"
   ```

4. **Ejecutar migraciones**:
   ```bash
   npm run prisma:migrate
   # O si las migraciones ya están aplicadas:
   npx prisma migrate deploy
   ```

5. **Generar Prisma Client**:
   ```bash
   npx prisma generate
   ```

6. **Opcional: Poblar con datos de prueba**:
   ```bash
   npm run seed
   ```

### Restaurar configuración de Railway

Si necesitas volver a usar Railway, puedes restaurar el backup:
```bash
cp .env.backup .env
```

O editar manualmente el `.env` y cambiar:
```env
DATABASE_URL="postgresql://postgres:aAnODYWtJgHEmAGyzGGkJcixUoATcZGF@postgres.railway.internal:5432/railway"
```

### Verificar conexión

Para verificar que la conexión funciona:
```bash
npm run dev
```

Deberías ver:
```
✅ Conectado a la base de datos
🚀 GRD Backend escuchando en http://localhost:3000
```


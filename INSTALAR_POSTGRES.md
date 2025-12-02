# Instalación de PostgreSQL - Guía Rápida

## Opción 1: Instalación con Homebrew (Recomendado para macOS)

### Paso 1: Instalar PostgreSQL
```bash
brew install postgresql@14
```

### Paso 2: Iniciar el servicio
```bash
brew services start postgresql@14
```

### Paso 3: Verificar que está corriendo
```bash
brew services list | grep postgres
# Deberías ver: postgresql@14 started
```

### Paso 4: Crear la base de datos
```bash
# Conectar a PostgreSQL
psql postgres

# Dentro de psql, ejecutar:
CREATE DATABASE grd;
\q
```

### Paso 5: Verificar conexión
```bash
psql -d grd -c "SELECT version();"
```

---

## Opción 2: Usar Docker (Más fácil, no requiere instalación permanente)

### Paso 1: Crear y ejecutar contenedor PostgreSQL
```bash
docker run --name postgres-grd \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=grd \
  -p 5432:5432 \
  -d postgres:14
```

### Paso 2: Verificar que está corriendo
```bash
docker ps | grep postgres-grd
```

### Paso 3: El .env ya está configurado correctamente
No necesitas cambiar nada, el .env ya tiene:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/grd?schema=public"
```

### Para detener el contenedor:
```bash
docker stop postgres-grd
```

### Para iniciar el contenedor de nuevo:
```bash
docker start postgres-grd
```

---

## Opción 3: PostgreSQL.app (Interfaz gráfica para macOS)

1. Descargar desde: https://postgresapp.com/
2. Instalar y abrir la app
3. Click en "Initialize" para crear un servidor
4. El servidor correrá en `localhost:5432` con usuario `postgres` y sin contraseña

**Nota:** Si usas PostgreSQL.app, actualiza el .env:
```
DATABASE_URL="postgresql://postgres@localhost:5432/grd?schema=public"
```

---

## Después de instalar PostgreSQL

1. **Ejecutar migraciones:**
   ```bash
   npm run prisma:migrate
   ```

2. **Generar Prisma Client:**
   ```bash
   npx prisma generate
   ```

3. **Iniciar el servidor:**
   ```bash
   npm run dev
   ```

Deberías ver:
```
✅ Conectado a la base de datos
🚀 GRD Backend escuchando en http://localhost:3000
```



# Instalación de PostgreSQL en macOS

## Opción 1: Usando Homebrew (Recomendado)

### 1. Instalar Homebrew (si no lo tienes)
Ejecuta en tu terminal:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Sigue las instrucciones en pantalla. Si es una Mac con Apple Silicon (M1/M2/M3), puede que necesites ejecutar:
```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 2. Instalar PostgreSQL
```bash
brew install postgresql@16
```

### 3. Iniciar PostgreSQL
```bash
brew services start postgresql@16
```

### 4. Crear la base de datos
```bash
createdb grd
```

### 5. Verificar que funciona
```bash
psql -d grd -c "SELECT version();"
```

---

## Opción 2: Usando Postgres.app (Más fácil, sin terminal)

### 1. Descargar Postgres.app
- Ve a: https://postgresapp.com/
- Descarga e instala la aplicación
- Ábrela y presiona "Initialize" para crear un nuevo servidor

### 2. Configurar PATH
Agrega esto a tu `~/.zshrc`:
```bash
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
```

Luego ejecuta:
```bash
source ~/.zshrc
```

### 3. Crear la base de datos
```bash
createdb grd
```

---

## Opción 3: Usando Docker (Si tienes Docker Desktop)

```bash
docker run --name postgres-grd \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=grd \
  -p 5432:5432 \
  -d postgres:16
```

Luego actualiza tu `.env`:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/grd?schema=public"
```

---

## Después de instalar PostgreSQL

### 1. Actualizar tu archivo .env
Asegúrate de que tu `.env` tenga:
```env
DATABASE_URL="postgresql://usuario:password@localhost:5432/grd?schema=public"
```

Reemplaza `usuario` y `password` con tus credenciales:
- Si usas Homebrew: usuario es tu nombre de usuario de macOS, sin password
- Si usas Postgres.app: usuario es tu nombre de usuario de macOS, sin password
- Si usas Docker: usuario es `postgres`, password es el que configuraste

### 2. Generar el cliente de Prisma
```bash
npm run prisma:generate
```

### 3. Ejecutar las migraciones
```bash
npm run prisma:migrate
```

### 4. (Opcional) Poblar con datos de prueba
```bash
npm run seed
```

---

## Verificar que todo funciona

```bash
npm run dev
```

El servidor debería iniciar sin errores de conexión a la base de datos.


# Solución Rápida - Error de Conexión a Base de Datos

## El Problema
```
❌ Error al conectar con la base de datos: Can't reach database server at `localhost:5432`
```

## Solución Rápida (3 opciones)

### Opción 1: Instalación Automática con Script ⚡
```bash
./scripts/install-postgres.sh
```

Este script:
- Instala PostgreSQL 14 con Homebrew
- Inicia el servicio
- Crea la base de datos 'grd'

### Opción 2: Instalación Manual 📝

**Paso 1:** Instalar PostgreSQL
```bash
brew install postgresql@14
brew services start postgresql@14
```

**Paso 2:** Crear la base de datos
```bash
./scripts/setup-db.sh
# O manualmente:
createdb grd
```

**Paso 3:** Ejecutar migraciones
```bash
npm run prisma:migrate
npx prisma generate
```

**Paso 4:** Iniciar servidor
```bash
npm run dev
```

### Opción 3: Usar Docker 🐳

Si tienes Docker instalado:
```bash
docker-compose up -d
```

Luego ejecuta las migraciones:
```bash
npm run prisma:migrate
npx prisma generate
npm run dev
```

---

## Verificar que Funciona

Después de instalar, deberías ver:
```
✅ Conectado a la base de datos
🚀 GRD Backend escuchando en http://localhost:3000
```

## Comandos Útiles

**Verificar que PostgreSQL está corriendo:**
```bash
brew services list | grep postgres
# O
pg_isready -h localhost -p 5432
```

**Conectar a la base de datos:**
```bash
psql -d grd
```

**Detener PostgreSQL:**
```bash
brew services stop postgresql@14
```

**Iniciar PostgreSQL:**
```bash
brew services start postgresql@14
```


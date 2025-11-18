# Instrucciones para aplicar la migración de la columna "Convenio"

## Pasos necesarios

### 0. Prerrequisitos

1. **Base de datos Postgres**

   - Levanta la base local con:
     ```bash
     docker compose up -d
     ```
     (usa el `docker-compose.yml` incluido en `backend-grd/`).
   - Si usas otra instancia, ajusta las credenciales.

2. **Archivo `.env`**  
   
   **Opción 1: Copiar desde .env.example (Más fácil)**
   ```bash
   cd backend-grd
   cp .env.example .env
   ```
   
   **Opción 2: Usar script bash**
   ```bash
   cd backend-grd
   chmod +x create-env.sh
   ./create-env.sh
   ```
   
   **Opción 3: Usar script PowerShell**
   ```powershell
   cd backend-grd
   .\create-env.ps1
   ```
   
   **Opción 4: Crear manualmente**
   Crea un archivo `.env` en `backend-grd/` y copia el contenido de `.env.example`.

### 1. Ejecutar migración y generación

La migración para agregar la columna "Convenio" ya está creada. Solo necesitas ejecutar los siguientes comandos:

### Opción 1: Usando el script npm (Recomendado)

Desde el directorio `backend-grd`, ejecuta:

```bash
npm run prisma:setup
```

Este comando ejecutará:

1. `npx prisma generate` - Regenera el cliente de Prisma con el nuevo campo
2. `npx prisma migrate deploy` - Aplica la migración a la base de datos

### Opción 2: Ejecutar comandos individualmente

```bash
# 1. Regenerar el cliente de Prisma
npm run prisma:generate

# 2. Aplicar la migración a la base de datos
npm run prisma:migrate:deploy
```

### Opción 3: Usando npx directamente

```bash
# 1. Regenerar el cliente de Prisma
npx prisma generate

# 2. Aplicar la migración a la base de datos
npx prisma migrate deploy
```

## Verificación

Después de ejecutar los comandos, verifica que:

1. ✅ El cliente de Prisma se haya regenerado correctamente
2. ✅ La migración se haya aplicado sin errores
3. ✅ La columna `convenio` exista en la tabla `Episodio` de tu base de datos

## Nota

- Si estás en desarrollo, puedes usar `npx prisma migrate dev` en lugar de `deploy`
- La columna `convenio` será `NULL` para los episodios existentes
- Puedes actualizar el convenio mediante la API usando `PATCH /api/episodios/:id` con `{ "convenio": "nombre del convenio" }`

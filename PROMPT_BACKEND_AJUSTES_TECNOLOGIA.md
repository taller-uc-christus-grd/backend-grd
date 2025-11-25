# Prompt para Backend: Tabla Ajustes Por Tecnología

## Resumen

El frontend necesita una nueva tabla `ajustes_tecnologia` para gestionar ajustes por tecnología (AT) y sus montos asociados. La vista es accesible solo por usuarios con rol `finanzas` o `gestion`.

## Cambios Requeridos

### 1. Modelo de Datos (Prisma Schema)

Agregar modelo `AjusteTecnologia`:

```prisma
model AjusteTecnologia {
  id       String  @id @default(uuid())
  at       String? @default("") // Descripción del AT (ej: "Stent mas dispositivo de liberación")
  monto    Float?  @default(0)  // Monto asociado (ej: 51276)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 2. Migración de Base de Datos

Ejecutar migración:

```bash
npx prisma migrate dev --name add_ajustes_tecnologia_table
```

### 3. Endpoints de API

Crear endpoints en `src/routes/ajustes-tecnologia.routes.ts`:

#### GET /api/ajustes-tecnologia
- Listar todos los ajustes por tecnología
- Requiere autenticación (roles: `finanzas`, `gestion`)
- Ordenar por `at` alfabéticamente

#### POST /api/ajustes-tecnologia
- Crear nuevo ajuste por tecnología
- Body: `{ at: string, monto: number }`
- Requiere autenticación (roles: `finanzas`, `gestion`)
- **Permite campos vacíos** para guardar campo por campo

#### PATCH /api/ajustes-tecnologia/:id
- Actualizar un ajuste existente
- Body: campos a actualizar (parcial): `{ at?: string, monto?: number }`
- Requiere autenticación (roles: `finanzas`, `gestion`)

#### DELETE /api/ajustes-tecnologia/:id
- Eliminar un ajuste
- Requiere autenticación (roles: `finanzas`, `gestion`)

### 4. Validaciones

**IMPORTANTE**: El frontend permite guardar campo por campo, por lo que los registros pueden tener campos vacíos al momento de crearse.

- `at`: opcional al crear (puede ser string vacío `""`), se puede completar después
- `monto`: opcional al crear (puede ser `0`), número positivo si está presente

**Nota**: Para permitir guardar campo por campo, NO marcar campos como `@required` en Prisma. Permitir valores por defecto.

### 5. Respuestas de API

**GET /api/ajustes-tecnologia**
```json
[
  {
    "id": "uuid-123",
    "at": "Stent mas dispositivo de liberación",
    "monto": 51276
  },
  {
    "id": "uuid-456",
    "at": "Instalación de 1 o más dispositivos coils",
    "monto": 134463
  }
]
```

**POST /api/ajustes-tecnologia**
```json
{
  "at": "Stent mas dispositivo de liberación",
  "monto": 51276
}
```

**Ejemplo con campos vacíos (permite guardar campo por campo):**
```json
{
  "at": "",
  "monto": 0
}
```

**PATCH /api/ajustes-tecnologia/:id**
```json
{
  "monto": 55000
}
```

## Checklist

- [ ] Modelo `AjusteTecnologia` agregado al schema de Prisma
- [ ] Migración de BD creada y ejecutada
- [ ] Endpoint `GET /api/ajustes-tecnologia` implementado
- [ ] Endpoint `POST /api/ajustes-tecnologia` implementado
- [ ] Endpoint `PATCH /api/ajustes-tecnologia/:id` implementado
- [ ] Endpoint `DELETE /api/ajustes-tecnologia/:id` implementado
- [ ] Validaciones de campos implementadas (permitir campos vacíos al crear)
- [ ] Control de roles (solo `finanzas` y `gestion`)
- [ ] Manejo de errores implementado
- [ ] Prisma Client regenerado

## Notas

- El frontend permite guardar campo por campo, por lo que el backend debe aceptar registros con campos vacíos inicialmente
- El campo `at` es la descripción del ajuste por tecnología
- El campo `monto` es un número decimal (sin formato de moneda en BD)
- El frontend formatea el monto con formato de moneda ($) para visualización


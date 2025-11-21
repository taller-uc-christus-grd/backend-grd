# Prompt para Backend: Tabla Precios Convenios

## Resumen

El frontend necesita una nueva tabla `precios_convenios` para gestionar precios de convenios por aseguradora, tipo y tramo. La vista es accesible solo por usuarios con rol `finanzas` o `gestion`.

## Cambios Requeridos

### 1. Modelo de Datos (Prisma Schema)

Agregar modelo `PrecioConvenio`:

```prisma
model PrecioConvenio {
  id             String    @id @default(uuid())
  aseguradora    String?   @default("") // Código de aseguradora (ej: "50000000")
  nombre_asegi   String?   @default("") // Nombre de la aseguradora (ej: "FONASA")
  convenio       String?   @default("") // Código del convenio (ej: "CH0041", "FNS012")
  descr_convenio String?   @default("") // Descripción del convenio (ej: "GRD CARDIOPATIA")
  tipoAsegurad   String?   @default("") // Tipo de aseguradora (ej: "Pública")
  tipoConvenio   String?   @default("") // Tipo de convenio (ej: "Público - GRD", "Público - GRD T1")
  tramo          String?   // Tramo (puede ser null o vacío, ej: "T1", "T2", "T3")
  fechaAdmision  DateTime? // Fecha de admisión (ej: "29-08-2025") - opcional para permitir guardar campo por campo
  fechaFin       DateTime? // Fecha fin (ej: "31-12-2025") - opcional para permitir guardar campo por campo
  precio         Float?    @default(0) // Precio del convenio (ej: 84.536, 202.666)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 2. Migración de Base de Datos

Ejecutar migración:

```bash
npx prisma migrate dev --name add_precios_convenios_table
```

### 3. Endpoints de API

Crear endpoints en `src/routes/precios-convenios.routes.ts`:

#### GET /api/precios-convenios
- Listar todos los precios de convenios
- Requiere autenticación (roles: `finanzas`, `gestion`)

#### POST /api/precios-convenios
- Crear nuevo precio de convenio
- Body: todos los campos del modelo (excepto `id`, `createdAt`, `updatedAt`)
- Requiere autenticación (roles: `finanzas`, `gestion`)

#### PATCH /api/precios-convenios/:id
- Actualizar un precio de convenio existente
- Body: campos a actualizar (parcial)
- Requiere autenticación (roles: `finanzas`, `gestion`)

#### DELETE /api/precios-convenios/:id
- Eliminar un precio de convenio
- Requiere autenticación (roles: `finanzas`, `gestion`)

### 4. Validaciones

**IMPORTANTE**: El frontend permite guardar campo por campo, por lo que los registros pueden tener campos vacíos al momento de crearse.

- `aseguradora`: opcional al crear (puede ser string vacío `""`), se puede completar después
- `nombre_asegi`: opcional al crear (puede ser string vacío `""`), se puede completar después
- `convenio`: opcional al crear (puede ser string vacío `""`), se puede completar después
- `descr_convenio`: opcional al crear (puede ser string vacío `""`)
- `tipoAsegurad`: opcional al crear (puede ser string vacío `""`)
- `tipoConvenio`: opcional al crear (puede ser string vacío `""`)
- `tramo`: opcional, string o null
- `fechaAdmision`: opcional al crear (puede ser `null`), formato fecha (DateTime) si está presente
- `fechaFin`: opcional al crear (puede ser `null`), formato fecha (DateTime) si está presente, debe ser >= fechaAdmision si ambos están presentes
- `precio`: opcional al crear (puede ser `0`), número positivo si está presente

**Nota**: Para permitir guardar campo por campo, NO marcar campos como `@required` en Prisma. Permitir `null` o valores por defecto.

### 5. Formato de Fechas

El frontend envía y espera recibir fechas en formato:
- Envío: `"DD-MM-YYYY"` (ej: "29-08-2025")
- Respuesta: `"YYYY-MM-DD"` o `"DD-MM-YYYY"` (el frontend puede manejar ambos)

Si usas DateTime de Prisma, convertir entre formatos según corresponda.

### 6. Respuestas de API

**GET /api/precios-convenios**
```json
[
  {
    "id": "uuid-123",
    "aseguradora": "50000000",
    "nombre_asegi": "FONASA",
    "convenio": "CH0041",
    "descr_convenio": "GRD CARDIOPATIA",
    "tipoAsegurad": "Pública",
    "tipoConvenio": "Público - GRD",
    "tramo": null,
    "fechaAdmision": "2025-08-29T00:00:00.000Z",
    "fechaFin": "2025-12-31T00:00:00.000Z",
    "precio": 84.536
  }
]
```

**POST /api/precios-convenios**
```json
{
  "aseguradora": "50000000",
  "nombre_asegi": "FONASA",
  "convenio": "FNS012",
  "descr_convenio": "GRD UGCC",
  "tipoAsegurad": "Pública",
  "tipoConvenio": "Público - GRD T1",
  "tramo": "T1",
  "fechaAdmision": "2025-08-29",
  "fechaFin": "2025-12-31",
  "precio": 84.536
}
```

**Ejemplo con campos vacíos (permite guardar campo por campo):**
```json
{
  "aseguradora": "123123",
  "nombre_asegi": "",
  "convenio": "",
  "descr_convenio": "",
  "tipoAsegurad": "",
  "tipoConvenio": "",
  "tramo": null,
  "fechaAdmision": null,
  "fechaFin": null,
  "precio": 0
}
```

**PATCH /api/precios-convenios/:id**
```json
{
  "precio": 95.500
}
```

## Checklist

- [ ] Modelo `PrecioConvenio` agregado al schema de Prisma
- [ ] Migración de BD creada y ejecutada
- [ ] Endpoint `GET /api/precios-convenios` implementado
- [ ] Endpoint `POST /api/precios-convenios` implementado
- [ ] Endpoint `PATCH /api/precios-convenios/:id` implementado
- [ ] Endpoint `DELETE /api/precios-convenios/:id` implementado
- [ ] Validaciones de campos implementadas
- [ ] Control de roles (solo `finanzas` y `gestion`)
- [ ] Manejo de errores implementado
- [ ] Prisma Client regenerado

## Notas

- Todos los campos de la tabla son editables desde el frontend
- El frontend permite agregar y eliminar filas
- Las fechas se manejan en formato DD-MM-YYYY para visualización pero pueden almacenarse como DateTime
- El precio es un número decimal con hasta 3 decimales


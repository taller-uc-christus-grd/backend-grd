# 📋 Especificación Completa: Funcionalidad de Finanzas - Edición de Episodios

## 🎯 Resumen Ejecutivo

Los usuarios con rol **`finanzas`** pueden editar manualmente campos financieros de episodios hospitalarios. El frontend envía actualizaciones parciales (PATCH) al backend, y el backend debe aplicar reglas de negocio para calcular campos derivados como `montoFinal`.

---

## 🔐 Autenticación y Autorización

### Requisitos
- **Rol requerido**: `finanzas`
- **Autenticación**: Token JWT en header `Authorization: Bearer <token>`
- **Permisos**: Solo usuarios con rol `finanzas` pueden editar los campos especificados

---

## 📍 Endpoint Principal

### **PATCH `/api/episodios/:id`**

**Descripción**: Actualiza uno o más campos financieros de un episodio específico.

**Método HTTP**: `PATCH`

**URL**: `/api/episodios/:id`

**Parámetro de ruta**:
- `id` (string/number): Identificador del episodio (ejemplo: `1022626645` o `"EP001"`)

**Headers requeridos**:
```
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

---

## 📦 Campos Editables por Finanzas

### 1. **estadoRN** (Estado del Reembolso)

**Tipo de dato**: `string | null`

**Valores permitidos**:
- `"Aprobado"`
- `"Pendiente"`
- `"Rechazado"`
- `null`

**Validación frontend**:
- Solo acepta los valores exactos listados arriba
- Case-sensitive

**Ejemplo de request**:
```json
{
  "estadoRN": "Aprobado"
}
```

---

### 2. **at** (Ajuste por Tecnología - Sí/No)

**Tipo de dato**: `boolean`

**Valores permitidos**:
- `true` (Sí)
- `false` (No)

**Validación frontend**:
- Se convierte desde string `"true"` o `"false"` a boolean

**Ejemplo de request**:
```json
{
  "at": true
}
```

---

### 3. **atDetalle** (Detalle del Ajuste por Tecnología)

**Tipo de dato**: `string | null | undefined`

**Valores permitidos**:
- Cualquier string (texto libre)
- `null`
- `undefined`

**Ejemplos válidos**:
- `"BASTON-ADULTO"`
- `"SILLA-RUEDAS-SIM"`
- `"PROTESIS-DENTAL"`
- `null`

**Ejemplo de request**:
```json
{
  "atDetalle": "BASTON-ADULTO"
}
```

---

### 4. **montoAT** (Monto del Ajuste por Tecnología)

**Tipo de dato**: `number`

**Validación frontend**:
- Debe ser un número válido
- Debe ser >= 0
- Se parsea como `parseFloat(value)`
- Warning si > 10,000,000

**Ejemplo de request**:
```json
{
  "montoAT": 18000
}
```

**Notas**:
- Solo se muestra/edita si `at === true`
- Valor ingresado manualmente por finanzas

---

### 5. **montoRN** (Monto de Reembolso)

**Tipo de dato**: `number`

**Validación frontend**:
- Debe ser un número válido
- Debe ser >= 0
- Warning si > 10,000,000

**Ejemplo de request**:
```json
{
  "montoRN": 150000
}
```

---

### 6. **diasDemoraRescate** (Días de Demora en Rescate)

**Tipo de dato**: `number`

**Validación frontend**:
- Debe ser un número entero válido
- Debe ser >= 0
- Se parsea como `parseInt(value)`
- Warning si > 365 días

**Ejemplo de request**:
```json
{
  "diasDemoraRescate": 5
}
```

---

### 7. **pagoDemora** (Pago por Demora en Rescate)

**Tipo de dato**: `number | null`

**Validación frontend**:
- Debe ser un número válido
- Debe ser >= 0
- Puede ser `null`
- Warning si > 10,000,000

**Ejemplo de request**:
```json
{
  "pagoDemora": 5000
}
```

---

### 8. **pagoOutlierSup** (Pago por Outlier Superior)

**Tipo de dato**: `number | null`

**Validación frontend**:
- Debe ser un número válido
- Debe ser >= 0
- Puede ser `null`
- Warning si > 10,000,000

**Ejemplo de request**:
```json
{
  "pagoOutlierSup": 25000
}
```

---

### 9. **precioBaseTramo** (Precio Base por Tramo)

**Tipo de dato**: `number`

**Validación frontend**:
- Debe ser un número válido
- Debe ser >= 0
- Warning si > 10,000,000

**Ejemplo de request**:
```json
{
  "precioBaseTramo": 125000
}
```

---

### 10. **valorGRD** (Valor GRD)

**Tipo de dato**: `number`

**Validación frontend**:
- Debe ser un número válido
- Debe ser >= 0
- Warning si > 10,000,000

**Ejemplo de request**:
```json
{
  "valorGRD": 150000
}
```

**Nota**: El frontend valida que `valorGRD ≈ peso * precioBaseTramo` (con tolerancia de 0.01), pero el backend puede aplicar sus propias reglas.

---

### 11. **montoFinal** (Monto Final Calculado)

**Tipo de dato**: `number`

**Validación frontend**:
- Debe ser un número válido
- Debe ser >= 0
- Warning si > 10,000,000

**Ejemplo de request**:
```json
{
  "montoFinal": 168000
}
```

**⚠️ IMPORTANTE**: Aunque el frontend permite editar este campo, el backend debe calcularlo automáticamente según la fórmula:
```
montoFinal = valorGRD + montoAT + pagoOutlierSup + pagoDemora
```

**El backend debe ignorar el valor de `montoFinal` si viene en el request y calcularlo siempre.**

---

### 12. **documentacion** (Documentación Necesaria)

**Tipo de dato**: `string | null | undefined`

**Valores permitidos**:
- Cualquier string (texto libre)
- `null`
- `undefined`

**Ejemplo de request**:
```json
{
  "documentacion": "Epicrisis completa, protocolo de alta"
}
```

---

## 📤 Formato de Request

### Request Body (PATCH Parcial)

El frontend envía **solo el campo que se está editando**, no el objeto completo.

**Ejemplo 1**: Editar solo `estadoRN`
```json
{
  "estadoRN": "Aprobado"
}
```

**Ejemplo 2**: Editar solo `montoAT`
```json
{
  "montoAT": 18000
}
```

**Ejemplo 3**: Editar solo `at` y `atDetalle` (cuando se marca AT como true)
```json
{
  "at": true,
  "atDetalle": "BASTON-ADULTO"
}
```

**Nota**: El frontend puede enviar múltiples campos en una sola actualización si el usuario edita varios campos seguidos.

---

## 📥 Formato de Response

### Response Exitosa (200 OK)

**Body**: Episodio completo actualizado

```json
{
  "episodio": "1022626645",
  "rut": "12.345.678-9",
  "nombre": "Juan Pérez",
  "fechaIngreso": "2024-01-15",
  "fechaAlta": "2024-01-20",
  "servicioAlta": "Medicina Interna",
  
  // Campos editables por finanzas
  "estadoRN": "Aprobado",
  "at": true,
  "atDetalle": "BASTON-ADULTO",
  "montoAT": 18000,
  "montoRN": 150000,
  "diasDemoraRescate": 5,
  "pagoDemora": 5000,
  "pagoOutlierSup": 25000,
  "precioBaseTramo": 125000,
  "valorGRD": 150000,
  "montoFinal": 198000,  // ← CALCULADO por backend
  "documentacion": "Epicrisis completa",
  
  // Campos de solo lectura
  "grdCodigo": "G045",
  "peso": 1.2,
  "inlierOutlier": "Inlier",
  "grupoDentroNorma": true,
  "diasEstada": 5,
  
  // ... otros campos del episodio
}
```

**⚠️ IMPORTANTE**: El backend debe devolver el episodio **completo** con todos los campos, incluyendo los calculados (`montoFinal`).

---

## ❌ Códigos de Error HTTP

### 400 Bad Request

**Causas**:
- Campo inválido o formato incorrecto
- Valor fuera de rango permitido
- Tipo de dato incorrecto

**Response body**:
```json
{
  "message": "Datos inválidos: El monto RN debe ser positivo",
  "error": "ValidationError",
  "field": "montoRN"
}
```

---

### 401 Unauthorized

**Causas**:
- Token JWT ausente o inválido
- Token expirado
- Usuario no autenticado

**Response body**:
```json
{
  "message": "No autorizado. Por favor, inicia sesión nuevamente.",
  "error": "Unauthorized"
}
```

---

### 403 Forbidden

**Causas**:
- Usuario no tiene rol `finanzas`
- Usuario no tiene permisos para editar el campo

**Response body**:
```json
{
  "message": "No tienes permisos para realizar esta acción",
  "error": "Forbidden"
}
```

---

### 404 Not Found

**Causas**:
- Episodio con el ID especificado no existe

**Response body**:
```json
{
  "message": "El episodio 1022626645 no fue encontrado",
  "error": "NotFound"
}
```

---

### 500 Internal Server Error

**Causas**:
- Error en el servidor
- Error en la base de datos
- Error al calcular campos derivados

**Response body**:
```json
{
  "message": "Error del servidor. Por favor, intenta nuevamente más tarde.",
  "error": "InternalServerError"
}
```

---

## 🔧 Reglas de Negocio del Backend

### 1. Cálculo de `montoFinal`

**Fórmula** (siempre aplicada):
```typescript
montoFinal = valorGRD + montoAT + pagoOutlierSup + pagoDemora
```

**Donde**:
- Si algún valor es `null` o `undefined`, se trata como `0`
- El cálculo se realiza **siempre**, incluso si el frontend envía `montoFinal` en el request
- El backend debe **ignorar** cualquier valor de `montoFinal` que venga en el request

---

### 2. Validación de `at` y `atDetalle`

**Reglas**:
- Si `at === false`, entonces `atDetalle` debe ser `null` o `undefined`
- Si `at === true`, `atDetalle` puede ser cualquier string (incluido vacío)
- Si `at === false` y hay `montoAT > 0`, el backend puede generar un warning

---

### 3. Validación de `estadoRN`

**Reglas**:
- Solo acepta: `"Aprobado"`, `"Pendiente"`, `"Rechazado"`, o `null`
- Case-sensitive
- Si se envía un valor inválido, retornar 400 Bad Request

---

### 4. Validación de Campos Numéricos

**Reglas**:
- Todos los campos numéricos deben ser >= 0
- `diasDemoraRescate` debe ser un entero (no decimal)
- Si un valor es negativo, retornar 400 Bad Request

---

### 5. Persistencia

**Reglas**:
- Todos los cambios deben persistirse inmediatamente en la base de datos
- No debe haber estados intermedios o "draft"
- Cada PATCH debe actualizar el registro en la BD

---

## 📊 Ejemplos Completos de Flujo

### Ejemplo 1: Editar `estadoRN`

**Request**:
```http
PATCH /api/episodios/1022626645
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "estadoRN": "Aprobado"
}
```

**Response (200 OK)**:
```json
{
  "episodio": "1022626645",
  "estadoRN": "Aprobado",
  // ... resto de campos con valores actualizados
}
```

---

### Ejemplo 2: Editar `montoAT`

**Request**:
```http
PATCH /api/episodios/1022626645
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "montoAT": 18000
}
```

**Response (200 OK)**:
```json
{
  "episodio": "1022626645",
  "montoAT": 18000,
  "montoFinal": 198000,  // ← Recalculado por backend
  // ... resto de campos
}
```

---

### Ejemplo 3: Editar múltiples campos

**Request**:
```http
PATCH /api/episodios/1022626645
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "at": true,
  "atDetalle": "BASTON-ADULTO",
  "montoAT": 18000
}
```

**Response (200 OK)**:
```json
{
  "episodio": "1022626645",
  "at": true,
  "atDetalle": "BASTON-ADULTO",
  "montoAT": 18000,
  "montoFinal": 198000,  // ← Recalculado por backend
  // ... resto de campos
}
```

---

### Ejemplo 4: Error - Campo inválido

**Request**:
```http
PATCH /api/episodios/1022626645
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "estadoRN": "Aprobadoo"  // ← Error: valor inválido
}
```

**Response (400 Bad Request)**:
```json
{
  "message": "Estado inválido. Use: Aprobado, Pendiente o Rechazado",
  "error": "ValidationError",
  "field": "estadoRN"
}
```

---

### Ejemplo 5: Error - Episodio no encontrado

**Request**:
```http
PATCH /api/episodios/999999999
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "montoAT": 18000
}
```

**Response (404 Not Found)**:
```json
{
  "message": "El episodio 999999999 no fue encontrado",
  "error": "NotFound"
}
```

---

## 🔄 Flujo Completo de Actualización

```
1. Usuario Finanzas hace clic en un campo editable
   ↓
2. Frontend muestra input de edición
   ↓
3. Usuario ingresa nuevo valor
   ↓
4. Usuario hace clic en "Guardar" (✓)
   ↓
5. Frontend valida el valor localmente
   ↓
6. Frontend convierte el valor al tipo correcto:
   - String → string
   - Número → parseFloat/parseInt
   - Boolean → boolean
   ↓
7. Frontend envía PATCH /api/episodios/:id
   Body: { [campo]: valor }
   ↓
8. Backend:
   - Valida autenticación (JWT)
   - Valida rol (debe ser 'finanzas')
   - Valida que el episodio exista
   - Valida el valor del campo
   - Actualiza el campo en la BD
   - Calcula montoFinal (si aplica)
   - Persiste cambios
   ↓
9. Backend devuelve episodio completo actualizado
   ↓
10. Frontend actualiza el estado local
   ↓
11. Frontend muestra mensaje de confirmación
   ↓
12. UI se actualiza con el nuevo valor
```

---

## 📝 Notas Importantes para el Backend

1. **Actualización Parcial**: El request solo incluye el campo que se editó, no todo el objeto. El backend debe hacer un UPDATE parcial (merge).

2. **Cálculo de `montoFinal`**: Siempre calcularlo, incluso si viene en el request. Ignorar el valor de `montoFinal` del request.

3. **Validación de Roles**: Verificar que el usuario tenga rol `finanzas` antes de permitir ediciones.

4. **Tipo de ID**: El ID puede ser string o número (ejemplo: `"1022626645"` o `1022626645`). El backend debe manejarlo correctamente.

5. **Campos Nullables**: Muchos campos pueden ser `null` o `undefined`. El backend debe manejar estos casos correctamente.

6. **Persistencia Inmediata**: No hay "draft" o estados intermedios. Cada PATCH debe guardarse inmediatamente.

7. **Response Completa**: Siempre devolver el episodio completo, no solo el campo actualizado.

8. **Validación de Campos**: El backend debe validar:
   - Tipos de dato correctos
   - Rangos válidos (>= 0 para números)
   - Valores permitidos (para enums como `estadoRN`)
   - Consistencia entre campos relacionados (ej: `at` y `atDetalle`)

---

## 🧪 Casos de Prueba Sugeridos

1. ✅ Actualizar `estadoRN` con valor válido
2. ✅ Actualizar `estadoRN` con valor inválido → 400
3. ✅ Actualizar `montoAT` → verificar que `montoFinal` se recalcula
4. ✅ Actualizar `at` a `false` → verificar que `atDetalle` se limpia
5. ✅ Actualizar `montoFinal` → verificar que se ignora y se recalcula
6. ✅ Actualizar con token inválido → 401
7. ✅ Actualizar con rol incorrecto → 403
8. ✅ Actualizar episodio inexistente → 404
9. ✅ Actualizar campo numérico con valor negativo → 400
10. ✅ Actualizar múltiples campos en un solo request

---

## 📚 Referencias de Código Frontend

- **Archivo de tipos**: `src/types.ts` - Define `Episode` interface
- **Configuración de columnas**: `src/lib/planillaConfig.ts` - Define campos editables
- **Validaciones**: `src/lib/validations.ts` - Funciones de validación
- **Página de episodios**: `src/pages/Episodios.tsx` - Tabla con edición inline
- **Página de detalle**: `src/pages/EpisodioDetalle.tsx` - Vista de detalle con edición

---

## ✅ Checklist de Implementación Backend

- [ ] Endpoint `PATCH /api/episodios/:id` implementado
- [ ] Validación de autenticación (JWT)
- [ ] Validación de rol `finanzas`
- [ ] Validación de existencia del episodio
- [ ] Validación de tipos de datos
- [ ] Validación de rangos y valores permitidos
- [ ] Actualización parcial (merge) en BD
- [ ] Cálculo automático de `montoFinal`
- [ ] Persistencia inmediata
- [ ] Response con episodio completo
- [ ] Manejo de errores (400, 401, 403, 404, 500)
- [ ] Logging de operaciones
- [ ] Tests unitarios e integración

---

**Última actualización**: 2024-01-XX
**Versión**: 1.0


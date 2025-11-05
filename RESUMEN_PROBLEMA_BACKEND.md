# 🔍 Resumen del Problema: Endpoint PATCH /api/episodios/:id

## ❌ Problema Actual

El frontend está enviando correctamente:
- **URL**: `PATCH /api/episodios/1022626645`
- **Body**: `{ "montoAT": 4580 }` (o cualquier otro campo editable)
- **Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`

Pero el backend responde con **404 Not Found**.

---

## 📋 Lo que el Frontend Está Enviando

### Endpoint
```
PATCH /api/episodios/:id
```

Donde `:id` puede ser:
- El campo `episodio` del objeto (ejemplo: `"1022626645"`)
- O un campo `id` si existe en el objeto devuelto por el backend

### Request Body (PATCH Parcial)
El frontend envía **solo el campo que se está editando**, no el objeto completo:

```json
{
  "montoAT": 4580
}
```

O para otros campos:
```json
{
  "estadoRN": "Aprobado"
}
```

```json
{
  "at": true,
  "atDetalle": "BASTON-ADULTO"
}
```

### Headers
```
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

---

## ✅ Lo que el Backend Debe Hacer

### 1. Aceptar el Request
- **Endpoint**: `PATCH /api/episodios/:id`
- **Parámetro `:id`**: Puede ser string o número (ej: `"1022626645"` o `1022626645`)
- **Body**: Objeto con campos a actualizar (actualización parcial)
- **Validar**: Autenticación JWT y rol `finanzas`

### 2. Buscar el Episodio
El backend debe buscar el episodio usando el `:id` del parámetro de ruta.

**⚠️ IMPORTANTE**: Verificar en qué campo se está buscando:
- ¿Busca por el campo `episodio` (CMBD)?
- ¿Busca por un `id` interno de la BD?
- ¿Busca por otro campo?

### 3. Actualizar el Episodio
- Hacer UPDATE parcial (merge) en la base de datos
- Aplicar reglas de negocio (ej: calcular `montoFinal`)
- Persistir cambios

### 4. Devolver Response
**Status**: `200 OK`

**Body**: Episodio completo actualizado
```json
{
  "episodio": "1022626645",
  "montoAT": 4580,
  "montoFinal": 198000,  // ← Calculado por backend
  // ... todos los demás campos del episodio
}
```

---

## 🔍 Puntos Críticos a Verificar en el Backend

### 1. **Ruta del Endpoint**
```javascript
// ✅ CORRECTO
router.patch('/api/episodios/:id', ...)

// ❌ INCORRECTO
router.patch('/api/episodes/:id', ...)
```

### 2. **Búsqueda del Episodio**
Verificar cómo se busca el episodio:

```javascript
// Opción 1: Buscar por campo episodio
const episodio = await db.episode.findUnique({
  where: { episodio: req.params.id }
});

// Opción 2: Buscar por ID interno
const episodio = await db.episode.findUnique({
  where: { id: parseInt(req.params.id) }
});

// Opción 3: Buscar por ambos (flexible)
const episodio = await db.episode.findFirst({
  where: {
    OR: [
      { episodio: req.params.id },
      { id: parseInt(req.params.id) || undefined }
    ].filter(Boolean)
  }
});
```

### 3. **Manejo del ID**
El `:id` puede venir como:
- **String**: `"1022626645"`
- **Número**: `1022626645`

El backend debe manejarlo correctamente en ambos casos.

### 4. **Validación de Campos**
El backend debe validar:
- Que el usuario tenga rol `finanzas`
- Que el episodio exista
- Que los valores sean válidos (tipos, rangos, etc.)

### 5. **Cálculo de `montoFinal`**
El backend **SIEMPRE** debe calcular `montoFinal`:
```javascript
montoFinal = valorGRD + montoAT + pagoOutlierSup + pagoDemora
```

Incluso si el frontend envía `montoFinal` en el request, el backend debe ignorarlo y calcularlo.

---

## 📊 Ejemplo de Request/Response Esperado

### Request
```http
PATCH /api/episodios/1022626645
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "montoAT": 4580
}
```

### Response Exitosa
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "episodio": "1022626645",
  "rut": "12.345.678-9",
  "nombre": "Juan Pérez",
  "montoAT": 4580,
  "valorGRD": 150000,
  "pagoOutlierSup": 25000,
  "pagoDemora": 5000,
  "montoFinal": 184580,  // ← Calculado: 150000 + 4580 + 25000 + 5000
  // ... resto de campos
}
```

### Response Error (404)
```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "message": "El episodio 1022626645 no fue encontrado",
  "error": "NotFound"
}
```

---

## 🧪 Casos de Prueba para el Backend

1. ✅ PATCH `/api/episodios/1022626645` con `{ "montoAT": 4580 }` → 200 OK
2. ✅ PATCH `/api/episodios/999999999` (inexistente) → 404 Not Found
3. ✅ PATCH `/api/episodios/1022626645` sin token → 401 Unauthorized
4. ✅ PATCH `/api/episodios/1022626645` con rol incorrecto → 403 Forbidden
5. ✅ PATCH `/api/episodios/1022626645` con `{ "montoFinal": 999 }` → Debe ignorar y recalcular

---

## 📝 Checklist para el Backend

- [ ] Endpoint `PATCH /api/episodios/:id` está implementado
- [ ] La ruta es `/api/episodios` (no `/api/episodes`)
- [ ] El endpoint acepta actualización parcial (PATCH)
- [ ] Busca el episodio correctamente (verificar campo de búsqueda)
- [ ] Maneja IDs como string y número
- [ ] Valida autenticación (JWT)
- [ ] Valida rol `finanzas`
- [ ] Valida existencia del episodio
- [ ] Calcula `montoFinal` automáticamente
- [ ] Devuelve episodio completo en la response
- [ ] Maneja errores correctamente (400, 401, 403, 404, 500)

---

**Fecha**: 2024-01-XX
**Versión Frontend**: Actualizada con soporte flexible de ID


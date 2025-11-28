# Prompt para Backend: Dropdown AT Detalle con Ajustes de Tecnología

## Resumen

El frontend ahora usa un **dropdown (select)** para el campo `atDetalle` en la vista de Episodios. Este dropdown muestra las opciones de AT disponibles desde la tabla `ajustes_tecnologia`.

## Cambios en el Frontend

El frontend ahora:
1. Carga automáticamente los ajustes de tecnología al mostrar la vista de Episodios
2. Muestra un dropdown en lugar de un input de texto para el campo `atDetalle`
3. Permite seleccionar un AT de la lista de ajustes disponibles

## Requisitos del Backend

### 1. Endpoint GET /api/ajustes-tecnologia

**IMPORTANTE:** Este endpoint debe estar **disponible para usuarios autenticados** que estén viendo la vista de Episodios, no solo para roles `finanzas` y `gestion`.

**Recomendación:** Hacer el endpoint `GET /api/ajustes-tecnologia` accesible para:
- Todos los usuarios autenticados (o al menos: `codificador`, `finanzas`, `gestion`, `admin`)
- O crear un endpoint separado de solo lectura: `GET /api/ajustes-tecnologia/list` que sea público para usuarios autenticados

#### Respuesta Esperada

```json
[
  {
    "id": "uuid-abc-123",
    "at": "Stent mas dispositivo de liberación",
    "monto": 51276.00,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  {
    "id": "uuid-def-456",
    "at": "BASTON-ADULTO",
    "monto": 18000.00,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Características:**
- Debe devolver solo los ajustes que tengan `at` no vacío (filtrado en backend o frontend)
- Debe ordenarse por `at` alfabéticamente
- Debe ser un array vacío `[]` si no hay ajustes

### 2. Validación del Campo `atDetalle` en Episodios

Cuando el frontend envía un `PATCH /api/episodios/:id` con el campo `atDetalle`:

- **Puede ser `null`** (cuando el usuario selecciona "-- Seleccionar AT --")
- **Puede ser un string** que corresponde a un valor de `at` de la tabla `ajustes_tecnologia`

**Opcional (recomendado):** El backend puede validar que el valor de `atDetalle` exista en la tabla `ajustes_tecnologia.at`, pero no es estrictamente necesario si el frontend siempre envía valores válidos.

### 3. Endpoint GET /api/episodios

Asegurar que las respuestas de episodios incluyan el campo `atDetalle`:

```json
{
  "id": "episodio-id",
  "episodio": "EPISODIO123",
  "atDetalle": "Stent mas dispositivo de liberación",
  // ... otros campos
}
```

## Checklist

- [ ] Endpoint `GET /api/ajustes-tecnologia` está disponible para usuarios autenticados (no solo `finanzas` y `gestion`)
- [ ] El endpoint devuelve un array con los campos `id`, `at`, `monto`, `createdAt`, `updatedAt`
- [ ] El endpoint filtra ajustes sin `at` o con `at` vacío (opcional, el frontend también lo hace)
- [ ] El endpoint ordena por `at` alfabéticamente
- [ ] El campo `atDetalle` se puede actualizar vía `PATCH /api/episodios/:id`
- [ ] El campo `atDetalle` se incluye en las respuestas de `GET /api/episodios` y `GET /api/episodios/:id`
- [ ] Validación opcional: verificar que `atDetalle` exista en `ajustes_tecnologia.at` cuando se actualiza

## Notas

- El frontend ya maneja la carga y el filtrado de ajustes sin nombre válido
- El frontend normaliza valores vacíos a `null` antes de enviarlos al backend
- El dropdown se muestra solo cuando el campo `atDetalle` es editable (según el rol del usuario)
- Si el endpoint `GET /api/ajustes-tecnologia` no está disponible, el dropdown estará vacío (solo mostrará "-- Seleccionar AT --")

## Relación con el Prompt Anterior

Este prompt complementa `PROMPT_BACKEND_AJUSTES_TECNOLOGIA.md`. Si ya implementaste ese prompt, solo necesitas ajustar los permisos del endpoint `GET /api/ajustes-tecnologia` para que sea accesible a más roles (o a todos los usuarios autenticados).


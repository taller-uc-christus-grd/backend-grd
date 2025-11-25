# Prompt para Backend: Devolver atDetalle en GET /api/episodios

## ⚠️ PROBLEMA CRÍTICO CONFIRMADO CON EVIDENCIA

**DIAGNÓSTICO COMPLETO REALIZADO:** Los logs del frontend confirman que el backend **NO está devolviendo el campo `atDetalle`** en la respuesta de `GET /api/episodios/final`.

**EVIDENCIA CONFIRMADA:**
```
🔍 TODAS LAS KEYS DEL EPISODIO: [
  'episodio', 'nombre', 'rut', 'centro', 'folio', 'tipoEpisodio', 
  'fechaIngreso', 'fechaAlta', 'servicioAlta', 'grdCodigo', 'peso', 
  'montoRN', 'inlierOutlier', 'validado', 'estadoRN', 
  'at', 'montoAT',  // ⚠️ Estos campos SÍ aparecen
  'diasDemoraRescate', 'pagoDemora', 'pagoOutlierSup', 'precioBaseTramo', 
  'valorGRD', 'montoFinal'
]

// ❌ NO aparece 'atDetalle' en la lista de keys
```

**El backend está devolviendo:**
- ✅ `at`: "S"
- ✅ `montoAT`: 93229
- ❌ `atDetalle`: **NO EXISTE EN LA RESPUESTA**

El frontend está haciendo lo siguiente:
1. Guarda `atDetalle` con `PATCH /api/episodios/:id` con payload `{ "atDetalle": "valor" }`
2. El backend responde correctamente y el frontend muestra el valor
3. Al recargar con `GET /api/episodios/final`, el backend **NO incluye el campo `atDetalle`** (devuelve `undefined`)

## Solución Requerida

El backend **DEBE devolver el campo `atDetalle`** en todas las respuestas de GET de episodios:

### 1. GET /api/episodios/final

Este endpoint debe incluir `atDetalle` en cada episodio devuelto:

```javascript
// Ejemplo de respuesta esperada
{
  "items": [
    {
      "episodio": "EP001",
      "at": "S",
      "atDetalle": "Stent más dispositivo de liberación", // ⚠️ DEBE estar presente
      "montoAT": 51276,
      // ... otros campos
    }
  ],
  "total": 100
}
```

### 2. GET /api/episodios/:id

Este endpoint también debe incluir `atDetalle`:

```javascript
{
  "episodio": "EP001",
  "at": "S",
  "atDetalle": "Stent más dispositivo de liberación", // ⚠️ DEBE estar presente
  "montoAT": 51276,
  // ... otros campos
}
```

## Verificaciones Necesarias

1. **Verificar que el campo se guarda correctamente:**
   - Cuando se recibe `PATCH /api/episodios/:id` con `{ "atDetalle": "valor" }`, verificar que se guarda en la base de datos
   - Verificar que el campo `atDetalle` existe en la tabla `Episodio` en Prisma

2. **Verificar que el campo se incluye en las consultas:**
   - En `GET /api/episodios/final`, asegurar que el `select` o `include` de Prisma incluye `atDetalle`
   - En `GET /api/episodios/:id`, asegurar que el `select` o `include` de Prisma incluye `atDetalle`

3. **Verificar que no se está filtrando:**
   - Asegurar que no hay ningún filtro o transformación que esté eliminando `atDetalle` de la respuesta

## Ejemplo de Código (Prisma)

### Opción 1: Usando `select` (explícito)

```typescript
// En GET /api/episodios/final
const episodios = await prisma.episodio.findMany({
  select: {
    id: true,
    episodio: true,
    // ... otros campos necesarios
    at: true,           // ⚠️ CRÍTICO: Debe estar incluido
    atDetalle: true,   // ⚠️ CRÍTICO: Debe estar incluido (ESTE ES EL PROBLEMA)
    montoAT: true,     // ⚠️ CRÍTICO: Debe estar incluido
    // ... todos los demás campos que necesitas
  },
  // ... resto de la query
});
```

### Opción 2: Sin `select` (incluir todos los campos automáticamente)

```typescript
// Si NO usas select, Prisma incluye todos los campos automáticamente
const episodios = await prisma.episodio.findMany({
  // No usar select - incluirá atDetalle automáticamente
  // ... resto de la query (where, orderBy, etc.)
});
```

### Verificar el Schema de Prisma

Asegurar que el modelo `Episodio` tiene el campo `atDetalle`:

```prisma
model Episodio {
  id        String   @id @default(uuid())
  episodio  String
  at        String?
  atDetalle String?  // ⚠️ Este campo DEBE existir
  montoAT   Float?
  // ... otros campos
}
```

### Transformación de Datos

Si estás transformando los datos después de la consulta, asegurar que incluyes `atDetalle`:

```typescript
const episodios = await prisma.episodio.findMany({ /* ... */ });

// Si transformas, asegurar que atDetalle se incluye
const episodiosFormateados = episodios.map(ep => ({
  ...ep,
  atDetalle: ep.atDetalle, // ⚠️ Asegurar que se incluye
  // ... otros campos
}));
```

## Checklist para Backend

- [ ] Verificar que `atDetalle` se guarda correctamente cuando se recibe en `PATCH /api/episodios/:id`
- [ ] Verificar que `atDetalle` está incluido en el `select` o no está excluido en `GET /api/episodios/final`
- [ ] Verificar que `atDetalle` está incluido en el `select` o no está excluido en `GET /api/episodios/:id`
- [ ] Probar guardar un `atDetalle` y luego hacer GET para verificar que se devuelve
- [ ] Verificar que no hay transformaciones que eliminen `atDetalle` de la respuesta

## Prueba Rápida

1. Hacer `PATCH /api/episodios/:id` con `{ "atDetalle": "test" }`
2. Hacer `GET /api/episodios/:id` y verificar que la respuesta incluye `"atDetalle": "test"`
3. Hacer `GET /api/episodios/final` y verificar que el episodio en la lista incluye `"atDetalle": "test"`

**VERIFICACIÓN ESPECÍFICA:** El frontend está verificando todas las keys del episodio devuelto. Actualmente aparecen estas keys:
- `episodio`, `nombre`, `rut`, `centro`, `folio`, `tipoEpisodio`, `fechaIngreso`, `fechaAlta`, `servicioAlta`, `grdCodigo`, `peso`, `montoRN`, `inlierOutlier`, `validado`, `estadoRN`, `at`, `montoAT`, `diasDemoraRescate`, `pagoDemora`, `pagoOutlierSup`, `precioBaseTramo`, `valorGRD`, `montoFinal`

**`atDetalle` NO aparece en esta lista, aunque el backend dice que lo agregó.**

## ⚠️ ACCIÓN REQUERIDA URGENTE

El backend **DEBE agregar `atDetalle` a la lista de campos devueltos** en `GET /api/episodios/final`. 

**Ubicación del código a modificar:** Probablemente en el archivo donde se define el endpoint `GET /api/episodios/final`, en la consulta de Prisma que no está incluyendo `atDetalle` en el `select`.

**Verificar específicamente:**
- Si usa `select: { ... }`, asegurar que incluya `atDetalle: true`
- Si NO usa `select`, verificar que no haya ningún filtro que excluya `atDetalle`
- Verificar que el campo existe en el modelo Prisma `Episodio`


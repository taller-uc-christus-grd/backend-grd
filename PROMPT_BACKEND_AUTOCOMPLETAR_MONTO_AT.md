# Prompt para Backend: Autocompletar Monto AT al Actualizar AT Detalle

## Resumen

Cuando se actualiza el campo `atDetalle` en un episodio, el backend debe **autocompletar automáticamente** el campo `montoAT` con el monto correspondiente de la tabla `ajustes_tecnologia`.

## Comportamiento Esperado

Cuando se recibe un `PATCH /api/episodios/:id` con el campo `atDetalle`:

1. **Buscar el ajuste correspondiente** en la tabla `ajustes_tecnologia` donde `at === atDetalle`
2. **Autocompletar automáticamente** el campo `montoAT` con el `monto` del ajuste encontrado
3. **Si no se encuentra el ajuste**, mantener el `montoAT` existente (o establecerlo a `0`/`null` si no existe)

## Implementación Requerida

### 1. En el Endpoint PATCH /api/episodios/:id

Cuando se actualiza `atDetalle`, buscar el monto correspondiente y actualizar `montoAT` automáticamente:

```javascript
// Ejemplo de código (Node.js/Prisma)
router.patch('/api/episodios/:id', authenticateToken, checkRole(['finanzas', 'gestion']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Buscar episodio
    const episodio = await prisma.episodio.findFirst({
      where: {
        OR: [
          { id: id },
          { episodio: id }
        ]
      }
    });
    
    if (!episodio) {
      return res.status(404).json({ message: `Episodio ${id} no encontrado` });
    }
    
    // Si se está actualizando atDetalle, buscar el monto correspondiente
    if (updates.atDetalle !== undefined) {
      const atDetalle = updates.atDetalle;
      
      if (atDetalle && atDetalle.trim() !== '') {
        // Buscar el ajuste de tecnología correspondiente
        const ajusteTecnologia = await prisma.ajusteTecnologia.findFirst({
          where: {
            at: {
              equals: atDetalle.trim(),
              mode: 'insensitive' // Opcional: búsqueda case-insensitive
            }
          }
        });
        
        if (ajusteTecnologia && ajusteTecnologia.monto !== null && ajusteTecnologia.monto !== undefined) {
          // Autocompletar montoAT con el monto del ajuste
          updates.montoAT = ajusteTecnologia.monto;
          console.log(`💰 Autocompletado montoAT: ${ajusteTecnologia.monto} para atDetalle: ${atDetalle}`);
        } else {
          // Si no se encuentra el ajuste, establecer montoAT a 0 o null
          // (depende de tu lógica de negocio)
          console.log(`⚠️ No se encontró ajuste para atDetalle: ${atDetalle}`);
          // Opcional: updates.montoAT = 0; o mantener el valor existente
        }
      } else {
        // Si atDetalle es null o vacío, también establecer montoAT a 0 o null
        updates.montoAT = 0; // o null, dependiendo de tu lógica
      }
    }
    
    // Actualizar episodio (incluye atDetalle y montoAT si aplica)
    const updated = await prisma.episodio.update({
      where: { id: episodio.id },
      data: updates
    });
    
    // Recalcular montoFinal (como ya lo haces)
    // ... tu lógica de cálculo existente ...
    
    res.json(updated);
    
  } catch (error) {
    console.error('Error actualizando episodio:', error);
    res.status(500).json({ message: 'Error del servidor', error: error.message });
  }
});
```

### 2. Búsqueda del Ajuste

**Importante:**
- La búsqueda debe ser **case-sensitive** o **case-insensitive** según tus necesidades
- Debe hacer **trim** del `atDetalle` antes de buscar
- Si hay múltiples ajustes con el mismo `at`, tomar el primero (o el más reciente, según tu lógica)

### 3. Manejo de Casos Especiales

- **`atDetalle` es `null` o vacío**: Establecer `montoAT` a `0` o `null`
- **No se encuentra el ajuste**: Mantener `montoAT` existente o establecerlo a `0`/`null`
- **El ajuste tiene `monto` en `null` o `undefined`**: No actualizar `montoAT` (mantener valor existente)

### 4. Prioridad de Valores

Si el frontend envía **ambos campos** (`atDetalle` y `montoAT`) en el mismo request:

**Opción 1 (Recomendada):** Autocompletar `montoAT` basado en `atDetalle`, pero **permitir override manual** si el frontend envía un `montoAT` diferente.

**Opción 2:** Siempre autocompletar `montoAT` basado en `atDetalle`, **ignorando** cualquier `montoAT` que venga en el request.

**Recomendación:** Usar Opción 1 para permitir flexibilidad.

## Ejemplos

### Ejemplo 1: Actualizar atDetalle con ajuste existente

**Request:**
```json
PATCH /api/episodios/123
{
  "atDetalle": "Stent mas dispositivo de liberación"
}
```

**Proceso:**
1. Buscar ajuste con `at = "Stent mas dispositivo de liberación"`
2. Si se encuentra con `monto = 51276`, actualizar `montoAT = 51276`
3. Guardar ambos campos

**Response:**
```json
{
  "id": "123",
  "atDetalle": "Stent mas dispositivo de liberación",
  "montoAT": 51276,
  // ... otros campos
}
```

### Ejemplo 2: Actualizar atDetalle con override manual

**Request:**
```json
PATCH /api/episodios/123
{
  "atDetalle": "Stent mas dispositivo de liberación",
  "montoAT": 55000
}
```

**Proceso (Opción 1):**
1. El frontend quiere usar un monto diferente al del catálogo
2. Guardar `atDetalle = "Stent mas dispositivo de liberación"` y `montoAT = 55000` (el valor enviado)

**Proceso (Opción 2):**
1. Ignorar `montoAT` del request
2. Buscar ajuste y usar su monto: `montoAT = 51276`

### Ejemplo 3: Limpiar atDetalle

**Request:**
```json
PATCH /api/episodios/123
{
  "atDetalle": null
}
```

**Proceso:**
1. `atDetalle` es `null` o vacío
2. Establecer `montoAT = 0` (o `null`, según tu lógica)

## Checklist

- [ ] Cuando se recibe `atDetalle` en PATCH, buscar el ajuste correspondiente en `ajustes_tecnologia`
- [ ] Autocompletar `montoAT` con el `monto` del ajuste encontrado
- [ ] Manejar caso cuando `atDetalle` es `null` o vacío (establecer `montoAT = 0` o `null`)
- [ ] Manejar caso cuando no se encuentra el ajuste (mantener `montoAT` existente o establecer a `0`/`null`)
- [ ] Decidir si permitir override manual de `montoAT` cuando viene en el request
- [ ] Hacer trim del `atDetalle` antes de buscar
- [ ] Considerar búsqueda case-sensitive o case-insensitive según necesidades
- [ ] Recalcular `montoFinal` después de actualizar `montoAT` (como ya lo haces)
- [ ] Logging para debugging (opcional pero recomendado)

## Notas

- El frontend también intenta autocompletar el `montoAT` antes de enviar el request, pero es **más seguro y confiable** que el backend también lo haga automáticamente
- Esto asegura consistencia de datos incluso si hay errores en el frontend o requests directos a la API
- La búsqueda debe ser eficiente (considerar índices en la columna `at` de `ajustes_tecnologia`)

## Relación con Otros Prompts

Este prompt complementa:
- `PROMPT_BACKEND_AJUSTES_TECNOLOGIA.md` - La tabla de ajustes debe estar creada
- `PROMPT_BACKEND_DROPDOWN_AT_DETALLE.md` - El endpoint GET de ajustes debe estar disponible


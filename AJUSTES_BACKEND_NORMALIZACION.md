# 🔧 Ajustes Backend - Normalización de Datos

## 📋 Resumen

El frontend ahora normaliza todos los campos editables para asegurar consistencia visual. El backend necesita hacer ajustes para **garantizar que siempre devuelva los datos en el formato esperado** por el frontend.

---

## 🎯 Problema Identificado

Cuando el backend devuelve datos en formatos inconsistentes (ej: `at` como `boolean` en lugar de `"S"/"N"`), el frontend no puede renderizar correctamente los cambios hasta que se hace otra edición.

---

## ✅ Solución: Normalización en el Backend

El backend debe **normalizar todos los campos** antes de enviarlos en las respuestas (tanto en PATCH como en GET).

---

## 📝 Campos que Requieren Normalización

### 1. **Campo `at` (Ajuste por Tecnología)**

**Problema actual:**
- El backend puede estar devolviendo `at` como `boolean` (`true`/`false`)
- El frontend espera `string` (`"S"`/`"N"`)

**Solución:**
- **Aceptar en el request**: Tanto `boolean` como `"S"/"N"` (retrocompatibilidad)
- **Devolver en el response**: **SIEMPRE** `string` (`"S"` o `"N"`)

**Código sugerido (ejemplo):**
```python
# Al recibir el request
if 'at' in request_data:
    at_value = request_data['at']
    # Normalizar: aceptar boolean o string
    if at_value is True or at_value == 'S' or at_value == 's':
        episode.at = 'S'
    elif at_value is False or at_value == 'N' or at_value == 'n':
        episode.at = 'N'
    else:
        episode.at = 'N'  # Default

# Al preparar la response
if episode.at is True or episode.at == 'S' or episode.at == 's':
    response_data['at'] = 'S'
else:
    response_data['at'] = 'N'
```

**O si usas un serializer:**
```python
def to_representation(self, instance):
    data = super().to_representation(instance)
    # Normalizar at
    at_value = instance.at
    if at_value is True or at_value == 'S' or at_value == 's':
        data['at'] = 'S'
    else:
        data['at'] = 'N'
    return data
```

---

### 2. **Campo `estadoRN` (Estado del Reembolso)**

**Problema actual:**
- Puede venir como `null`, `undefined`, `""` (string vacío), o string
- El frontend necesita consistencia

**Solución:**
- **Aceptar en el request**: `null`, `undefined`, `""`, o string válido
- **Devolver en el response**: **SIEMPRE** `string` válido o `null` (nunca `undefined` o `""`)

**Código sugerido:**
```python
# Al recibir el request
if 'estadoRN' in request_data:
    estado_rn = request_data['estadoRN']
    if estado_rn in ['Aprobado', 'Pendiente', 'Rechazado']:
        episode.estadoRN = estado_rn
    elif estado_rn is None or estado_rn == '' or estado_rn == 'null':
        episode.estadoRN = None
    else:
        raise ValidationError("Estado inválido. Use: Aprobado, Pendiente o Rechazado")

# Al preparar la response
response_data['estadoRN'] = episode.estadoRN if episode.estadoRN else None
# Asegurar que nunca sea undefined o string vacío
```

---

### 3. **Campos Numéricos**

**Campos afectados:**
- `montoAT`
- `montoRN`
- `pagoOutlierSup`
- `pagoDemora`
- `precioBaseTramo`
- `valorGRD`
- `montoFinal`
- `diasDemoraRescate`

**Problema actual:**
- Pueden venir como `string` desde la base de datos o cálculos
- El frontend necesita `number`

**Solución:**
- **Aceptar en el request**: Tanto `number` como `string` numérico
- **Devolver en el response**: **SIEMPRE** `number` (no string)

**Código sugerido:**
```python
# Al recibir el request
numeric_fields = ['montoAT', 'montoRN', 'pagoOutlierSup', 'pagoDemora', 
                  'precioBaseTramo', 'valorGRD', 'montoFinal', 'diasDemoraRescate']

for field in numeric_fields:
    if field in request_data:
        value = request_data[field]
        if value is not None:
            # Convertir a número si viene como string
            if isinstance(value, str):
                try:
                    value = float(value) if field != 'diasDemoraRescate' else int(value)
                except ValueError:
                    raise ValidationError(f"{field} debe ser un número válido")
            setattr(episode, field, value)

# Al preparar la response
for field in numeric_fields:
    value = getattr(episode, field, None)
    if value is not None:
        # Asegurar que sea número
        response_data[field] = float(value) if field != 'diasDemoraRescate' else int(value)
    else:
        response_data[field] = None
```

---

## 📍 Endpoints Afectados

### 1. **PATCH `/api/episodios/:id`**

**Ajustes necesarios:**
- Normalizar `at` antes de guardar
- Normalizar `estadoRN` antes de guardar
- Normalizar campos numéricos antes de guardar
- **En la respuesta, normalizar TODOS los campos antes de enviar**

---

### 2. **GET `/api/episodios/:id`**

**Ajustes necesarios:**
- Normalizar todos los campos antes de enviar la respuesta
- Asegurar que `at` sea siempre `"S"` o `"N"` (string)
- Asegurar que `estadoRN` sea string o `null` (nunca `undefined` o `""`)
- Asegurar que campos numéricos sean `number` (no string)

---

### 3. **GET `/api/episodios/final`**

**Ajustes necesarios:**
- Normalizar todos los campos en cada episodio de la lista
- Aplicar las mismas reglas de normalización que en el GET individual

---

## 🔍 Ejemplo de Response Normalizado

**Antes (inconsistente):**
```json
{
  "episodio": "1022626645",
  "at": true,  // ❌ Boolean
  "estadoRN": "",  // ❌ String vacío
  "montoRN": "150000",  // ❌ String
  "diasDemoraRescate": "5"  // ❌ String
}
```

**Después (normalizado):**
```json
{
  "episodio": "1022626645",
  "at": "S",  // ✅ String
  "estadoRN": null,  // ✅ null (no string vacío)
  "montoRN": 150000,  // ✅ Number
  "diasDemoraRescate": 5  // ✅ Number
}
```

---

## ✅ Checklist de Implementación

- [ ] Normalizar `at` en PATCH `/api/episodios/:id` (request y response)
- [ ] Normalizar `at` en GET `/api/episodios/:id` (response)
- [ ] Normalizar `at` en GET `/api/episodios/final` (response de cada episodio)
- [ ] Normalizar `estadoRN` en PATCH `/api/episodios/:id` (request y response)
- [ ] Normalizar `estadoRN` en GET `/api/episodios/:id` (response)
- [ ] Normalizar `estadoRN` en GET `/api/episodios/final` (response de cada episodio)
- [ ] Normalizar campos numéricos en PATCH `/api/episodios/:id` (request y response)
- [ ] Normalizar campos numéricos en GET `/api/episodios/:id` (response)
- [ ] Normalizar campos numéricos en GET `/api/episodios/final` (response de cada episodio)
- [ ] Crear función helper para normalización reutilizable
- [ ] Agregar tests para verificar normalización
- [ ] Verificar que los cambios persisten correctamente en la BD

---

## 🎯 Beneficios

1. **Consistencia**: Todos los campos tienen formato predecible
2. **Visualización inmediata**: Los cambios se reflejan correctamente en el frontend
3. **Persistencia**: Los cambios se ven al recargar la página
4. **Mantenibilidad**: Código más fácil de mantener y depurar

---

## 📝 Notas Técnicas

- La normalización debe aplicarse **antes de guardar** (para validación) y **antes de enviar** (para respuesta)
- Si usas un ORM/Serializer, considera crear métodos personalizados para normalización
- Los campos numéricos pueden necesitar validación adicional (no NaN, no Infinity)
- `diasDemoraRescate` debe ser `integer`, no `float`

---

## 🚀 Prioridad

**ALTA** - Este ajuste es necesario para que los cambios se visualicen correctamente en el frontend.


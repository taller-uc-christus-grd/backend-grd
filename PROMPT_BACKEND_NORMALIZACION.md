# 🔧 Ajuste Backend: Normalización de Datos en Responses

## 🎯 Problema

El frontend está recibiendo datos en formatos inconsistentes del backend, lo que causa que los cambios no se visualicen correctamente hasta que se hace otra edición.

**Ejemplo del problema:**
- Backend devuelve `at: true` (boolean) → Frontend no puede renderizar correctamente
- Backend devuelve `estadoRN: ""` (string vacío) → Frontend espera `null` o string válido
- Backend devuelve `montoRN: "150000"` (string) → Frontend espera `number`

---

## ✅ Solución

**Normalizar TODOS los campos en TODAS las respuestas** (PATCH y GET) antes de enviarlos al frontend.

---

## 📝 Cambios Necesarios

### 1. **Campo `at` - Cambio de Tipo**

**Antes:**
- Request aceptaba: `boolean` (true/false)
- Response devolvía: `boolean` (true/false)

**Ahora:**
- Request acepta: `boolean` O `"S"/"N"` (retrocompatibilidad)
- **Response SIEMPRE devuelve: `string` (`"S"` o `"N"`)**

**Ejemplo:**
```json
// Request (ambos aceptados)
{ "at": true }     // ✅ OK
{ "at": "S" }      // ✅ OK

// Response (SIEMPRE string)
{ "at": "S" }      // ✅ Correcto
{ "at": true }     // ❌ Incorrecto
```

---

### 2. **Campo `estadoRN` - Normalizar null/vacío**

**Antes:**
- Podía devolver: `null`, `undefined`, `""`, o string

**Ahora:**
- **Response SIEMPRE devuelve: `string` válido o `null`** (nunca `undefined` o `""`)

**Ejemplo:**
```json
// Response
{ "estadoRN": "Aprobado" }  // ✅ Correcto
{ "estadoRN": null }         // ✅ Correcto
{ "estadoRN": "" }          // ❌ Cambiar a null
{ "estadoRN": undefined }   // ❌ Cambiar a null
```

---

### 3. **Campos Numéricos - Asegurar tipo number**

**Campos afectados:**
- `montoAT`, `montoRN`, `pagoOutlierSup`, `pagoDemora`
- `precioBaseTramo`, `valorGRD`, `montoFinal`
- `diasDemoraRescate` (debe ser `integer`, los demás `float`)

**Antes:**
- Podía devolver: `string` o `number`

**Ahora:**
- **Response SIEMPRE devuelve: `number`** (nunca string)

**Ejemplo:**
```json
// Response
{ "montoRN": 150000 }        // ✅ Correcto
{ "montoRN": "150000" }      // ❌ Cambiar a number
{ "diasDemoraRescate": 5 }   // ✅ Correcto (integer)
{ "diasDemoraRescate": "5" } // ❌ Cambiar a number
```

---

## 📍 Endpoints a Modificar

### 1. **PATCH `/api/episodios/:id`**

**Ajustes:**
1. Al recibir el request:
   - Si `at` viene como `boolean`, convertirlo a `"S"/"N"` antes de guardar
   - Si `at` viene como `"S"/"N"`, aceptarlo directamente
   - Normalizar `estadoRN` (vacío → null)
   - Convertir campos numéricos a `number` si vienen como string

2. Al preparar la response:
   - **SIEMPRE** convertir `at` a string (`"S"` o `"N"`)
   - **SIEMPRE** normalizar `estadoRN` (null o string válido, nunca vacío)
   - **SIEMPRE** asegurar que campos numéricos sean `number`

---

### 2. **GET `/api/episodios/:id`**

**Ajustes:**
- Normalizar todos los campos antes de enviar la response
- Aplicar las mismas reglas que en PATCH

---

### 3. **GET `/api/episodios/final`**

**Ajustes:**
- Normalizar todos los campos en **cada episodio** de la lista
- Aplicar las mismas reglas que en PATCH

---

## 💻 Código Sugerido (Pseudocódigo)

```python
def normalize_episode_data(episode):
    """
    Normaliza todos los campos de un episodio antes de enviar al frontend
    """
    data = episode.to_dict()  # O como obtengas los datos
    
    # 1. Normalizar AT
    at_value = data.get('at')
    if at_value is True or at_value == 'S' or at_value == 's':
        data['at'] = 'S'
    else:
        data['at'] = 'N'
    
    # 2. Normalizar estadoRN
    estado_rn = data.get('estadoRN')
    if estado_rn in ['Aprobado', 'Pendiente', 'Rechazado']:
        data['estadoRN'] = estado_rn
    else:
        data['estadoRN'] = None  # Nunca vacío o undefined
    
    # 3. Normalizar campos numéricos
    numeric_fields = [
        'montoAT', 'montoRN', 'pagoOutlierSup', 'pagoDemora',
        'precioBaseTramo', 'valorGRD', 'montoFinal'
    ]
    for field in numeric_fields:
        value = data.get(field)
        if value is not None:
            if isinstance(value, str):
                try:
                    data[field] = float(value)
                except ValueError:
                    data[field] = None
            else:
                data[field] = float(value) if value else None
    
    # 4. Normalizar diasDemoraRescate (integer)
    dias = data.get('diasDemoraRescate')
    if dias is not None:
        if isinstance(dias, str):
            try:
                data['diasDemoraRescate'] = int(dias)
            except ValueError:
                data['diasDemoraRescate'] = None
        else:
            data['diasDemoraRescate'] = int(dias) if dias else None
    
    return data
```

**Usar en todos los endpoints:**
```python
# En PATCH /api/episodios/:id
def patch(self, request, id):
    # ... actualizar episodio ...
    episode.save()
    
    # Normalizar antes de enviar
    normalized_data = normalize_episode_data(episode)
    return Response(normalized_data, status=200)

# En GET /api/episodios/:id
def get(self, request, id):
    episode = get_episode(id)
    
    # Normalizar antes de enviar
    normalized_data = normalize_episode_data(episode)
    return Response(normalized_data, status=200)

# En GET /api/episodios/final
def get(self, request):
    episodes = get_episodes()
    
    # Normalizar cada episodio
    normalized_list = [normalize_episode_data(ep) for ep in episodes]
    return Response({'items': normalized_list}, status=200)
```

---

## ✅ Checklist

- [ ] Crear función `normalize_episode_data()` reutilizable
- [ ] Aplicar normalización en PATCH `/api/episodios/:id` (response)
- [ ] Aplicar normalización en GET `/api/episodios/:id` (response)
- [ ] Aplicar normalización en GET `/api/episodios/final` (response de cada episodio)
- [ ] Aceptar `at` como boolean o string en PATCH (retrocompatibilidad)
- [ ] Convertir `at` a string siempre en responses
- [ ] Normalizar `estadoRN` (nunca vacío, siempre null o string válido)
- [ ] Asegurar campos numéricos como `number` (no string)
- [ ] Asegurar `diasDemoraRescate` como `integer`
- [ ] Probar que los cambios persisten correctamente
- [ ] Verificar que no se rompe nada existente

---

## 🎯 Prioridad

**ALTA** - Sin esto, los cambios no se visualizan correctamente en el frontend.

---

## 📝 Nota

Este ajuste es **solo en las responses**. El frontend ya normaliza lo que recibe, pero es mejor que el backend envíe datos consistentes desde el origen.


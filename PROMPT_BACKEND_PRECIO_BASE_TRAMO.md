# Prompt para Backend: Cálculo Automático de Precio Base por Tramo

## 🎯 Objetivo

Implementar el cálculo automático del campo `precioBaseTramo` en los episodios basándose en:
1. El **convenio** asociado al episodio
2. El **peso GRD** del episodio (campo `peso`)
3. Las reglas de tramos definidas para cada convenio

## 📋 Reglas de Negocio

### Convenios con Sistema de Tramos (basado en peso GRD)

Para los convenios **FNS012** y **FNS026**, el precio base se determina mediante tramos basados en el **peso GRD** del episodio:

- **T1**: `0 <= peso GRD <= 1.5`
- **T2**: `1.5 < peso GRD <= 2.5`
- **T3**: `peso GRD > 2.5`

**Lógica:**
1. Obtener el peso GRD del episodio (campo `peso`)
2. Determinar el tramo según los rangos anteriores
3. Buscar en la tabla `precios_convenios` el registro que corresponda a:
   - `convenio = 'FNS012'` o `convenio = 'FNS026'` (según el convenio del episodio)
   - `tramo = 'T1'`, `tramo = 'T2'`, o `tramo = 'T3'` (según el peso GRD calculado)
   - **NO buscar por fechas** - simplemente tomar el precio que coincida con convenio y tramo
4. Obtener el `precio` de ese registro y asignarlo a `precioBaseTramo`

### Convenios con Precio Único

Para los convenios **FNS019** y **CH0041**, existe un único precio base (no hay tramos):

**Lógica:**
1. Buscar en la tabla `precios_convenios` el registro que corresponda a:
   - `convenio = 'FNS019'` o `convenio = 'CH0041'` (según el convenio del episodio)
   - **NO buscar por fechas** - como hay una sola opción, simplemente tomar el precio que coincida con el convenio
2. Obtener el `precio` de ese registro y asignarlo a `precioBaseTramo`
3. **Nota:** Si el registro tiene un `tramo` definido, debería ignorarse (ya que estos convenios no usan tramos)

## 🔧 Requisitos de Implementación

### 1. Determinar el Convenio del Episodio

**Pregunta crítica:** ¿Cómo se determina el convenio de un episodio?

**Opciones posibles:**
- **Opción A:** El convenio está almacenado en un campo del episodio (ej: `convenio`, `codigoConvenio`)
- **Opción B:** El convenio se determina a partir del `folio` del episodio (puede haber una relación entre folio y convenio)
- **Opción C:** El convenio viene en el archivo maestro importado desde SIGESA
- **Opción D:** El convenio se determina mediante alguna otra lógica de negocio

**⚠️ ACCIÓN REQUERIDA:** El backend debe confirmar cómo se determina el convenio del episodio para implementar correctamente esta funcionalidad.

### 2. Función de Cálculo del Tramo (para FNS012 y FNS026)

```typescript
// Pseudocódigo
function calcularTramo(pesoGRD: number): 'T1' | 'T2' | 'T3' | null {
  if (pesoGRD === null || pesoGRD === undefined) {
    return null; // No se puede determinar el tramo sin peso
  }
  
  if (pesoGRD >= 0 && pesoGRD <= 1.5) {
    return 'T1';
  } else if (pesoGRD > 1.5 && pesoGRD <= 2.5) {
    return 'T2';
  } else if (pesoGRD > 2.5) {
    return 'T3';
  }
  
  return null; // Peso negativo (no debería ocurrir)
}
```

### 3. Función de Búsqueda de Precio Base

```typescript
// Pseudocódigo
async function obtenerPrecioBaseTramo(
  convenio: string,
  pesoGRD: number | null
): Promise<number | null> {
  // Determinar si el convenio usa tramos o precio único
  const conveniosConTramos = ['FNS012', 'FNS026'];
  const conveniosPrecioUnico = ['FNS019', 'CH0041'];
  
  if (conveniosConTramos.includes(convenio)) {
    // Calcular tramo basado en peso GRD
    const tramo = calcularTramo(pesoGRD);
    if (!tramo) {
      return null; // No se puede determinar el tramo
    }
    
    // Buscar en precios_convenios (sin validar fechas)
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenio,
        tramo: tramo
      }
    });
    
    return precioRegistro?.precio || null;
    
  } else if (conveniosPrecioUnico.includes(convenio)) {
    // Buscar precio único (ignorar tramo y fechas)
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenio
      }
    });
    
    return precioRegistro?.precio || null;
  }
  
  // Si el convenio no está en ninguna de las listas, retornar null
  return null;
}
```

### 4. Aplicación del Cálculo

#### 4.1. Al Importar Episodios (POST /api/episodios/import)

Después de importar los episodios desde el archivo maestro, el backend debe:

1. Para cada episodio importado:
   - Determinar su convenio
   - Obtener su peso GRD (campo `peso`)
   - Calcular `precioBaseTramo` usando la función `obtenerPrecioBaseTramo` (solo con convenio y peso GRD)
   - Asignar el valor calculado a `precioBaseTramo` del episodio

#### 4.2. Al Recuperar Episodios (GET /api/episodios/final y GET /api/episodios/:id)

Si `precioBaseTramo` es `null` o si el convenio/peso GRD ha cambiado, el backend debe:

1. Recalcular `precioBaseTramo` automáticamente antes de devolver el episodio
2. Opcionalmente, actualizar el valor en la base de datos para evitar recalcular en cada consulta

#### 4.3. Al Actualizar un Episodio (PATCH /api/episodios/:id)

Si el payload incluye cambios en campos que afectan el cálculo de `precioBaseTramo`:
- Cambio en `peso` (peso GRD) - puede cambiar el tramo para FNS012/FNS026
- Cambio en el convenio (si es editable)

El backend debe:

1. Recalcular `precioBaseTramo` automáticamente si cambian `peso` o `convenio`
2. Actualizar el campo en la base de datos
3. **IMPORTANTE:** Si el frontend envía `precioBaseTramo` en el payload, el backend debe:
   - **Opción A (Recomendada):** Ignorar el valor enviado y recalcular automáticamente (el cálculo es determinístico)
   - **Opción B:** Aceptar el valor si es proporcionado, pero recalcular si cambian `peso` o `convenio`

**⚠️ RECOMENDACIÓN:** Preferir la **Opción A** para mantener la consistencia de datos y evitar errores manuales.

#### 4.4. Cuando se Actualizan Precios de Convenios

Si un usuario actualiza la tabla `precios_convenios` (crea, edita o elimina registros), el backend debe:

1. **Opción A (Recomendada para producción):** Recalcular `precioBaseTramo` para todos los episodios afectados que tengan convenios/periodos relacionados
2. **Opción B (Más eficiente):** Recalcular `precioBaseTramo` de forma lazy (solo cuando se consultan los episodios)

**⚠️ RECOMENDACIÓN:** Para producción, usar la **Opción B** con un mecanismo de caché o invalidación para evitar recalcular en cada consulta.

### 5. Validación de Datos

Antes de calcular `precioBaseTramo`, validar:

- ✅ El convenio existe y es válido (FNS012, FNS026, FNS019, o CH0041)
- ✅ El peso GRD es un número válido (para convenios con tramos)
- ✅ Existe al menos un registro en `precios_convenios` que corresponda al convenio (y tramo si aplica)

Si alguna validación falla:
- Asignar `precioBaseTramo = null`
- Registrar un warning en los logs (no un error, ya que puede ser temporal)

### 6. Manejo de Casos Especiales

#### 6.1. Múltiples Registros de Precios

Si existen múltiples registros de `precios_convenios` que coinciden con el convenio (y tramo si aplica):

**Solución:** Tomar el primer registro encontrado (o el más reciente basado en `createdAt` si hay múltiples). **Nota:** Idealmente, debería haber solo un registro por convenio/tramo, pero si hay múltiples, el backend debe manejar este caso.

#### 6.2. No Hay Registro de Precio

Si no existe ningún registro de `precios_convenios` que corresponda al convenio (y tramo si aplica):

**Solución:** Asignar `precioBaseTramo = null` y registrar un warning.

#### 6.3. Peso GRD es Null o Indefinido (para convenios con tramos)

Si el convenio requiere tramos pero el peso GRD es `null` o `undefined`:

**Solución:** Asignar `precioBaseTramo = null` y registrar un warning.

#### 6.4. Convenio Desconocido

Si el convenio del episodio no es FNS012, FNS026, FNS019, ni CH0041:

**Solución:** Asignar `precioBaseTramo = null` y registrar un warning (puede ser un convenio nuevo que aún no tiene reglas definidas).

## 📝 Estructura de la Tabla `precios_convenios`

La tabla `precios_convenios` debe tener los siguientes campos para soportar esta funcionalidad:

```prisma
model PrecioConvenio {
  id             String    @id @default(uuid())
  aseguradora    String?
  nombre_asegi   String?
  convenio       String    // ⚠️ CRÍTICO: Debe contener valores como 'FNS012', 'FNS026', 'FNS019', 'CH0041'
  descr_convenio String?
  tipoAsegurad   String?
  tipoConvenio   String?
  tramo          String?   // ⚠️ CRÍTICO: Para FNS012 y FNS026 debe ser 'T1', 'T2', o 'T3'. Para FNS019 y CH0041 puede ser null o ignorado
  fechaAdmision  DateTime? // ⚠️ CRÍTICO: Fecha de inicio del periodo de validez del precio
  fechaFin       DateTime? // ⚠️ CRÍTICO: Fecha de fin del period de validez del precio
  precio         Float?    // ⚠️ CRÍTICO: El precio base a usar
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Validaciones recomendadas:**
- `convenio` debe ser no nulo
- `precio` debe ser un número positivo
- `fechaAdmision` y `fechaFin` deben ser válidas si están presentes
- `fechaFin` debe ser >= `fechaAdmision` si ambas están presentes

## 🔄 Flujo de Cálculo Completo

```
1. Episodio se importa/actualiza
   ↓
2. Determinar convenio del episodio
   ↓
3. Obtener peso GRD (campo `peso`)
   ↓
4. ¿El convenio usa tramos? (FNS012, FNS026)
   ├─ SÍ → Calcular tramo basado en peso GRD
   │        ↓
   │        Buscar en precios_convenios: convenio + tramo (SIN validar fechas)
   │        ↓
   │        Asignar precio encontrado a precioBaseTramo
   │
   └─ NO → (FNS019, CH0041)
            ↓
            Buscar en precios_convenios: convenio (SIN validar fechas ni tramo)
            ↓
            Asignar precio encontrado a precioBaseTramo
   ↓
5. Si no se encontró precio → precioBaseTramo = null
   ↓
6. Guardar/actualizar episodio con precioBaseTramo calculado
```

## ✅ Checklist para Backend

- [ ] Confirmar cómo se determina el convenio del episodio (campo, relación, o lógica)
- [ ] Implementar función `calcularTramo(pesoGRD)` para FNS012 y FNS026
- [ ] Implementar función `obtenerPrecioBaseTramo(convenio, pesoGRD, fechaIngreso)`
- [ ] Aplicar cálculo automático en `POST /api/episodios/import`
- [ ] Aplicar cálculo automático en `GET /api/episodios/final` (lazy calculation si es null)
- [ ] Aplicar cálculo automático en `GET /api/episodios/:id` (lazy calculation si es null)
- [ ] Aplicar cálculo automático en `PATCH /api/episodios/:id` (recalcular si cambian peso/convenio/fecha)
- [ ] Manejar casos especiales (múltiples registros, no hay registro, peso null, convenio desconocido)
- [ ] Validar que la tabla `precios_convenios` tenga los campos necesarios
- [ ] Agregar logging para debugging (registrar cuando no se encuentra precio, cuando se recalcula, etc.)
- [ ] Probar con datos reales para cada convenio y tramo

## 📌 Notas Adicionales

1. **Performance:** Si hay muchos episodios, considerar implementar un índice en `precios_convenios` para `convenio`, `tramo`, `fechaAdmision`, y `fechaFin` para acelerar las búsquedas.

2. **Auditoría:** Considerar registrar en logs cuándo y por qué se calcula `precioBaseTramo` para facilitar el debugging.

3. **Frontend:** El frontend actualmente marca `precioBaseTramo` como editable para el rol `finanzas`, pero con esta implementación, el backend debería recalcular automáticamente. El frontend puede mantener la edición manual como "override" si es necesario, pero se recomienda que el backend siempre recalcule para mantener consistencia.

4. **Migración de Datos Existentes:** Si ya existen episodios en la base de datos sin `precioBaseTramo` calculado, considerar crear un script de migración que recorra todos los episodios y calcule este campo.


# Prompt para Backend: Permisos de Codificador para AT(S/N) y AT Detalle

## ⚠️ PROBLEMA CRÍTICO ACTUAL

El backend está devolviendo el siguiente error cuando un usuario con rol `codificador` intenta editar los campos `at` y `atDetalle`:

```
❌ Acceso denegado: Rol del usuario "codificador" (normalizado: "CODIFICADOR") no está en [finanzas, FINANZAS, gestion, GESTION] (normalizados: [FINANZAS, FINANZAS, GESTION, GESTION])
```

**El problema:** El middleware o la verificación de permisos en `PATCH /api/episodios/:id` solo permite los roles `finanzas` y `gestion`, pero **NO incluye `codificador`**.

## Solución Requerida

El backend **DEBE agregar el rol `codificador`** a la lista de roles permitidos para editar los campos `at` y `atDetalle`.

## Cambios Requeridos

### 1. Verificar Permisos en el Endpoint PATCH /api/episodios/:id

El endpoint `PATCH /api/episodios/:id` debe permitir que usuarios con rol `codificador` puedan editar los campos `at` y `atDetalle`.

**Verificación requerida:**
- El middleware de autenticación debe reconocer el rol `codificador`.
- El middleware de autorización debe permitir que `codificador` actualice los campos `at` y `atDetalle`.

### 2. Roles que Deben Poder Editar Cada Campo

**Campo `at` (AT(S/N)):**
- ✅ `codificador` - **DEBE poder editar**
- ❌ `finanzas` - NO puede editar (removido)
- ❌ `gestion` - NO puede editar

**Campo `atDetalle` (AT Detalle):**
- ✅ `codificador` - **DEBE poder editar**
- ❌ `finanzas` - NO puede editar (removido)
- ❌ `gestion` - NO puede editar

**Campo `montoAT` (Monto AT):**
- ❌ Ningún rol puede editarlo directamente
- ✅ Se autocompleta automáticamente cuando se guarda `atDetalle` (backend debe hacerlo)

### 3. 🔧 CAMBIO URGENTE REQUERIDO

**Ubicación del problema:** Probablemente en el middleware o en la ruta `PATCH /api/episodios/:id` en `src/routes/episodios.routes.ts` o similar.

**Código problemático actual (ejemplo):**
```typescript
// ❌ INCORRECTO - Solo permite finanzas y gestion
const rolesPermitidos = ['finanzas', 'FINANZAS', 'gestion', 'GESTION'];
if (!rolesPermitidos.includes(userRole.toUpperCase())) {
  return res.status(403).json({
    message: `Acceso denegado: Rol del usuario "${userRole}" no está permitido`
  });
}
```

**⚠️ PROBLEMAS ESPECÍFICOS REPORTADOS:**

1. **Problema 1:** Cuando el frontend cambia AT de "Sí" a "No", envía el payload:
   ```json
   { "at": "N", "atDetalle": null }
   ```
   **IMPORTANTE:** El frontend NO envía `montoAT` - solo envía `at` y `atDetalle: null`. El backend debe limpiar `montoAT` automáticamente cuando `at = 'N'`.
   El backend detecta que `atDetalle` está en el payload y rechaza la petición porque el rol no está en la lista permitida.

2. **Problema 2:** Cuando el frontend guarda AT Detalle, envía el payload:
   ```json
   { "atDetalle": "valor" }
   ```
   **IMPORTANTE:** El frontend NO envía `montoAT` - solo envía `atDetalle`. El backend debe autocompletar `montoAT` automáticamente.
   El backend rechaza la petición porque el rol `codificador` no está en la lista permitida.

**La solución:** El backend debe verificar si `at` O `atDetalle` están en el payload, y si es así, PERMITIR al rol `codificador`, incluso si `montoAT` también viene en el payload (es parte de la autocompletación/limpieza automática).

**Código corregido requerido:**
```typescript
// ✅ CORRECTO - Verificar permisos por campo específico
const camposATEditables = ['at', 'atDetalle'];
const camposEditablesEnPayload = camposATEditables.filter(campo => campo in req.body);
const otrosCampos = Object.keys(req.body).filter(campo => !camposATEditables.includes(campo) && campo !== 'montoAT');
const userRoleUpper = userRole.toUpperCase();

// Si el payload contiene 'at' o 'atDetalle', SOLO codificador puede editarlos
if (camposEditablesEnPayload.length > 0) {
  if (userRoleUpper !== 'CODIFICADOR') {
    return res.status(403).json({
      message: `Acceso denegado: Solo el rol codificador puede editar los campos AT(S/N) y AT Detalle. Rol actual: "${userRole}".`,
      error: 'FORBIDDEN',
      campos: camposEditablesEnPayload,
      rolActual: userRole
    });
  }
  // Si es codificador, permitir - incluso si montoAT viene junto (es parte de la autocompletación)
} else if (otrosCampos.length > 0) {
  // Para otros campos (no at ni atDetalle), permitir finanzas y gestion
  const rolesPermitidosParaOtros = ['FINANZAS', 'GESTION'];
  if (!rolesPermitidosParaOtros.includes(userRoleUpper)) {
    return res.status(403).json({
      message: `Acceso denegado: Rol del usuario "${userRole}" no está permitido para editar estos campos.`,
      error: 'FORBIDDEN',
      rolActual: userRole,
      campos: otrosCampos
    });
  }
}

// ⚠️ IMPORTANTE: NO rechazar si montoAT viene junto con at o atDetalle
// montoAT es solo un campo derivado/autocompletado, no un campo editable por sí mismo
```

### 4. Ejemplo Completo de Verificación de Permisos (CON LÓGICA CORRECTA)

```typescript
// En el endpoint PATCH /api/episodios/:id
router.patch('/api/episodios/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role; // 'codificador', 'finanzas', 'gestion', etc.
    const userRoleUpper = userRole.toUpperCase(); // 'CODIFICADOR', 'FINANZAS', 'GESTION'
    const { id } = req.params;
    const updates = req.body; // { at?: 'S' | 'N', atDetalle?: string | null, montoAT?: number, ... }

    // IMPORTANTE: montoAT siempre viene junto con at o atDetalle, pero NO se considera un campo editable
    // Es solo una consecuencia automática de editar at o atDetalle
    const camposATEditables = ['at', 'atDetalle'];
    const camposEditablesEnPayload = camposATEditables.filter(campo => campo in updates);
    const otrosCampos = Object.keys(updates).filter(campo => !camposATEditables.includes(campo) && campo !== 'montoAT');

    console.log('🔐 Verificando permisos para PATCH /api/episodios/:id:', {
      rol: userRole,
      camposATEditables: camposEditablesEnPayload,
      otrosCampos: otrosCampos,
      montoATEnPayload: 'montoAT' in updates,
      payloadCompleto: updates
    });

    // CASO 1: Si está intentando editar 'at' o 'atDetalle' directamente, SOLO codificador puede hacerlo
    if (camposEditablesEnPayload.length > 0) {
      if (userRoleUpper !== 'CODIFICADOR') {
        return res.status(403).json({
          message: `Acceso denegado: Solo el rol codificador puede editar los campos AT(S/N) y AT Detalle. Rol actual: "${userRole}".`,
          error: 'FORBIDDEN',
          campos: camposEditablesEnPayload,
          rolActual: userRole,
          camposRequeridos: ['at', 'atDetalle']
        });
      }
      // Si el rol es CODIFICADOR y está editando at o atDetalle, permitir
      // Incluso si montoAT viene en el payload, es aceptable porque se autocompleta
      console.log('✅ Permiso concedido para codificador editando:', camposEditablesEnPayload);
    }

    // CASO 2: Si está intentando editar otros campos (pero NO at ni atDetalle), permitir finanzas y gestion
    if (otrosCampos.length > 0) {
      const rolesPermitidosParaOtros = ['FINANZAS', 'GESTION'];
      if (!rolesPermitidosParaOtros.includes(userRoleUpper)) {
        return res.status(403).json({
          message: `Acceso denegado: Rol del usuario "${userRole}" no está permitido para editar estos campos.`,
          error: 'FORBIDDEN',
          rolActual: userRole,
          campos: otrosCampos
        });
      }
      console.log('✅ Permiso concedido para', userRole, 'editando:', otrosCampos);
    }

    // CASO ESPECIAL: Si el payload solo contiene montoAT sin at ni atDetalle
    // Esto no debería pasar desde el frontend, pero por seguridad rechazar
    if ('montoAT' in updates && camposEditablesEnPayload.length === 0) {
      return res.status(403).json({
        message: 'Acceso denegado: El campo montoAT no puede editarse directamente. Solo se autocompleta al editar AT Detalle.',
        error: 'FORBIDDEN',
        rolActual: userRole
      });
    }

    // Si llegamos aquí, los permisos son correctos - continuar con la actualización
    console.log('✅ Permisos verificados correctamente. Procediendo con actualización...');
    // ... resto de la lógica de actualización

  } catch (error) {
    // ... manejo de errores
  }
});
```

### 4.1. Casos Especiales a Manejar

**⚠️ ESTOS SON LOS PAYLOADS EXACTOS QUE ENVÍA EL FRONTEND:**

**Caso 1: Cambiar AT de "No" a "Sí"**
- **Payload enviado:** `{ "at": "S" }`
- **Permiso requerido:** `codificador` (porque `at` está en el payload)
- **Lógica:** El backend debe permitir que `codificador` envíe este payload.

**Caso 2: Cambiar AT de "Sí" a "No"**
- **Payload enviado:** `{ "at": "N", "atDetalle": null }`
- **Permiso requerido:** `codificador` (porque `at` está en el payload)
- **IMPORTANTE:** El frontend NO envía `montoAT` - solo envía `at` y `atDetalle: null`.
- **Lógica:** El backend debe permitir que `codificador` envíe este payload. El backend debe limpiar automáticamente `montoAT = 0` cuando `at = 'N'`. **NO rechazar porque `atDetalle` esté en el payload (aunque sea `null`) - es parte de la limpieza automática.**

**Caso 3: Guardar AT Detalle**
- **Payload enviado:** `{ "atDetalle": "valor del detalle" }`
- **Permiso requerido:** `codificador` (porque `atDetalle` está en el payload)
- **IMPORTANTE:** El frontend NO envía `montoAT` - solo envía `atDetalle`.
- **Lógica:** El backend debe permitir que `codificador` envíe este payload. El backend debe autocompletar automáticamente `montoAT` consultando la tabla `ajustes_tecnologia`.

**⚠️ REGLAS CRÍTICAS:**
1. El backend **DEBE verificar** si `at` O `atDetalle` están presentes en el payload (incluso si `atDetalle` es `null`).
2. Si `at` O `atDetalle` están en el payload, el backend **DEBE permitir** al rol `codificador`.
3. **El frontend NUNCA envía `montoAT`** - solo envía `at` y/o `atDetalle`. El backend debe autocompletar/limpiar `montoAT` automáticamente.
4. Si el payload contiene `montoAT` sin `at` ni `atDetalle`, el backend **DEBE rechazar** - nadie puede editar `montoAT` directamente.
5. Cuando `at = 'N'`, el backend **DEBE limpiar automáticamente** `atDetalle = null` y `montoAT = 0`.
6. Cuando se actualiza `atDetalle`, el backend **DEBE autocompletar automáticamente** `montoAT` consultando `ajustes_tecnologia`.

### 4. Verificación del Token

Asegurar que:
- El token JWT se está validando correctamente
- El rol del usuario se está extrayendo correctamente del token
- El rol `codificador` está reconocido en el sistema

### 5. Campos que Puede Editar Cada Rol

**Resumen de Permisos:**

| Campo | Codificador | Finanzas | Gestión |
|-------|------------|----------|---------|
| `at` | ✅ | ❌ | ❌ |
| `atDetalle` | ✅ | ❌ | ❌ |
| `montoAT` | ❌ (autocompleta) | ❌ | ❌ |
| `estadoRN` | ❌ | ✅ | ❌ |
| `montoRN` | ❌ | ✅ | ❌ |
| `diasDemoraRescate` | ❌ | ✅ | ❌ |
| `pagoDemora` | ❌ | ✅ | ❌ |
| `pagoOutlierSup` | ❌ | ✅ | ❌ |
| `precioBaseTramo` | ❌ | ✅ | ❌ |
| `montoFinal` | ❌ | ✅ (calculado) | ❌ |
| `documentacion` | ❌ | ✅ | ❌ |
| `validado` | ❌ | ❌ | ✅ |

## 🔧 Checklist para Backend (URGENTE)

- [ ] **CRÍTICO:** Agregar `codificador` y `CODIFICADOR` a la lista de roles permitidos en el middleware o verificación de permisos de `PATCH /api/episodios/:id`
- [ ] **CRÍTICO:** Modificar la lógica para permitir que `codificador` edite `at` y `atDetalle`
- [ ] El middleware de autenticación reconoce el rol `codificador`
- [ ] El endpoint `PATCH /api/episodios/:id` permite que `codificador` edite `at` y `atDetalle`
- [ ] El endpoint `PATCH /api/episodios/:id` NO permite que `finanzas` o `gestion` editen `at` o `atDetalle`
- [ ] El mensaje de error 403 es claro cuando un rol sin permisos intenta editar estos campos
- [ ] El token JWT se está validando correctamente y el rol se extrae correctamente
- [ ] Cuando se guarda `atDetalle`, el backend autocompleta `montoAT` desde la tabla `ajustes_tecnologia`
- [ ] Cuando se guarda `at = 'N'`, el backend limpia `atDetalle = null` y `montoAT = 0`

## Mensaje de Error Esperado

Si un usuario sin permisos intenta editar `at` o `atDetalle`, el backend debe devolver:

```json
{
  "message": "Acceso denegado: Solo el rol codificador puede editar los campos AT(S/N) y AT Detalle.",
  "error": "FORBIDDEN",
  "campos": ["at", "atDetalle"],
  "rolActual": "finanzas" // o "gestion"
}
```

Con código HTTP `403 Forbidden`.

## 📍 Ubicación del Código a Modificar

**Buscar en el backend:**
- Archivo: Probablemente `src/routes/episodios.routes.ts` o similar
- Función/Endpoint: `PATCH /api/episodios/:id`
- Buscar: La línea que tiene el array `[finanzas, FINANZAS, gestion, GESTION]`
- Acción: **Agregar `codificador` y `CODIFICADOR` a ese array**, o mejor aún, implementar la lógica de verificación por campo como se muestra en la sección 3.

## ⚠️ IMPORTANTE: Payloads que Envía el Frontend

**El frontend NO envía `montoAT` cuando guarda `atDetalle`**. Solo envía:
- `{ "atDetalle": "valor" }`

El backend **DEBE autocompletar `montoAT`** automáticamente según el `atDetalle` seleccionado, consultando la tabla `ajustes_tecnologia`.

**Cuando se cambia AT de "Sí" a "No", el frontend envía:**
- `{ "at": "N", "atDetalle": null, "montoAT": 0 }`

En este caso, el backend **DEBE aceptar** este payload completo del rol `codificador` porque se están limpiando los campos automáticamente.

**Ejemplo de dónde buscar:**
```typescript
// Buscar líneas como estas:
const rolesPermitidos = ['finanzas', 'FINANZAS', 'gestion', 'GESTION'];
// O
if (!['finanzas', 'FINANZAS', 'gestion', 'GESTION'].includes(userRole.toUpperCase()))
// O
checkRole(['finanzas', 'gestion'])
```

**Cambiar a:**
```typescript
// IMPORTANTE: Verificar si 'at' O 'atDetalle' están en el payload
const camposATEditables = ['at', 'atDetalle'];
const tieneAtOAtDetalle = camposATEditables.some(campo => campo in req.body);
const otrosCampos = Object.keys(req.body).filter(campo => !camposATEditables.includes(campo) && campo !== 'montoAT');
const userRoleUpper = userRole.toUpperCase();

// CASO 1: Si el payload contiene 'at' o 'atDetalle', SOLO codificador puede editarlos
// ⚠️ IMPORTANTE: Incluso si montoAT viene junto, es parte de la autocompletación/limpieza
if (tieneAtOAtDetalle) {
  if (userRoleUpper !== 'CODIFICADOR') {
    return res.status(403).json({
      message: `Acceso denegado: Solo el rol codificador puede editar los campos AT(S/N) y AT Detalle. Rol actual: "${userRole}".`,
      error: 'FORBIDDEN',
      campos: camposATEditables.filter(campo => campo in req.body),
      rolActual: userRole
    });
  }
  // Si es codificador, PERMITIR - incluso si montoAT viene junto
  // Continuar con la actualización...
}
// CASO 2: Si solo hay otros campos (no at ni atDetalle), permitir finanzas y gestion
else if (otrosCampos.length > 0) {
  if (!['FINANZAS', 'GESTION'].includes(userRoleUpper)) {
    return res.status(403).json({
      message: `Acceso denegado: Rol del usuario "${userRole}" no está permitido para editar estos campos.`,
      error: 'FORBIDDEN',
      rolActual: userRole,
      campos: otrosCampos
    });
  }
}
// CASO 3: Si solo viene montoAT sin at ni atDetalle, rechazar (no debería pasar)
else if ('montoAT' in req.body) {
  return res.status(403).json({
    message: 'Acceso denegado: El campo montoAT no puede editarse directamente. Solo se autocompleta al editar AT Detalle.',
    error: 'FORBIDDEN',
    rolActual: userRole
  });
}
```


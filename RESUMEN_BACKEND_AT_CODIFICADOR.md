# Resumen para Backend: Implementación de AT(S/N) y AT Detalle para Codificador

## 📋 Resumen Ejecutivo

El frontend necesita que el backend permita que usuarios con rol `codificador` editen los campos `at` (AT(S/N)) y `atDetalle` (AT Detalle) en episodios. Además, cuando se guarda `atDetalle`, el backend debe **autocompletar automáticamente** el campo `montoAT` consultando la tabla `ajustes_tecnologia`.

## 🔑 Puntos Clave

1. **Solo `codificador` puede editar** `at` y `atDetalle`
2. **El frontend NO envía `montoAT`** cuando guarda `atDetalle` - solo envía `atDetalle`
3. **El backend DEBE autocompletar `montoAT`** automáticamente consultando `ajustes_tecnologia`
4. Cuando se cambia `at` de "Sí" a "No", el frontend envía: `{ "at": "N", "atDetalle": null, "montoAT": 0 }`

## 📤 Payloads que Envía el Frontend

### Caso 1: Cambiar AT(S/N) de "No" a "Sí"
```json
PATCH /api/episodios/:id
{
  "at": "S"
}
```
**Permiso requerido:** `codificador`

### Caso 2: Cambiar AT(S/N) de "Sí" a "No"
```json
PATCH /api/episodios/:id
{
  "at": "N",
  "atDetalle": null
}
```
**Permiso requerido:** `codificador`
**IMPORTANTE:** El frontend NO envía `montoAT` - solo envía `at` y `atDetalle: null`. El backend debe limpiar `montoAT` automáticamente cuando `at = 'N'`.

### Caso 3: Guardar AT Detalle
```json
PATCH /api/episodios/:id
{
  "atDetalle": "Stent más dispositivo de liberación"
}
```
**Permiso requerido:** `codificador`
**IMPORTANTE:** El frontend NO envía `montoAT`. El backend debe autocompletarlo automáticamente.

## 🔧 Cambios Requeridos en Backend

### 1. Permisos en `PATCH /api/episodios/:id`

Implementar verificación de permisos **por campo específico**:

```javascript
// Pseudocódigo
router.patch('/api/episodios/:id', authenticateToken, async (req, res) => {
  try {
    const userRole = req.user.role; // 'codificador', 'finanzas', 'gestion', etc.
    const userRoleUpper = userRole.toUpperCase();
    const updates = req.body;

    // Campos que solo codificador puede editar
    const camposATEditables = ['at', 'atDetalle'];
    const camposEnPayloadQueSonAT = camposATEditables.filter(campo => campo in updates);
    const otrosCampos = Object.keys(updates).filter(
      campo => !camposATEditables.includes(campo) && campo !== 'montoAT'
    );

    // CASO 1: Si el payload contiene 'at' o 'atDetalle', SOLO codificador puede editarlos
    if (camposEnPayloadQueSonAT.length > 0) {
      if (userRoleUpper !== 'CODIFICADOR') {
        return res.status(403).json({
          message: `Acceso denegado: Solo el rol codificador puede editar los campos AT(S/N) y AT Detalle. Rol actual: "${userRole}".`,
          error: 'FORBIDDEN',
          campos: camposEnPayloadQueSonAT,
          rolActual: userRole
        });
      }
      // Si es codificador, PERMITIR - incluso si montoAT viene junto (es parte de la limpieza cuando at = 'N')
    }

    // CASO 2: Si solo viene montoAT sin at ni atDetalle, rechazar (no debería pasar desde frontend)
    if ('montoAT' in updates && camposEnPayloadQueSonAT.length === 0) {
      return res.status(403).json({
        message: 'Acceso denegado: El campo montoAT no puede editarse directamente. Solo se autocompleta al editar AT Detalle.',
        error: 'FORBIDDEN',
        rolActual: userRole
      });
    }

    // CASO 3: Para otros campos (no at, no atDetalle, no montoAT), permitir finanzas y gestion
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
    }

    // Si llegamos aquí, los permisos son correctos - continuar con la actualización
    // ... resto de la lógica
  } catch (error) {
    // ... manejo de errores
  }
});
```

### 2. Autocompletado de `montoAT` al guardar `atDetalle`

Cuando el payload contiene `atDetalle`, el backend debe:

1. **Buscar el ajuste correspondiente** en la tabla `ajustes_tecnologia` donde `at === atDetalle`
2. **Autocompletar automáticamente** el campo `montoAT` con el `monto` del ajuste encontrado
3. **Si no se encuentra el ajuste** o `atDetalle` es `null`, establecer `montoAT` a `0`

```javascript
// Pseudocódigo dentro del handler PATCH /api/episodios/:id
if ('atDetalle' in updates) {
  const atDetalle = updates.atDetalle;
  
  if (atDetalle && atDetalle.trim() !== '') {
    // Buscar el ajuste de tecnología correspondiente
    const ajusteTecnologia = await prisma.ajusteTecnologia.findFirst({
      where: {
        at: {
          equals: atDetalle.trim(),
          // Opcional: mode: 'insensitive' para búsqueda case-insensitive
        }
      }
    });
    
    if (ajusteTecnologia && ajusteTecnologia.monto !== null && ajusteTecnologia.monto !== undefined) {
      // Autocompletar montoAT con el monto del ajuste
      updates.montoAT = ajusteTecnologia.monto;
      console.log(`💰 Autocompletado montoAT: ${ajusteTecnologia.monto} para atDetalle: ${atDetalle}`);
    } else {
      // Si no se encuentra el ajuste, establecer montoAT a 0
      updates.montoAT = 0;
      console.warn(`⚠️ No se encontró ajuste para atDetalle: ${atDetalle}. Estableciendo montoAT a 0.`);
    }
  } else {
    // Si atDetalle es null o vacío, establecer montoAT a 0
    updates.montoAT = 0;
    console.log(`🧹 atDetalle es null. Estableciendo montoAT a 0.`);
  }
}
```

### 3. Limpieza cuando `at = 'N'`

Cuando el payload contiene `at: 'N'`, el backend debe asegurar que `atDetalle` y `montoAT` estén limpios automáticamente:

```javascript
// Pseudocódigo dentro del handler PATCH /api/episodios/:id
if (updates.at === 'N' || updates.at === 'n') {
  updates.at = 'N'; // Normalizar
  updates.atDetalle = null; // Limpiar automáticamente
  updates.montoAT = 0; // Limpiar automáticamente
  console.log('🧹 Limpiando atDetalle y montoAT automáticamente porque AT = N');
}
```

**IMPORTANTE:** El frontend puede enviar `atDetalle: null` en el payload cuando `at = 'N'`, pero el backend **SIEMPRE debe limpiar `montoAT = 0` automáticamente**, incluso si no viene en el payload del frontend.

## ✅ Checklist para Backend

- [ ] **CRÍTICO:** Implementar verificación de permisos por campo específico en `PATCH /api/episodios/:id`
- [ ] Permitir que `codificador` edite `at` y `atDetalle`
- [ ] Rechazar que otros roles (incluyendo `finanzas` y `gestion`) editen `at` y `atDetalle`
- [ ] Implementar autocompletado de `montoAT` cuando se recibe `atDetalle` en el payload
- [ ] Buscar en `ajustes_tecnologia` por el campo `at` que coincida con `atDetalle`
- [ ] Establecer `montoAT = 0` si no se encuentra el ajuste o si `atDetalle` es `null`
- [ ] Limpiar `atDetalle = null` y `montoAT = 0` cuando se recibe `at = 'N'`
- [ ] Devolver el episodio completo actualizado en la respuesta del PATCH (incluyendo `montoAT` autocompletado)
- [ ] El endpoint `GET /api/episodios/:id` debe devolver el episodio completo con `montoAT` incluido

## 📚 Documentos de Referencia

Para más detalles, consultar:
- `PROMPT_BACKEND_PERMISOS_CODIFICADOR_AT.md` - Detalles completos sobre permisos
- `PROMPT_BACKEND_AUTOCOMPLETAR_MONTO_AT.md` - Detalles completos sobre autocompletado de montoAT

## 🚨 Notas Importantes

1. **El frontend NO envía `montoAT`** cuando guarda `atDetalle` - solo envía `atDetalle`. El backend debe autocompletarlo.
2. **Cuando `at = 'N'`**, el frontend envía `{ "at": "N", "atDetalle": null, "montoAT": 0 }` para limpiar estos campos. El backend debe aceptar este payload completo del rol `codificador`.
3. **El frontend hace un GET después del PATCH** de `atDetalle` para refrescar el episodio y obtener el `montoAT` actualizado. Asegurar que el GET devuelva el episodio completo.


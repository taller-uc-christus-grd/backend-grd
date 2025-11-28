# Resumen: Cálculo Automático de Precio Base por Tramo

## 🎯 Objetivo

Calcular automáticamente `precioBaseTramo` en episodios basándose en el convenio y el peso GRD.

## 📋 Reglas

### Convenios con Tramos (FNS012, FNS026)
- **T1**: `0 <= peso GRD <= 1.5`
- **T2**: `1.5 < peso GRD <= 2.5`
- **T3**: `peso GRD > 2.5`

Buscar en `precios_convenios` el registro que coincida con:
- `convenio = 'FNS012'` o `'FNS026'`
- `tramo = 'T1'`, `'T2'`, o `'T3'` (según peso GRD)
- **NO buscar por fechas** - solo mapear por convenio y tramo

### Convenios Precio Único (FNS019, CH0041)
Buscar en `precios_convenios` el registro que coincida con:
- `convenio = 'FNS019'` o `'CH0041'`
- **NO buscar por fechas** - como hay una sola opción, tomar el precio que coincida con el convenio
- Ignorar el campo `tramo` (si existe)

## 🔧 Implementación

### Dónde Aplicar el Cálculo

1. **Al importar episodios** (`POST /api/episodios/import`)
2. **Al recuperar episodios** (`GET /api/episodios/final`, `GET /api/episodios/:id`) - recalcular si es `null`
3. **Al actualizar episodios** (`PATCH /api/episodios/:id`) - recalcular si cambian `peso` o `convenio`
4. **Cuando se actualiza `precios_convenios`** - recalcular episodios afectados (lazy o batch)

### Pseudocódigo de la Función Principal

```typescript
async function calcularPrecioBaseTramo(episodio: Episodio): Promise<number | null> {
  const convenio = episodio.convenio; // ⚠️ Verificar cómo se determina el convenio
  const pesoGRD = episodio.peso; // Campo "Peso Medio [Norma IR]"
  
  if (['FNS012', 'FNS026'].includes(convenio)) {
    // Calcular tramo
    let tramo: string | null = null;
    if (pesoGRD >= 0 && pesoGRD <= 1.5) tramo = 'T1';
    else if (pesoGRD > 1.5 && pesoGRD <= 2.5) tramo = 'T2';
    else if (pesoGRD > 2.5) tramo = 'T3';
    
    if (!tramo) return null;
    
    // Buscar precio (sin validar fechas)
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenio,
        tramo: tramo
      }
    });
    
    return precioRegistro?.precio || null;
    
  } else if (['FNS019', 'CH0041'].includes(convenio)) {
    // Buscar precio único (sin validar fechas ni tramo)
    const precioRegistro = await prisma.precioConvenio.findFirst({
      where: {
        convenio: convenio
      }
    });
    
    return precioRegistro?.precio || null;
  }
  
  return null; // Convenio desconocido
}
```

## ⚠️ Pregunta Crítica

**¿Cómo se determina el convenio del episodio?**

- ¿Hay un campo `convenio` en el modelo `Episodio`?
- ¿Se determina desde el `folio`?
- ¿Viene en el archivo maestro importado?
- ¿Otra lógica?

**Esto debe confirmarse antes de implementar.**

## ✅ Checklist Rápido

- [ ] Confirmar cómo se determina el convenio del episodio
- [ ] Implementar función de cálculo de tramo (T1/T2/T3) para FNS012 y FNS026
- [ ] Implementar función de búsqueda de precio base en `precios_convenios`
- [ ] Aplicar cálculo en importación de episodios
- [ ] Aplicar cálculo lazy en GET de episodios (si `precioBaseTramo` es `null`)
- [ ] Recalcular en PATCH si cambian peso/convenio
- [ ] Manejar casos especiales (no hay precio, peso null, convenio desconocido)
- [ ] Agregar logging para debugging

## 📄 Documentación Completa

Ver `PROMPT_BACKEND_PRECIO_BASE_TRAMO.md` para detalles completos, casos especiales, y ejemplos de código.


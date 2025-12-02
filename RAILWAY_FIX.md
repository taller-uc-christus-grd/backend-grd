# Fix para Railway - Campos de Percentiles

## Problema

Railway está intentando insertar campos `percentil25`, `percentil50`, `percentil75` que no existen en la base de datos.

## Solución Aplicada

El código ahora usa `Omit` para excluir explícitamente los campos de percentiles del tipo de Prisma, asegurando que no se intenten insertar.

## Pasos para Desplegar en Railway

1. **Hacer commit y push de los cambios:**
   ```bash
   git add .
   git commit -m "Fix: Excluir campos de percentiles del upsert hasta migración"
   git push
   ```

2. **En Railway, después del deploy:**
   - El código debería funcionar sin los campos de percentiles
   - Los percentiles se leerán del archivo pero NO se guardarán

3. **Ejecutar la migración en Railway:**
   ```bash
   # En Railway, usar el terminal o ejecutar como comando de build
   npx prisma migrate deploy
   npx prisma generate
   ```

   O agregar a `package.json` scripts:
   ```json
   "postdeploy": "npx prisma migrate deploy && npx prisma generate"
   ```

4. **Después de la migración:**
   - Actualizar el código para incluir los percentiles en el upsert
   - O simplemente recargar la Norma Minsal y los percentiles se guardarán automáticamente

## Código Actual

El código ahora usa:
```typescript
const dataToUpsert = {
  codigo: codigo,
  descripcion: `Descripción de ${codigo}`,
  peso: peso,
  puntoCorteInf: pci,
  puntoCorteSup: pcs,
  precioBaseTramo: precioBaseEjemplo,
} as Omit<Prisma.GrdUncheckedCreateInput, 'percentil25' | 'percentil50' | 'percentil75'>;
```

Esto asegura que TypeScript y Prisma NO intenten incluir los campos de percentiles.


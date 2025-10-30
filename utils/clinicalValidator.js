function validateClinical(row, grdDict) {
  const issues = [];
  const out = {
    VALIDADO: 'OK',
    inlier_outlier: ''
  };

  // Reglas básicas
  if (!row.paciente_id && !row.episodio_cmbd && !row.folio)
    issues.push('Falta identificador de caso (RUT/Episodio/Folio).');

  if (row.fecha_ingreso && row.fecha_egreso && row.fecha_egreso < row.fecha_ingreso)
    issues.push('Fecha Alta anterior a Fecha de ingreso.');

  if (row.edad != null && (row.edad < 0 || row.edad > 120))
    issues.push('Edad fuera de rango [0,120].');

  if (row.peso != null && (row.peso < 0.3 || row.peso > 300))
    issues.push('Peso fuera de rango [0.3,300].');

  // Cálculo de días
  let dias = row.dias_estancia;
  if (!Number.isFinite(dias)) {
    if (row.fecha_ingreso && row.fecha_egreso) {
      dias = Math.max(0, Math.round((row.fecha_egreso - row.fecha_ingreso) / 86400000));
    }
  }

  // Validación GRD
  const grdCode = String(row.ir_grd ?? row.grd ?? row['IR - GRD'] ?? '').trim();
  if (grdCode) {
    if (!grdDict.has(grdCode)) {
      issues.push(`GRD no encontrado en norma MINSAL: ${grdCode}`);
    } else if (Number.isFinite(dias)) {
      const { pci, pcs } = grdDict.get(grdCode);
      if (dias < pci || dias > pcs) {
        out.inlier_outlier = 'outlier';
        if (dias > pcs && !(Number(row.pago_outlier_sup) >= 0)) {
          issues.push('Outlier superior sin campo "Pago por outlier superior".');
        }
      } else {
        out.inlier_outlier = 'inlier';
      }
    }
  }

  if (issues.length > 0) out.VALIDADO = 'Con errores';
  out.OBSERVACIONES = issues;
  return out;
}

module.exports = { validateClinical };
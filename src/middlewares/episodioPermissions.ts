import { Request, Response, NextFunction } from 'express';

/**
 * Middleware para verificar permisos de edición de episodios según el rol
 * 
 * - Gestión solo puede editar: validado, comentariosGestion, fechaRevision, revisadoPor
 * - Finanzas solo puede editar: campos financieros (estadoRN, montoAT, etc.)
 * - Admin puede editar todo
 */
export function checkEpisodioPermissions(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  const updates = req.body;

  if (!user) {
    return res.status(401).json({ 
      message: 'No autenticado',
      error: 'Unauthorized'
    });
  }

  // Campos que solo finanzas puede editar
  const finanzasOnlyFields = [
    'estadoRN', 'montoRN', 'at', 'atDetalle', 'montoAT',
    'diasDemoraRescate', 'pagoDemora', 'pagoOutlierSup',
    'precioBaseTramo', 'montoFinal', 'valorGRD', 'documentacion'
  ];

  // Campos que solo gestión puede editar
  const gestionOnlyFields = [
    'validado', 'comentariosGestion', 'fechaRevision', 'revisadoPor'
  ];

  // Verificar qué campos se están intentando actualizar
  const camposSolicitados = Object.keys(updates);
  const tieneCamposFinanzas = camposSolicitados.some(campo =>
    finanzasOnlyFields.includes(campo)
  );
  const tieneCamposGestion = camposSolicitados.some(campo =>
    gestionOnlyFields.includes(campo)
  );

  // Normalizar rol a minúsculas para comparación
  const userRole = user.role.toLowerCase();

  // Admin puede editar todo
  if (userRole === 'admin') {
    return next();
  }

  // Si intenta editar campos de finanzas, debe tener rol finanzas
  if (tieneCamposFinanzas && userRole !== 'finanzas') {
    return res.status(403).json({
      message: 'No tienes permisos para editar campos financieros. Se requiere rol "finanzas".',
      error: 'Forbidden'
    });
  }

  // Si intenta editar campos de gestión, debe tener rol gestion
  if (tieneCamposGestion && userRole !== 'gestion') {
    return res.status(403).json({
      message: 'No tienes permisos para validar episodios. Se requiere rol "gestión".',
      error: 'Forbidden'
    });
  }

  // Si intenta editar campos que no son de su rol
  if (userRole === 'finanzas' && tieneCamposGestion) {
    return res.status(403).json({
      message: 'No tienes permisos para validar episodios. Solo puedes editar campos financieros.',
      error: 'Forbidden'
    });
  }

  if (userRole === 'gestion' && tieneCamposFinanzas) {
    return res.status(403).json({
      message: 'No tienes permisos para editar campos financieros. Solo puedes validar episodios.',
      error: 'Forbidden'
    });
  }

  // Verificar que tenga al menos uno de los roles permitidos
  if (!['finanzas', 'gestion', 'admin'].includes(userRole)) {
    return res.status(403).json({
      message: 'No tienes permisos para actualizar episodios.',
      error: 'Forbidden'
    });
  }

  next();
}


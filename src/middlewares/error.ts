import { Request, Response, NextFunction } from 'express';
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  console.error('❌ Error no manejado:', {
    message: err?.message,
    stack: err?.stack,
    code: err?.code,
    name: err?.name,
    status: err?.status,
    path: req.path,
    method: req.method,
  });
  
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  res.status(status).json({ 
    message,
    ...(process.env.NODE_ENV === 'development' && {
      error: err.message,
      stack: err.stack
    })
  });
}
// Silenciar console.log y console.error durante los tests para una salida más limpia
// Solo mostrar errores reales de los tests, no los console.log/error del código

const originalLog = console.log;
const originalError = console.error;

// Guardar los logs originales pero no mostrarlos durante los tests
// Esto hace que la salida sea más limpia y similar a la imagen de referencia
console.log = (...args: any[]) => {
  // Solo mostrar si es un error crítico o viene de Jest
  if (args[0]?.includes?.('PASS') || args[0]?.includes?.('FAIL') || args[0]?.includes?.('RUNS')) {
    originalLog(...args);
  }
  // Silenciar el resto
};

console.error = (...args: any[]) => {
  // Solo mostrar errores que no sean de dotenv o del código de producción
  const message = args[0]?.toString() || '';
  if (
    !message.includes('dotenv') &&
    !message.includes('Error listando usuarios') &&
    !message.includes('Error obteniendo') &&
    !message.includes('Error creando') &&
    !message.includes('Error actualizando') &&
    !message.includes('Error eliminando') &&
    !message.includes('Error cambiando') &&
    !message.includes('Error en signup') &&
    !message.includes('Error en login') &&
    !message.includes('Stack trace')
  ) {
    originalError(...args);
  }
};


import * as XLSX from 'xlsx';
import * as path from 'path';
import * as os from 'os';

// ✅ Datos de prueba CON TODAS LAS COLUMNAS REQUERIDAS
const datosTest = [
  {
    'Episodio CMBD': 'EP-TEST-001',
    'Hospital (Descripción)': 'Hospital UC Christus',
    'RUT': '12345678-9',
    'Nombre': 'Juan Pérez',
    'Sexo  (Desc)': 'M',
    'Edad en años': 45,
    'IR GRD (Código)': 'G045',
    'Peso GRD Medio (Todos)': 1.2,  // ✅ AGREGADA
    'Peso Medio [Norma IR]': 1.2,   // ✅ AGREGADA
    'Convenios  (cod)': 'FNS012',
    'Fecha Ingreso completa': '2024-01-15',
    'Fecha Completa': '2024-01-20',
    'Tipo Actividad': 'Hospitalización',
    'Servicio Egreso (Descripción)': 'Medicina Interna',
    'Motivo Egreso (Descripción)': 'Alta médica',
    'Estancia real del episodio': 5,
    'ID Derivación': 'FOL001',
    'Facturación Total del episodio': 150000,
    'IR Alta Inlier / Outlier': 'Inlier',
    'Estado RN': '',  // ✅ VACÍO - default "Pendiente"
    'AT': '',         // ✅ VACÍO - default false
    'AT Detalle': '', // ✅ VACÍO - default null
    'Monto AT': '',   // ✅ VACÍO - default 0
    'Monto RN': '',   // ✅ VACÍO - default 0
    'Días Demora Rescate': '',      // ✅ VACÍO - default 0
    'Pago Demora Rescate': '',      // ✅ VACÍO - default 0
    'Pago Outlier Superior': '',    // ✅ VACÍO - default 0
  },
  {
    'Episodio CMBD': 'EP-TEST-002',
    'Hospital (Descripción)': 'Hospital San José',
    'RUT': '98765432-1',
    'Nombre': 'María González',
    'Sexo  (Desc)': 'F',
    'Edad en años': 52,
    'IR GRD (Código)': 'G012',
    'Peso GRD Medio (Todos)': 0.8,  // ✅ AGREGADA
    'Peso Medio [Norma IR]': 0.8,   // ✅ AGREGADA
    'Convenios  (cod)': 'FNS012',
    'Fecha Ingreso completa': '2024-02-10',
    'Fecha Completa': '2024-02-18',
    'Tipo Actividad': 'Cirugía',
    'Servicio Egreso (Descripción)': 'Cirugía General',
    'Motivo Egreso (Descripción)': 'Curación completada',
    'Estancia real del episodio': 8,
    'ID Derivación': 'FOL002',
    'Facturación Total del episodio': 200000,
    'IR Alta Inlier / Outlier': 'Outlier',
    'Estado RN': '',
    'AT': '',
    'AT Detalle': '',
    'Monto AT': '',
    'Monto RN': '',
    'Días Demora Rescate': '',
    'Pago Demora Rescate': '',
    'Pago Outlier Superior': '',
  },
  {
    'Episodio CMBD': 'EP-TEST-003',
    'Hospital (Descripción)': 'Clínica Las Condes',
    'RUT': '11111111-1',
    'Nombre': 'Carlos López',
    'Sexo  (Desc)': 'M',
    'Edad en años': 60,
    'IR GRD (Código)': 'G089',
    'Peso GRD Medio (Todos)': 1.5,  // ✅ AGREGADA
    'Peso Medio [Norma IR]': 1.5,   // ✅ AGREGADA
    'Convenios  (cod)': 'FNS026',
    'Fecha Ingreso completa': '2024-03-05',
    'Fecha Completa': '2024-03-12',
    'Tipo Actividad': 'Procedimiento',
    'Servicio Egreso (Descripción)': 'Urgencia',
    'Motivo Egreso (Descripción)': 'Derivación a especialista',
    'Estancia real del episodio': 7,
    'ID Derivación': 'FOL003',
    'Facturación Total del episodio': 120000,
    'IR Alta Inlier / Outlier': 'Inlier',
    'Estado RN': '',
    'AT': '',
    'AT Detalle': '',
    'Monto AT': '',
    'Monto RN': '',
    'Días Demora Rescate': '',
    'Pago Demora Rescate': '',
    'Pago Outlier Superior': '',
  }
];

// ✅ Crear workbook
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(datosTest);

// ✅ Ajustar ancho de columnas (ACTUALIZADO CON AMBAS COLUMNAS DE PESO)
ws['!cols'] = [
  { wch: 15 }, // Episodio CMBD
  { wch: 25 }, // Hospital
  { wch: 12 }, // RUT
  { wch: 15 }, // Nombre
  { wch: 10 }, // Sexo
  { wch: 12 }, // Edad
  { wch: 12 }, // GRD
  { wch: 18 }, // Peso GRD Medio (Todos) ✅
  { wch: 18 }, // Peso Medio [Norma IR] ✅
  { wch: 15 }, // Convenio
  { wch: 18 }, // Fecha Ingreso
  { wch: 18 }, // Fecha Completa
  { wch: 15 }, // Tipo
  { wch: 25 }, // Servicio
  { wch: 25 }, // Motivo Egreso
  { wch: 18 }, // Estancia real
  { wch: 12 }, // Folio
  { wch: 15 }, // Facturación
  { wch: 15 }, // Inlier/Outlier
  { wch: 12 }, // Estado RN
  { wch: 8 },  // AT
  { wch: 15 }, // AT Detalle
  { wch: 12 }, // Monto AT
  { wch: 12 }, // Monto RN
  { wch: 15 }, // Días Demora
  { wch: 18 }, // Pago Demora
  { wch: 18 }, // Pago Outlier
];

XLSX.utils.book_append_sheet(wb, ws, 'Episodios');

// ✅ Guardar en el Escritorio
const desktopPath = path.join(os.homedir(), 'Desktop');
const filePath = path.join(desktopPath, 'test-data-campos-blancos.xlsx');

XLSX.writeFile(wb, filePath);

console.log(`✅ Archivo de prueba creado en: ${filePath}`);
console.log(`📁 Puedes encontrarlo en tu Escritorio`);
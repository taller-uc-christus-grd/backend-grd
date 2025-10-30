// utils/grdRules.js
const axios = require('axios');
const XLSX = require('xlsx');

let GRD_RULES = null;
let LAST_LOAD = null;

function parseWorkbookToRules(workbook) {
  const sheet = workbook.Sheets['Normas (4)'];
  if (!sheet) throw new Error('No se encontró la hoja "Normas (4)".');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const dict = new Map();
  rows.forEach((r) => {
    const grd = String(r['GRD'] ?? '').trim();
    if (!grd) return;
    const pci = Number(r['Punto Corte Inferior'] ?? 0);
    const pcs = Number(r['Punto Corte Superior'] ?? 0);
    if (Number.isFinite(pci) && Number.isFinite(pcs)) dict.set(grd, { pci, pcs });
  });
  return dict;
}

async function downloadExcelPublic(url) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    // si el CDN fuerza redirects, permitirlos:
    maxRedirects: 5,
  });
  return data; // Buffer
}


async function loadMinsalNorma() {
  const url = process.env.MINSAL_GRD_URL ||
    'https://uccl0-my.sharepoint.com/:x:/g/personal/pcguzman_uc_cl/EXs0QNqv_WdGpuf27_7dEj8BL_yZuFYkRD-wXVVJV1ZxEw?e=y7D1AR';

  const refreshHours = Number(process.env.MINSAL_REFRESH_HOURS || 24);
  const expired = !GRD_RULES || !LAST_LOAD ||
    (Date.now() - LAST_LOAD.getTime()) > refreshHours * 3600 * 1000;

  if (!expired) return GRD_RULES;

  const bin = await downloadExcelPublic(url);
  const wb = XLSX.read(bin, { type: 'buffer', cellDates: true });
  GRD_RULES = parseWorkbookToRules(wb);
  LAST_LOAD = new Date();
  console.log(`✅ Reglas GRD cargadas: ${GRD_RULES.size}`);
  return GRD_RULES;
}

module.exports = { loadMinsalNorma };

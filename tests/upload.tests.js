const request = require('supertest');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

jest.setTimeout(20000);

const router = require('./upload'); // router under test

const tmpFiles = [];

function createTempFileName(ext = '.csv') {
  const name = `upload-test-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  return path.join(os.tmpdir(), name);
}

async function writeCsv(content) {
  const p = createTempFileName('.csv');
  await fs.promises.writeFile(p, content, 'utf8');
  tmpFiles.push(p);
  return p;
}

async function writeXlsx(jsonArray) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(jsonArray);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const p = createTempFileName('.xlsx');
  XLSX.writeFile(wb, p);
  tmpFiles.push(p);
  return p;
}

afterAll(async () => {
  // cleanup temp files
  await Promise.all(tmpFiles.map(async (f) => {
    try { if (fs.existsSync(f)) await fs.promises.unlink(f); } catch (_) {}
  }));
  // try remove uploads and logs created by multer/audit (best effort)
  try {
    const base = path.join(__dirname, '..', '..');
    const uploads = path.join(__dirname, '..', '..', 'uploads');
    const logs = path.join(__dirname, '..', '..', 'logs');
    if (fs.existsSync(uploads)) {
      const files = await fs.promises.readdir(uploads);
      await Promise.all(files.map(n => fs.promises.unlink(path.join(uploads, n))));
      await fs.promises.rmdir(uploads);
    }
    if (fs.existsSync(logs)) {
      const files = await fs.promises.readdir(logs);
      await Promise.all(files.map(n => fs.promises.unlink(path.join(logs, n))));
      await fs.promises.rmdir(logs);
    }
    // attempt to remove temporary uploaded files in project root upload folder if any
  } catch (_) {}
});

describe('POST /api/upload (upload router)', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api', router);
  });

  test('procesa CSV válido y devuelve fila válida', async () => {
    const csv = [
      'RUT,fecha ingreso,diagnostico,edad,sexo',
      '12345678-9,2020-01-01,C01,30,M'
    ].join('\n');
    const p = await writeCsv(csv);

    const res = await request(app)
      .post('/api/upload')
      .attach('file', p);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('valid_rows', 1);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toHaveProperty('paciente_id', '12345678-9');
  });

  test('reporte de errores por datos faltantes o inválidos', async () => {
    // edad vacío y sexo inválido -> Joi should flag error
    const csv = [
      'RUT,fecha ingreso,diagnostico,edad,sexo',
      '87654321-0,2020-02-02,C02,,X'
    ].join('\n');
    const p = await writeCsv(csv);

    const res = await request(app)
      .post('/api/upload')
      .attach('file', p);

    expect(res.status).toBe(200);
    // Should include errors array with at least one item
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(1);
    const err = res.body.errors[0];
    expect(err).toHaveProperty('row');
    expect(err).toHaveProperty('error');
    expect(err).toHaveProperty('data');
    // Additionally, response may include warnings object indicating row errors
    expect(res.body).toHaveProperty('warnings');
    expect(res.body.warnings).toHaveProperty('error_count');
    expect(res.body.warnings.error_count).toBeGreaterThanOrEqual(1);
  });

  test('advierte sobre columnas desconocidas en la estructura', async () => {
    // Header contains unknown column 'foo' and missing required columns
    const csv = [
      'foo,bar',
      '1,2'
    ].join('\n');
    const p = await writeCsv(csv);

    const res = await request(app)
      .post('/api/upload')
      .attach('file', p);

    expect(res.status).toBe(200);
    // structure_warnings should be present because validateColumnStructure emits warnings
    expect(res.body).toHaveProperty('structure_warnings');
    expect(res.body.structure_warnings).toHaveProperty('warning_count');
    expect(res.body.structure_warnings.warning_count).toBeGreaterThanOrEqual(1);
  });

  test('detecta duplicados por paciente_id y los omite', async () => {
    const csv = [
      'RUT,fecha ingreso,diagnostico,edad,sexo',
      'dup-1,2021-01-01,C03,40,M',
      'dup-1,2021-01-02,C04,50,M'
    ].join('\n');
    const p = await writeCsv(csv);

    const res = await request(app)
      .post('/api/upload')
      .attach('file', p);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('omitted_duplicates');
    expect(res.body.omitted_duplicates).toHaveProperty('count');
    expect(res.body.omitted_duplicates.count).toBe(1);
    expect(res.body.summary.valid_rows).toBe(1);
  });

  test('procesa archivo Excel (.xlsx) y devuelve datos', async () => {
    const rows = [
      { 'RUT': 'xls-1', 'fecha ingreso': '2022-03-03', 'diagnostico': 'C05', 'edad': 60, 'sexo': 'F' }
    ];
    const p = await writeXlsx(rows);

    const res = await request(app)
      .post('/api/upload')
      .attach('file', p);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.summary.valid_rows).toBe(1);
    expect(res.body.data[0]).toHaveProperty('paciente_id', 'xls-1');
  });
});
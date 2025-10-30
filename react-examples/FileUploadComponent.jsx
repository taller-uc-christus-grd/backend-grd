import React, { useState } from 'react';
import axios from 'axios';

const FileUploadComponent = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      // Validar tipo de archivo
      const allowedTypes = [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ];
      
      if (!allowedTypes.includes(selectedFile.type) && 
          !selectedFile.name.match(/\.(csv|xlsx|xls)$/i)) {
        setError('Solo se permiten archivos CSV y Excel');
        return;
      }
      
      // Validar tamaño (10MB)
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError('El archivo es demasiado grande. Máximo 10MB');
        return;
      }
      
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Por favor selecciona un archivo');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post('http://localhost:3000/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        // Timeout de 30 segundos
        timeout: 30000,
      });

      setResult(response.data);
      console.log('Upload exitoso:', response.data);
      
    } catch (err) {
      console.error('Error en upload:', err);
      setError(
        err.response?.data?.message || 
        err.response?.data?.error || 
        'Error al subir el archivo'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setUploading(false);
  };

  return (
    <div className="file-upload-container">
      <h2>📁 Carga de Archivos Clínicos - UC Christus</h2>
      
      <div className="upload-section">
        <div className="file-input-container">
          <input
            type="file"
            id="file-input"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            disabled={uploading}
            style={{ display: 'none' }}
          />
          <label htmlFor="file-input" className="file-input-label">
            {file ? file.name : 'Seleccionar archivo CSV/Excel'}
          </label>
        </div>

        {file && (
          <div className="file-info">
            <p><strong>Archivo:</strong> {file.name}</p>
            <p><strong>Tamaño:</strong> {(file.size / 1024).toFixed(2)} KB</p>
            <p><strong>Tipo:</strong> {file.type || 'No especificado'}</p>
          </div>
        )}

        <div className="button-container">
          <button 
            onClick={handleUpload} 
            disabled={!file || uploading}
            className="upload-button"
          >
            {uploading ? '⏳ Procesando...' : '📤 Subir Archivo'}
          </button>
          
          <button 
            onClick={handleReset}
            disabled={uploading}
            className="reset-button"
          >
            🔄 Limpiar
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <h3>❌ Error</h3>
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="result-container">
          <h3>✅ Resultado del Procesamiento</h3>
          
          <div className="summary">
            <h4>📊 Resumen</h4>
            <ul>
              <li><strong>Archivo:</strong> {result.summary.file_name}</li>
              <li><strong>Tamaño:</strong> {(result.summary.file_size / 1024).toFixed(2)} KB</li>
              <li><strong>Filas totales:</strong> {result.summary.total_rows}</li>
              <li><strong>Filas válidas:</strong> {result.summary.valid_rows}</li>
              <li><strong>Filas con errores:</strong> {result.summary.invalid_rows}</li>
              <li><strong>Procesado:</strong> {new Date(result.summary.processed_at).toLocaleString()}</li>
            </ul>
          </div>

          {result.data && result.data.length > 0 && (
            <div className="data-preview">
              <h4>👥 Datos Procesados (Primeros 5 registros)</h4>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Paciente ID</th>
                      <th>Diagnóstico</th>
                      <th>Edad</th>
                      <th>Sexo</th>
                      <th>Ingreso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.slice(0, 5).map((record, index) => (
                      <tr key={index}>
                        <td>{record.paciente_id}</td>
                        <td>{record.diagnostico_principal}</td>
                        <td>{record.edad}</td>
                        <td>{record.sexo}</td>
                        <td>{new Date(record.fecha_ingreso).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.errors && result.errors.length > 0 && (
            <div className="errors-section">
              <h4>⚠️ Errores Encontrados</h4>
              <ul>
                {result.errors.slice(0, 5).map((error, index) => (
                  <li key={index}>
                    <strong>Fila {error.row}:</strong> {error.error}
                  </li>
                ))}
                {result.errors.length > 5 && (
                  <li>... y {result.errors.length - 5} errores más</li>
                )}
              </ul>
            </div>
          )}

          {result.warnings && (
            <div className="warnings-section">
              <h4>⚠️ Advertencias</h4>
              <p>{result.warnings.message}</p>
              <p>Errores encontrados: {result.warnings.error_count}</p>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .file-upload-container {
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          font-family: Arial, sans-serif;
        }

        .upload-section {
          border: 2px dashed #ccc;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin: 20px 0;
        }

        .file-input-label {
          display: inline-block;
          padding: 12px 24px;
          background-color: #007bff;
          color: white;
          border-radius: 4px;
          cursor: pointer;
          transition: background-color 0.3s;
        }

        .file-input-label:hover {
          background-color: #0056b3;
        }

        .file-info {
          margin: 15px 0;
          padding: 10px;
          background-color: #f8f9fa;
          border-radius: 4px;
          text-align: left;
        }

        .button-container {
          margin: 15px 0;
        }

        .upload-button, .reset-button {
          margin: 0 10px;
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
        }

        .upload-button {
          background-color: #28a745;
          color: white;
        }

        .upload-button:disabled {
          background-color: #6c757d;
          cursor: not-allowed;
        }

        .reset-button {
          background-color: #6c757d;
          color: white;
        }

        .error-message {
          background-color: #f8d7da;
          color: #721c24;
          padding: 15px;
          border-radius: 4px;
          margin: 15px 0;
        }

        .result-container {
          background-color: #d4edda;
          color: #155724;
          padding: 20px;
          border-radius: 4px;
          margin: 20px 0;
        }

        .summary ul {
          list-style: none;
          padding: 0;
        }

        .summary li {
          margin: 5px 0;
        }

        .table-container {
          overflow-x: auto;
          margin: 15px 0;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin: 10px 0;
        }

        th, td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
        }

        th {
          background-color: #f2f2f2;
        }

        .errors-section, .warnings-section {
          background-color: #fff3cd;
          color: #856404;
          padding: 15px;
          border-radius: 4px;
          margin: 15px 0;
        }

        .errors-section ul {
          margin: 10px 0;
        }
      `}</style>
    </div>
  );
};

export default FileUploadComponent;

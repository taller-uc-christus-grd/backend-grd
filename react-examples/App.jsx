import React from 'react';
import FileUploadComponent from './FileUploadComponent';

function App() {
  return (
    <div className="App">
      <header style={{ 
        backgroundColor: '#1e3a8a', 
        color: 'white', 
        padding: '20px', 
        textAlign: 'center',
        marginBottom: '20px'
      }}>
        <h1>🏥 Sistema GRD - UC Christus</h1>
        <p>Carga de Archivos Clínicos de Episodios</p>
      </header>
      
      <main>
        <FileUploadComponent />
      </main>
      
      <footer style={{ 
        marginTop: '40px', 
        padding: '20px', 
        backgroundColor: '#f8f9fa', 
        textAlign: 'center',
        borderTop: '1px solid #dee2e6'
      }}>
        <p>© 2024 UC Christus - Sistema de Gestión GRD</p>
      </footer>
    </div>
  );
}

export default App;

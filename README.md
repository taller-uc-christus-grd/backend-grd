# Backend GRD - UC Christus

Backend del Sistema Unificado de Codificación y Facturación GRD para UC Christus. Construido con Node.js, Express, TypeScript y Prisma.

Este backend maneja la autenticación de usuarios, la gestión de episodios clínicos, la carga de archivos ETL desde sistemas externos y la exportación de reportes para FONASA.

## 🚀 Características

- **Autenticación JWT:** Endpoints seguros para `login` y gestión de usuarios por roles.
- **Gestión de Usuarios:** CRUD de usuarios (solo para rol `ADMIN`).
- **Gestión de Episodios:** API REST para crear, leer, actualizar y eliminar episodios clínicos de la base de datos.
- **Carga de Archivo Maestro (ETL):** Endpoint `/api/upload` que recibe archivos (CSV/Excel), los valida contra la base de datos (duplicados, campos requeridos) y guarda los datos en las tablas `Episodio`, `Paciente` y `Grd`.
- **Exportación a Excel:** Endpoint `/api/export` que genera un archivo Excel (`.xlsx`) con el formato requerido por FONASA, consultando los datos directamente desde la base de datos.

## 📋 Requisitos

- Node.js >= 16.0.0
- Una base de datos PostgreSQL

## 🛠️ Instalación y Configuración

1.  Clonar el repositorio:
    ```bash
    git clone <repository-url>
    cd backend-grd
    ```

2.  Instalar dependencias:
    ```bash
    npm install
    ```

3.  Crear el archivo `.env` (copiar de `.env.example`) y configurarlo:
    ```.env
    # URL de conexión a tu base de datos PostgreSQL
    DATABASE_URL="postgresql://<usuario>:<password>@localhost:5432/grd?schema=public"
    
    # Puerto donde correrá el backend (Recomendado: 3000)
    PORT=3000
    
    # Secreto para firmar los JSON Web Tokens
    JWT_SECRET=tu-secreto-muy-seguro-aqui
    
    # Origen del frontend (ej. http://localhost:5173)
    CORS_ORIGIN=http://localhost:5173
    
    # Configuración de Cloudinary para almacenamiento de documentos
    CLOUDINARY_CLOUD_NAME=tu-cloud-name
    CLOUDINARY_API_KEY=tu-api-key
    CLOUDINARY_API_SECRET=tu-api-secret
    ```

4.  Ejecutar las migraciones de Prisma para crear las tablas en tu DB:
    ```bash
    npm run prisma:migrate
    ```

5.  (Opcional) Poblar la base de datos con datos de prueba:
    ```bash
    npm run seed
    ```

## 🏃‍♂️ Ejecución

```bash
# Modo desarrollo con recarga automática
npm run dev

# Compilar para producción
npm run build

# Ejecutar en producción (después de 'npm run build')
npm run start
```

## ☁️ Configuración en Railway (Producción)

Para que el backend funcione correctamente en Railway, asegúrate de configurar las siguientes variables de entorno en el dashboard de Railway:

1. Ve a tu proyecto en Railway
2. Abre la pestaña **"Variables"**
3. Agrega las siguientes variables:

   - `DATABASE_URL` - URL de conexión a PostgreSQL (Railway la genera automáticamente si usas su servicio de DB)
   - `PORT` - Puerto del servidor (Railway lo configura automáticamente)
   - `JWT_SECRET` - Secreto para firmar tokens JWT
   - `CORS_ORIGIN` - URL del frontend (ej. `https://tu-frontend.com`)
   - `CLOUDINARY_CLOUD_NAME` - Nombre de tu cuenta en Cloudinary
   - `CLOUDINARY_API_KEY` - API Key de Cloudinary
   - `CLOUDINARY_API_SECRET` - API Secret de Cloudinary

**⚠️ Importante:** Después de agregar las variables de Cloudinary, reinicia el servicio en Railway para que los cambios surtan efecto.
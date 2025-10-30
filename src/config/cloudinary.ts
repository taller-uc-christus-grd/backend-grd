import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Sube un archivo (buffer) a Cloudinary
 * @param buffer El buffer del archivo (ej. de req.file.buffer)
 * @param options Opciones de subida
 * @returns Resultado de la subida de Cloudinary
 */
export const uploadToCloudinary = (
  buffer: Buffer,
  options: {
    folder: string;
    public_id: string;
    resource_type?: 'image' | 'video' | 'raw' | 'auto';
  }
) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        ...options,
        resource_type: options.resource_type || 'auto', // auto detecta si es PDF, img, etc.
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result);
      }
    );
    stream.end(buffer);
  });
};

export default cloudinary;
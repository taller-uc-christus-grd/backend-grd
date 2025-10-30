import dotenv from 'dotenv';
dotenv.config();

import app from './app';

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`GRD Backend escuchando en http://localhost:${PORT}`);
});
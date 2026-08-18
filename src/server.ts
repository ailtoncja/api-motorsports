// Entrada só pro dev local (npm run dev / npm start) -- em producao na
// Vercel quem serve o app e api/index.ts, como funcao serverless (nao chama
// listen()).
import { createApp } from './app.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

createApp().listen(PORT, () => {
  console.log(`api-motorsports rodando em http://localhost:${PORT}`);
});

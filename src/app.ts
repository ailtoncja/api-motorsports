import express from 'express';
import seriesRouter from './routes/series.js';

// Fabrica do app Express, separada do listen() -- server.ts (dev local) e
// api/index.ts (funcao serverless da Vercel) usam a mesma instancia sem
// duplicar rotas/middlewares.
export function createApp() {
  const app = express();

  // API de leitura publica -- libera qualquer origem pra poder ser chamada
  // direto do navegador (ex.: pelo frontend do PitStopHub, em outro dominio).
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(seriesRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  return app;
}

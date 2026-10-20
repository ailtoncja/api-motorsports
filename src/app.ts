import express from 'express';
import seriesRouter from './routes/series.js';
import enduranceBrasilRouter from './routes/endurance-brasil.js';
import { baseHeaders, CACHE_NONE, errorHandler, notFound } from './http.js';

export { isAllowedOrigin } from './http.js';

// Fabrica do app Express, separada do listen() -- server.ts (dev local) e
// api/index.ts (funcao serverless da Vercel) usam a mesma instancia sem
// duplicar rotas/middlewares.
export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // CORS (so o PitStopHub), Vary: Origin, headers de seguranca e
  // Cache-Control -- ver src/http.ts.
  app.use(baseHeaders);

  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', CACHE_NONE);
    res.json({ ok: true });
  });

  app.use(seriesRouter);
  app.use(enduranceBrasilRouter);

  app.use((_req, res) => {
    notFound(res, 'Rota não encontrada.');
  });

  app.use(errorHandler);

  return app;
}

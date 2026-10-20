import express from 'express';
import seriesRouter from './routes/series.js';
import enduranceBrasilRouter from './routes/endurance-brasil.js';

// Fabrica do app Express, separada do listen() -- server.ts (dev local) e
// api/index.ts (funcao serverless da Vercel) usam a mesma instancia sem
// duplicar rotas/middlewares.
export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // API de leitura, chamada direto do navegador pelo PitStopHub (outro dominio).
  // So o site (producao, previas da Vercel e dev local) recebe liberacao de CORS;
  // o app Android nao passa por CORS. Outras origens podem ser liberadas por
  // ALLOWED_ORIGINS (separadas por virgula).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(seriesRouter);
  app.use(enduranceBrasilRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  return app;
}

const DEFAULT_ORIGINS = ['https://pitstophub.vercel.app'];
const PREVIEW_ORIGIN = /^https:\/\/pitstophub-[a-z0-9-]+\.vercel\.app$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin: string): boolean {
  const extra = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra].includes(origin) || PREVIEW_ORIGIN.test(origin) || LOCAL_ORIGIN.test(origin);
}

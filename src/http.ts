// CORS, cache e respostas de erro num lugar so -- usados por app.ts e pelas
// rotas. Separado de app.ts pra poder testar sem env var do Supabase.
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

// API de leitura, chamada direto do navegador pelo PitStopHub (outro dominio).
// So o site recebe liberacao de CORS: producao, previas da Vercel DO DONO
// (escopo ailtoncustodiojunior24-8945s-projects -- qualquer conta da Vercel
// consegue criar um projeto "pitstophub-algo", entao so o prefixo nao basta)
// e dev local. O app Android nao passa por CORS. Outras origens podem ser
// liberadas por ALLOWED_ORIGINS (separadas por virgula, origem exata).
const DEFAULT_ORIGINS = ['https://pitstophub.vercel.app'];
const PREVIEW_ORIGIN = /^https:\/\/pitstophub-[a-z0-9-]+-ailtoncustodiojunior24-8945s-projects\.vercel\.app$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin: string): boolean {
  const extra = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra].includes(origin) || PREVIEW_ORIGIN.test(origin) || LOCAL_ORIGIN.test(origin);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// Os dados mudam a cada poucas horas (cron das Edge Functions), entao o CDN
// da Vercel pode segurar a resposta 5 min e servir a velha por ate 1 h
// enquanto revalida. Erro (404/500/400) nunca e cacheado.
export const CACHE_OK = 'public, s-maxage=300, stale-while-revalidate=3600';
export const CACHE_NONE = 'no-store';

// Headers de toda resposta. Vary: Origin sempre (mesmo sem Origin no request):
// a resposta cacheada muda conforme a origem (Access-Control-Allow-Origin),
// entao o CDN precisa separar por Origin -- senao a resposta de um request
// sem Origin (ou de outra origem) seria servida pro site sem o header de CORS.
export const baseHeaders: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Padrao: GET/HEAD com sucesso vai pro cache. Respostas de erro trocam pra
  // no-store (ver notFound/serverError/errorHandler).
  res.setHeader('Cache-Control', req.method === 'GET' || req.method === 'HEAD' ? CACHE_OK : CACHE_NONE);
  next();
};

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export function notFound(res: Response, message: string): void {
  res.setHeader('Cache-Control', CACHE_NONE);
  res.status(404).json({ error: message });
}

// Erro do Supabase/inesperado: detalhe so no log (Vercel), nunca na resposta
// -- a mensagem do PostgREST pode expor nome de tabela/coluna/constraint.
export function serverError(res: Response, context: string, error: unknown): void {
  console.error(`[${context}]`, error);
  res.setHeader('Cache-Control', CACHE_NONE);
  res.status(500).json({ error: 'Erro interno.' });
}

// Ultimo middleware do app. Pega o que o Express repassa com next(err) --
// ex.: URL com encoding quebrado (/series/%E0%A4%A) vira URIError com
// status 400 dentro do Express. Sem isso, o handler padrao do Express
// devolve HTML com stack trace fora de NODE_ENV=production.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = Number(err?.status ?? err?.statusCode);
  res.setHeader('Cache-Control', CACHE_NONE);
  if (status >= 400 && status < 500) {
    res.status(400).json({ error: 'Requisição inválida.' });
    return;
  }
  console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({ error: 'Erro interno.' });
};

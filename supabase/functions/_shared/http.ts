// fetch com timeout, retry e User-Agent honesto, mais um limitador de
// concorrencia por host. Os sites oficiais nao tem API -- isso aqui e o
// minimo pra raspar com educacao (pouca carga, sem se passar por navegador)
// e sem travar a Edge Function num request pendurado.

export const USER_AGENT = 'api-motorsports-sync/2.0 (Supabase Edge Function; +https://github.com/ailtoncja/api-motorsports)';

// Ajustavel so nos testes (pra nao esperar segundos de backoff).
export const HTTP_CONFIG = {
  timeoutMs: 20_000,
  maxAttempts: 3, // 1 tentativa + 2 retries
  retryDelaysMs: [1000, 3000],
  maxRetryAfterMs: 10_000,
  maxConcurrentPerHost: 3,
  gapPerHostMs: 250,
};

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} em ${url}`);
    this.name = 'HttpError';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, res?: Response): number {
  const header = res?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, HTTP_CONFIG.maxRetryAfterMs);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), HTTP_CONFIG.maxRetryAfterMs);
  }
  const delays = HTTP_CONFIG.retryDelaysMs;
  return delays[Math.min(attempt - 1, delays.length - 1)];
}

// Espaca o inicio dos requests pro mesmo host (gapMs) e limita quantos
// rodam ao mesmo tempo (maxConcurrent). Substitui o sleep(1000) fixo entre
// todo request do script antigo: mesma educacao, bem menos tempo parado.
export class HostLimiter {
  private active = 0;
  private queue: (() => void)[] = [];
  private nextStartAt = 0;

  constructor(private readonly maxConcurrent = HTTP_CONFIG.maxConcurrentPerHost, private readonly gapMs = HTTP_CONFIG.gapPerHostMs) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      // A vaga e repassada direto por quem terminar (ver finally), entao
      // `active` nao muda aqui.
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    try {
      const wait = this.nextStartAt - Date.now();
      this.nextStartAt = Math.max(Date.now(), this.nextStartAt) + this.gapMs;
      if (wait > 0) await sleep(wait);
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const limiters = new Map<string, HostLimiter>();

// So pros testes: recria os limitadores com o HTTP_CONFIG atual.
export function resetLimiters(): void {
  limiters.clear();
}

function limiterFor(url: string): HostLimiter {
  const host = new URL(url).host;
  let limiter = limiters.get(host);
  if (!limiter) {
    limiter = new HostLimiter();
    limiters.set(host, limiter);
  }
  return limiter;
}

export interface FetchStats {
  requests: number;
  retries: number;
}

export const fetchStats: FetchStats = { requests: 0, retries: 0 };

// GET de HTML. Retry so em erro de rede/timeout, 429 e 5xx -- 4xx (ex.: 404
// de entry list ainda nao publicado) volta direto como HttpError.
export async function fetchHtml(url: string): Promise<string> {
  return await limiterFor(url).run(async () => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= HTTP_CONFIG.maxAttempts; attempt++) {
      fetchStats.requests++;
      let res: Response | undefined;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(HTTP_CONFIG.timeoutMs),
        });
        if (res.ok) return await res.text();
        await res.body?.cancel();
        lastError = new HttpError(res.status, url);
        if (!isRetryableStatus(res.status)) throw lastError;
      } catch (error) {
        if (error instanceof HttpError && !isRetryableStatus(error.status)) throw error;
        lastError = error instanceof Error && error.name === 'TimeoutError'
          ? new Error(`timeout de ${HTTP_CONFIG.timeoutMs / 1000}s em ${url}`)
          : error;
      }
      if (attempt < HTTP_CONFIG.maxAttempts) {
        fetchStats.retries++;
        await sleep(retryDelayMs(attempt, res));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`falha em ${url}`);
  });
}

// Promise.all com limite de concorrencia, preservando a ordem.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

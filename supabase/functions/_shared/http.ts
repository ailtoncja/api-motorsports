// fetch com timeout, retry e User-Agent honesto, mais um limitador de
// concorrencia por host. Os sites oficiais nao tem API -- isso aqui e o
// minimo pra raspar com educacao (pouca carga, sem se passar por navegador)
// e sem travar a Edge Function num request pendurado. Redirect so dentro do
// mesmo host (no maximo 3) e corpo com teto de tamanho, pra um site
// comprometido nao conseguir mandar o sync pra outro lugar (ex.: rede
// interna) nem estourar a memoria da funcao.

export const USER_AGENT = 'api-motorsports-sync/2.0 (Supabase Edge Function; +https://github.com/ailtoncja/api-motorsports)';

// Ajustavel so nos testes (pra nao esperar segundos de backoff).
export const HTTP_CONFIG = {
  timeoutMs: 20_000,
  maxAttempts: 3, // 1 tentativa + 2 retries
  retryDelaysMs: [1000, 3000],
  maxRetryAfterMs: 10_000,
  maxConcurrentPerHost: 3,
  gapPerHostMs: 250,
  maxRedirects: 3,
  maxBodyBytes: 5 * 1024 * 1024, // 5 MB, ja descomprimido; as paginas raspadas tem ate ~150 KB (2026-10)
};

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} em ${url}`);
    this.name = 'HttpError';
  }
}

// Recusa de seguranca (redirect pra outro host, redirects demais, corpo
// grande demais). Nunca tem retry: tentar de novo daria no mesmo.
export class FetchGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchGuardError';
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

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

// fetch com redirect: 'manual', seguindo no maximo HTTP_CONFIG.maxRedirects
// redirects e so se o destino ficar no mesmo host (e sem cair de https pra
// http). O fetch padrao seguiria ate 20 redirects pra qualquer lugar.
async function fetchSameHost(url: string, signal: AbortSignal): Promise<Response> {
  const origin = new URL(url);
  let current = origin;
  for (let redirects = 0;; redirects++) {
    const res = await fetch(current.href, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal,
    });
    if (!isRedirect(res.status)) return res;
    const location = res.headers.get('location');
    await res.body?.cancel();
    if (!location) throw new FetchGuardError(`redirect ${res.status} sem Location em ${current.href}`);
    if (redirects >= HTTP_CONFIG.maxRedirects) {
      throw new FetchGuardError(`mais de ${HTTP_CONFIG.maxRedirects} redirects a partir de ${url}`);
    }
    const next = new URL(location, current);
    const downgrade = current.protocol === 'https:' && next.protocol !== 'https:';
    if (next.host !== origin.host || !/^https?:$/.test(next.protocol) || downgrade) {
      throw new FetchGuardError(`redirect pra fora de ${origin.host} recusado (${next.protocol}//${next.host}) em ${current.href}`);
    }
    current = next;
  }
}

// Le o corpo em stream e aborta se passar de HTTP_CONFIG.maxBodyBytes (no
// Content-Length declarado ou no que ja chegou). Decodifica como UTF-8, igual
// ao res.text().
async function readTextCapped(res: Response, url: string): Promise<string> {
  const max = HTTP_CONFIG.maxBodyBytes;
  const tooLarge = () => new FetchGuardError(`resposta maior que ${max} bytes em ${url}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    throw tooLarge();
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// GET de HTML. Retry so em erro de rede/timeout, 429 e 5xx -- 4xx (ex.: 404
// de entry list ainda nao publicado) volta direto como HttpError, e recusa de
// seguranca (FetchGuardError) tambem nao tem retry.
export async function fetchHtml(url: string): Promise<string> {
  return await limiterFor(url).run(async () => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= HTTP_CONFIG.maxAttempts; attempt++) {
      fetchStats.requests++;
      let res: Response | undefined;
      try {
        // Um timeout so pra tentativa inteira: redirects + leitura do corpo.
        res = await fetchSameHost(url, AbortSignal.timeout(HTTP_CONFIG.timeoutMs));
        if (res.ok) return await readTextCapped(res, url);
        await res.body?.cancel();
        lastError = new HttpError(res.status, url);
        if (!isRetryableStatus(res.status)) throw lastError;
      } catch (error) {
        if (error instanceof HttpError && !isRetryableStatus(error.status)) throw error;
        if (error instanceof FetchGuardError) throw error;
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

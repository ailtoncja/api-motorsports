// Utilitarios dos testes: leitura de fixture e fetch falso (sem rede).

export function fixture(name: string): string {
  return Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}

export interface FakeRequest {
  url: string;
  method: string;
  body: string | null;
}

export type Route = [RegExp, string | number | ((req: FakeRequest) => Response | Promise<Response>)];

// Troca globalThis.fetch por um que responde com fixtures conforme a URL.
// Devolve as requisicoes feitas e uma funcao pra restaurar o fetch real.
export function fakeFetch(routes: Route[]): { calls: string[]; requests: FakeRequest[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const requests: FakeRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const rawBody = init?.body ?? (request ? await request.clone().text() : null);
    const req: FakeRequest = { url, method, body: typeof rawBody === 'string' ? rawBody : rawBody == null ? null : String(rawBody) };
    calls.push(url);
    requests.push(req);
    for (const [re, body] of routes) {
      if (!re.test(url)) continue;
      if (typeof body === 'number') return new Response('x', { status: body });
      if (typeof body === 'function') return await body(req);
      return new Response(fixture(body), { status: 200 });
    }
    return new Response('nao mapeado', { status: 404 });
  }) as typeof fetch;
  return { calls, requests, restore: () => void (globalThis.fetch = original) };
}

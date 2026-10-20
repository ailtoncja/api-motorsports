// Testes da API (node:test, sem rede): CORS, Cache-Control e respostas de
// erro genericas. Rodar com `npm test`.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { isAllowedOrigin } from '../src/http.js';

describe('isAllowedOrigin', () => {
  test('libera producao, previa do escopo do dono e localhost', () => {
    for (const origin of [
      'https://pitstophub.vercel.app',
      'https://pitstophub-1dynaxpbw-ailtoncustodiojunior24-8945s-projects.vercel.app',
      'https://pitstophub-git-feat-x-ailtoncustodiojunior24-8945s-projects.vercel.app',
      'http://localhost:5173',
      'http://localhost',
      'http://127.0.0.1:3000',
    ]) {
      assert.equal(isAllowedOrigin(origin), true, origin);
    }
  });

  test('recusa projeto "pitstophub-*" de outra conta e qualquer outra origem', () => {
    for (const origin of [
      'https://pitstophub-evil.vercel.app',
      'https://pitstophub-1dynaxpbw-outra-conta-projects.vercel.app',
      'https://pitstophub-x-ailtoncustodiojunior24-8945s-projects.vercel.app.evil.example',
      'https://evil-ailtoncustodiojunior24-8945s-projects.vercel.app',
      'http://pitstophub.vercel.app',
      'https://evil.example',
      'http://localhost.evil.example',
      'null',
    ]) {
      assert.equal(isAllowedOrigin(origin), false, origin);
    }
  });

  test('ALLOWED_ORIGINS libera origem exata extra', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example, https://b.example';
    try {
      assert.equal(isAllowedOrigin('https://b.example'), true);
      assert.equal(isAllowedOrigin('https://c.example'), false);
    } finally {
      delete process.env.ALLOWED_ORIGINS;
    }
  });
});

describe('app', () => {
  let server: Server;
  let postgrest: Server;
  let base: string;

  const listen = async (s: Server) => {
    s.listen(0, '127.0.0.1');
    await new Promise((resolve) => s.once('listening', resolve));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  };

  before(async () => {
    // PostgREST falso: toda consulta volta erro com detalhe interno (nome de
    // tabela), que nunca pode chegar na resposta da API.
    postgrest = createServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: '42P01', message: 'relation "public.gtwc_races_segredo" does not exist' }));
    });
    process.env.SUPABASE_URL = await listen(postgrest);
    process.env.SUPABASE_ANON_KEY = 'chave-de-teste';
    const { createApp } = await import('../src/app.js');
    server = createServer(createApp());
    base = await listen(server);
  });

  after(() => {
    server.close();
    postgrest.close();
  });

  test('origem liberada recebe Access-Control-Allow-Origin; Vary: Origin sempre', async () => {
    const ok = await fetch(`${base}/series`, { headers: { Origin: 'https://pitstophub.vercel.app' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://pitstophub.vercel.app');
    assert.equal(ok.headers.get('vary'), 'Origin');

    const evil = await fetch(`${base}/series`, { headers: { Origin: 'https://pitstophub-evil.vercel.app' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    assert.equal(evil.headers.get('vary'), 'Origin');

    const none = await fetch(`${base}/series`);
    assert.equal(none.headers.get('vary'), 'Origin');
  });

  test('GET com sucesso e cacheavel no CDN', async () => {
    const res = await fetch(`${base}/series`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, s-maxage=300, stale-while-revalidate=3600');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('/health nao e cacheado', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('404 (rota e serie) nao e cacheado', async () => {
    for (const path of ['/nao-existe', '/series/formula-1', '/series/formula-1/races']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 404, path);
      assert.equal(res.headers.get('cache-control'), 'no-store', path);
    }
  });

  test('erro do Supabase vira 500 generico, sem detalhe, nao cacheado', async () => {
    const original = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const res = await fetch(`${base}/series/europe/races`);
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { error: 'Erro interno.' });
      assert.doesNotMatch(text, /segredo|relation/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(logged.length, 1); // o detalhe vai pro log
    } finally {
      console.error = original;
    }
  });

  test('URL com encoding quebrado vira 400 JSON generico (sem stack trace)', async () => {
    const res = await fetch(`${base}/series/%E0%A4%A/races`);
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = await res.json();
    assert.deepEqual(body, { error: 'Requisição inválida.' });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

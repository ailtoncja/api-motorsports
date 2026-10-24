// Sem as env vars do Supabase do PitStopHub, as rotas brasileiras respondem
// 503 e o resto da API continua de pe. Arquivo separado porque o cliente e
// criado uma vez por processo (node --test roda cada arquivo no seu).
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

describe('categorias brasileiras sem configuracao', () => {
  let server: Server;
  let base: string;

  before(async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_ANON_KEY = 'chave-de-teste';
    delete process.env.PITSTOPHUB_SUPABASE_URL;
    delete process.env.PITSTOPHUB_SUPABASE_ANON_KEY;
    const { createApp } = await import('../src/app.js');
    server = createServer(createApp());
    server.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  test('responde 503 sem cache, e /health continua funcionando', async () => {
    for (const path of ['/nascar-brasil', '/nascar-brasil/races', '/porsche-cup/standings', '/porsche-cup/drivers']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 503, path);
      assert.equal(res.headers.get('cache-control'), 'no-store', path);
      assert.deepEqual(await res.json(), { error: 'Categoria temporariamente indisponível.' });
    }
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});

// NASCAR Brasil e Porsche Cup Brasil: as rotas leem o Supabase do PitStopHub
// (tabelas synced_races / synced_standings / standings_detail / race_results).
// PostgREST falso aqui, sem rede.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

type Row = Record<string, unknown>;

const RACES: Row[] = [
  // Temporada velha: nada dela pode aparecer junto com a atual.
  {
    category_id: 'porsche-cup', season: 2025, race_id: 'r01-velha', round: 1, name: 'Interlagos 2025',
    location: 'Interlagos', circuit: null, date: '2025-03-02', starts_at: null, status: 'completed',
    winner: 'Piloto De 2025', official: true, source_url: 'https://porschecupbrasil.com/#etapas',
    source: 'porschecupbrasil.com (planilha oficial no Google Drive)', updated_at: '2025-12-01T00:00:00+00:00',
  },
  {
    category_id: 'porsche-cup', season: 2026, race_id: 'r01-interlagos', round: 1, name: 'Interlagos',
    location: 'Interlagos', circuit: null, date: '2026-03-01', starts_at: null, status: 'completed',
    winner: 'Marçal Muller / Jeff Giassi', official: true, source_url: 'https://porschecupbrasil.com/#etapas',
    source: 'porschecupbrasil.com (planilha oficial no Google Drive)', updated_at: '2026-10-23T20:45:10.982+00:00',
  },
  {
    category_id: 'porsche-cup', season: 2026, race_id: 'r10-interlagos', round: 10, name: 'Interlagos (Endurance)',
    location: 'Interlagos', circuit: null, date: '2026-11-28', starts_at: null, status: 'upcoming',
    winner: null, official: true, source_url: 'https://porschecupbrasil.com/#etapas',
    source: 'porschecupbrasil.com (planilha oficial no Google Drive)', updated_at: '2026-10-23T20:45:10.982+00:00',
  },
  {
    category_id: 'nascar-brasil', season: 2026, race_id: 'r01-santa-cruz', round: 1, name: 'Santa Cruz',
    location: 'Santa Cruz', circuit: null, date: '2026-04-12', starts_at: null, status: 'completed',
    winner: 'Thiago Camilo / Gabriel Casagrande', official: true,
    source_url: 'https://cba.org.br/campeonato/classificacao/330/50/nascar-brasil-sprint-nbsp-race',
    source: 'cba.org.br (classificacao CBA)', updated_at: '2026-10-23T19:31:46.559+00:00',
  },
];

const STANDINGS: Row[] = [
  { category_id: 'porsche-cup', season: 2026, position: 1, name: 'Marçal Muller', team: null, points: 180, as_of_round: 7 },
  { category_id: 'porsche-cup', season: 2026, position: 2, name: 'Jeff Giassi', team: null, points: 150, as_of_round: 7 },
  { category_id: 'porsche-cup', season: 2025, position: 1, name: 'Piloto De 2025', team: null, points: 999, as_of_round: 10 },
  { category_id: 'nascar-brasil', season: 2026, position: 1, name: 'Thiago Camilo', team: null, points: 226, as_of_round: 7 },
];

const STANDINGS_DETAIL: Row[] = [
  { category_id: 'porsche-cup', season: 2026, grp: 'endurance-challenge', position: 1, name: 'Fabio Carbone', team: null, points: 105, as_of_round: 8 },
  { category_id: 'porsche-cup', season: 2026, grp: 'trophy', position: 1, name: 'Peter Ferter', team: null, points: 90, as_of_round: 7 },
  { category_id: 'porsche-cup', season: 2026, grp: 'challenge', position: 1, name: 'Bruno Campos', team: null, points: 110, as_of_round: 7 },
];

const RESULTS: Row[] = [
  {
    category_id: 'porsche-cup', season: 2026, race_id: 'r01-interlagos', session: 'race1', official: true,
    rows: [
      { position: 1, driver: 'Marçal Muller', number: '544', points: 28, status: null },
      { position: null, driver: 'Edu Guedes', number: '9', points: 0, status: 'DQ' },
    ],
  },
  {
    category_id: 'porsche-cup', season: 2025, race_id: 'r01-velha', session: 'race1', official: true,
    rows: [{ position: 1, driver: 'Piloto De 2025', number: '1', points: 28, status: null }],
  },
];

const TABLES: Record<string, Row[]> = {
  synced_races: RACES,
  synced_standings: STANDINGS,
  standings_detail: STANDINGS_DETAIL,
  race_results: RESULTS,
};

function applyFilters(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    if (value.startsWith('eq.')) {
      const wanted = value.slice(3);
      out = out.filter((row) => String(row[key]) === wanted);
    } else if (value === 'not.is.null') {
      out = out.filter((row) => row[key] != null);
    }
  }
  if (params.get('season') === 'not.is.null') out = out.filter((row) => row.season != null);
  const order = params.get('order');
  if (order) {
    const [column, direction] = order.split('.');
    out = [...out].sort((a, b) => {
      const x = a[column] as number | string | null;
      const y = b[column] as number | string | null;
      const cmp = x == null ? -1 : y == null ? 1 : x < y ? -1 : x > y ? 1 : 0;
      return direction === 'desc' ? -cmp : cmp;
    });
  }
  const limit = Number(params.get('limit'));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

describe('categorias brasileiras (NASCAR Brasil e Porsche Cup)', () => {
  let server: Server;
  let postgrest: Server;
  let base: string;

  const listen = async (s: Server) => {
    s.listen(0, '127.0.0.1');
    await new Promise((resolve) => s.once('listening', resolve));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  };

  before(async () => {
    postgrest = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const table = url.pathname.replace('/rest/v1/', '');
      const rows = applyFilters(TABLES[table] ?? [], url.searchParams);
      const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object+json');
      if (wantsObject) {
        if (rows.length === 0) {
          res.writeHead(406, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'PGRST116', message: 'no rows' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/vnd.pgrst.object+json' });
        res.end(JSON.stringify(rows[0]));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    });
    const postgrestUrl = await listen(postgrest);
    process.env.SUPABASE_URL = postgrestUrl;
    process.env.SUPABASE_ANON_KEY = 'chave-de-teste';
    process.env.PITSTOPHUB_SUPABASE_URL = postgrestUrl;
    process.env.PITSTOPHUB_SUPABASE_ANON_KEY = 'chave-de-teste';
    const { createApp } = await import('../src/app.js');
    server = createServer(createApp());
    base = await listen(server);
  });

  after(() => {
    server.close();
    postgrest.close();
  });

  test('a categoria informa temporada, fonte e ultima atualizacao', async () => {
    const res = await fetch(`${base}/porsche-cup`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, 'porsche-cup');
    assert.equal(body.name, 'Porsche Cup Brasil');
    assert.equal(body.season, 2026);
    assert.match(body.source, /porschecupbrasil/);
  });

  test('o calendario traz so a temporada atual, em ordem de rodada', async () => {
    const res = await fetch(`${base}/porsche-cup/races`);
    const races = await res.json();
    assert.deepEqual(races.map((r: { raceId: string }) => r.raceId), ['r01-interlagos', 'r10-interlagos']);
    assert.equal(races[0].winner, 'Marçal Muller / Jeff Giassi');
    assert.equal(races[1].status, 'upcoming');
  });

  test('uma etapa traz o resultado de cada corrida do fim de semana', async () => {
    const res = await fetch(`${base}/porsche-cup/races/r01-interlagos`);
    const race = await res.json();
    assert.equal(race.sessions.length, 1);
    assert.equal(race.sessions[0].session, 'race1');
    assert.deepEqual(race.sessions[0].rows[0], {
      position: 1, driver: 'Marçal Muller', number: '544', points: 28, status: null,
    });
    assert.equal(race.sessions[0].rows[1].status, 'DQ');
  });

  test('etapa de outra temporada nao e encontrada', async () => {
    const res = await fetch(`${base}/porsche-cup/races/r01-velha`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('a classificacao separa as divisoes, na ordem do campeonato', async () => {
    const res = await fetch(`${base}/porsche-cup/standings`);
    const standings = await res.json();
    assert.equal(standings.season, 2026);
    assert.equal(standings.asOfRound, 8);
    assert.deepEqual(standings.drivers.map((c: { classLabel: string }) => c.classLabel), [
      'Sprint Carrera', 'Sprint Challenge', 'Sprint Trophy', 'Endurance Challenge',
    ]);
    assert.equal(standings.drivers[0].entries[0].name, 'Marçal Muller');
    assert.equal(standings.teams, null);
    // nada de 2025 entra na lista da temporada atual
    const names = standings.drivers.flatMap((c: { entries: { name: string }[] }) => c.entries.map((e) => e.name));
    assert.equal(names.includes('Piloto De 2025'), false);
  });

  test('o grid sai dos resultados e da classificacao, sem repetir piloto', async () => {
    const res = await fetch(`${base}/porsche-cup/drivers`);
    const drivers = await res.json();
    const muller = drivers.find((d: { driverId: string }) => d.driverId === 'marcal-muller');
    assert.equal(muller.number, '544');
    assert.deepEqual(muller.classes, ['Sprint Carrera']);
    assert.equal(drivers.filter((d: { name: string }) => d.name === 'Marçal Muller').length, 1);
    assert.equal(drivers.some((d: { name: string }) => d.name === 'Piloto De 2025'), false);
  });

  test('NASCAR Brasil responde com a lista unica de pilotos', async () => {
    const res = await fetch(`${base}/nascar-brasil/standings`);
    const standings = await res.json();
    assert.deepEqual(standings.drivers.map((c: { classLabel: string }) => c.classLabel), ['Geral']);
    assert.equal(standings.drivers[0].entries[0].name, 'Thiago Camilo');

    const races = await (await fetch(`${base}/nascar-brasil/races`)).json();
    assert.equal(races.length, 1);
    assert.equal(races[0].raceId, 'r01-santa-cruz');
  });
});

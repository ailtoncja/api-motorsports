// Testa as funcoes SQL da migracao num Postgres de verdade rodando em
// processo (PGlite, Postgres compilado pra WASM) -- sem Docker nem projeto
// Supabase. Carrega os mesmos .sql do repo, na ordem do README.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.15';

const ROOT = new URL('../../', import.meta.url); // supabase/
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const migration = [...Deno.readDirSync(new URL('migrations/', ROOT))].map((e) => e.name).filter((n) => n.endsWith('_edge_sync.sql'))[0];

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  // roles que o Supabase ja tem (os .sql fazem grant/revoke neles)
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  for (const file of ['schema.sql', 'standings_schema.sql', 'endurance_brasil_schema.sql', `migrations/${migration}`]) {
    await db.exec(read(file));
  }
  return db;
}

async function rpc<T = unknown>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<{ r: T }>(
    `select ${sql} as r`,
    params.map((p) => (typeof p === 'object' && p !== null ? JSON.stringify(p) : p)),
  );
  return res.rows[0].r;
}

const count = async (db: PGlite, sql: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n);

const race = (race_id: string, round: number, date: string, winner: string | null = null) => ({
  race_id,
  round,
  name: race_id,
  location: 'X',
  date,
  winner,
});
const cars = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => ({
      car_number: String(i + 1),
      team_name: `Team ${i}`,
      car: 'GT3',
      class: 'PRO',
      drivers: [{ name: `D${i}`, nationality: null }],
    }),
  );

Deno.test('sql: migracao aplica limpa e pode rodar 2x', async () => {
  const db = await freshDb();
  await db.exec(read(`migrations/${migration}`));
  assertEquals(await count(db, 'public.sync_status'), 0);
  await db.close();
});

Deno.test('sql gtwc: lista vazia e recusada e nada e apagado', async () => {
  const db = await freshDb();
  await rpc(db, `public.sync_gtwc_races('europe', 2026, $1::jsonb)`, [[race('monza', 3, '2026-05-31', 'A')]]);
  await rpc(db, `public.replace_gtwc_entries('europe', 'monza', 'u', $1::jsonb)`, [cars(5)]);
  await rpc(db, `public.replace_gtwc_standings('europe', $1::jsonb)`, [[{
    standing_type: 'drivers',
    class_label: 'Geral',
    position: 1,
    name: 'X',
    points: 10,
  }]]);

  await assertRejects(() => rpc(db, `public.sync_gtwc_races('europe', 2026, '[]'::jsonb)`), Error, 'lista vazia');
  await assertRejects(() => rpc(db, `public.replace_gtwc_entries('europe', 'monza', 'u', '[]'::jsonb)`), Error, 'lista vazia');
  await assertRejects(() => rpc(db, `public.replace_gtwc_standings('europe', '[]'::jsonb)`), Error, 'lista vazia');
  await assertRejects(() => rpc(db, `public.replace_gtwc_entries('europe', 'nao-existe', 'u', $1::jsonb)`, [cars(1)]), Error, 'nao existe');

  assertEquals(await count(db, `public.gtwc_entries where race_id = 'monza'`), 5);
  assertEquals(await count(db, `public.gtwc_standings`), 1);
  await db.close();
});

Deno.test('sql gtwc: insert com erro no meio desfaz o delete (atomico)', async () => {
  const db = await freshDb();
  await rpc(db, `public.sync_gtwc_races('europe', 2026, $1::jsonb)`, [[race('monza', 3, '2026-05-31')]]);
  await rpc(db, `public.replace_gtwc_entries('europe', 'monza', 'u', $1::jsonb)`, [cars(5)]);
  const broken = [...cars(2), { car_number: '9', team_name: null, car: null, class: null, drivers: [] }]; // team_name not null
  await assertRejects(() => rpc(db, `public.replace_gtwc_entries('europe', 'monza', 'u', $1::jsonb)`, [broken]));
  assertEquals(await count(db, `public.gtwc_entries where race_id = 'monza'`), 5);
  await db.close();
});

Deno.test('sql gtwc: winner null mantem o gravado; standings so troca o grupo enviado', async () => {
  const db = await freshDb();
  await rpc(db, `public.sync_gtwc_races('america', 2026, $1::jsonb)`, [[race('sonoma-raceway', 1, '2026-03-29', 'JMF Motorsports')]]);
  await rpc(db, `public.sync_gtwc_races('america', 2026, $1::jsonb)`, [[race('sonoma-raceway', 1, '2026-03-29', null)]]);
  assertEquals(
    (await db.query<{ winner: string }>(`select winner from gtwc_races where race_id = 'sonoma-raceway'`)).rows[0].winner,
    'JMF Motorsports',
  );

  const row = (cls: string, pos: number) => ({
    standing_type: 'teams',
    class_label: cls,
    position: pos,
    name: `${cls}${pos}`,
    points: 100 - pos,
  });
  await rpc(db, `public.replace_gtwc_standings('america', $1::jsonb)`, [[row('Pro', 1), row('Pro', 2), row('Am', 1)]]);
  await rpc(db, `public.replace_gtwc_standings('america', $1::jsonb)`, [[row('Pro', 1)]]); // Am nao veio -> fica
  assertEquals(await count(db, `gtwc_standings where class_label = 'Pro'`), 1);
  assertEquals(await count(db, `gtwc_standings where class_label = 'Am'`), 1);
  await db.close();
});

Deno.test('sql gtwc: virada 2026 -> 2027 limpa vencedor/grid do slug reaproveitado e corridas que sairam', async () => {
  const db = await freshDb();
  await rpc(db, `public.sync_gtwc_races('europe', 2026, $1::jsonb)`, [[
    race('circuit-paul-ricard', 1, '2026-04-12', 'Comtoyou Racing'),
    race('portimao', 10, '2026-10-18', 'GetSpeed'),
  ]]);
  await rpc(db, `public.replace_gtwc_entries('europe', 'circuit-paul-ricard', 'u', $1::jsonb)`, [cars(58)]);
  await rpc(db, `public.replace_gtwc_entries('europe', 'portimao', 'u', $1::jsonb)`, [cars(61)]);
  // outra serie nao pode ser afetada
  await rpc(db, `public.sync_gtwc_races('asia', 2026, $1::jsonb)`, [[race('sepang', 1, '2026-04-05', 'Absolute Racing')]]);

  const result = await rpc<{ stale_deleted: number; entries_reset: number }>(db, `public.sync_gtwc_races('europe', 2027, $1::jsonb)`, [[
    race('circuit-paul-ricard', 1, '2027-04-15'),
    race('imola', 3, '2027-05-21'),
  ]]);
  assertEquals(result.stale_deleted, 1); // portimao (2026, fora do calendario 2027)
  assertEquals(result.entries_reset, 58);
  const pr = (await db.query<{ winner: string | null; date: string; source_url: string | null }>(
    `select winner, date::text as date, source_url from gtwc_races where race_id = 'circuit-paul-ricard'`,
  )).rows[0];
  assertEquals(pr, { winner: null, date: '2027-04-15', source_url: null });
  assertEquals(await count(db, `gtwc_entries where series_id = 'europe'`), 0);
  assertEquals(await count(db, `gtwc_races where series_id = 'europe'`), 2);
  assertEquals(await count(db, `gtwc_races where series_id = 'asia'`), 1);

  // corrida da temporada ATUAL que some do calendario nao e apagada
  await rpc(db, `public.sync_gtwc_races('europe', 2027, $1::jsonb)`, [[race('imola', 3, '2027-05-21')]]);
  assertEquals(await count(db, `gtwc_races where series_id = 'europe'`), 2);
  await db.close();
});

Deno.test('sql gtwc_sync_state: corridas com contagem de carros e tamanho das classificacoes', async () => {
  const db = await freshDb();
  await rpc(db, `public.sync_gtwc_races('europe', 2026, $1::jsonb)`, [[
    race('monza', 3, '2026-05-31', 'A'),
    race('misano', 5, '2026-07-19'),
  ]]);
  await rpc(db, `public.replace_gtwc_entries('europe', 'monza', 'u', $1::jsonb)`, [cars(3)]);
  await rpc(db, `public.replace_gtwc_standings('europe', $1::jsonb)`, [[{
    standing_type: 'drivers',
    class_label: 'Geral',
    position: 1,
    name: 'X',
    points: 10,
  }]]);
  const state = await rpc<{ races: { race_id: string; entries: number; winner: string | null }[]; standings: { rows: number }[] }>(
    db,
    `public.gtwc_sync_state('europe')`,
  );
  assertEquals(state.races.find((r) => r.race_id === 'monza')?.entries, 3);
  assertEquals(state.races.find((r) => r.race_id === 'misano')?.entries, 0);
  assertEquals(state.standings[0].rows, 1);
  await db.close();
});

Deno.test('sql eb: roster atomico, vazio recusado, etapas que sairam do calendario apagadas', async () => {
  const db = await freshDb();
  const teams = [{
    team_id: 'foresti-sports',
    name: 'Foresti Sports',
    team_principal: 'P',
    source_url: 'u',
    drivers: [{ name: 'Lucas Foresti', driverId: 'lucas-foresti' }],
  }];
  const drivers = [{
    driver_id: 'lucas-foresti',
    name: 'Lucas Foresti',
    uf: 'DF',
    class: 'P1',
    team_id: 'foresti-sports',
    source_url: 'u',
  }];
  await rpc(db, `public.replace_eb_roster($1::jsonb, $2::jsonb)`, [teams, drivers]);
  await assertRejects(() => rpc(db, `public.replace_eb_roster($1::jsonb, '[]'::jsonb)`, [teams]), Error, 'vazia');
  // piloto apontando pra equipe inexistente -> FK falha -> nada muda
  await assertRejects(() => rpc(db, `public.replace_eb_roster($1::jsonb, $2::jsonb)`, [teams, [{ ...drivers[0], team_id: 'nao-existe' }]]));
  assertEquals(await count(db, 'eb_drivers'), 1);
  assertEquals(await count(db, 'eb_teams'), 1);

  const ebRace = (race_id: string, date: string, winner: string | null, completed = true) => ({
    race_id,
    round: 1,
    name: race_id,
    location: null,
    date,
    source_url: 'u',
    completed,
    winner,
  });
  await rpc(db, `public.sync_eb_races($1::jsonb)`, [[ebRace('e1', '2026-04-11', 'Foresti Sports'), ebRace('e2', '2026-05-23', null)]]);
  await rpc(db, `public.sync_eb_races($1::jsonb)`, [[ebRace('e1', '2026-04-11', null)]]);
  assertEquals((await db.query<{ winner: string }>(`select winner from eb_races where race_id = 'e1'`)).rows[0].winner, 'Foresti Sports');
  assertEquals(await count(db, 'eb_races'), 1);
  await assertRejects(() => rpc(db, `public.sync_eb_races('[]'::jsonb)`), Error, 'vazia');

  await rpc(db, `public.replace_eb_standings($1::jsonb)`, [[{
    class_label: 'P1',
    position: 1,
    name: 'Lucas Foresti',
    points: 580,
    uf: 'DF',
  }]]);
  await assertRejects(() => rpc(db, `public.replace_eb_standings('[]'::jsonb)`), Error, 'vazia');
  assertEquals(await count(db, 'eb_standings'), 1);
  const state = await rpc<{ teams: number; drivers: number; standings: number }>(db, 'public.eb_sync_state()');
  assertEquals([state.teams, state.drivers, state.standings], [1, 1, 1]);
  await db.close();
});

Deno.test('setup_cron.sql: agenda 5 jobs (idempotente) e chama a funcao com URL/segredo do Vault', async () => {
  const db = await freshDb();
  // Stubs minimos de pg_cron, pg_net e Vault (nao existem no PGlite).
  await db.exec(`
    create schema cron;
    create table cron.job (jobid serial, jobname text unique, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as
      $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid::bigint $$;
    create function cron.unschedule(n text) returns boolean language sql as
      $$ delete from cron.job where jobname = n returning true $$;
    create schema net;
    create table net.calls (url text, headers jsonb, body jsonb, timeout_ms int);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
      returns bigint language sql as
      $$ insert into net.calls values (url, headers, body, timeout_milliseconds); select 1::bigint $$;
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
  `);
  const script = read('setup_cron.sql').split('\n').filter((l) => !/^create extension/i.test(l)).join('\n');
  await db.exec(script);
  await db.exec(script); // rodar de novo nao duplica
  const jobs = (await db.query<{ jobname: string; schedule: string }>(`select jobname, schedule from cron.job order by jobname`)).rows;
  assertEquals(jobs.map((j) => j.jobname), [
    'sync-endurance-brasil-daily',
    'sync-endurance-brasil-weekend',
    'sync-gtwc-america',
    'sync-gtwc-asia',
    'sync-gtwc-europe',
  ]);

  await assertRejects(() => db.query(`select public.invoke_sync_function('sync-endurance-brasil')`), Error, 'Vault');
  await db.exec(`insert into vault.decrypted_secrets values ('project_url', 'https://abc.supabase.co/'), ('sync_secret', 's3cr3t')`);
  await db.query(`select public.invoke_sync_function('sync-gtwc?series=asia')`);
  const call =
    (await db.query<{ url: string; headers: Record<string, string>; timeout_ms: number }>(`select url, headers, timeout_ms from net.calls`))
      .rows[0];
  assertEquals(call.url, 'https://abc.supabase.co/functions/v1/sync-gtwc?series=asia');
  assertEquals(call.headers['x-sync-secret'], 's3cr3t');
  assertEquals(call.timeout_ms, 150000);
  assert(
    !(await db.query<{ a: boolean }>(`select has_function_privilege('anon', 'public.invoke_sync_function(text)', 'execute') as a`)).rows[0]
      .a,
  );
  await db.close();
});

Deno.test('sql: anon/authenticated nao executam as funcoes de escrita', async () => {
  const db = await freshDb();
  const rows = await db.query<{ anon: boolean; svc: boolean }>(
    `select has_function_privilege('anon', 'public.replace_eb_standings(jsonb)', 'execute') as anon,
            has_function_privilege('service_role', 'public.replace_eb_standings(jsonb)', 'execute') as svc`,
  );
  assertEquals(rows.rows[0], { anon: false, svc: true });
  assert(
    !(await db.query<{ a: boolean }>(
      `select has_function_privilege('authenticated', 'public.sync_gtwc_races(text,int,jsonb)', 'execute') as a`,
    )).rows[0].a,
  );
  await db.close();
});

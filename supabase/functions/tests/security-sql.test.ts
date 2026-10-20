// Testa migrations/*_security_review.sql num Postgres em processo (PGlite)
// montado com os grants padrao do Supabase: default privileges do postgres
// no public dando tudo pro anon/authenticated e um schema net (pg_net) do
// supabase_admin com tudo pro PUBLIC -- o estado conferido em producao.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.15';

const ROOT = new URL('../../', import.meta.url); // supabase/
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const migrations = [...Deno.readDirSync(new URL('migrations/', ROOT))].map((e) => e.name).sort();
const edgeSync = migrations.find((n) => n.endsWith('_edge_sync.sql'))!;
const securityReview = migrations.find((n) => n.endsWith('_security_review.sql'))!;
const HTTP_POST = 'net.http_post(text,jsonb,jsonb,jsonb,integer)';

// No PGlite o "postgres" e superuser (no Supabase nao e) -- por isso o acesso
// do postgres ao net e conferido pelo ACL explicito, nao por has_*_privilege.
async function supabaseLikeDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create role supabase_admin; create role supabase_functions_admin;
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

    create schema net authorization supabase_admin;
    set role supabase_admin;
    create table net.http_request_queue (id bigserial primary key, method text, url text, headers jsonb, body bytea, timeout_milliseconds int);
    create table net._http_response (id bigint, status_code int, content text, created timestamptz default now());
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
                                  timeout_milliseconds int default 5000) returns bigint language plpgsql as $$
    declare v_id bigint;
    begin
      insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
      values ('POST', url, headers, convert_to(body::text, 'UTF8'), timeout_milliseconds) returning id into v_id;
      return v_id;
    end $$;
    grant usage on schema net to public, postgres, anon, authenticated, service_role, supabase_functions_admin;
    grant all on net.http_request_queue, net._http_response to public;
    grant all on all sequences in schema net to public;
    reset role;
  `);
  for (const file of ['schema.sql', 'standings_schema.sql', 'endurance_brasil_schema.sql', `migrations/${edgeSync}`]) {
    await db.exec(read(file));
  }
  return db;
}

async function bool(db: PGlite, sql: string): Promise<boolean> {
  return (await db.query<{ r: boolean }>(`select ${sql} as r`)).rows[0].r;
}

// Privilegios dados explicitamente pra um role (sem contar PUBLIC).
async function explicit(db: PGlite, aclSql: string, role: string): Promise<string[]> {
  const res = await db.query<{ p: string }>(
    `select a.privilege_type as p from aclexplode((${aclSql})) a where a.grantee = (select oid from pg_roles where rolname = $1) order by 1`,
    [role],
  );
  return res.rows.map((r) => r.p);
}

async function assertPublicLockedDown(db: PGlite) {
  for (const t of ['gtwc_races', 'gtwc_entries', 'gtwc_standings', 'eb_races', 'eb_teams', 'eb_drivers', 'eb_standings']) {
    for (const role of ['anon', 'authenticated']) {
      assert(await bool(db, `has_table_privilege('${role}', 'public.${t}', 'select')`), `${role} perdeu select em ${t}`);
      for (const priv of ['insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain']) {
        assertEquals(await bool(db, `has_table_privilege('${role}', 'public.${t}', '${priv}')`), false, `${role} ${priv} ${t}`);
      }
    }
    assert(await bool(db, `has_table_privilege('service_role', 'public.${t}', 'insert')`));
  }
  assertEquals(await bool(db, `has_table_privilege('anon', 'public.sync_status', 'select')`), false);
  assertEquals(await bool(db, `has_table_privilege('authenticated', 'public.sync_status', 'select')`), false);
  assert(await bool(db, `has_table_privilege('service_role', 'public.sync_status', 'update')`));
  assert(await bool(db, `has_function_privilege('service_role', 'public.sync_eb_races(jsonb)', 'execute')`));
  assertEquals(await bool(db, `has_function_privilege('anon', 'public.sync_eb_races(jsonb)', 'execute')`), false);
}

Deno.test('security_review: anon/authenticated so com SELECT; sync_status fechado; pode rodar 2x', async () => {
  const db = await supabaseLikeDb();
  try {
    assert(await bool(db, `has_table_privilege('anon', 'public.gtwc_races', 'truncate')`)); // estado de antes
    await db.exec(read(`migrations/${securityReview}`));
    await db.exec(read(`migrations/${securityReview}`));
    await assertPublicLockedDown(db);
  } finally {
    await db.close();
  }
});

Deno.test('security_review: tabela/funcao/sequence futura nasce sem escrita/execute pro anon', async () => {
  const db = await supabaseLikeDb();
  try {
    await db.exec(read(`migrations/${securityReview}`));
    await db.exec(`
      create table public.nova (id int);
      create sequence public.nova_seq;
      create function public.nova_fn() returns int language sql as 'select 1';
    `);
    assert(await bool(db, `has_table_privilege('anon', 'public.nova', 'select')`));
    assertEquals(await bool(db, `has_table_privilege('anon', 'public.nova', 'insert')`), false);
    assertEquals(await bool(db, `has_table_privilege('authenticated', 'public.nova', 'delete')`), false);
    assertEquals(await bool(db, `has_sequence_privilege('anon', 'public.nova_seq', 'usage')`), false);
    assertEquals(await bool(db, `has_function_privilege('anon', 'public.nova_fn()', 'execute')`), false);
    assertEquals(await bool(db, `has_function_privilege('authenticated', 'public.nova_fn()', 'execute')`), false);
    assert(await bool(db, `has_function_privilege('service_role', 'public.nova_fn()', 'execute')`));
  } finally {
    await db.close();
  }
});

Deno.test('security_review: rodando como dono do net, fecha o pg_net e o postgres mantem acesso explicito', async () => {
  const db = await supabaseLikeDb();
  try {
    assert(await bool(db, `has_function_privilege('anon', '${HTTP_POST}', 'execute')`)); // estado de antes
    assertEquals(await explicit(db, `select proacl from pg_proc where oid = '${HTTP_POST}'::regprocedure`, 'postgres'), []);
    await db.exec(read(`migrations/${securityReview}`)); // superuser (como o supabase_admin)

    for (const role of ['anon', 'authenticated']) {
      assertEquals(await bool(db, `has_function_privilege('${role}', '${HTTP_POST}', 'execute')`), false, role);
      assertEquals(await bool(db, `has_table_privilege('${role}', 'net._http_response', 'select')`), false, role);
      assertEquals(await bool(db, `has_table_privilege('${role}', 'net.http_request_queue', 'insert')`), false, role);
      assertEquals(await bool(db, `has_schema_privilege('${role}', 'net', 'usage')`), false, role);
    }
    // service_role nao usa o pg_net (as Edge Functions nao chamam net.*)
    assertEquals(await bool(db, `has_function_privilege('service_role', '${HTTP_POST}', 'execute')`), false);

    // postgres (jobs do cron + invoke_sync_function) com grant explicito,
    // independente do PUBLIC
    for (const role of ['postgres', 'supabase_functions_admin']) {
      assertEquals(await explicit(db, `select proacl from pg_proc where oid = '${HTTP_POST}'::regprocedure`, role), ['EXECUTE'], role);
      assertEquals(
        await explicit(db, `select relacl from pg_class where oid = 'net.http_request_queue'::regclass`, role),
        ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        role,
      );
      assertEquals(await explicit(db, `select relacl from pg_class where oid = 'net._http_response'::regclass`, role), [
        'DELETE',
        'INSERT',
        'SELECT',
        'UPDATE',
      ], role);
      assertEquals(
        await explicit(db, `select relacl from pg_class where oid = 'net.http_request_queue_id_seq'::regclass`, role),
        ['SELECT', 'USAGE'],
        role,
      );
      assertEquals(await explicit(db, `select nspacl from pg_namespace where nspname = 'net'`, role), ['USAGE'], role);
    }
    await assertPublicLockedDown(db);
  } finally {
    await db.close();
  }
});

Deno.test('security_review: rodando como postgres do Supabase (nao dono do net) avisa, nao quebra e fecha o public', async () => {
  const db = await supabaseLikeDb();
  try {
    // "runner" faz o papel do postgres do Supabase: membro do dono das
    // tabelas, mas sem superuser e sem nada no supabase_admin.
    await db.exec(`create role runner; grant postgres to runner;`);
    const warnings: string[] = [];
    await db.exec(`set role runner;`);
    await db.exec(read(`migrations/${securityReview}`), { onNotice: (n) => void warnings.push(`${n.severity}: ${n.message}`) });
    await db.exec(`reset role;`);
    assert(warnings.some((w) => w.startsWith('WARNING: pg_net: runner nao e dono do schema net')), JSON.stringify(warnings));

    // net intocado (no Supabase precisa rodar o bloco como supabase_admin)
    assert(await bool(db, `has_function_privilege('anon', '${HTTP_POST}', 'execute')`));
    assert(await bool(db, `has_table_privilege('anon', 'net._http_response', 'select')`));
    await assertPublicLockedDown(db);
  } finally {
    await db.close();
  }
});

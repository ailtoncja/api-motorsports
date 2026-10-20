-- Revisao de seguranca dos grants (rode DEPOIS de 20261020120000_edge_sync.sql,
-- pelo `supabase db push` ou colando no SQL Editor). Pode rodar de novo.
--
-- Por que: o Supabase da, por padrao, TODOS os privilegios (insert, update,
-- delete, truncate, ...) em toda tabela nova do schema public pro anon e pro
-- authenticated -- quem segura a escrita e so o RLS. Truncate nem passa por
-- RLS. A API so le com a anon key, e quem escreve sao as Edge Functions com a
-- service_role, entao anon/authenticated ficam so com SELECT (e o RLS
-- continua decidindo quais linhas).
--
-- Estado conferido em 2026-10-20 (projeto de producao):
--   * anon/authenticated com arwdDxtm em gtwc_*, eb_* e sync_status;
--   * default privileges do postgres no public: arwdDxtm em tabelas, rwU em
--     sequences e EXECUTE em funcoes pro anon/authenticated;
--   * pg_net (schema net, dono supabase_admin): http_request_queue e
--     _http_response com tudo pro PUBLIC, funcoes com EXECUTE pro PUBLIC e
--     USAGE no schema pro anon/authenticated.

-- ---------------------------------------------------------------------------
-- Tabelas existentes do public
-- ---------------------------------------------------------------------------

-- maintain = privilegio novo do Postgres 17 (VACUUM/ANALYZE/LOCK TABLE...).
revoke insert, update, delete, truncate, references, trigger, maintain
  on all tables in schema public from anon, authenticated;

-- sync_status e so pra monitorar (Edge Functions gravam com a service_role):
-- anon/authenticated nao precisam nem de SELECT (o RLS ja nao tinha policy).
revoke all on public.sync_status from anon, authenticated;

-- Hoje nenhuma funcao do public e executavel pelo anon/authenticated (todas
-- com revoke explicito no edge_sync/setup_cron); isso so garante.
revoke execute on all functions in schema public from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Objetos futuros (default privileges do postgres, que e quem roda as
-- migracoes). Tabela nova continua ganhando SELECT pro anon/authenticated
-- (ainda precisa de RLS + policy pra liberar linhas); escrita, nao.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger, maintain on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, update on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- O EXECUTE pro PUBLIC em funcao nova vem do default GLOBAL do Postgres (nao
-- do schema public), e um default por schema nao consegue tirar o que o
-- global da -- por isso este vai sem "in schema". Vale pra funcoes criadas
-- pelo postgres em qualquer schema: quem precisar chamar ganha grant
-- explicito (como as funcoes do edge_sync ja fazem com a service_role).
alter default privileges for role postgres
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- pg_net (schema net)
-- ---------------------------------------------------------------------------
-- Com o acesso padrao, anon/authenticated podem ler net._http_response (as
-- respostas das Edge Functions) e chamar net.http_post/http_get (o banco faz
-- request pra qualquer URL). Quem precisa do pg_net aqui e so o postgres:
-- os jobs do pg_cron rodam como postgres e chamam
-- public.invoke_sync_function (security definer, dono postgres), que chama
-- net.http_post -- e http_post NAO e security definer, entao roda como
-- postgres e insere em net.http_request_queue.
--
-- Hoje o postgres so tem esse acesso VIA PUBLIC (fora o USAGE no schema).
-- Por isso, antes de tirar do PUBLIC, o postgres (e o
-- supabase_functions_admin, dos Database Webhooks) ganha grant explicito --
-- senao os jobs do cron parariam de funcionar.
--
-- Os objetos do net sao do supabase_admin e os grants pro PUBLIC foram dados
-- por ele; o postgres do Supabase nao e superuser nem tem grant option
-- neles, entao REVOKE/GRANT rodando como postgres viram WARNING e nao fazem
-- nada. O bloco abaixo confere isso antes: se quem roda nao for dono do
-- schema net (ou superuser), avisa e pula -- sem quebrar a migracao.
-- Atencao: o event trigger do Supabase (extensions.grant_pg_net_access)
-- devolve o USAGE no schema net pro anon/authenticated sempre que a
-- extensao pg_net e recriada/atualizada -- se isso acontecer, rode este
-- bloco de novo.
do $$
declare
  v_owner oid;
  v_role text;
begin
  select nspowner into v_owner from pg_namespace where nspname = 'net';
  if v_owner is null then
    raise notice 'pg_net nao instalado (sem schema net) -- nada a fazer';
    return;
  end if;
  if not pg_has_role(current_user, v_owner, 'USAGE') then
    raise warning 'pg_net: % nao e dono do schema net (%) -- grants do net NAO alterados; rode este bloco como %',
      current_user, v_owner::regrole, v_owner::regrole;
    return;
  end if;

  foreach v_role in array array['postgres', 'supabase_functions_admin'] loop
    continue when not exists (select 1 from pg_roles where rolname = v_role);
    execute format('grant usage on schema net to %I', v_role);
    execute format('grant execute on all functions in schema net to %I', v_role);
    execute format('grant usage, select on all sequences in schema net to %I', v_role);
    execute format('grant select, insert, update, delete on net.http_request_queue to %I', v_role);
    execute format('grant select, insert, update, delete on net._http_response to %I', v_role);
  end loop;

  revoke all on net.http_request_queue, net._http_response from public, anon, authenticated;
  revoke all on all sequences in schema net from public, anon, authenticated;
  revoke execute on all functions in schema net from public, anon, authenticated;
  -- PUBLIC tambem: o schema net tem USAGE pro PUBLIC, entao so tirar do
  -- anon/authenticated nao mudaria nada pra eles.
  revoke usage on schema net from public, anon, authenticated;
end
$$;

-- Conferir depois (anon nao pode nada; postgres continua podendo):
--   select has_table_privilege('anon', 'public.gtwc_races', 'insert') as anon_insert,
--          has_table_privilege('anon', 'public.gtwc_races', 'select') as anon_select,
--          has_table_privilege('anon', 'public.sync_status', 'select') as anon_status,
--          has_function_privilege('anon', 'net.http_post(text,jsonb,jsonb,jsonb,integer)', 'execute') as anon_http_post,
--          has_function_privilege('postgres', 'net.http_post(text,jsonb,jsonb,jsonb,integer)', 'execute') as postgres_http_post,
--          has_table_privilege('postgres', 'net.http_request_queue', 'insert') as postgres_queue;

-- Agenda as Edge Functions de sync com pg_cron + pg_net (substitui os
-- GitHub Actions). Rode no SQL Editor do Supabase DEPOIS de:
--   1. aplicar supabase/migrations/20261020120000_edge_sync.sql;
--   2. publicar as funcoes (supabase functions deploy ...) e configurar o
--      secret SYNC_SECRET nelas (ver README, "Migracao para Supabase Edge
--      Functions");
--   3. guardar no Vault os 2 segredos que este script le (troque os valores
--      e rode UMA vez, separado deste script):
--
--        select vault.create_secret('https://SEU_PROJECT_REF.supabase.co', 'project_url');
--        select vault.create_secret('O_MESMO_VALOR_DO_SYNC_SECRET', 'sync_secret');
--
--      (pra trocar depois: select vault.update_secret(id, 'novo valor')
--       from vault.secrets where name = 'sync_secret';)
--
-- Pode rodar de novo: desagenda os jobs com o mesmo nome antes de agendar.
-- Horarios em UTC.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Chama uma Edge Function com o x-sync-secret lido do Vault. A URL e o
-- segredo nunca ficam escritos em cron.job (so o nome da funcao).
-- security definer: so o dono (postgres) le o Vault; ninguem mais executa.
create or replace function public.invoke_sync_function(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sync_secret';
  if v_url is null or v_secret is null then
    raise exception 'faltam os secrets project_url e/ou sync_secret no Vault (ver topo de setup_cron.sql)';
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := '{}'::jsonb,
    -- a funcao pode levar ate ~2 min; o padrao do pg_net (5 s) cortaria a
    -- conexao antes da resposta.
    timeout_milliseconds := 150000
  );
end;
$$;

revoke all on function public.invoke_sync_function(text) from public, anon, authenticated;

-- Remove versoes anteriores dos jobs (idempotente).
select cron.unschedule(jobname)
from cron.job
where jobname in (
  'sync-gtwc-europe',
  'sync-gtwc-america',
  'sync-gtwc-asia',
  'sync-endurance-brasil-daily',
  'sync-endurance-brasil-weekend'
);

-- GTWC: cada serie a cada 3 h, desencontradas 20 min (uma por vez, cada
-- chamada bem abaixo dos 150 s). Incremental: depois da 1a execucao so
-- re-raspa o que e novo (rodada recente/futura), entao rodar mais vezes
-- custa pouco pro site oficial.
select cron.schedule('sync-gtwc-europe', '5 */3 * * *', $$select public.invoke_sync_function('sync-gtwc?series=europe')$$);
select cron.schedule('sync-gtwc-america', '25 */3 * * *', $$select public.invoke_sync_function('sync-gtwc?series=america')$$);
select cron.schedule('sync-gtwc-asia', '45 */3 * * *', $$select public.invoke_sync_function('sync-gtwc?series=asia')$$);

-- Endurance Brasil: 1x/dia de segunda a quinta (06:00 UTC, mesmo horario
-- do Action antigo) e a cada 30 min de sexta a domingo (fim de semana de
-- etapa: vencedor aparece nas noticias logo depois da prova).
select cron.schedule('sync-endurance-brasil-daily', '0 6 * * 1-4', $$select public.invoke_sync_function('sync-endurance-brasil')$$);
select cron.schedule('sync-endurance-brasil-weekend', '*/30 * * * 5,6,0', $$select public.invoke_sync_function('sync-endurance-brasil')$$);

-- Conferir:
--   select jobname, schedule, active from cron.job order by jobname;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select id, status_code, left(content::text, 300), error_msg, created
--     from net._http_response order by created desc limit 20;
--   select category, last_status, last_run_at, last_success_at,
--          consecutive_failures, last_error from public.sync_status;
--
-- Rodar uma vez na hora (sem esperar o cron):
--   select public.invoke_sync_function('sync-gtwc?series=europe');

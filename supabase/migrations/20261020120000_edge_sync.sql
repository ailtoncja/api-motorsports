-- Migracao do sync (GitHub Actions -> Supabase Edge Functions).
-- Rode no SQL Editor do Supabase (ou `supabase db push`), DEPOIS de
-- schema.sql, standings_schema.sql e endurance_brasil_schema.sql. NAO muda
-- nenhuma tabela existente (a API na Vercel continua igual): so cria
-- sync_status e funcoes de gravacao usadas pelas Edge Functions
-- (supabase/functions/sync-gtwc e sync-endurance-brasil).
--
-- Por que funcoes SQL: o script antigo fazia delete + insert em chamadas
-- separadas, sem transacao -- se a raspagem voltasse 0 linhas (site fora
-- do ar, layout mudou), apagava tudo e nao colocava nada no lugar. Cada
-- funcao abaixo roda numa transacao so e RECUSA lista vazia (raise), entao
-- ou troca tudo ou nao mexe em nada.
--
-- Todas podem rodar de novo sem problema (create or replace / if not exists).

-- ---------------------------------------------------------------------------
-- sync_status: 1 linha por categoria (gtwc-europe, gtwc-america, gtwc-asia,
-- endurance-brasil). Lida pra monitorar; escrita so pelas Edge Functions.
-- ---------------------------------------------------------------------------
create table if not exists public.sync_status (
  category text primary key,
  last_run_at timestamptz,
  last_success_at timestamptz, -- ultima execucao sem erro (warning conta como sucesso)
  last_status text check (last_status in ('ok', 'warning', 'error')),
  consecutive_failures int not null default 0,
  last_error text,
  problems jsonb not null default '[]'::jsonb, -- [{ level, code, scope, message, alert }]
  last_duration_ms int,
  season_year int, -- temporada descoberta automaticamente no site
  last_summary jsonb,
  last_alert_key text, -- dedupe de alerta (mesma chave nao repete em 12 h)
  last_alert_at timestamptz
);

alter table public.sync_status enable row level security;
-- Sem policy: anon/authenticated nao leem nem escrevem; so service_role.

-- ---------------------------------------------------------------------------
-- GTWC
-- ---------------------------------------------------------------------------

-- Estado atual de uma serie (pro sync ser incremental): corridas com
-- vencedor/data/quantidade de carros e tamanho de cada classificacao.
create or replace function public.gtwc_sync_state(p_series text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'races', coalesce((
      select jsonb_agg(jsonb_build_object(
        'race_id', r.race_id,
        'winner', r.winner,
        'date', r.date,
        'entries', (select count(*) from public.gtwc_entries e where e.series_id = r.series_id and e.race_id = r.race_id)
      ))
      from public.gtwc_races r
      where r.series_id = p_series
    ), '[]'::jsonb),
    'standings', coalesce((
      select jsonb_agg(jsonb_build_object('standing_type', s.standing_type, 'class_label', s.class_label, 'rows', s.n))
      from (
        select standing_type, class_label, count(*) as n
        from public.gtwc_standings
        where series_id = p_series
        group by standing_type, class_label
      ) s
    ), '[]'::jsonb)
  );
$$;

-- Upsert do calendario de uma serie.
--   winner/source_url null = "nao sei" -> mantem o valor gravado (o sync e
--   incremental e nao re-raspa vencedor de corrida antiga).
--   Mesmo slug com data de OUTRO ano (ex.: circuit-paul-ricard 2026 -> 2027)
--   = corrida nova: zera vencedor/source_url e apaga o grid antigo.
--   Corridas de temporadas anteriores (ano < p_season_year) que nao estao
--   mais no calendario sao apagadas (o grid vai junto, on delete cascade).
--   Corrida da temporada atual que sumiu do calendario NAO e apagada (pode
--   ser so uma raspagem incompleta).
create or replace function public.sync_gtwc_races(p_series text, p_season_year int, p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_upserted int;
  v_entries_reset int;
  v_stale int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'sync_gtwc_races(%): lista vazia -- nada foi alterado', p_series;
  end if;

  delete from public.gtwc_entries e
  using jsonb_to_recordset(p_rows) as n(race_id text, date date), public.gtwc_races g
  where g.series_id = p_series
    and g.race_id = n.race_id
    and e.series_id = g.series_id
    and e.race_id = g.race_id
    and extract(year from g.date) <> extract(year from n.date);
  get diagnostics v_entries_reset = row_count;

  insert into public.gtwc_races as g (series_id, race_id, round, name, location, date, winner, updated_at)
  select p_series, n.race_id, n.round, n.name, n.location, n.date, n.winner, now()
  from jsonb_to_recordset(p_rows) as n(race_id text, round int, name text, location text, date date, winner text)
  on conflict (series_id, race_id) do update set
    round = excluded.round,
    name = excluded.name,
    location = excluded.location,
    date = excluded.date,
    winner = case
      when extract(year from g.date) <> extract(year from excluded.date) then excluded.winner
      else coalesce(excluded.winner, g.winner)
    end,
    source_url = case
      when extract(year from g.date) <> extract(year from excluded.date) then null
      else g.source_url
    end,
    updated_at = now();
  get diagnostics v_upserted = row_count;

  delete from public.gtwc_races g
  where g.series_id = p_series
    and extract(year from g.date) < p_season_year
    and not exists (select 1 from jsonb_to_recordset(p_rows) as n(race_id text) where n.race_id = g.race_id);
  get diagnostics v_stale = row_count;

  return jsonb_build_object('upserted', v_upserted, 'entries_reset', v_entries_reset, 'stale_deleted', v_stale);
end;
$$;

-- Troca o grid de UMA corrida (delete + insert na mesma transacao).
create or replace function public.replace_gtwc_entries(p_series text, p_race_id text, p_source_url text, p_rows jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'replace_gtwc_entries(%, %): lista vazia -- grid atual mantido', p_series, p_race_id;
  end if;
  if not exists (select 1 from public.gtwc_races where series_id = p_series and race_id = p_race_id) then
    raise exception 'replace_gtwc_entries: corrida %/% nao existe em gtwc_races', p_series, p_race_id;
  end if;

  delete from public.gtwc_entries where series_id = p_series and race_id = p_race_id;

  insert into public.gtwc_entries (series_id, race_id, car_number, team_name, car, class, drivers)
  select p_series, p_race_id, n.car_number, n.team_name, n.car, n.class, coalesce(n.drivers, '[]'::jsonb)
  from jsonb_to_recordset(p_rows) as n(car_number text, team_name text, car text, class text, drivers jsonb);
  get diagnostics v_count = row_count;

  update public.gtwc_races set source_url = p_source_url where series_id = p_series and race_id = p_race_id;
  return v_count;
end;
$$;

-- Troca as classificacoes de uma serie. So mexe nos grupos
-- (standing_type, class_label) presentes em p_rows -- um grupo que veio
-- vazio na raspagem simplesmente nao vem, e o que estava gravado fica.
create or replace function public.replace_gtwc_standings(p_series text, p_rows jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'replace_gtwc_standings(%): lista vazia -- classificacao atual mantida', p_series;
  end if;

  delete from public.gtwc_standings s
  using (
    select distinct n.standing_type, n.class_label
    from jsonb_to_recordset(p_rows) as n(standing_type text, class_label text)
  ) k
  where s.series_id = p_series
    and s.standing_type = k.standing_type
    and s.class_label = k.class_label;

  insert into public.gtwc_standings (series_id, standing_type, class_label, position, name, points, updated_at)
  select p_series, n.standing_type, n.class_label, n.position, n.name, n.points, now()
  from jsonb_to_recordset(p_rows) as n(standing_type text, class_label text, position int, name text, points numeric);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Endurance Brasil
-- ---------------------------------------------------------------------------

create or replace function public.eb_sync_state()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'races', coalesce((
      select jsonb_agg(jsonb_build_object('race_id', race_id, 'winner', winner, 'date', date))
      from public.eb_races
    ), '[]'::jsonb),
    'teams', (select count(*) from public.eb_teams),
    'drivers', (select count(*) from public.eb_drivers),
    'standings', (select count(*) from public.eb_standings)
  );
$$;

-- Upsert do calendario + remove etapas que sairam do /calendario (mesmo
-- comportamento do script antigo). winner null = mantem o gravado, salvo
-- se a etapa mudou de ano (slug reaproveitado na temporada seguinte).
create or replace function public.sync_eb_races(p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_upserted int;
  v_stale int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'sync_eb_races: lista vazia -- nada foi alterado';
  end if;

  insert into public.eb_races as g (race_id, round, name, location, date, source_url, completed, winner, updated_at)
  select n.race_id, n.round, n.name, n.location, n.date, n.source_url, coalesce(n.completed, false), n.winner, now()
  from jsonb_to_recordset(p_rows) as n(race_id text, round int, name text, location text, date date, source_url text, completed boolean, winner text)
  on conflict (race_id) do update set
    round = excluded.round,
    name = excluded.name,
    location = excluded.location,
    date = excluded.date,
    source_url = excluded.source_url,
    completed = excluded.completed,
    winner = case
      when extract(year from g.date) <> extract(year from excluded.date) then excluded.winner
      else coalesce(excluded.winner, g.winner)
    end,
    updated_at = now();
  get diagnostics v_upserted = row_count;

  delete from public.eb_races g
  where not exists (select 1 from jsonb_to_recordset(p_rows) as n(race_id text) where n.race_id = g.race_id);
  get diagnostics v_stale = row_count;

  return jsonb_build_object('upserted', v_upserted, 'stale_deleted', v_stale);
end;
$$;

-- Troca equipes + pilotos juntos (pilotos referenciam equipes).
create or replace function public.replace_eb_roster(p_teams jsonb, p_drivers jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_teams int;
  v_drivers int;
begin
  if p_teams is null or jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) = 0 then
    raise exception 'replace_eb_roster: lista de equipes vazia -- roster atual mantido';
  end if;
  if p_drivers is null or jsonb_typeof(p_drivers) <> 'array' or jsonb_array_length(p_drivers) = 0 then
    raise exception 'replace_eb_roster: lista de pilotos vazia -- roster atual mantido';
  end if;

  -- `where true`: o pg-safeupdate do Supabase barra delete sem where.
  delete from public.eb_drivers where true;
  delete from public.eb_teams where true;

  insert into public.eb_teams (team_id, name, team_principal, source_url, drivers, updated_at)
  select n.team_id, n.name, n.team_principal, n.source_url, coalesce(n.drivers, '[]'::jsonb), now()
  from jsonb_to_recordset(p_teams) as n(team_id text, name text, team_principal text, source_url text, drivers jsonb);
  get diagnostics v_teams = row_count;

  insert into public.eb_drivers (driver_id, name, uf, class, team_id, source_url, updated_at)
  select n.driver_id, n.name, n.uf, n.class, n.team_id, n.source_url, now()
  from jsonb_to_recordset(p_drivers) as n(driver_id text, name text, uf text, class text, team_id text, source_url text);
  get diagnostics v_drivers = row_count;

  return jsonb_build_object('teams', v_teams, 'drivers', v_drivers);
end;
$$;

create or replace function public.replace_eb_standings(p_rows jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'replace_eb_standings: lista vazia -- classificacao atual mantida';
  end if;

  delete from public.eb_standings where true;

  insert into public.eb_standings (class_label, position, name, points, uf, updated_at)
  select n.class_label, n.position, n.name, n.points, n.uf, now()
  from jsonb_to_recordset(p_rows) as n(class_label text, position int, name text, points numeric, uf text);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissoes: funcoes em public viram RPC no PostgREST e, por padrao,
-- qualquer role pode executar. So a service_role (Edge Functions) pode.
-- ---------------------------------------------------------------------------
revoke all on function public.gtwc_sync_state(text) from public, anon, authenticated;
revoke all on function public.sync_gtwc_races(text, int, jsonb) from public, anon, authenticated;
revoke all on function public.replace_gtwc_entries(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.replace_gtwc_standings(text, jsonb) from public, anon, authenticated;
revoke all on function public.eb_sync_state() from public, anon, authenticated;
revoke all on function public.sync_eb_races(jsonb) from public, anon, authenticated;
revoke all on function public.replace_eb_roster(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.replace_eb_standings(jsonb) from public, anon, authenticated;

grant execute on function public.gtwc_sync_state(text) to service_role;
grant execute on function public.sync_gtwc_races(text, int, jsonb) to service_role;
grant execute on function public.replace_gtwc_entries(text, text, text, jsonb) to service_role;
grant execute on function public.replace_gtwc_standings(text, jsonb) to service_role;
grant execute on function public.eb_sync_state() to service_role;
grant execute on function public.sync_eb_races(jsonb) to service_role;
grant execute on function public.replace_eb_roster(jsonb, jsonb) to service_role;
grant execute on function public.replace_eb_standings(jsonb) to service_role;

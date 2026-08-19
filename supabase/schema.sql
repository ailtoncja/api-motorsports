-- Execute este script no SQL Editor do Supabase (projeto proprio do
-- api-motorsports, separado do pitstophub).
--
-- gtwc_races: calendario de cada serie (Europe/America/Asia), sincronizado
-- automaticamente por scripts/sync-gtwc.mjs.
--
-- gtwc_entries: grid de cada corrida (time/carro/pilotos), raspado direto da
-- pagina oficial de entry list daquela corrida especifica -- por isso nao
-- existe "roster da temporada + excecao pra corrida grande": cada corrida
-- tem o grid real dela, ponto. So sincronizado pra Europe e America (a Asia
-- so publica entry list em PDF, nao da pra raspar com confianca -- fica de
-- carga manual, ver seed_asia.sql).

create table if not exists public.gtwc_races (
  series_id text not null check (series_id in ('europe', 'america', 'asia')),
  race_id text not null,
  round int,
  name text not null,
  location text,
  date date not null,
  source_url text,
  winner text, -- nome do time vencedor (carros de GT3 tem 2-3 pilotos), null se ainda nao disputada ou sem resultado achado
  updated_at timestamptz not null default now(),
  primary key (series_id, race_id)
);

alter table public.gtwc_races add column if not exists winner text;

create index if not exists gtwc_races_series_idx on public.gtwc_races (series_id);

create table if not exists public.gtwc_entries (
  id uuid primary key default gen_random_uuid(),
  series_id text not null,
  race_id text not null,
  car_number text,
  team_name text not null,
  car text,
  class text,
  drivers jsonb not null default '[]'::jsonb, -- [{ name, nationality }]
  foreign key (series_id, race_id) references public.gtwc_races (series_id, race_id) on delete cascade
);

create index if not exists gtwc_entries_race_idx on public.gtwc_entries (series_id, race_id);

alter table public.gtwc_races enable row level security;
alter table public.gtwc_entries enable row level security;

-- Leitura publica (a API usa a chave anon): qualquer um pode ler.
drop policy if exists "gtwc_races_select_public" on public.gtwc_races;
create policy "gtwc_races_select_public" on public.gtwc_races for select using (true);

drop policy if exists "gtwc_entries_select_public" on public.gtwc_entries;
create policy "gtwc_entries_select_public" on public.gtwc_entries for select using (true);

-- Sem policy de insert/update/delete: por padrao o RLS bloqueia essas
-- operacoes pros roles "anon" e "authenticated". So a service_role (usada
-- pelo scripts/sync-gtwc.mjs via GitHub Actions) ignora RLS e consegue
-- escrever.

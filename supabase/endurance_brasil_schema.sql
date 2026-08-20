-- Execute este script no SQL Editor do Supabase (mesmo projeto do
-- schema.sql do GTWC). Nao altera tabelas gtwc_*.
--
-- Endurance Brasil (endurancebrasiloficial.com.br): calendario, roster de
-- temporada (equipes/pilotos) e classificacao por classe. Diferente do GTWC,
-- o site oficial NAO publica entry list por corrida -- por isso nao existe
-- eb_entries. O vencedor da etapa vem das noticias oficiais (lista numerada
-- da prova ou manchete de vitoria geral), nao da tabela CLASSIFICACAO na
-- pagina da corrida (aquilo e o campeonato da temporada). Times e pilotos
-- sao tabelas proprias (nao vistas derivadas).
--
-- Sincronizado por scripts/sync-endurance-brasil.mjs.

create table if not exists public.eb_races (
  race_id text primary key, -- slug oficial, ex.: 1-etapa-quatro-horas-de-brasilia
  round int,
  name text not null,
  location text,
  date date not null,
  source_url text,
  completed boolean not null default false, -- badge ENCERRADA no /calendario
  winner text, -- nome do time vencedor (geral/P1); null se a etapa ainda nao rolou
  updated_at timestamptz not null default now()
);

create table if not exists public.eb_teams (
  team_id text primary key, -- slug oficial, ex.: foresti-sports
  name text not null,
  team_principal text,
  source_url text,
  drivers jsonb not null default '[]'::jsonb, -- [{ name, driverId }]
  updated_at timestamptz not null default now()
);

create table if not exists public.eb_drivers (
  driver_id text primary key, -- slug oficial, ex.: lucas-foresti
  name text not null,
  uf text, -- estado (DF, SP, ...), nao nacionalidade
  class text, -- P1, GT3, GT4, P2, ...
  team_id text references public.eb_teams (team_id) on delete set null,
  source_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.eb_standings (
  id uuid primary key default gen_random_uuid(),
  class_label text not null, -- P1, GT3, GT4, P2, P2 Light, GT3L, P3, GT4L
  position int not null,
  name text not null,
  points numeric not null,
  uf text,
  updated_at timestamptz not null default now()
);

create index if not exists eb_standings_lookup_idx
  on public.eb_standings (class_label, position);

alter table public.eb_races enable row level security;
alter table public.eb_teams enable row level security;
alter table public.eb_drivers enable row level security;
alter table public.eb_standings enable row level security;

drop policy if exists "eb_races_select_public" on public.eb_races;
create policy "eb_races_select_public" on public.eb_races for select using (true);

drop policy if exists "eb_teams_select_public" on public.eb_teams;
create policy "eb_teams_select_public" on public.eb_teams for select using (true);

drop policy if exists "eb_drivers_select_public" on public.eb_drivers;
create policy "eb_drivers_select_public" on public.eb_drivers for select using (true);

drop policy if exists "eb_standings_select_public" on public.eb_standings;
create policy "eb_standings_select_public" on public.eb_standings for select using (true);

-- Sem policy de insert/update/delete: mesmo padrao do GTWC -- so a
-- service_role (GitHub Actions / scripts/sync-endurance-brasil.mjs) escreve.

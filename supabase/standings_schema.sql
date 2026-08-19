-- Execute este script no SQL Editor do Supabase (mesmo projeto do
-- schema.sql), depois que o schema.sql ja tiver rodado.
--
-- gtwc_standings: classificacao de pilotos e/ou times de cada serie,
-- sincronizada automaticamente por scripts/sync-gtwc.mjs a partir de
-- /standings de cada site oficial. Nem toda serie tem os dois tipos --
-- America nao tem classificacao "geral" de pilotos nem de times em 2026, so
-- classificacao de times dividida por classe (Pro/Pro-Am/Am); ver
-- SERIES_CONFIG no script pra detalhes. class_label existe justamente pra
-- nao misturar classes diferentes numa unica lista de posicoes (foi um
-- "misturar coisas que nao deviam" desse tipo, em outro contexto, que
-- motivou o pitstophub a redesenhar como guarda dado de GT World Challenge).

create table if not exists public.gtwc_standings (
  id uuid primary key default gen_random_uuid(),
  series_id text not null check (series_id in ('europe', 'america', 'asia')),
  standing_type text not null check (standing_type in ('drivers', 'teams')),
  class_label text not null, -- ex.: 'Geral', 'Pro', 'Pro-Am', 'Am'
  position int not null,
  name text not null,
  points numeric not null,
  updated_at timestamptz not null default now()
);

create index if not exists gtwc_standings_lookup_idx
  on public.gtwc_standings (series_id, standing_type, class_label);

alter table public.gtwc_standings enable row level security;

drop policy if exists "gtwc_standings_select_public" on public.gtwc_standings;
create policy "gtwc_standings_select_public" on public.gtwc_standings for select using (true);

-- Sem policy de insert/update/delete: mesmo padrao do schema.sql -- so a
-- service_role (GitHub Actions) escreve.

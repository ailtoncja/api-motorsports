-- Carga manual, unica, dos dados da Asia (a serie que nao tem entry list
-- automatizado -- so PDF no site oficial, ver README.md). Times/pilotos reais
-- da abertura da temporada 2026 em Sepang, levantados via busca na web em
-- ago/2026. Rode uma vez no SQL Editor do Supabase; atualize a mao quando
-- precisar (ex.: proxima corrida, troca de piloto).
--
-- Faz upsert da propria linha de gtwc_races (round 1, Sepang) pra funcionar
-- mesmo se voce rodar este seed ANTES do primeiro sync automatico -- se o
-- sync ja tiver rodado, so atualiza os mesmos campos, sem problema.

insert into public.gtwc_races (series_id, race_id, round, name, location, date, source_url)
values ('asia', 'sepang', 1, 'Sepang International Circuit', 'Sepang, Malásia', '2026-04-04', 'https://www.gt-world-challenge-asia.com/entry-lists')
on conflict (series_id, race_id) do update set
  round = excluded.round,
  name = excluded.name,
  location = excluded.location,
  date = excluded.date;

delete from public.gtwc_entries where series_id = 'asia' and race_id = 'sepang';

insert into public.gtwc_entries (series_id, race_id, car_number, team_name, car, class, drivers) values
  ('asia', 'sepang', '4', 'Origine Motorsport', 'Porsche 911 GT3 R (992.2)', null,
    '[{"name": "Alessio Picariello", "nationality": "Bélgica"}, {"name": "Lu Wei", "nationality": "China"}]'::jsonb),
  ('asia', 'sepang', '5', 'PLUS with BMW M Team Studie', 'BMW M4 GT3 Evo', null,
    '[{"name": "Seiji Ara", "nationality": "Japão"}, {"name": "Tomohide Yamaguchi", "nationality": "Japão"}]'::jsonb),
  ('asia', 'sepang', '13', '33R Harmony Racing', 'Ferrari 296 GT3 Evo', 'Silver-Am',
    '[{"name": "Sun Jingzu", "nationality": "China"}, {"name": "Adderly Fong", "nationality": "Hong Kong"}]'::jsonb),
  ('asia', 'sepang', '77', 'Craft-Bamboo Racing', 'Mercedes-AMG GT3 Evo', null,
    '[{"name": "Liang Jiatong", "nationality": "China"}, {"name": "Dean Chen", "nationality": "China"}]'::jsonb);

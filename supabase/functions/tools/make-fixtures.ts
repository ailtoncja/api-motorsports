// Regera as fixtures de teste (supabase/functions/tests/fixtures/) a partir
// das paginas reais, cortadas so no que os parsers leem (selects, itens de
// calendario, primeiras linhas das tabelas). As URLs aqui SAO fixas de
// proposito (temporada 2026) -- os testes afirmam fatos dessas paginas.
// Se regerar numa outra data, os fatos dos testes podem mudar.
//
//   deno run -A supabase/functions/tools/make-fixtures.ts

import { cheerio } from '../_shared/deps.ts';
import { fetchHtml } from '../_shared/http.ts';

const OUT = new URL('../tests/fixtures/', import.meta.url);
const EU = 'https://www.gt-world-challenge-europe.com';
const AM = 'https://www.gt-world-challenge-america.com';
const AS = 'https://www.gt-world-challenge-asia.com';
const EB = 'https://endurancebrasiloficial.com.br';
const SELECTS = '#filter_season_id, #filter_meeting_id, #filter_race_id, #filter_standing_type, #season_select';

interface Spec {
  file: string;
  url: string;
  keep: string; // seletor dos elementos mantidos (outerHTML)
  maxRows?: number; // corta <tbody> das tabelas
  limit?: number; // maximo de elementos de `keep`
}

const SPECS: Spec[] = [
  { file: 'gtwc-europe-calendar.html', url: `${EU}/calendar`, keep: '.calendar__list-item, .past-events__list-item' },
  // Calendario 2027 ja publicado (usado pra simular a virada de temporada).
  {
    file: 'gtwc-europe-calendar-2027.html',
    url: `${EU}/calendar?filter_season_id=27`,
    keep: '.calendar__list-item, .past-events__list-item',
  },
  { file: 'gtwc-america-calendar.html', url: `${AM}/calendar`, keep: '.calendar__list-item, .past-events__list-item' },
  { file: 'gtwc-asia-calendar.html', url: `${AS}/calendar`, keep: '.calendar__list-item, .past-events__list-item' },
  { file: 'gtwc-europe-standings-teams.html', url: `${EU}/standings`, keep: `${SELECTS}, table`, maxRows: 6 },
  {
    file: 'gtwc-europe-standings-drivers.html',
    url: `${EU}/standings?filter_season_id=26&filter_standing_type=0_0_drivers`,
    keep: 'table',
    maxRows: 6,
  },
  { file: 'gtwc-america-standings.html', url: `${AM}/standings`, keep: `${SELECTS}, table`, maxRows: 6 },
  { file: 'gtwc-asia-standings.html', url: `${AS}/standings`, keep: `${SELECTS}, table`, maxRows: 6 },
  { file: 'gtwc-europe-results-portimao.html', url: `${EU}/results?filter_season_id=26&filter_meeting_id=255`, keep: SELECTS },
  { file: 'gtwc-europe-results-brands-hatch.html', url: `${EU}/results?filter_season_id=26&filter_meeting_id=247`, keep: SELECTS },
  {
    file: 'gtwc-europe-results-portimao-main-race.html',
    url: `${EU}/results?filter_season_id=26&filter_meeting_id=255&filter_race_id=1824`,
    keep: 'table',
    maxRows: 4,
  },
  {
    file: 'gtwc-america-results-indianapolis-race.html',
    url: `${AM}/results?filter_season_id=11&filter_meeting_id=117&filter_race_id=598`,
    keep: 'table',
    maxRows: 4,
  },
  { file: 'gtwc-asia-results-beijing.html', url: `${AS}/results?filter_season_id=10&filter_meeting_id=83`, keep: SELECTS },
  {
    file: 'gtwc-asia-results-beijing-race1.html',
    url: `${AS}/results?filter_season_id=10&filter_meeting_id=83&filter_race_id=499`,
    keep: 'table',
    maxRows: 4,
  },
  { file: 'gtwc-europe-entry-list-portimao.html', url: `${EU}/entry-list/2026/portimao`, keep: 'table', maxRows: 5 },
  { file: 'gtwc-america-entry-list-indianapolis.html', url: `${AM}/entry-list/2026/indianpolis-8-hour`, keep: 'table', maxRows: 5 },
  { file: 'eb-calendario.html', url: `${EB}/calendario`, keep: '.row.calendario, #season_select' },
  { file: 'eb-classificacao.html', url: `${EB}/classificacao`, keep: 'script:contains("season_classifications"), #season_select' },
  { file: 'eb-equipes.html', url: `${EB}/equipes`, keep: '.card:has(a[href*="/equipe/"]), #season_select', limit: 4 },
  { file: 'eb-pilotos.html', url: `${EB}/pilotos`, keep: '.pilot, #season_select', limit: 7 },
  { file: 'eb-noticias.html', url: `${EB}/noticias`, keep: '.card:has(a[href*="/noticia/"])', limit: 8 },
  { file: 'eb-noticia-etapa6.html', url: `${EB}/noticia/em-interlagos-elias-e-rosario-superam-adversidades`, keep: 'ol' },
];

function trim(html: string, spec: Spec): string {
  const $ = cheerio.load(html);
  if (spec.maxRows) $('table tbody').each((_, tb) => void $(tb).find('tr').slice(spec.maxRows).remove());
  // Tira scripts/estilos dentro do que vai ser mantido (exceto o script que
  // e o proprio alvo, no caso da classificacao do EB).
  const kept = $(spec.keep).toArray().filter((el) => $(el).parents(spec.keep).length === 0);
  const parts = (spec.limit ? kept.slice(0, spec.limit) : kept).map((el) => {
    const $el = $(el);
    if ((el as { tagName?: string }).tagName !== 'script') $el.find('script, style, svg').remove();
    return $.html($el);
  });
  return `<!-- fonte: ${spec.url} (cortado por tools/make-fixtures.ts em ${new Date().toISOString().slice(0, 10)}) -->\n<html><body>\n${
    parts.join('\n')
  }\n</body></html>\n`;
}

await Deno.mkdir(OUT, { recursive: true });
for (const spec of SPECS) {
  const html = await fetchHtml(spec.url);
  const out = trim(html, spec);
  await Deno.writeTextFile(new URL(spec.file, OUT), out);
  console.log(`${spec.file}: ${(out.length / 1024).toFixed(1)} KB`);
}

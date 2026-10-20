// Parsers puros (HTML -> dados) do GT World Challenge. Port fiel de
// scripts/sync-gtwc.mjs, sem rede nem banco -- por isso da pra testar com
// fixtures salvas (supabase/functions/tests/fixtures/).
//
// Novidade em relacao ao script antigo: descoberta automatica de temporada.
// Nada de YEAR/season id/param de standings fixo no codigo -- tudo sai dos
// <select> que os proprios sites usam (ver parseSeasonOptions e
// pickStandingOptions).

import { cheerio, type CheerioAPI } from './deps.ts';
import { codeToCountry } from './country-codes.ts';

export type SeriesId = 'europe' | 'america' | 'asia';

export interface CalendarRace {
  round: number;
  // Rodadas cobertas pelo evento. Asia anuncia "Round 1 & 2" (duas corridas
  // num fim de semana) -- `round` continua sendo a primeira (1 linha por
  // evento em gtwc_races, chave = slug), `rounds` guarda todas.
  rounds: number[];
  raceId: string;
  eventId: string;
  name: string;
  location: string | null;
  date: string | null; // inicio do evento, YYYY-MM-DD
  endDate: string | null; // fim do evento (so pra logica de "ja acabou")
}

export interface EntryDriver {
  name: string;
  nationality: string | null;
}

export interface Entry {
  carNumber: string | null;
  teamName: string;
  car: string | null;
  class: string | null;
  drivers: EntryDriver[];
}

export interface StandingRow {
  position: number;
  name: string;
  points: number;
}

export interface SeasonOption {
  id: string;
  year: number;
  selected: boolean;
}

export interface StandingOption {
  param: string;
  label: string;
  standingType: 'drivers' | 'teams';
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

export function buildDate(
  day: string | number | undefined,
  monthText: string | undefined,
  year: string | number | undefined,
): string | null {
  const month = MONTHS[(monthText ?? '').slice(0, 3).toLowerCase()];
  if (!month || !day || !year) return null;
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

// "Round 1" -> [1]; "Round 1 & 2" / "Round 11 & 12" -> [1, 2] / [11, 12];
// "Round" sozinho (ex.: gala de fim de ano da America) -> [].
export function parseRounds(text: string): number[] {
  const m = text.match(/Round\s+(\d+(?:\s*(?:&|and|,|-)\s*\d+)*)/i);
  if (!m) return [];
  const nums = m[1].split(/\s*(?:&|and|,|-)\s*/i).map(Number).filter(Number.isFinite);
  return [...new Set(nums)];
}

// deno-lint-ignore no-explicit-any
function extractEventLink($el: any): { eventId: string; slug: string } | null {
  const href = $el.find('a[href*="/event/"]').first().attr('href');
  if (!href) return null;
  const m = href.match(/\/event\/(\d+)\/([^/?#]+)/);
  if (!m) return null;
  let slug = m[2];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // slug ja decodificado (ex.: "nürburgring" cru no href)
  }
  return { eventId: m[1], slug };
}

// Rodadas futuras ficam em ".calendar__list-item" (dia/mes/ano em spans
// separados de inicio e fim). Rodadas ja disputadas migram pra
// ".past-events__list-item" (data como uma string so, tipo "10 - 12 April
// 2026" ou "30 July 2026 - 2 August 2026"). As duas sao lidas; test days e
// prologues ficam de fora por nao terem "Round N" no texto.
function parseUpcomingItems($: CheerioAPI): CalendarRace[] {
  const races: CalendarRace[] = [];
  $('.calendar__list-item').each((_, el) => {
    const $el = $(el);
    const roundText = $el.find('.calendar__race-text').first().text().trim();
    const rounds = parseRounds(roundText);
    if (rounds.length === 0) return;
    const link = extractEventLink($el);
    if (!link) return;
    const part = (sel: string, field: string) => $el.find(`${sel} .calendar__date-${field}`).first().text().trim();
    const date = buildDate(
      part('.calendar__date-start', 'number'),
      part('.calendar__date-start', 'month'),
      part('.calendar__date-start', 'year'),
    );
    const endDate = buildDate(
      part('.calendar__date-end', 'number'),
      part('.calendar__date-end', 'month'),
      part('.calendar__date-end', 'year'),
    );
    races.push({
      round: rounds[0],
      rounds,
      raceId: link.slug,
      eventId: link.eventId,
      name: $el.find('.calendar__race-header').first().text().trim(),
      location: $el.find('.calendar__race-subheading-text').first().text().trim() || null,
      date,
      endDate: endDate ?? date,
    });
  });
  return races;
}

// `date` usa EXATAMENTE a regex do script antigo (pra API continuar
// devolvendo as mesmas datas): em faixa no mesmo mes ela pega o dia final
// ("10 - 12 April 2026" -> 2026-04-12), em faixa que cruza mes pega o
// inicial ("30 July 2026 - 2 August 2026" -> 2026-07-30). `endDate` e
// sempre o ultimo dia (2026-04-12 / 2026-08-02) e so serve pra logica de
// "evento ja acabou".
export function parsePastDateRange(text: string): { date: string | null; endDate: string | null } {
  const start = text.match(/(\d{1,2})\D*?([A-Za-z]+)[\s\S]*?(\d{4})/);
  const date = start ? buildDate(start[1], start[2], start[3]) : null;
  const end = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*$/);
  const endDate = end ? buildDate(end[1], end[2], end[3]) : date;
  return { date, endDate: endDate && date && endDate < date ? date : endDate };
}

function parsePastItems($: CheerioAPI): CalendarRace[] {
  const races: CalendarRace[] = [];
  $('.past-events__list-item').each((_, el) => {
    const $el = $(el);
    const spans = $el.find('.past-events__piped-list-span');
    if (spans.length < 3) return;
    const dateText = $(spans[0]).text().trim();
    const rounds = parseRounds($(spans[2]).text().trim());
    if (rounds.length === 0) return;
    const link = extractEventLink($el);
    if (!link) return;
    const name = $(spans[1]).find('strong').first().text().trim();
    const location = $(spans[1]).clone().find('strong').remove().end().text().trim() || null;
    const { date, endDate } = parsePastDateRange(dateText);
    races.push({ round: rounds[0], rounds, raceId: link.slug, eventId: link.eventId, name, location, date, endDate });
  });
  return races;
}

export function parseCalendar(html: string): CalendarRace[] {
  const $ = cheerio.load(html);
  const byRaceId = new Map<string, CalendarRace>();
  for (const race of [...parsePastItems($), ...parseUpcomingItems($)]) {
    if (race.date) byRaceId.set(race.raceId, race);
  }
  return [...byRaceId.values()].sort((a, b) => a.round - b.round);
}

// Ano da temporada mostrada no /calendar = ano mais frequente entre as
// datas das rodadas (robusto a um evento que cruza a virada do ano).
export function calendarSeasonYear(races: CalendarRace[]): number | null {
  const counts = new Map<number, number>();
  for (const race of races) {
    if (!race.date) continue;
    const year = Number(race.date.slice(0, 4));
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [year, count] of counts) {
    if (best == null || count > (counts.get(best) ?? 0) || (count === counts.get(best) && year > best)) best = year;
  }
  return best;
}

// <select id="filter_season_id"> existe em /results e /standings nos 3
// sites: value = id interno da temporada, texto = ano ("2026"). A opcao
// marcada `selected` e a temporada que o site esta mostrando.
export function parseSeasonOptions(html: string): SeasonOption[] {
  const $ = cheerio.load(html);
  const options: SeasonOption[] = [];
  $('#filter_season_id option, select[name="filter_season_id"] option').each((_, opt) => {
    const id = ($(opt).attr('value') ?? '').trim();
    const yearText = $(opt).text().trim();
    if (!/^\d+$/.test(id) || id === '0' || !/^\d{4}$/.test(yearText)) return;
    if (options.some((o) => o.id === id)) return;
    options.push({ id, year: Number(yearText), selected: $(opt).attr('selected') !== undefined });
  });
  return options;
}

// So sessoes de corrida de verdade (nao Practice/Qualifying/Test/Pit Walk,
// nem os checkpoints intermediarios tipo "Main Race after 2h 30" que a
// Europe tambem lista) -- lista positiva em vez de negativa, pra uma sessao
// desconhecida no futuro ficar de fora por padrao em vez de entrar por
// engano.
const RACE_SESSION_RE = /^(main\s+)?race(\s+\d+)?$/i;

export interface RaceSession {
  id: string;
  label: string;
  order: number;
}

export function parseRaceSessionOptions(html: string): RaceSession[] {
  const $ = cheerio.load(html);
  return $('#filter_race_id option')
    .map((_, opt) => ({ id: $(opt).attr('value') ?? '', label: $(opt).text().trim() }))
    .get()
    .filter((o) => o.id && RACE_SESSION_RE.test(o.label))
    .map((o) => ({ ...o, order: Number(o.label.match(/\d+/)?.[0] ?? 0) }))
    .sort((a, b) => a.order - b.order);
}

// Le "Pos"/"Team" por nome de cabecalho (America/Asia/Europe tem ordem de
// coluna diferente) e devolve o time da linha Pos=1.
export function parseSessionWinnerTeam(html: string): string | null {
  const $ = cheerio.load(html);
  const table = $('table').first();
  if (table.length === 0) return null;
  const headers = table.find('thead th').map((_, th) => $(th).text().trim()).get();
  const posIdx = headers.findIndex((h) => /^pos$/i.test(h));
  const teamIdx = headers.findIndex((h) => /^team$/i.test(h));
  if (posIdx === -1 || teamIdx === -1) return null;

  let winner: string | null = null;
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length <= Math.max(posIdx, teamIdx)) return;
    if ($(cells[posIdx]).text().trim() === '1') {
      winner = $(cells[teamIdx]).text().trim() || null;
      return false;
    }
  });
  return winner;
}

// Le o cabecalho da tabela (<th>) pra mapear coluna -> significado, em vez
// de assumir posicao fixa -- Europe (Car #, Team, Driver 1/2/3, Car, Class)
// e America (Car #, Driver 1/2/3, Team, Car, Class) usam ordem diferente.
export function parseEntryTable(html: string): Entry[] {
  const $ = cheerio.load(html);
  const table = $('table.table').first();
  if (table.length === 0) return [];
  const headers = table.find('thead th').map((_, th) => $(th).text().trim()).get();
  const carNumberHeader = headers.find((h) => /car\s*#/i.test(h));
  const teamHeader = headers.find((h) => h.trim().toLowerCase() === 'team');
  const carHeader = headers.find((h) => h.trim().toLowerCase() === 'car');
  const classHeader = headers.find((h) => h.trim().toLowerCase() === 'class');
  const driverHeaders = headers.filter((h) => /^Driver \d+$/i.test(h));

  const entries: Entry[] = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length !== headers.length) return;
    const cellByHeader = new Map(headers.map((h, i) => [h, $(cells[i])]));

    const drivers: EntryDriver[] = [];
    for (const header of driverHeaders) {
      const cell = cellByHeader.get(header)!;
      const name = cell.find('.table__text').first().text().trim() || cell.text().trim();
      // Placeholders, nao pilotos de verdade: "/" e o 4o slot vazio em
      // corridas de endurance, e "TBA" e piloto ainda nao confirmado.
      if (!name || name === '/' || /^TBA$/i.test(name)) continue;
      const flagClass = cell.find('[class*="flag"]').first().attr('class') ?? '';
      const codeMatch = flagClass.match(/size--tiny\s+([a-z]+)/i);
      drivers.push({ name, nationality: codeToCountry(codeMatch ? codeMatch[1] : null) });
    }

    const teamName = teamHeader ? cellByHeader.get(teamHeader)!.text().trim() : null;
    if (!teamName || drivers.length === 0) return;

    entries.push({
      carNumber: carNumberHeader ? cellByHeader.get(carNumberHeader)!.text().trim() : null,
      teamName,
      car: carHeader ? cellByHeader.get(carHeader)!.text().trim() : null,
      class: classHeader ? cellByHeader.get(classHeader)!.text().trim() : null,
      drivers,
    });
  });
  return entries;
}

// Le a tabela de /standings. Duas variantes de marcacao: America/Asia tem
// cabecalho real (<thead><th>Pos/Driver ou Team/Total</th>); ja o <thead>
// da Europe so agrupa por corrida -- o rotulo real (POS/DRIVER/TOTAL) vem
// disfarcado de primeira linha do <tbody>. Le por nome de coluna nos dois
// casos e pula essa linha-cabecalho disfarcada.
export function parseStandingsTable(html: string): StandingRow[] {
  const $ = cheerio.load(html);
  const table = $('table.standing, table.table, table').first();
  if (table.length === 0) return [];

  let headers = table.find('thead th').map((_, th) => $(th).text().trim()).get();

  if (!headers.some((h) => /^pos$/i.test(h))) {
    const pseudoHeaderRow = table.find('tbody tr').filter((_, tr) => /^pos$/i.test($(tr).find('td').first().text().trim())).first();
    if (pseudoHeaderRow.length > 0) {
      headers = pseudoHeaderRow.find('td').map((_, td) => $(td).text().trim()).get();
    }
  }

  const posIdx = headers.findIndex((h) => /^pos$/i.test(h));
  const nameIdx = headers.findIndex((h) => /^(driver|team)$/i.test(h));
  const totalIdx = headers.findIndex((h) => /^total$/i.test(h));
  if (posIdx === -1 || nameIdx === -1 || totalIdx === -1) return [];

  const rows: StandingRow[] = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length <= totalIdx) return;
    if (/^pos$/i.test($(cells[0]).text().trim())) return;

    const position = parseInt($(cells[posIdx]).text().trim(), 10);
    const nameCell = $(cells[nameIdx]);
    const name = nameCell.find('a').first().text().trim() || nameCell.text().trim();
    const points = parseFloat($(cells[totalIdx]).text().trim());

    if (!Number.isFinite(position) || !name || !Number.isFinite(points)) return;
    rows.push({ position, name, points });
  });
  return rows;
}

// <select id="filter_standing_type"> de /standings: value tipo "0_0_drivers"
// ou "16_31_teams" (ids internos que mudam de temporada pra temporada),
// texto tipo "GT World Challenge Europe Powered by AWS Drivers".
export function parseStandingOptions(html: string): StandingOption[] {
  const $ = cheerio.load(html);
  const options: StandingOption[] = [];
  $('#filter_standing_type option').each((_, opt) => {
    const param = ($(opt).attr('value') ?? '').trim();
    const label = $(opt).text().replace(/\s+/g, ' ').trim();
    const typeMatch = param.match(/_(drivers|teams)$/i);
    if (!param || !typeMatch) return;
    if (options.some((o) => o.param === param)) return;
    options.push({ param, label, standingType: typeMatch[1].toLowerCase() as 'drivers' | 'teams' });
  });
  return options;
}

export interface StandingTarget {
  standingType: 'drivers' | 'teams';
  classLabel: string;
  param: string;
  label: string;
}

// Palavras que indicam sub-classificacao (copa ou classe de piloto). Uma
// opcao sem nenhuma delas e a classificacao "geral" da temporada.
const SUB_STANDING_RE = /\b(cup|gold|silver|bronze|pro|am|academy|pit\s*stop|overall)\b/i;

// Classes de time da America (o site nao tem classificacao geral la).
// (?:^|\s) em vez de \b pra "Am Teams" nao casar com "Pro-Am Teams".
const AMERICA_TEAM_CLASSES: { classLabel: string; re: RegExp }[] = [
  { classLabel: 'Pro', re: /(?:^|\s)Pro\s+Teams?$/i },
  { classLabel: 'Pro-Am', re: /(?:^|\s)Pro-Am\s+Teams?$/i },
  { classLabel: 'Am', re: /(?:^|\s)Am\s+Teams?$/i },
];

// Escolhe, entre as opcoes do <select>, quais classificacoes gravar --
// pelo TEXTO da opcao, nao pelo id, entao continua funcionando quando o
// site troca os ids na virada de temporada. Mesma selecao do script antigo:
//   europe/asia: geral de pilotos e de times (classLabel 'Geral')
//   america: times Pro / Pro-Am / Am (e a geral, se um dia aparecer)
export function pickStandingOptions(series: SeriesId, options: StandingOption[]): StandingTarget[] {
  const targets: StandingTarget[] = [];
  for (const type of ['drivers', 'teams'] as const) {
    const overall = options.find((o) => o.standingType === type && !SUB_STANDING_RE.test(o.label));
    if (overall) targets.push({ standingType: type, classLabel: 'Geral', param: overall.param, label: overall.label });
  }
  if (series === 'america') {
    for (const cls of AMERICA_TEAM_CLASSES) {
      const opt = options.find((o) => o.standingType === 'teams' && cls.re.test(o.label));
      if (opt) targets.push({ standingType: 'teams', classLabel: cls.classLabel, param: opt.param, label: opt.label });
    }
  }
  return targets;
}

// Quantas classificacoes cada serie deveria ter (pra acusar problema se o
// site mudar os rotulos e pickStandingOptions parar de achar).
export const EXPECTED_STANDINGS: Record<SeriesId, number> = { europe: 2, america: 3, asia: 2 };

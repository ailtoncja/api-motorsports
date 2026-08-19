// Sincroniza calendario, classificacao, vencedor de cada corrida e (pra
// Europe/America) entry list do GT World Challenge, direto dos sites
// oficiais -- nao existe API publica estruturada pra essa categoria. Roda
// 1x/dia via GitHub Actions (.github/workflows/sync-gtwc.yml).
//
// Por que raspar em vez de usar uma API: nao ha uma. A TheSportsDB chegou a
// ser usada (no pitstophub) mas misturava o grid de Sprint Cup com o de
// Endurance Cup -- por isso aqui cada corrida tem seu proprio entry list,
// raspado da pagina oficial daquela corrida especifica, sem "roster da
// temporada + excecao".
//
// Asia fica so com calendario automatico: o entry list oficial de la e
// PDF, nao tabela HTML, e parsing de PDF nao e confiavel o suficiente pra
// rodar sem supervisao todo dia -- ver supabase/seed_asia.sql pra carga
// manual.
//
// Env vars necessarias: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { codeToCountry } from './lib/country-codes.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const REQUEST_DELAY_MS = 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; api-motorsports-sync/1.0; +https://github.com/ailtoncja/api-motorsports)';
// Ano usado na URL do entry-list (/entry-list/{ANO}/{slug}). O site oficial
// nao expoe o ano da temporada atual em lugar nenhum facil de ler -- bump
// manual quando virar temporada.
const YEAR = 2026;

// Os `param`s de standings abaixo (ex.: "0_0_drivers", "16_31_teams") vem
// do <select> de /standings de cada site -- o primeiro numero e um id de
// temporada interno de cada site (Europe usa "0" pra temporada atual,
// America "16", Asia "11" pra 2026), e muda toda virada de temporada.
// Conferir de novo em .../standings (ver <option value="...">) se o sync
// comecar a trazer 0 posicoes.
const SERIES_CONFIG = [
  {
    id: 'europe',
    baseUrl: 'https://www.gt-world-challenge-europe.com',
    scrapeEntryLists: true,
    // "Overall" da temporada inteira (Sprint Cup + Endurance Cup somados).
    // O site tambem tem sub-classificacoes so de uma copa e por classe de
    // piloto (Bronze/Gold/Silver) -- nao sincronizadas aqui pra manter
    // simples; dá pra achar os params delas no <select> de /standings.
    standings: [
      { standingType: 'drivers', classLabel: 'Geral', param: '0_0_drivers' },
      { standingType: 'teams', classLabel: 'Geral', param: '0_0_teams' },
    ],
  },
  {
    id: 'america',
    baseUrl: 'https://www.gt-world-challenge-america.com',
    scrapeEntryLists: true,
    // America nao tem uma classificacao "geral" (nem de pilotos) em 2026 --
    // só classificação de times, dividida por classe (Pro/Pro-Am/Am).
    // Documentado como limitação conhecida no README.
    standings: [
      { standingType: 'teams', classLabel: 'Pro', param: '16_31_teams' },
      { standingType: 'teams', classLabel: 'Pro-Am', param: '16_30_teams' },
      { standingType: 'teams', classLabel: 'Am', param: '16_29_teams' },
    ],
  },
  {
    id: 'asia',
    baseUrl: 'https://www.gt-world-challenge-asia.com',
    scrapeEntryLists: false,
    standings: [
      { standingType: 'drivers', classLabel: 'Geral', param: '11_0_1_drivers' },
      { standingType: 'teams', classLabel: 'Geral', param: '11_0_1_teams' },
    ],
  },
];

// filter_season_id usado em /results?filter_season_id=X&filter_meeting_id=Y
// -- id interno de temporada de cada site (nao e o ano), confirmado em
// links reais de eventos 2026. Muda toda virada de temporada, igual YEAR e
// os params de standings acima -- conferir de novo se /results parar de
// achar vencedor pras corridas ja disputadas.
const RESULTS_SEASON_ID = { europe: 26, america: 11, asia: 10 };

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

function buildDate(day, monthText, year) {
  const month = MONTHS[(monthText ?? '').slice(0, 3).toLowerCase()];
  if (!month || !day || !year) return null;
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

function extractEventLink($el) {
  const href = $el.find('a[href*="/event/"]').first().attr('href');
  if (!href) return null;
  const m = href.match(/\/event\/(\d+)\/([^/?#]+)/);
  if (!m) return null;
  return { eventId: m[1], slug: decodeURIComponent(m[2]) };
}

// Rodadas futuras ficam em ".calendar__list-item" (dia/mes/ano em spans
// separados de inicio e fim). Rodadas ja disputadas migram pra
// ".past-events__list-item" (data como uma string so, tipo "10 - 12 April
// 2026"). As duas tem que ser lidas pra ter a temporada completa -- e as
// duas listam tambem test days/prologues, que sao pulados aqui por nao
// terem "Round N" no texto.
function parseUpcomingItems($) {
  const races = [];
  $('.calendar__list-item').each((_, el) => {
    const $el = $(el);
    const roundText = $el.find('.calendar__race-text').first().text().trim();
    const roundMatch = roundText.match(/Round\s+(\d+)/i);
    if (!roundMatch) return;
    const link = extractEventLink($el);
    if (!link) return;
    const day = $el.find('.calendar__date-start .calendar__date-number').first().text().trim();
    const monthText = $el.find('.calendar__date-start .calendar__date-month').first().text().trim();
    const year = $el.find('.calendar__date-start .calendar__date-year').first().text().trim();
    races.push({
      round: Number(roundMatch[1]),
      raceId: link.slug,
      eventId: link.eventId,
      name: $el.find('.calendar__race-header').first().text().trim(),
      location: $el.find('.calendar__race-subheading-text').first().text().trim() || null,
      date: buildDate(day, monthText, year),
    });
  });
  return races;
}

function parsePastItems($) {
  const races = [];
  $('.past-events__list-item').each((_, el) => {
    const $el = $(el);
    const spans = $el.find('.past-events__piped-list-span');
    if (spans.length < 3) return;
    const dateText = $(spans[0]).text().trim();
    const roundText = $(spans[2]).text().trim();
    const roundMatch = roundText.match(/Round\s+(\d+)/i);
    if (!roundMatch) return;
    const link = extractEventLink($el);
    if (!link) return;
    const name = $(spans[1]).find('strong').first().text().trim();
    const location = $(spans[1]).clone().find('strong').remove().end().text().trim() || null;
    const dateMatch = dateText.match(/(\d{1,2})\D*?([A-Za-z]+)[\s\S]*?(\d{4})/);
    races.push({
      round: Number(roundMatch[1]),
      raceId: link.slug,
      eventId: link.eventId,
      name,
      location,
      date: dateMatch ? buildDate(dateMatch[1], dateMatch[2], dateMatch[3]) : null,
    });
  });
  return races;
}

async function scrapeCalendar(baseUrl) {
  const html = await fetchHtml(`${baseUrl}/calendar`);
  const $ = cheerio.load(html);
  const byRaceId = new Map();
  for (const race of [...parsePastItems($), ...parseUpcomingItems($)]) {
    if (race.date) byRaceId.set(race.raceId, race);
  }
  return [...byRaceId.values()].sort((a, b) => a.round - b.round);
}

// So sessoes de corrida de verdade (nao Practice/Qualifying/Test/Pit Walk,
// nem os checkpoints intermediarios tipo "Main Race after 2h 30" que a
// Europe tambem lista) -- lista positiva em vez de negativa, pra uma sessao
// desconhecida no futuro ficar de fora por padrao em vez de entrar por
// engano.
const RACE_SESSION_RE = /^(main\s+)?race(\s+\d+)?$/i;

function parseRaceSessionOptions($) {
  return $('#filter_race_id option')
    .map((_, opt) => ({ id: $(opt).attr('value'), label: $(opt).text().trim() }))
    .get()
    .filter((o) => o.id && RACE_SESSION_RE.test(o.label))
    .map((o) => ({ ...o, order: Number(o.label.match(/\d+/)?.[0] ?? 0) }))
    .sort((a, b) => a.order - b.order);
}

// Le "Pos"/"Team" por nome de cabecalho (America/Asia/Europe tem ordem de
// coluna diferente) e devolve o time da linha Pos=1.
function parseSessionWinnerTeam($) {
  const table = $('table').first();
  if (table.length === 0) return null;
  const headers = table.find('thead th').map((_, th) => $(th).text().trim()).get();
  const posIdx = headers.findIndex((h) => /^pos$/i.test(h));
  const teamIdx = headers.findIndex((h) => /^team$/i.test(h));
  if (posIdx === -1 || teamIdx === -1) return null;

  let winner = null;
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

// Vencedor = time (nao piloto -- carros de GT3 tem 2-3 pilotos, e essa e a
// mesma convencao que a categoria GT World Challenge ja usava aqui antes de
// ser removida do pitstophub). Corridas Sprint (Race 1 + Race 2) juntam os
// dois vencedores com " / ", mesma convencao que o pitstophub ja usa pra
// fins de semana de 2 corridas (ver DTM em src/types.ts).
async function scrapeRaceWinner(baseUrl, seasonId, eventId) {
  if (!eventId) return null;
  const listHtml = await fetchHtml(`${baseUrl}/results?filter_season_id=${seasonId}&filter_meeting_id=${eventId}`);
  const sessions = parseRaceSessionOptions(cheerio.load(listHtml));
  if (sessions.length === 0) return null;

  const winners = [];
  for (const session of sessions) {
    await sleep(REQUEST_DELAY_MS);
    const html = await fetchHtml(
      `${baseUrl}/results?filter_season_id=${seasonId}&filter_meeting_id=${eventId}&filter_race_id=${session.id}`,
    );
    const team = parseSessionWinnerTeam(cheerio.load(html));
    if (team) winners.push(team);
  }
  return winners.length > 0 ? winners.join(' / ') : null;
}

// Le o cabecalho da tabela (<th>) pra mapear coluna -> significado, em vez
// de assumir posicao fixa -- confirmado que Europe (Car #, Team, Driver
// 1/2/3, Car, Class) e America (Car #, Driver 1/2, Team, Car, Class) usam
// ordem e quantidade de colunas diferentes.
function parseEntryTable($) {
  const table = $('table.table').first();
  if (table.length === 0) return [];
  const headers = table.find('thead th').map((_, th) => $(th).text().trim()).get();
  const carNumberHeader = headers.find((h) => /car\s*#/i.test(h));
  const teamHeader = headers.find((h) => h.trim().toLowerCase() === 'team');
  const carHeader = headers.find((h) => h.trim().toLowerCase() === 'car');
  const classHeader = headers.find((h) => h.trim().toLowerCase() === 'class');
  const driverHeaders = headers.filter((h) => /^Driver \d+$/i.test(h));

  const entries = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length !== headers.length) return;
    const cellByHeader = new Map(headers.map((h, i) => [h, $(cells[i])]));

    const drivers = [];
    for (const header of driverHeaders) {
      const cell = cellByHeader.get(header);
      const name = cell.find('.table__text').first().text().trim() || cell.text().trim();
      // Corridas com 4 colunas de piloto (endurance, ex.: 24h de Spa) usam "/"
      // como placeholder no 4o piloto quando o carro so tem 3 -- nao e nome.
      if (!name || name === '/') continue;
      const flagClass = cell.find('[class*="flag"]').first().attr('class') ?? '';
      const codeMatch = flagClass.match(/size--tiny\s+([a-z]+)/i);
      drivers.push({ name, nationality: codeToCountry(codeMatch ? codeMatch[1] : null) });
    }

    const teamName = teamHeader ? cellByHeader.get(teamHeader).text().trim() : null;
    if (!teamName || drivers.length === 0) return;

    entries.push({
      carNumber: carNumberHeader ? cellByHeader.get(carNumberHeader).text().trim() : null,
      teamName,
      car: carHeader ? cellByHeader.get(carHeader).text().trim() : null,
      class: classHeader ? cellByHeader.get(classHeader).text().trim() : null,
      drivers,
    });
  });
  return entries;
}

async function scrapeEntryList(baseUrl, raceId) {
  const url = `${baseUrl}/entry-list/${YEAR}/${raceId}`;
  const html = await fetchHtml(url);
  return { url, entries: parseEntryTable(cheerio.load(html)) };
}

// Le a tabela de /standings. Duas variantes de marcacao encontradas nos
// sites oficiais: America/Asia tem cabecalho real (<thead><th>Pos/Driver ou
// Team/Total</th></thead>); ja o <thead> da Europe so agrupa por corrida
// (Round/Track/Session) -- o rotulo real (POS/DRIVER/TOTAL) vem disfarcado
// de primeira linha do <tbody>, como <td> em vez de <th>. Le por nome de
// coluna nos dois casos (mesmo motivo do parseEntryTable acima), e pula
// essa linha-cabecalho disfarcada quando aparece no meio dos dados.
function parseStandingsTable($) {
  const table = $('table.standing, table.table, table').first();
  if (table.length === 0) return [];

  let headers = table.find('thead th').map((_, th) => $(th).text().trim()).get();

  if (!headers.some((h) => /^pos$/i.test(h))) {
    const pseudoHeaderRow = table.find('tbody tr').filter((_, tr) => {
      return /^pos$/i.test($(tr).find('td').first().text().trim());
    }).first();
    if (pseudoHeaderRow.length > 0) {
      headers = pseudoHeaderRow.find('td').map((_, td) => $(td).text().trim()).get();
    }
  }

  const posIdx = headers.findIndex((h) => /^pos$/i.test(h));
  const nameIdx = headers.findIndex((h) => /^(driver|team)$/i.test(h));
  const totalIdx = headers.findIndex((h) => /^total$/i.test(h));
  if (posIdx === -1 || nameIdx === -1 || totalIdx === -1) return [];

  const rows = [];
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

async function scrapeStandings(baseUrl, param) {
  const url = `${baseUrl}/standings?filter_standing_type=${param}`;
  const html = await fetchHtml(url);
  return parseStandingsTable(cheerio.load(html));
}

async function upsertRaces(seriesId, races) {
  if (races.length === 0) return;
  const rows = races.map((r) => ({
    series_id: seriesId,
    race_id: r.raceId,
    round: r.round,
    name: r.name,
    location: r.location,
    date: r.date,
    winner: r.winner ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('gtwc_races').upsert(rows, { onConflict: 'series_id,race_id' });
  if (error) throw error;
}

async function replaceEntries(seriesId, raceId, entries, sourceUrl) {
  const { error: deleteError } = await supabase
    .from('gtwc_entries')
    .delete()
    .eq('series_id', seriesId)
    .eq('race_id', raceId);
  if (deleteError) throw deleteError;

  if (entries.length > 0) {
    const rows = entries.map((e) => ({
      series_id: seriesId,
      race_id: raceId,
      car_number: e.carNumber,
      team_name: e.teamName,
      car: e.car,
      class: e.class,
      drivers: e.drivers,
    }));
    const { error: insertError } = await supabase.from('gtwc_entries').insert(rows);
    if (insertError) throw insertError;
  }

  const { error: updateError } = await supabase
    .from('gtwc_races')
    .update({ source_url: sourceUrl })
    .eq('series_id', seriesId)
    .eq('race_id', raceId);
  if (updateError) throw updateError;
}

async function replaceStandings(seriesId, standingType, classLabel, entries) {
  const { error: deleteError } = await supabase
    .from('gtwc_standings')
    .delete()
    .eq('series_id', seriesId)
    .eq('standing_type', standingType)
    .eq('class_label', classLabel);
  if (deleteError) throw deleteError;

  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    series_id: seriesId,
    standing_type: standingType,
    class_label: classLabel,
    position: e.position,
    name: e.name,
    points: e.points,
  }));
  const { error: insertError } = await supabase.from('gtwc_standings').insert(rows);
  if (insertError) throw insertError;
}

async function syncSeries(config) {
  console.log(`\n=== ${config.id} ===`);
  const races = await scrapeCalendar(config.baseUrl);
  console.log(`${races.length} rodada(s) encontrada(s) no calendario.`);

  const today = new Date();
  const seasonId = RESULTS_SEASON_ID[config.id];
  for (const race of races) {
    if (new Date(`${race.date}T23:59:59Z`) >= today) continue; // corrida futura, sem resultado ainda
    await sleep(REQUEST_DELAY_MS);
    try {
      race.winner = await scrapeRaceWinner(config.baseUrl, seasonId, race.eventId);
      if (race.winner) console.log(`  round ${race.round}: vencedor ${race.winner}.`);
    } catch (error) {
      console.error(`  round ${race.round}: falha ao buscar vencedor -- ${error.message}`);
    }
  }

  await upsertRaces(config.id, races);

  for (const standing of config.standings) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const entries = await scrapeStandings(config.baseUrl, standing.param);
      await replaceStandings(config.id, standing.standingType, standing.classLabel, entries);
      console.log(`  standings ${standing.standingType}/${standing.classLabel}: ${entries.length} posicao(oes).`);
    } catch (error) {
      console.error(`  standings ${standing.standingType}/${standing.classLabel}: falhou -- ${error.message}`);
    }
  }

  if (!config.scrapeEntryLists) {
    console.log('Entry list nao automatizado pra essa serie (site so publica PDF) -- so calendario/classificacao sincronizados.');
    return;
  }

  for (const race of races) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const { url, entries } = await scrapeEntryList(config.baseUrl, race.raceId);
      await replaceEntries(config.id, race.raceId, entries, url);
      console.log(`  round ${race.round} (${race.raceId}): ${entries.length} carro(s).`);
    } catch (error) {
      console.error(`  round ${race.round} (${race.raceId}): falhou -- ${error.message}`);
    }
  }
}

async function main() {
  for (const config of SERIES_CONFIG) {
    await sleep(REQUEST_DELAY_MS);
    try {
      await syncSeries(config);
    } catch (error) {
      console.error(`[${config.id}] falhou:`, error.message);
    }
  }
}

main().catch((error) => {
  console.error('Sync falhou:', error);
  process.exit(1);
});

// Parsers puros (HTML -> dados) do Endurance Brasil. Port fiel de
// scripts/sync-endurance-brasil.mjs, sem rede nem banco.
//
// Diferenca de seguranca: o objeto JS `season_classifications` de
// /classificacao era avaliado com Function() (= executar codigo do site
// dentro do sync). Agora e lido com JSON5.parse, que so aceita dados
// (objetos, arrays, strings, numeros, virgula sobrando) e nunca executa nada.

import { cheerio, JSON5 } from './deps.ts';

export const EB_BASE_URL = 'https://endurancebrasiloficial.com.br';

export interface EbRace {
  raceId: string;
  round: number | null;
  name: string;
  location: string | null;
  date: string;
  completed: boolean;
  sourceUrl: string;
  winner: string | null;
}

export interface EbTeamDriver {
  name: string;
  driverId: string;
}

export interface EbTeam {
  teamId: string;
  name: string;
  teamPrincipal: string | null;
  sourceUrl: string;
  drivers: EbTeamDriver[];
}

export interface EbIndexDriver {
  driverId: string;
  name: string;
  sourceUrl: string;
}

export interface EbDriver extends EbIndexDriver {
  uf: string | null;
  class: string | null;
  teamId: string | null;
}

export interface EbStandingRow {
  classLabel: string;
  position: number;
  name: string;
  points: number;
  uf: string | null;
}

export interface EbNewsItem {
  slug: string;
  title: string;
  date: string;
  url: string;
}

export interface EbSeason {
  id: string;
  year: number;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function slugFromHref(href: string | undefined, prefix: string): string | null {
  if (!href) return null;
  const m = href.match(new RegExp(`/${prefix}/([^/?#]+)`));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function parseBrDate(text: string | undefined): string | null {
  const m = (text ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// Temporada que o site esta mostrando: <select id="season_select"> no
// rodape de toda pagina, opcao `selected` (value = uuid, texto = ano). O
// site troca de temporada via cookie (/set_season/{uuid}); sem cookie ele
// sempre mostra a atual -- entao o sync acompanha a virada sozinho.
export function parseEbSeason(html: string): EbSeason | null {
  const $ = cheerio.load(html);
  const opt = $('#season_select option[selected]').first();
  const year = opt.text().trim();
  const id = (opt.attr('value') ?? '').trim();
  if (!/^\d{4}$/.test(year) || !id || id === '0') return null;
  return { id, year: Number(year) };
}

export function extractJsObjectLiteral(html: string, marker: string): string | null {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  let i = html.indexOf('{', start);
  if (i === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  const begin = i;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(begin, i + 1);
    }
  }
  return null;
}

export interface RawClassificationEntry {
  position?: string | number;
  points?: number | string;
  pilot?: { name?: string; uf?: string; category?: string };
}

export function parseSeasonClassifications(html: string): Record<string, RawClassificationEntry[]> | null {
  const literal = extractJsObjectLiteral(html, 'const season_classifications = ');
  if (!literal) return null;
  try {
    return JSON5.parse(literal);
  } catch (error) {
    throw new Error(`Falha ao interpretar season_classifications: ${(error as Error).message}`);
  }
}

function parsePosition(raw: unknown, lastPos: number | null): number | null {
  const m = String(raw ?? '').match(/(\d+)/);
  if (m) return Number(m[1]);
  return lastPos;
}

export function parseEbCalendar(html: string): EbRace[] {
  const $ = cheerio.load(html);
  const races: EbRace[] = [];
  $('.row.calendario .card').each((_, el) => {
    const $card = $(el);
    const href = $card.find('a[href*="/calendario/"]').first().attr('href');
    const raceId = slugFromHref(href, 'calendario');
    const name = clean($card.find('h4.card-title').first().text());
    const location = clean($card.find('h3.card-text').first().text()) || null;
    const date = parseBrDate($card.find('h5').first().text());
    if (!raceId || !name || !date) return;
    const roundMatch = name.match(/Etapa\s+(\d+)/i);
    races.push({
      raceId,
      round: roundMatch ? Number(roundMatch[1]) : null,
      name,
      location,
      date,
      completed: clean($card.find('.badge').text()).toUpperCase() === 'ENCERRADA',
      sourceUrl: `${EB_BASE_URL}/calendario/${raceId}`,
      winner: null,
    });
  });
  return races.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
}

export function parseEbTeams(html: string): EbTeam[] {
  const $ = cheerio.load(html);
  const teams: EbTeam[] = [];
  $('a[href*="/equipe/"]').each((_, el) => {
    const $link = $(el);
    const teamId = slugFromHref($link.attr('href'), 'equipe');
    if (!teamId) return;
    const $card = $link.closest('.card');
    if ($card.length === 0) return;
    const name = clean($card.find('h5.card-title').first().text());
    if (!name) return;
    const principalText = clean($card.find('.card-footer .col').first().text());
    const teamPrincipal = principalText.replace(/^CHEFE DE EQUIPE:\s*/i, '').trim() || null;
    const drivers: EbTeamDriver[] = [];
    $card.find('ul.pilotos li a[href*="/piloto/"]').each((__, a) => {
      const $a = $(a);
      const driverId = slugFromHref($a.attr('href'), 'piloto');
      const driverName = clean($a.find('span.name').first().text()) || clean($a.text()).replace(/>/g, '').trim();
      if (!driverId || !driverName) return;
      if (drivers.some((d) => d.driverId === driverId)) return;
      drivers.push({ name: driverName, driverId });
    });
    teams.push({ teamId, name, teamPrincipal, sourceUrl: `${EB_BASE_URL}/equipe/${teamId}`, drivers });
  });
  return teams;
}

export function parseEbDriversIndex(html: string): EbIndexDriver[] {
  const $ = cheerio.load(html);
  const drivers: EbIndexDriver[] = [];
  $('.pilot a[href*="/piloto/"]').each((_, el) => {
    const $a = $(el);
    const driverId = slugFromHref($a.attr('href'), 'piloto');
    const $card = $a.closest('.pilot');
    const name = clean($card.find('h4.card-title').first().text());
    if (!driverId || !name) return;
    if (drivers.some((d) => d.driverId === driverId)) return;
    drivers.push({ driverId, name, sourceUrl: `${EB_BASE_URL}/piloto/${driverId}` });
  });
  return drivers;
}

// Uma lista por classe. Ignora `general` (mistura P1/GT3/GT4) e qualquer
// outra chave cujas linhas tenham mais de uma categoria de piloto.
export function flattenStandings(
  byClass: Record<string, RawClassificationEntry[]> | null,
  log: (msg: string) => void = () => {},
): EbStandingRow[] {
  const rows: EbStandingRow[] = [];
  for (const [classLabel, entries] of Object.entries(byClass ?? {})) {
    if (!classLabel || classLabel === 'general') continue;
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const categories = new Set(entries.map((e) => e.pilot?.category).filter(Boolean));
    if (categories.size > 1) {
      log(`standings "${classLabel}": misturada (${[...categories].join(', ')}) -- ignorada.`);
      continue;
    }
    let lastPos: number | null = null;
    for (const entry of entries) {
      const name = entry.pilot?.name?.trim();
      const points = Number(entry.points);
      const position = parsePosition(entry.position, lastPos);
      if (!name || !Number.isFinite(points) || position == null) continue;
      lastPos = position;
      rows.push({ classLabel, position, name, points, uf: entry.pilot?.uf?.trim() || null });
    }
  }
  return rows;
}

const GENERIC_TEAM_WORDS = new Set(['sports', 'sport', 'racing', 'motorsport', 'autosport', 'team', 'endurance']);

const ROUND_ORDINALS: Record<number, RegExp> = {
  1: /primeira etapa|1[ªa] etapa|abertura da temporada/i,
  2: /segunda etapa|2[ªa] etapa/i,
  3: /terceira etapa|3[ªa] etapa/i,
  4: /quarta etapa|4[ªa] etapa/i,
  5: /quinta etapa|5[ªa] etapa/i,
  6: /sexta etapa|6[ªa] etapa/i,
  7: /s[eé]tima etapa|7[ªa] etapa/i,
  8: /oitava etapa|8[ªa] etapa/i, // calendario 2026 tem 8 etapas
};

export function foldName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/autorsport/g, 'autosport')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000;
}

export function parseEbNewsIndex(html: string): EbNewsItem[] {
  const $ = cheerio.load(html);
  const items: EbNewsItem[] = [];
  $('.card').each((_, el) => {
    const $card = $(el);
    const href = $card.find('a[href*="/noticia/"]').first().attr('href');
    const slug = slugFromHref(href, 'noticia');
    const title = clean($card.find('h2.card-title').first().text());
    const date = parseBrDate($card.find('h5').first().text());
    if (!slug || !title || !date) return;
    if (items.some((item) => item.slug === slug)) return;
    items.push({ slug, title, date, url: `${EB_BASE_URL}/noticia/${slug}` });
  });
  return items;
}

export function isOverallWinCandidate(title: string): boolean {
  const folded = foldName(title);
  if (!/vence|vitoria/.test(folded)) return false;
  if (/\bGT\s*[34]\b/i.test(title) && !/\bP1\b/i.test(title)) return false;
  return true;
}

function parseResultTeam(line: string): string | null {
  const m = String(line).match(/#\d+\s+[^/]+\/([^)-]+?)\s*-\s*P1\s*\)/);
  return m ? m[1].trim() : null;
}

// Lista numerada do resultado da prova na materia (<ol>, maior lista com
// uma linha "#NN pilotos/time - P1)").
export function parseOverallWinnerFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  let best: { team: string; listSize: number } | null = null;
  $('ol').each((_, ol) => {
    const items = $(ol).find('li').map((__, li) => clean($(li).text())).get();
    if (items.length < 5) return;
    const firstP1 = items.find((line) => /#\d+/.test(line) && /-\s*P1\s*\)/.test(line));
    if (!firstP1) return;
    const team = parseResultTeam(firstP1);
    if (!team) return;
    if (!best || items.length > best.listSize) best = { team, listSize: items.length };
  });
  return (best as { team: string } | null)?.team ?? null;
}

export function articleText(html: string): string {
  return cheerio.load(html).text();
}

export function prototypeTeams(teams: EbTeam[], drivers: { driverId: string; class: string | null }[]): EbTeam[] {
  const protoIds = new Set(drivers.filter((d) => /^P[123]/i.test(d.class ?? '')).map((d) => d.driverId));
  const matched = teams.filter((team) => team.drivers.some((d) => protoIds.has(d.driverId)));
  return matched.length > 0 ? matched : teams;
}

export function resolveTeamName(raw: string, teams: { name: string }[]): string {
  if (!raw || teams.length === 0) return raw;
  const folded = foldName(raw);
  const exact = teams.find((team) => foldName(team.name) === folded);
  if (exact) return exact.name;

  const contained = [...teams]
    .sort((a, b) => b.name.length - a.name.length)
    .find((team) => {
      const name = foldName(team.name);
      return name && (folded.includes(name) || name.includes(folded));
    });
  if (contained) return contained.name;

  const tokens = folded.split(' ').filter((tok) => tok.length >= 4 && !GENERIC_TEAM_WORDS.has(tok));
  for (const tok of tokens) {
    const hits = teams.filter((team) => foldName(team.name).includes(tok));
    if (hits.length === 1) return hits[0].name;
  }
  return raw;
}

export function winnerFromTitle(title: string, teams: { name: string }[]): string | null {
  if (/\bGT\s*[34]\b/i.test(title)) return null;
  const foldedTitle = foldName(title);
  const byName = [...teams]
    .sort((a, b) => b.name.length - a.name.length)
    .find((team) => {
      const name = foldName(team.name);
      return name && foldedTitle.includes(name);
    });
  if (byName) return byName.name;
  const resolved = resolveTeamName(title, teams);
  return resolved && resolved !== title ? resolved : null;
}

function roundMentioned(text: string, round: number | null): boolean {
  const pattern = round != null ? ROUND_ORDINALS[round] : undefined;
  return pattern ? pattern.test(text) : false;
}

export function matchRace<R extends { completed: boolean; date: string; round: number | null }>(
  article: { title: string; date: string; body?: string },
  races: R[],
): R | null {
  const dated = races.filter((race) => race.completed && daysBetween(race.date, article.date) <= 2);
  if (dated.length === 0) return null;
  if (dated.length === 1) return dated[0];

  const exact = dated.filter((race) => race.date === article.date);
  if (exact.length === 1) return exact[0];

  const hay = `${article.title} ${article.body ?? ''}`;
  const byRound = dated.filter((race) => roundMentioned(hay, race.round));
  if (byRound.length === 1) return byRound[0];
  return exact[0] ?? dated[0];
}

export interface EbReport extends EbNewsItem {
  fromOl: string | null;
  body: string;
}

// Mesmo algoritmo do script antigo: primeiro as materias com resultado
// numerado (<ol>), depois as manchetes. Corridas que ja tem `winner`
// (inclusive o que veio do banco) nao sao sobrescritas.
export function assignWinners(
  races: EbRace[],
  reports: EbReport[],
  teams: EbTeam[],
  drivers: EbDriver[],
  log: (msg: string) => void = () => {},
): void {
  for (const report of reports) {
    if (!report.fromOl) continue;
    const race = matchRace(report, races);
    if (!race || race.winner) continue;
    race.winner = resolveTeamName(report.fromOl, teams);
    log(`round ${race.round}: vencedor ${race.winner} (resultado em ${report.slug}).`);
  }
  const proto = prototypeTeams(teams, drivers);
  for (const report of reports) {
    if (report.fromOl) continue;
    const fromTitle = winnerFromTitle(report.title, proto);
    if (!fromTitle) continue;
    const race = matchRace(report, races);
    if (!race || race.winner) continue;
    race.winner = fromTitle;
    log(`round ${race.round}: vencedor ${race.winner} (manchete ${report.slug}).`);
  }
}

export function enrichDrivers(indexDrivers: EbIndexDriver[], teams: EbTeam[], standingRows: EbStandingRow[]): EbDriver[] {
  const teamByDriverId = new Map<string, string>();
  for (const team of teams) {
    for (const driver of team.drivers) {
      if (!teamByDriverId.has(driver.driverId)) teamByDriverId.set(driver.driverId, team.teamId);
    }
  }
  const standingByName = new Map<string, EbStandingRow>();
  for (const row of standingRows) {
    const key = row.name.toLowerCase();
    if (!standingByName.has(key)) standingByName.set(key, row);
  }
  return indexDrivers.map((driver) => {
    const standing = standingByName.get(driver.name.toLowerCase());
    return {
      ...driver,
      uf: standing?.uf ?? null,
      class: standing?.classLabel ?? null,
      teamId: teamByDriverId.get(driver.driverId) ?? null,
    };
  });
}

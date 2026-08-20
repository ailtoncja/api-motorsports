// Sincroniza calendario, equipes, pilotos e classificacao do Endurance Brasil
// a partir de endurancebrasiloficial.com.br. Roda 1x/dia via GitHub Actions
// (.github/workflows/sync-endurance-brasil.yml). Nao toca tabelas gtwc_*.
//
// Diferente do GTWC, o site oficial NAO publica entry list por corrida.
// Times/pilotos vem das paginas de roster da temporada (/equipes, /pilotos).
// Vencedor da etapa vem das noticias oficiais -- a tabela CLASSIFICACAO na
// pagina da corrida e o campeonato da temporada, nao o resultado da prova.
//
// Env vars necessarias: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// DRY_RUN=1 raspa e loga sem gravar no Supabase.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const DRY_RUN = process.env.DRY_RUN === '1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('Faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = 'https://endurancebrasiloficial.com.br';
const REQUEST_DELAY_MS = 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; api-motorsports-sync/1.0; +https://github.com/ailtoncja/api-motorsports)';
const EPOCH = '1970-01-01';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

function slugFromHref(href, prefix) {
  if (!href) return null;
  const m = href.match(new RegExp(`/${prefix}/([^/?#]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function parseBrDate(text) {
  const m = (text ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

function extractJsObjectLiteral(html, marker) {
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

function parseSeasonClassifications(html) {
  const literal = extractJsObjectLiteral(html, 'const season_classifications = ');
  if (!literal) return null;
  try {
    return Function(`"use strict"; return (${literal});`)();
  } catch (error) {
    throw new Error(`Falha ao interpretar season_classifications: ${error.message}`);
  }
}

function parsePosition(raw, lastPos) {
  const m = String(raw ?? '').match(/(\d+)/);
  if (m) return Number(m[1]);
  return lastPos;
}

function scrapeCalendar(html) {
  const $ = cheerio.load(html);
  const races = [];
  $('.row.calendario .card').each((_, el) => {
    const $card = $(el);
    const href = $card.find('a[href*="/calendario/"]').first().attr('href');
    const raceId = slugFromHref(href, 'calendario');
    const name = $card.find('h4.card-title').first().text().replace(/\s+/g, ' ').trim();
    const location = $card.find('h3.card-text').first().text().replace(/\s+/g, ' ').trim() || null;
    const date = parseBrDate($card.find('h5').first().text());
    if (!raceId || !name || !date) return;
    const roundMatch = name.match(/Etapa\s+(\d+)/i);
    races.push({
      raceId,
      round: roundMatch ? Number(roundMatch[1]) : null,
      name,
      location,
      date,
      completed: $card.find('.badge').text().replace(/\s+/g, ' ').trim().toUpperCase() === 'ENCERRADA',
      sourceUrl: `${BASE_URL}/calendario/${raceId}`,
      winner: null,
    });
  });
  return races.sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
}

function scrapeTeams(html) {
  const $ = cheerio.load(html);
  const teams = [];
  $('a[href*="/equipe/"]').each((_, el) => {
    const $link = $(el);
    const href = $link.attr('href');
    const teamId = slugFromHref(href, 'equipe');
    if (!teamId) return;
    const $card = $link.closest('.card');
    if ($card.length === 0) return;
    const name = $card.find('h5.card-title').first().text().replace(/\s+/g, ' ').trim();
    if (!name) return;
    const principalText = $card.find('.card-footer .col').first().text().replace(/\s+/g, ' ').trim();
    const teamPrincipal = principalText.replace(/^CHEFE DE EQUIPE:\s*/i, '').trim() || null;
    const drivers = [];
    $card.find('ul.pilotos li a[href*="/piloto/"]').each((__, a) => {
      const $a = $(a);
      const driverId = slugFromHref($a.attr('href'), 'piloto');
      const driverName = $a.find('span.name').first().text().replace(/\s+/g, ' ').trim()
        || $a.text().replace(/\s+/g, ' ').replace(/>/g, '').trim();
      if (!driverId || !driverName) return;
      if (drivers.some((d) => d.driverId === driverId)) return;
      drivers.push({ name: driverName, driverId });
    });
    teams.push({
      teamId,
      name,
      teamPrincipal,
      sourceUrl: `${BASE_URL}/equipe/${teamId}`,
      drivers,
    });
  });
  return teams;
}

function scrapeDriversIndex(html) {
  const $ = cheerio.load(html);
  const drivers = [];
  $('.pilot a[href*="/piloto/"]').each((_, el) => {
    const $a = $(el);
    const driverId = slugFromHref($a.attr('href'), 'piloto');
    const $card = $a.closest('.pilot');
    const name = $card.find('h4.card-title').first().text().replace(/\s+/g, ' ').trim();
    if (!driverId || !name) return;
    if (drivers.some((d) => d.driverId === driverId)) return;
    drivers.push({
      driverId,
      name,
      sourceUrl: `${BASE_URL}/piloto/${driverId}`,
    });
  });
  return drivers;
}

function flattenStandings(byClass) {
  const rows = [];
  for (const [classLabel, entries] of Object.entries(byClass ?? {})) {
    if (!classLabel || classLabel === 'general') continue;
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const categories = new Set(entries.map((e) => e.pilot?.category).filter(Boolean));
    if (categories.size > 1) {
      console.log(`  standings "${classLabel}": misturada (${[...categories].join(', ')}) -- ignorada.`);
      continue;
    }
    let lastPos = null;
    for (const entry of entries) {
      const name = entry.pilot?.name?.trim();
      const points = Number(entry.points);
      const position = parsePosition(entry.position, lastPos);
      if (!name || !Number.isFinite(points) || position == null) continue;
      lastPos = position;
      rows.push({
        classLabel,
        position,
        name,
        points,
        uf: entry.pilot?.uf?.trim() || null,
      });
    }
  }
  return rows;
}

const GENERIC_TEAM_WORDS = new Set([
  'sports',
  'sport',
  'racing',
  'motorsport',
  'autosport',
  'team',
  'endurance',
]);

const ROUND_ORDINALS = {
  1: /primeira etapa|1[ªa] etapa|abertura da temporada/i,
  2: /segunda etapa|2[ªa] etapa/i,
  3: /terceira etapa|3[ªa] etapa/i,
  4: /quarta etapa|4[ªa] etapa/i,
  5: /quinta etapa|5[ªa] etapa/i,
  6: /sexta etapa|6[ªa] etapa/i,
  7: /s[eé]tima etapa|7[ªa] etapa/i,
};

function foldName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/autorsport/g, 'autosport')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000;
}

function scrapeNewsIndex(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('.card').each((_, el) => {
    const $card = $(el);
    const href = $card.find('a[href*="/noticia/"]').first().attr('href');
    const slug = slugFromHref(href, 'noticia');
    const title = $card.find('h2.card-title').first().text().replace(/\s+/g, ' ').trim();
    const date = parseBrDate($card.find('h5').first().text());
    if (!slug || !title || !date) return;
    if (items.some((item) => item.slug === slug)) return;
    items.push({
      slug,
      title,
      date,
      url: `${BASE_URL}/noticia/${slug}`,
    });
  });
  return items;
}

function isOverallWinCandidate(title) {
  const folded = foldName(title);
  if (!/vence|vitoria/.test(folded)) return false;
  if (/\bGT\s*[34]\b/i.test(title) && !/\bP1\b/i.test(title)) return false;
  return true;
}

function parseResultTeam(line) {
  const m = String(line).match(/#\d+\s+[^/]+\/([^)-]+?)\s*-\s*P1\s*\)/);
  return m ? m[1].trim() : null;
}

function parseOverallWinnerFromHtml(html) {
  const $ = cheerio.load(html);
  let best = null;
  $('ol').each((_, ol) => {
    const items = $(ol)
      .find('li')
      .map((__, li) => $(li).text().replace(/\s+/g, ' ').trim())
      .get();
    if (items.length < 5) return;
    const firstP1 = items.find((line) => /#\d+/.test(line) && /-\s*P1\s*\)/.test(line));
    if (!firstP1) return;
    const team = parseResultTeam(firstP1);
    if (!team) return;
    if (!best || items.length > best.listSize) best = { team, listSize: items.length };
  });
  return best?.team ?? null;
}

function prototypeTeams(teams, drivers) {
  const protoIds = new Set(
    drivers.filter((d) => /^P[123]/i.test(d.class ?? '')).map((d) => d.driverId),
  );
  const matched = teams.filter((team) => team.drivers.some((d) => protoIds.has(d.driverId)));
  return matched.length > 0 ? matched : teams;
}

function resolveTeamName(raw, teams) {
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

function winnerFromTitle(title, teams) {
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

function roundMentioned(text, round) {
  const pattern = ROUND_ORDINALS[round];
  return pattern ? pattern.test(text) : false;
}

function matchRace(article, races) {
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

async function attachWinnersFromNews(races, teams, drivers) {
  const completed = races.filter((race) => race.completed);
  if (completed.length === 0) return;

  const earliest = completed.map((race) => race.date).sort()[0];
  const items = [];
  for (let page = 1; page <= 8; page++) {
    if (page > 1) await sleep(REQUEST_DELAY_MS);
    const url = page === 1 ? `${BASE_URL}/noticias` : `${BASE_URL}/noticias?page=${page}`;
    const html = await fetchHtml(url);
    const pageItems = scrapeNewsIndex(html);
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    if (pageItems.every((item) => item.date < earliest)) break;
  }

  const candidates = items.filter(
    (item) => item.date >= earliest && isOverallWinCandidate(item.title),
  );
  const proto = prototypeTeams(teams, drivers);
  const reports = [];
  for (const article of candidates) {
    await sleep(REQUEST_DELAY_MS);
    const html = await fetchHtml(article.url);
    const $ = cheerio.load(html);
    reports.push({
      ...article,
      fromOl: parseOverallWinnerFromHtml(html),
      body: $.text(),
    });
  }

  for (const report of reports) {
    if (!report.fromOl) continue;
    const race = matchRace(report, races);
    if (!race || race.winner) continue;
    race.winner = resolveTeamName(report.fromOl, teams);
    console.log(`  round ${race.round}: vencedor ${race.winner} (resultado em ${report.slug}).`);
  }

  for (const report of reports) {
    if (report.fromOl) continue;
    const fromTitle = winnerFromTitle(report.title, proto);
    if (!fromTitle) continue;
    const race = matchRace(report, races);
    if (!race || race.winner) continue;
    race.winner = fromTitle;
    console.log(`  round ${race.round}: vencedor ${race.winner} (manchete ${report.slug}).`);
  }
}

async function replaceRaces(races) {
  if (DRY_RUN) {
    for (const race of races) {
      console.log(`  [dry-run] r${race.round} ${race.date} winner=${race.winner ?? 'null'}`);
    }
    return;
  }
  if (races.length === 0) return;
  const rows = races.map((r) => ({
    race_id: r.raceId,
    round: r.round,
    name: r.name,
    location: r.location,
    date: r.date,
    source_url: r.sourceUrl,
    completed: r.completed,
    winner: r.winner,
    updated_at: new Date().toISOString(),
  }));
  const { error: upsertError } = await supabase.from('eb_races').upsert(rows, { onConflict: 'race_id' });
  if (upsertError) throw upsertError;

  const keep = new Set(races.map((r) => r.raceId));
  const { data: existing, error: existingError } = await supabase.from('eb_races').select('race_id');
  if (existingError) throw existingError;
  const stale = (existing ?? []).map((r) => r.race_id).filter((id) => !keep.has(id));
  if (stale.length > 0) {
    const { error: deleteError } = await supabase.from('eb_races').delete().in('race_id', stale);
    if (deleteError) throw deleteError;
  }
}

async function replaceTeamsAndDrivers(teams, drivers) {
  if (DRY_RUN) return;
  const { error: clearDrivers } = await supabase.from('eb_drivers').delete().gte('updated_at', EPOCH);
  if (clearDrivers) throw clearDrivers;
  const { error: clearTeams } = await supabase.from('eb_teams').delete().gte('updated_at', EPOCH);
  if (clearTeams) throw clearTeams;

  if (teams.length > 0) {
    const teamRows = teams.map((t) => ({
      team_id: t.teamId,
      name: t.name,
      team_principal: t.teamPrincipal,
      source_url: t.sourceUrl,
      drivers: t.drivers,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('eb_teams').insert(teamRows);
    if (error) throw error;
  }

  if (drivers.length > 0) {
    const driverRows = drivers.map((d) => ({
      driver_id: d.driverId,
      name: d.name,
      uf: d.uf ?? null,
      class: d.class ?? null,
      team_id: d.teamId ?? null,
      source_url: d.sourceUrl,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('eb_drivers').insert(driverRows);
    if (error) throw error;
  }
}

async function replaceStandings(rows) {
  if (DRY_RUN) return;
  const { error: deleteError } = await supabase.from('eb_standings').delete().gte('updated_at', EPOCH);
  if (deleteError) throw deleteError;
  if (rows.length === 0) return;
  const insertRows = rows.map((r) => ({
    class_label: r.classLabel,
    position: r.position,
    name: r.name,
    points: r.points,
    uf: r.uf,
  }));
  const { error } = await supabase.from('eb_standings').insert(insertRows);
  if (error) throw error;
}

function enrichDrivers(indexDrivers, teams, standingRows) {
  const teamByDriverId = new Map();
  for (const team of teams) {
    for (const driver of team.drivers) {
      if (!teamByDriverId.has(driver.driverId)) teamByDriverId.set(driver.driverId, team.teamId);
    }
  }

  const standingByName = new Map();
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

async function main() {
  console.log('\n=== endurance-brasil ===');

  const calendarHtml = await fetchHtml(`${BASE_URL}/calendario`);
  const races = scrapeCalendar(calendarHtml);
  console.log(`${races.length} etapa(s) no calendario.`);

  await sleep(REQUEST_DELAY_MS);
  const teamsHtml = await fetchHtml(`${BASE_URL}/equipes`);
  const teams = scrapeTeams(teamsHtml);
  console.log(`${teams.length} equipe(s).`);

  await sleep(REQUEST_DELAY_MS);
  const driversHtml = await fetchHtml(`${BASE_URL}/pilotos`);
  const indexDrivers = scrapeDriversIndex(driversHtml);
  console.log(`${indexDrivers.length} piloto(s) no roster.`);

  await sleep(REQUEST_DELAY_MS);
  const standingsHtml = await fetchHtml(`${BASE_URL}/classificacao`);
  const standingRows = flattenStandings(parseSeasonClassifications(standingsHtml));
  const classes = [...new Set(standingRows.map((r) => r.classLabel))];
  console.log(`standings: ${standingRows.length} linha(s) em ${classes.join(', ') || '(nenhuma classe)'}.`);

  const drivers = enrichDrivers(indexDrivers, teams, standingRows);
  console.log('vencedores (noticias oficiais):');
  await attachWinnersFromNews(races, teams, drivers);

  await replaceRaces(races);
  await replaceTeamsAndDrivers(teams, drivers);
  await replaceStandings(standingRows);
  console.log('Sync endurance-brasil concluido.');
}

main().catch((error) => {
  console.error('Sync falhou:', error);
  process.exit(1);
});

// Sincroniza calendario, equipes, pilotos e classificacao do Endurance Brasil
// a partir de endurancebrasiloficial.com.br. Roda 1x/dia via GitHub Actions
// (.github/workflows/sync-endurance-brasil.yml). Nao toca tabelas gtwc_*.
//
// Diferente do GTWC, o site oficial NAO publica entry list por corrida nem
// resultado estruturado da etapa -- winner fica null. Times/pilotos vem das
// paginas de roster da temporada (/equipes, /pilotos), nao de um grid.
//
// Env vars necessarias: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

async function replaceRaces(races) {
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
  await replaceRaces(races);

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
  await replaceTeamsAndDrivers(teams, drivers);
  await replaceStandings(standingRows);
  console.log('Sync endurance-brasil concluido.');
}

main().catch((error) => {
  console.error('Sync falhou:', error);
  process.exit(1);
});

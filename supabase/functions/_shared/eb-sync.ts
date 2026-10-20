// Sync do Endurance Brasil (endurancebrasiloficial.com.br). Mesmo fluxo do
// script antigo, mais: incremental nos vencedores (so le noticias se tiver
// etapa ENCERRADA sem vencedor), protecao contra raspagem vazia/encolhida e
// gravacao atomica via funcoes SQL.
//
// Temporada: o site guarda a temporada escolhida em cookie
// (/set_season/{uuid}); sem cookie mostra sempre a atual, e o
// <select id="season_select"> diz qual e. O sync so confere que as 4
// paginas concordam na mesma temporada -- nao ha ano fixo em lugar nenhum.

import { fetchHtml, mapLimit } from './http.ts';
import {
  articleText,
  assignWinners,
  daysBetween,
  EB_BASE_URL,
  type EbDriver,
  type EbNewsItem,
  type EbRace,
  type EbReport,
  type EbStandingRow,
  type EbTeam,
  enrichDrivers,
  flattenStandings,
  isOverallWinCandidate,
  parseEbCalendar,
  parseEbDriversIndex,
  parseEbNewsIndex,
  parseEbSeason,
  parseEbTeams,
  parseOverallWinnerFromHtml,
  parseSeasonClassifications,
} from './eb-parse.ts';
import { addDays, errorMessage, isoDay, type RunContext, shrinkGuard } from './run.ts';

const SETTLE_DAYS = 3;
const MAX_NEWS_PAGES = 8;

export interface EbState {
  races: Map<string, { winner: string | null; date: string }>;
  teams: number;
  drivers: number;
  standings: number;
}

export interface EbStore {
  load(): Promise<EbState>;
  saveRaces(seasonYear: number, races: EbRace[]): Promise<void>;
  replaceRoster(teams: EbTeam[], drivers: EbDriver[]): Promise<void>;
  replaceStandings(rows: EbStandingRow[]): Promise<void>;
}

export interface EbSummary {
  seasonYear: number | null;
  races: EbRace[];
  teams: number;
  drivers: number;
  standings: { rows: number; classes: string[]; leaders: Record<string, string> };
  news: { pages: number; articles: number; skipped: boolean };
  written: { races: boolean; roster: boolean; standings: boolean };
}

export async function syncEnduranceBrasil(store: EbStore, ctx: RunContext, now = new Date()): Promise<EbSummary> {
  const today = isoDay(now);
  const summary: EbSummary = {
    seasonYear: null,
    races: [],
    teams: 0,
    drivers: 0,
    standings: { rows: 0, classes: [], leaders: {} },
    news: { pages: 0, articles: 0, skipped: false },
    written: { races: false, roster: false, standings: false },
  };

  const state = await store.load();

  // 1. As 4 paginas de temporada (o limitador por host segura a concorrencia)
  const [calendarHtml, teamsHtml, driversHtml, standingsHtml] = await Promise.all(
    ['calendario', 'equipes', 'pilotos', 'classificacao'].map((p) => fetchHtml(`${EB_BASE_URL}/${p}`)),
  );

  const seasons = [calendarHtml, teamsHtml, driversHtml, standingsHtml].map(parseEbSeason);
  const seasonIds = new Set(seasons.filter((s) => s).map((s) => s!.id));
  if (seasonIds.size > 1) {
    throw new Error(`paginas em temporadas diferentes (${seasons.map((s) => s?.year ?? '?').join(', ')}) -- tentar de novo`);
  }

  const races = parseEbCalendar(calendarHtml);
  if (races.length === 0) throw new Error('/calendario nao trouxe nenhuma etapa (layout mudou?)');
  const seasonYear = seasons.find((s) => s)?.year ?? Number(races[0].date.slice(0, 4));
  summary.seasonYear = seasonYear;

  const storedYears = [...state.races.values()].map((r) => Number(r.date.slice(0, 4)));
  const storedMaxYear = storedYears.length > 0 ? Math.max(...storedYears) : null;
  const seasonChanged = storedMaxYear != null && seasonYear > storedMaxYear;
  ctx.log(`temporada ${seasonYear}, ${races.length} etapa(s)${seasonChanged ? `, VIRADA de ${storedMaxYear}` : ''}.`);

  const teams = dedupeTeams(parseEbTeams(teamsHtml));
  const indexDrivers = parseEbDriversIndex(driversHtml);
  let standingRows: EbStandingRow[] = [];
  const classifications = parseSeasonClassifications(standingsHtml);
  if (classifications == null) {
    ctx.warn(
      'classificacao_sem_objeto',
      'classificacao',
      'objeto season_classifications nao encontrado em /classificacao (layout mudou?)',
      true,
    );
  } else {
    standingRows = flattenStandings(classifications, (m) => ctx.log(m));
  }
  const drivers = enrichDrivers(indexDrivers, teams, standingRows);
  summary.teams = teams.length;
  summary.drivers = drivers.length;
  summary.standings.rows = standingRows.length;
  summary.standings.classes = [...new Set(standingRows.map((r) => r.classLabel))];
  for (const row of standingRows) summary.standings.leaders[row.classLabel] ??= `${row.name} (${row.points})`;
  ctx.log(
    `${teams.length} equipe(s), ${drivers.length} piloto(s), standings ${standingRows.length} linha(s) em ${
      summary.standings.classes.join(', ') || '(nenhuma classe)'
    }.`,
  );

  // 2. Vencedores: reaproveita o que o banco ja tem (mesmo slug, mesmo ano).
  for (const race of races) {
    const stored = state.races.get(race.raceId);
    const fresh = addDays(race.date, SETTLE_DAYS) >= today;
    if (stored?.winner && stored.date.slice(0, 4) === race.date.slice(0, 4) && !fresh) race.winner = stored.winner;
  }
  const pending = races.filter((race) => race.completed && !race.winner);
  if (pending.length === 0) {
    summary.news.skipped = true;
    ctx.log('vencedores: todas as etapas encerradas ja tem vencedor -- noticias puladas.');
  } else {
    try {
      await attachWinnersFromNews(races, pending, teams, drivers, ctx, summary);
    } catch (error) {
      ctx.error('noticias_falhou', 'noticias', errorMessage(error));
    }
    for (const race of pending) {
      if (!race.winner && addDays(race.date, SETTLE_DAYS) < today) {
        // Volta o que o banco tinha (se tinha) -- null aqui so quer dizer "nao achei".
        ctx.warn('vencedor_nao_encontrado', `etapa ${race.round} ${race.raceId}`, 'nenhuma noticia de vitoria geral casou com a etapa');
      }
    }
  }
  summary.races = races.map((race) => ({ ...race, winner: race.winner ?? state.races.get(race.raceId)?.winner ?? null }));

  // 3. Gravacao (cada bloco independente: um falhar nao impede os outros)
  const racesGuard = shrinkGuard(races.length, state.races.size, seasonChanged, 4);
  if (!racesGuard.ok) {
    ctx.warn(
      'calendario_suspeito',
      'eb_races',
      `raspagem trouxe ${races.length} etapa(s), banco tem ${state.races.size} -- mantido o que ja estava`,
      true,
    );
  } else {
    try {
      await store.saveRaces(seasonYear, races);
      summary.written.races = true;
    } catch (error) {
      ctx.error('races_gravar', 'eb_races', errorMessage(error));
    }
  }

  const teamsGuard = shrinkGuard(teams.length, state.teams, seasonChanged, 4);
  const driversGuard = shrinkGuard(drivers.length, state.drivers, seasonChanged, 10);
  if (!teamsGuard.ok || !driversGuard.ok) {
    if (teams.length === 0 && drivers.length === 0 && state.teams === 0) {
      ctx.warn('roster_vazio', 'eb_teams/eb_drivers', 'site sem equipes/pilotos publicados', true);
    } else {
      ctx.warn(
        'roster_suspeito',
        'eb_teams/eb_drivers',
        `raspagem trouxe ${teams.length} equipe(s)/${drivers.length} piloto(s), banco tem ${state.teams}/${state.drivers} -- mantido o que ja estava`,
        true,
      );
    }
  } else {
    try {
      await store.replaceRoster(teams, drivers);
      summary.written.roster = true;
    } catch (error) {
      ctx.error('roster_gravar', 'eb_teams/eb_drivers', errorMessage(error));
    }
  }

  const anyCompleted = races.some((r) => r.completed);
  const standingsGuard = shrinkGuard(standingRows.length, state.standings, seasonChanged, 5);
  if (standingsGuard.ok) {
    try {
      await store.replaceStandings(standingRows);
      summary.written.standings = true;
    } catch (error) {
      ctx.error('standings_gravar', 'eb_standings', errorMessage(error));
    }
  } else if (standingRows.length === 0 && !anyCompleted) {
    ctx.log('standings: vazia (temporada nao comecou) -- mantido o que ja estava.');
  } else if (classifications != null) {
    ctx.warn(
      'standings_suspeita',
      'eb_standings',
      `raspagem trouxe ${standingRows.length} linha(s), banco tem ${state.standings} -- mantido o que ja estava`,
      true,
    );
  }

  return summary;
}

function dedupeTeams(teams: EbTeam[]): EbTeam[] {
  const seen = new Set<string>();
  return teams.filter((t) => (seen.has(t.teamId) ? false : (seen.add(t.teamId), true)));
}

// Igual ao script antigo, mas: pagina as noticias so ate a etapa pendente
// mais antiga, e so abre materias com data a ate 2 dias de alguma etapa
// pendente (matchRace nunca casaria as outras com uma etapa sem vencedor).
async function attachWinnersFromNews(
  races: EbRace[],
  pending: EbRace[],
  teams: EbTeam[],
  drivers: EbDriver[],
  ctx: RunContext,
  summary: EbSummary,
): Promise<void> {
  const earliest = pending.map((race) => race.date).sort()[0];
  const items: EbNewsItem[] = [];
  for (let page = 1; page <= MAX_NEWS_PAGES; page++) {
    const url = page === 1 ? `${EB_BASE_URL}/noticias` : `${EB_BASE_URL}/noticias?page=${page}`;
    const pageItems = parseEbNewsIndex(await fetchHtml(url));
    summary.news.pages++;
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    if (pageItems.every((item) => item.date < earliest)) break;
  }

  const candidates = items.filter(
    (item) => item.date >= earliest && isOverallWinCandidate(item.title) && pending.some((race) => daysBetween(race.date, item.date) <= 2),
  );
  summary.news.articles = candidates.length;
  const reports: EbReport[] = await mapLimit(candidates, 3, async (article) => {
    const html = await fetchHtml(article.url);
    return { ...article, fromOl: parseOverallWinnerFromHtml(html), body: articleText(html) };
  });
  assignWinners(races, reports, teams, drivers, (m) => ctx.log(m));
}

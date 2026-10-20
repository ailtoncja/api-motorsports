// Sync de UMA serie do GT World Challenge por execucao (europe, america ou
// asia) -- as 3 juntas levavam ~163 s no script antigo, acima do limite de
// 150 s de uma Edge Function. Rede e banco entram por parametro (GtwcStore),
// entao o mesmo codigo roda na Edge Function (store real) e no probe local
// (store que nao grava nada).
//
// Descoberta automatica de temporada (nada fixo no codigo):
//   1. /calendar sem filtro mostra a temporada atual do site; o ano dela e o
//      ano mais frequente nas datas das rodadas.
//   2. /standings tem <select id="filter_season_id"> com todas as temporadas
//      (value = id interno, texto = ano). O id da temporada do calendario e
//      a opcao cujo texto e esse ano -- usado em /results?filter_season_id=.
//   3. Se /standings estiver mostrando outra temporada, pede
//      /standings?filter_season_id={id}. Se o site devolver outra temporada
//      selecionada, a classificacao daquele ano ainda nao existe (comeco de
//      temporada) e a do ano anterior fica no banco ate sair a nova.
//   4. Os params de classificacao (ex.: "0_0_drivers", "16_31_teams") saem
//      do <select id="filter_standing_type"> dessa temporada, escolhidos pelo
//      TEXTO da opcao (ver pickStandingOptions).
//   5. O ano do entry list (/entry-list/{ano}/{slug}) e o ano do passo 1.
// Em 2027, quando o site virar, tudo isso muda sozinho.

import { fetchHtml, HttpError, mapLimit } from './http.ts';
import {
  type CalendarRace,
  calendarSeasonYear,
  type Entry,
  EXPECTED_STANDINGS,
  parseCalendar,
  parseEntryTable,
  parseRaceSessionOptions,
  parseSeasonOptions,
  parseSessionWinnerTeam,
  parseStandingOptions,
  parseStandingsTable,
  pickStandingOptions,
  type SeasonOption,
  type SeriesId,
  type StandingRow,
  type StandingTarget,
} from './gtwc-parse.ts';
import { addDays, errorMessage, isoDay, type RunContext, shrinkGuard } from './run.ts';

export const SERIES_CONFIG: Record<SeriesId, { baseUrl: string; scrapeEntryLists: boolean }> = {
  europe: { baseUrl: 'https://www.gt-world-challenge-europe.com', scrapeEntryLists: true },
  america: { baseUrl: 'https://www.gt-world-challenge-america.com', scrapeEntryLists: true },
  // Asia: entry list oficial e PDF -- continua com carga manual
  // (supabase/seed_asia.sql). So calendario/vencedor/classificacao.
  asia: { baseUrl: 'https://www.gt-world-challenge-asia.com', scrapeEntryLists: false },
};

export const SERIES_IDS = Object.keys(SERIES_CONFIG) as SeriesId[];

export function isSeriesId(value: string | null): value is SeriesId {
  return value != null && (SERIES_IDS as string[]).includes(value);
}

// Dias depois do fim do evento em que vencedor e entry list ainda sao
// re-raspados mesmo se ja estiverem no banco (resultado provisorio,
// punicao, troca de piloto de ultima hora). Depois disso, so se faltar.
const SETTLE_DAYS = 3;

export interface StoredRace {
  winner: string | null;
  date: string;
  entries: number;
}

export interface GtwcState {
  races: Map<string, StoredRace>;
  standings: Map<string, number>; // `${standingType}|${classLabel}` -> linhas
}

export interface RaceRow {
  race_id: string;
  round: number;
  name: string;
  location: string | null;
  date: string;
  winner: string | null; // null = "nao sei" (o banco mantem o que tinha)
}

export interface StandingDbRow {
  standing_type: 'drivers' | 'teams';
  class_label: string;
  position: number;
  name: string;
  points: number;
}

export interface GtwcStore {
  load(series: SeriesId): Promise<GtwcState>;
  saveRaces(series: SeriesId, seasonYear: number, rows: RaceRow[]): Promise<void>;
  replaceEntries(series: SeriesId, raceId: string, sourceUrl: string, entries: Entry[]): Promise<void>;
  replaceStandings(series: SeriesId, rows: StandingDbRow[]): Promise<void>;
}

export interface GtwcSummary {
  series: SeriesId;
  seasonYear: number | null;
  seasonId: string | null;
  races: (CalendarRace & { winner: string | null })[];
  winners: { scraped: number; found: number; skipped: number };
  standings: { classLabel: string; standingType: string; rows: number; written: boolean; top?: StandingRow }[];
  entries: { scraped: number; written: number; skipped: number; cars: Record<string, number> };
}

const standingKey = (type: string, classLabel: string) => `${type}|${classLabel}`;

async function discoverSeason(
  baseUrl: string,
  seasonYear: number,
  ctx: RunContext,
): Promise<{ season: SeasonOption; standingsHtml: string | null }> {
  let html = await fetchHtml(`${baseUrl}/standings`);
  let options = parseSeasonOptions(html);
  if (options.length === 0) {
    // Plano B: o mesmo <select> existe em /results.
    options = parseSeasonOptions(await fetchHtml(`${baseUrl}/results`));
  }
  const season = options.find((o) => o.year === seasonYear);
  if (!season) {
    throw new Error(
      `temporada ${seasonYear} (ano do /calendar) nao aparece no <select> filter_season_id (${
        options.map((o) => o.year).join(', ') || 'vazio'
      })`,
    );
  }
  const shown = parseSeasonOptions(html).find((o) => o.selected);
  if (shown?.id === season.id) return { season, standingsHtml: html };

  html = await fetchHtml(`${baseUrl}/standings?filter_season_id=${season.id}`);
  const shownNow = parseSeasonOptions(html).find((o) => o.selected);
  if (shownNow?.id === season.id) return { season, standingsHtml: html };
  ctx.log(`classificacao ${seasonYear} ainda nao publicada (site mostra ${shownNow?.year ?? '?'}).`);
  return { season, standingsHtml: null };
}

// Vencedor = time (carro de GT3 tem 2-3 pilotos). Sprint (Race 1 + Race 2)
// e Asia (2 corridas por evento) juntam os vencedores com " / ".
// `complete` = toda sessao de corrida listada ja tem P1 -- se faltar alguma
// (ex.: sabado de fim de semana Sprint), nao grava vencedor parcial.
async function scrapeRaceWinner(
  baseUrl: string,
  seasonId: string,
  eventId: string,
): Promise<{ winner: string | null; complete: boolean; sessions: number }> {
  const base = `${baseUrl}/results?filter_season_id=${seasonId}&filter_meeting_id=${eventId}`;
  const sessions = parseRaceSessionOptions(await fetchHtml(base));
  if (sessions.length === 0) return { winner: null, complete: false, sessions: 0 };
  const winners = await mapLimit(sessions, 2, async (s) => parseSessionWinnerTeam(await fetchHtml(`${base}&filter_race_id=${s.id}`)));
  const found = winners.filter((w): w is string => !!w);
  const complete = found.length === sessions.length;
  return { winner: complete ? found.join(' / ') : null, complete, sessions: sessions.length };
}

export async function syncGtwcSeries(series: SeriesId, store: GtwcStore, ctx: RunContext, now = new Date()): Promise<GtwcSummary> {
  const { baseUrl, scrapeEntryLists } = SERIES_CONFIG[series];
  const today = isoDay(now);
  const summary: GtwcSummary = {
    series,
    seasonYear: null,
    seasonId: null,
    races: [],
    winners: { scraped: 0, found: 0, skipped: 0 },
    standings: [],
    entries: { scraped: 0, written: 0, skipped: 0, cars: {} },
  };

  const state = await store.load(series);

  // 1. Calendario + temporada
  const races = parseCalendar(await fetchHtml(`${baseUrl}/calendar`));
  if (races.length === 0) throw new Error('/calendar nao trouxe nenhuma rodada (layout mudou?)');
  const seasonYear = calendarSeasonYear(races)!;
  const { season, standingsHtml } = await discoverSeason(baseUrl, seasonYear, ctx);
  summary.seasonYear = seasonYear;
  summary.seasonId = season.id;

  const storedYears = [...state.races.values()].map((r) => Number(r.date.slice(0, 4)));
  const storedMaxYear = storedYears.length > 0 ? Math.max(...storedYears) : null;
  const seasonChanged = storedMaxYear != null && seasonYear > storedMaxYear;
  ctx.log(
    `temporada ${seasonYear} (season id ${season.id}), ${races.length} rodada(s)${seasonChanged ? `, VIRADA de ${storedMaxYear}` : ''}.`,
  );
  if (races.length < 4) ctx.warn('poucas_rodadas', 'calendar', `so ${races.length} rodada(s) no /calendar`, true);

  const sameSeason = (race: CalendarRace) => {
    const stored = state.races.get(race.raceId);
    return stored && race.date && stored.date.slice(0, 4) === race.date.slice(0, 4) ? stored : null;
  };
  const settled = (race: CalendarRace) => addDays(race.endDate ?? race.date!, SETTLE_DAYS) < today;
  const finished = (race: CalendarRace) => (race.endDate ?? race.date!) < today;

  // 2. Vencedores (so rodadas ja iniciadas; pula as que ja tem vencedor
  // gravado e ja "assentaram")
  const winnerByRace = new Map<string, string | null>();
  const toScrape = races.filter((race) => {
    if (!(race.date! < today)) return false; // corrida futura, sem resultado ainda
    const stored = sameSeason(race);
    if (stored?.winner && settled(race)) {
      summary.winners.skipped++;
      return false;
    }
    return true;
  });
  await mapLimit(toScrape, 2, async (race) => {
    summary.winners.scraped++;
    try {
      const result = await scrapeRaceWinner(baseUrl, season.id, race.eventId);
      winnerByRace.set(race.raceId, result.winner);
      if (result.winner) {
        summary.winners.found++;
        ctx.log(`round ${race.round}: vencedor ${result.winner}.`);
      } else if (finished(race) && !sameSeason(race)?.winner) {
        const why = result.sessions === 0 ? 'nenhuma sessao de corrida em /results' : 'sessao de corrida sem P1';
        ctx.warn('vencedor_nao_encontrado', `round ${race.round} ${race.raceId}`, why);
      }
    } catch (error) {
      ctx.error('vencedor_falhou', `round ${race.round} ${race.raceId}`, errorMessage(error));
    }
  });

  summary.races = races.map((race) => ({ ...race, winner: winnerByRace.get(race.raceId) ?? sameSeason(race)?.winner ?? null }));

  // 3. Grava calendario (+ vencedores). null = mantem o que o banco tinha.
  try {
    await store.saveRaces(
      series,
      seasonYear,
      races.map((race) => ({
        race_id: race.raceId,
        round: race.round,
        name: race.name,
        location: race.location,
        date: race.date!,
        winner: winnerByRace.get(race.raceId) ?? null,
      })),
    );
  } catch (error) {
    // Sem gtwc_races gravado nao da pra gravar entry list (FK) -- para aqui.
    throw new Error(`gravar gtwc_races: ${errorMessage(error)}`);
  }

  // 4. Classificacao
  const anyFinished = races.some(finished);
  if (standingsHtml == null) {
    if (anyFinished) {
      ctx.warn(
        'standings_indisponivel',
        'standings',
        `site ainda nao publicou classificacao ${seasonYear} mas ja ha rodada disputada`,
        true,
      );
    }
  } else {
    const targets = pickStandingOptions(series, parseStandingOptions(standingsHtml));
    if (targets.length < EXPECTED_STANDINGS[series]) {
      ctx.warn(
        'standings_nao_mapeadas',
        'standings',
        `achei ${targets.length}/${EXPECTED_STANDINGS[series]} classificacoes no <select> (rotulos mudaram?)`,
        true,
      );
    }
    const toWrite: StandingDbRow[] = [];
    await mapLimit(targets, 2, async (target: StandingTarget) => {
      const scope = `standings ${target.standingType}/${target.classLabel}`;
      try {
        const rows = parseStandingsTable(
          await fetchHtml(`${baseUrl}/standings?filter_season_id=${season.id}&filter_standing_type=${target.param}`),
        );
        const stored = state.standings.get(standingKey(target.standingType, target.classLabel)) ?? 0;
        const guard = shrinkGuard(rows.length, stored, seasonChanged, 4);
        summary.standings.push({
          standingType: target.standingType,
          classLabel: target.classLabel,
          rows: rows.length,
          written: guard.ok,
          top: rows[0],
        });
        if (guard.ok) {
          toWrite.push(...rows.map((r) => ({ standing_type: target.standingType, class_label: target.classLabel, ...r })));
          ctx.log(`${scope}: ${rows.length} posicao(oes).`);
        } else if (rows.length === 0 && !anyFinished) {
          ctx.log(`${scope}: vazia (temporada nao comecou).`);
        } else {
          ctx.warn(
            'standings_suspeita',
            scope,
            `raspagem trouxe ${rows.length} linha(s), banco tem ${stored} -- mantido o que ja estava`,
            true,
          );
        }
      } catch (error) {
        ctx.error('standings_falhou', scope, errorMessage(error));
      }
    });
    if (toWrite.length > 0) {
      try {
        await store.replaceStandings(series, toWrite);
      } catch (error) {
        ctx.error('standings_gravar', 'standings', errorMessage(error));
        for (const s of summary.standings) s.written = false;
      }
    }
  }

  // 5. Entry list (Europe/America). Pula rodada ja disputada e assentada
  // que ja tem grid no banco.
  if (!scrapeEntryLists) {
    ctx.log('entry list nao automatizado pra essa serie (site so publica PDF).');
    return summary;
  }
  const entryTargets = races.filter((race) => {
    const stored = sameSeason(race);
    if (stored && stored.entries > 0 && settled(race)) {
      summary.entries.skipped++;
      return false;
    }
    return true;
  });
  let outOfTime = false;
  await mapLimit(entryTargets, 3, async (race) => {
    if (ctx.timeLeftMs() < 15_000) {
      if (!outOfTime) {
        ctx.warn('tempo_esgotado', 'entry list', 'orcamento de tempo acabando -- entry lists restantes ficam pra proxima execucao');
      }
      outOfTime = true;
      return;
    }
    const scope = `entry list round ${race.round} ${race.raceId}`;
    const url = `${baseUrl}/entry-list/${seasonYear}/${race.raceId}`;
    const stored = sameSeason(race)?.entries ?? 0;
    try {
      summary.entries.scraped++;
      let entries: Entry[] = [];
      try {
        entries = parseEntryTable(await fetchHtml(url));
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 404)) throw error;
      }
      summary.entries.cars[race.raceId] = entries.length;
      const guard = shrinkGuard(entries.length, stored, seasonChanged, 10);
      if (guard.ok) {
        await store.replaceEntries(series, race.raceId, url, entries);
        summary.entries.written++;
        ctx.log(`round ${race.round} (${race.raceId}): ${entries.length} carro(s).`);
      } else if (guard.suspicious) {
        ctx.warn(
          'entry_list_suspeito',
          scope,
          `raspagem trouxe ${entries.length} carro(s), banco tem ${stored} -- mantido o que ja estava`,
          true,
        );
      } else if (finished(race)) {
        ctx.warn('entry_list_vazio', scope, 'rodada ja disputada sem entry list no site');
      }
    } catch (error) {
      ctx.error('entry_list_falhou', scope, errorMessage(error));
    }
  });
  return summary;
}

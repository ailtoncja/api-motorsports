import { Router, type Response } from 'express';
import { CACHE_NONE, notFound, serverError } from '../http.js';
import { pitstophubData } from '../pitstophub-data.js';
import type {
  BrasilCategory,
  BrasilDriver,
  BrasilRace,
  BrasilRaceDetail,
  BrasilRaceSession,
  BrasilResultRow,
  BrasilStandings,
  BrasilStandingsClass,
} from '../brasil-types.js';

const router = Router();

export type CategoryConfig = {
  /** Como a categoria e identificada no banco do PitStopHub. */
  categoryId: string;
  name: string;
  /** Nome da lista principal (synced_standings) desta categoria. */
  mainClassLabel: string;
  /** grp de standings_detail -> nome mostrado. grp fora daqui usa o proprio grp. */
  groupLabels: Record<string, string>;
  /** Ordem das divisoes na resposta; o que nao estiver aqui vai depois, em ordem alfabetica. */
  groupOrder: string[];
};

// Todas as 11 categorias alimentadas pelo motor do pitstophub-data no Supabase do PitStopHub.
// A Porsche Cup disputa dois campeonatos (Sprint e Endurance) divididos em Carrera/Challenge/Trophy.
// WEC (Hypercar/LMGT3), IMSA (GTP/LMP2/GTD Pro/GTD) e WRC (WRC/WRC2/WRC3) tambem podem ter divisoes
// em standings_detail. As demais tem lista principal "Geral" (e eventual grupo "teams" em standings_detail).
export const ENGINE_CATEGORIES: Record<string, CategoryConfig> = {
  'nascar-brasil': {
    categoryId: 'nascar-brasil',
    name: 'NASCAR Brasil',
    mainClassLabel: 'Geral',
    groupLabels: {},
    groupOrder: [],
  },
  'porsche-cup': {
    categoryId: 'porsche-cup',
    name: 'Porsche Cup Brasil',
    mainClassLabel: 'Sprint Carrera',
    groupLabels: {
      challenge: 'Sprint Challenge',
      trophy: 'Sprint Trophy',
      endurance: 'Endurance Carrera',
      'endurance-challenge': 'Endurance Challenge',
    },
    groupOrder: ['challenge', 'trophy', 'endurance', 'endurance-challenge'],
  },
  f2: {
    categoryId: 'f2',
    name: 'Fórmula 2',
    mainClassLabel: 'Geral',
    groupLabels: {},
    groupOrder: [],
  },
  f3: {
    categoryId: 'f3',
    name: 'Fórmula 3',
    mainClassLabel: 'Geral',
    groupLabels: {},
    groupOrder: [],
  },
  'f1-academy': {
    categoryId: 'f1-academy',
    name: 'F1 Academy',
    mainClassLabel: 'Geral',
    groupLabels: {},
    groupOrder: [],
  },
  wec: {
    categoryId: 'wec',
    name: 'WEC',
    mainClassLabel: 'Hypercar',
    groupLabels: {
      hypercar: 'Hypercar',
      'class:hypercar': 'Hypercar',
      lmgt3: 'LMGT3',
      'class:lmgt3': 'LMGT3',
      lmp2: 'LMP2',
      'class:lmp2': 'LMP2',
    },
    groupOrder: ['hypercar', 'class:hypercar', 'lmgt3', 'class:lmgt3', 'lmp2', 'class:lmp2'],
  },
  imsa: {
    categoryId: 'imsa',
    name: 'IMSA',
    mainClassLabel: 'GTP',
    groupLabels: {
      gtp: 'GTP',
      'class:gtp': 'GTP',
      lmp2: 'LMP2',
      'class:lmp2': 'LMP2',
      'gtd-pro': 'GTD Pro',
      gtdpro: 'GTD Pro',
      'class:gtdpro': 'GTD Pro',
      'class:gtd-pro': 'GTD Pro',
      gtd: 'GTD',
      'class:gtd': 'GTD',
    },
    groupOrder: ['gtp', 'class:gtp', 'lmp2', 'class:lmp2', 'gtd-pro', 'gtdpro', 'class:gtdpro', 'class:gtd-pro', 'gtd', 'class:gtd'],
  },
  dtm: {
    categoryId: 'dtm',
    name: 'DTM',
    mainClassLabel: 'Geral',
    groupLabels: {},
    groupOrder: [],
  },
  indy: {
    categoryId: 'indy',
    name: 'IndyCar',
    mainClassLabel: 'Geral',
    groupLabels: {},
    groupOrder: [],
  },
  nascar: {
    categoryId: 'nascar',
    name: 'NASCAR',
    mainClassLabel: 'Geral',
    groupLabels: {},
    groupOrder: [],
  },
  wrc: {
    categoryId: 'wrc',
    name: 'WRC',
    mainClassLabel: 'Geral',
    groupLabels: {
      wrc2: 'WRC2',
      wrc3: 'WRC3',
      jwrc: 'JWRC',
    },
    groupOrder: ['wrc2', 'wrc3', 'jwrc'],
  },
};

const MAIN_GROUP = 'drivers';
const TEAM_GROUPS = new Set(['teams', 'constructors']);
const IGNORED_GROUPS = new Set(['manufacturers']);

function isTeamGroup(grp: string): boolean {
  const lower = grp.toLowerCase();
  return TEAM_GROUPS.has(lower) || lower.startsWith('teams:') || lower.startsWith('team-') || lower.startsWith('constructors:');
}

function isIgnoredGroup(grp: string): boolean {
  return IGNORED_GROUPS.has(grp.toLowerCase());
}

function driverClassLabel(grp: string, config: CategoryConfig): string {
  const lower = grp.toLowerCase();
  const stripped = lower.replace(/^class:/, '');
  return (
    config.groupLabels[grp] ??
    config.groupLabels[lower] ??
    config.groupLabels[stripped] ??
    grp.replace(/^class:/i, '')
  );
}

function teamClassLabel(grp: string, config: CategoryConfig): string {
  const lower = grp.toLowerCase();
  if (TEAM_GROUPS.has(lower)) return 'Geral';
  const suffix = grp.replace(/^(teams:|team-|constructors:)/i, '');
  return config.groupLabels[suffix.toLowerCase()] ?? config.groupLabels[grp] ?? suffix;
}

function unavailable(res: Response): void {
  res.setHeader('Cache-Control', CACHE_NONE);
  res.status(503).json({ error: 'Categoria temporariamente indisponível.' });
}

export type ResolvedSeason = {
  season: number | null;
  /** false quando a tabela ainda tem linhas legadas com season = null (ano vem de date). */
  bySeasonColumn: boolean;
};

/**
 * Temporada publicada: a mais recente que tem calendario. Tudo numa resposta sai
 * dessa mesma temporada -- calendario de 2027 com classificacao de 2026 seria
 * misturar dois campeonatos diferentes.
 * Se a categoria tiver apenas linhas legadas sem coluna `season` preenchida,
 * descobre o ano pela data mais recente do calendario.
 */
export async function resolveSeason(categoryId: string): Promise<ResolvedSeason> {
  const db = pitstophubData();
  if (!db) return { season: null, bySeasonColumn: true };
  const { data, error } = await db
    .from('synced_races')
    .select('season')
    .eq('category_id', categoryId)
    .not('season', 'is', null)
    .order('season', { ascending: false })
    .limit(1);
  if (!error && data?.[0]?.season != null) {
    return { season: Number(data[0].season), bySeasonColumn: true };
  }

  // Fallback defensivo: linhas onde `season` esta null mas `date` existe.
  const fallback = await db
    .from('synced_races')
    .select('date')
    .eq('category_id', categoryId)
    .order('date', { ascending: false })
    .limit(1);
  if (fallback.error) {
    if (error) throw error;
    throw fallback.error;
  }
  const latestDate = fallback.data?.[0]?.date;
  const year = typeof latestDate === 'string' ? Number(latestDate.slice(0, 4)) : NaN;
  if (Number.isFinite(year) && year > 1900) {
    return { season: year, bySeasonColumn: false };
  }
  return { season: null, bySeasonColumn: true };
}

export type RaceRow = {
  category_id?: string;
  season?: number | null;
  race_id: string;
  round: number | null;
  name: string;
  en_name?: string | null;
  location: string | null;
  en_location?: string | null;
  circuit: string | null;
  date: string;
  starts_at?: string | null;
  status: string | null;
  winner: string | null;
  official?: boolean | null;
  source_url?: string | null;
  source?: string | null;
  updated_at?: string | null;
};

export function mapRace(row: RaceRow): BrasilRace {
  const status = row.status === 'completed' || row.status === 'cancelled' ? row.status : 'upcoming';
  const mapped: BrasilRace = {
    raceId: row.race_id,
    round: row.round ?? null,
    name: row.name,
    location: row.location ?? null,
    circuit: row.circuit ?? null,
    date: row.date,
    startsAt: row.starts_at ?? null,
    status,
    winner: row.winner ?? null,
    official: row.official ?? true,
    sourceUrl: row.source_url ?? null,
  };
  if (row.en_name != null) mapped.enName = row.en_name;
  if (row.en_location != null) mapped.enLocation = row.en_location;
  return mapped;
}

export const RACE_COLUMNS =
  'race_id, round, name, en_name, location, en_location, circuit, date, starts_at, status, winner, official, source_url';
const LEGACY_RACE_COLUMNS = 'race_id, round, name, en_name, location, en_location, circuit, date, starts_at, status, winner';

export function mapResultRows(rows: unknown): BrasilResultRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const item: BrasilResultRow = {
      position: typeof r.position === 'number' ? r.position : null,
      driver: typeof r.driver === 'string' ? r.driver : '',
      number: typeof r.number === 'string' ? r.number : null,
      points: typeof r.points === 'number' ? r.points : null,
      status: typeof r.status === 'string' ? r.status : null,
    };
    if (typeof r.team === 'string') item.team = r.team;
    if (typeof r.time === 'string') item.time = r.time;
    if (typeof r.laps === 'number') item.laps = r.laps;
    return item;
  });
}

export type StandingRowInput = {
  position: number;
  name: string;
  team: string | null;
  points: number | string;
  as_of_round?: number | null;
};

export type StandingDetailRowInput = StandingRowInput & {
  grp: string;
};

export function buildEngineStandings(
  config: CategoryConfig,
  season: number,
  mainRows: StandingRowInput[],
  detailRows: StandingDetailRowInput[],
): BrasilStandings {
  const driverClasses: BrasilStandingsClass[] = [];
  const byDriverGroup = new Map<string, BrasilStandingsClass>();
  const byTeamGroup = new Map<string, BrasilStandingsClass>();
  let asOfRound: number | null = null;

  const mainEntries = mainRows.map((row) => {
    if (row.as_of_round != null) asOfRound = Math.max(asOfRound ?? 0, row.as_of_round);
    return { position: row.position, name: row.name, team: row.team ?? null, points: Number(row.points) };
  });
  if (mainEntries.length > 0) {
    driverClasses.push({ classLabel: config.mainClassLabel, entries: mainEntries });
  }

  for (const row of detailRows) {
    if (row.grp === MAIN_GROUP || isIgnoredGroup(row.grp)) continue;
    if (row.as_of_round != null) asOfRound = Math.max(asOfRound ?? 0, row.as_of_round);

    if (isTeamGroup(row.grp)) {
      const label = teamClassLabel(row.grp, config);
      let group = byTeamGroup.get(label);
      if (!group) {
        group = { classLabel: label, entries: [] };
        byTeamGroup.set(label, group);
      }
      group.entries.push({
        position: row.position,
        name: row.name,
        team: row.team ?? null,
        points: Number(row.points),
      });
      continue;
    }

    const label = driverClassLabel(row.grp, config);
    // Evita duplicar a lista principal se standings_detail repetir a mesma classe de synced_standings.
    if (mainEntries.length > 0 && label.toLowerCase() === config.mainClassLabel.toLowerCase()) continue;

    let group = byDriverGroup.get(row.grp);
    if (!group) {
      group = { classLabel: label, entries: [] };
      byDriverGroup.set(row.grp, group);
    }
    group.entries.push({
      position: row.position,
      name: row.name,
      team: row.team ?? null,
      points: Number(row.points),
    });
  }

  const rank = (grp: string) => {
    const idx = config.groupOrder.indexOf(grp);
    if (idx !== -1) return idx;
    const lowerIdx = config.groupOrder.indexOf(grp.toLowerCase());
    return lowerIdx === -1 ? config.groupOrder.length : lowerIdx;
  };
  const orderedDrivers = [...byDriverGroup.entries()].sort(
    ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b),
  );
  for (const [, group] of orderedDrivers) driverClasses.push(group);

  const teamClasses = [...byTeamGroup.values()].filter((g) => g.entries.length > 0);

  return {
    season,
    asOfRound,
    drivers: driverClasses.length > 0 ? driverClasses : null,
    teams: teamClasses.length > 0 ? teamClasses : null,
  };
}

export function buildEngineDrivers(
  config: CategoryConfig,
  resultRows: { rows: unknown }[],
  mainStandings: { name: string; team?: string | null }[],
  detailStandings: { grp: string; name: string; team?: string | null }[],
): BrasilDriver[] {
  const drivers = new Map<string, BrasilDriver>();
  const add = (name: string, number: string | null, className: string | null, team?: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const driverId = slugify(trimmed);
    let driver = drivers.get(driverId);
    if (!driver) {
      driver = { driverId, name: trimmed, number: null, classes: [] };
      drivers.set(driverId, driver);
    }
    if (number && !driver.number) driver.number = number;
    if (team && !driver.team) driver.team = team;
    if (className && !driver.classes.includes(className)) driver.classes.push(className);
  };

  for (const row of resultRows) {
    for (const entry of mapResultRows(row.rows)) add(entry.driver, entry.number, null, entry.team);
  }
  for (const row of mainStandings) add(row.name, null, config.mainClassLabel, row.team);
  for (const row of detailStandings) {
    if (row.grp === MAIN_GROUP || isTeamGroup(row.grp) || isIgnoredGroup(row.grp)) continue;
    add(row.name, null, driverClassLabel(row.grp, config), row.team);
  }

  return [...drivers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function queryCategoryRaces(categoryId: string, resolved: ResolvedSeason): Promise<RaceRow[]> {
  const db = pitstophubData();
  if (!db || resolved.season == null) return [];

  let query = db.from('synced_races').select(RACE_COLUMNS).eq('category_id', categoryId);
  if (resolved.bySeasonColumn) query = query.eq('season', resolved.season);
  const res = await query.order('round', { ascending: true });

  if (res.error && /column .* does not exist/i.test(res.error.message)) {
    const legacy = await db
      .from('synced_races')
      .select(LEGACY_RACE_COLUMNS)
      .eq('category_id', categoryId)
      .order('round', { ascending: true });
    if (legacy.error) throw legacy.error;
    const rows = (legacy.data ?? []) as RaceRow[];
    return resolved.bySeasonColumn ? rows : rows.filter((r) => r.date?.startsWith(`${resolved.season}-`));
  }

  if (res.error) throw res.error;
  const rows = (res.data ?? []) as RaceRow[];
  return resolved.bySeasonColumn ? rows : rows.filter((r) => r.date?.startsWith(`${resolved.season}-`));
}

function registerCategory(config: CategoryConfig, path: string): void {
  const { categoryId } = config;

  router.get(path, async (req, res) => {
    const db = pitstophubData();
    if (!db) {
      unavailable(res);
      return;
    }
    try {
      const { season } = await resolveSeason(categoryId);
      const { data, error } = await db
        .from('synced_races')
        .select('source, updated_at')
        .eq('category_id', categoryId)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const category: BrasilCategory = {
        id: categoryId,
        name: config.name,
        season,
        source: data?.[0]?.source ?? null,
        lastUpdate: data?.[0]?.updated_at ?? null,
      };
      res.json(category);
    } catch (error) {
      serverError(res, req.path, error);
    }
  });

  router.get(`${path}/races`, async (req, res) => {
    const db = pitstophubData();
    if (!db) {
      unavailable(res);
      return;
    }
    try {
      const resolved = await resolveSeason(categoryId);
      if (resolved.season == null) {
        res.json([]);
        return;
      }
      const rows = await queryCategoryRaces(categoryId, resolved);
      res.json(rows.map(mapRace));
    } catch (error) {
      serverError(res, req.path, error);
    }
  });

  router.get(`${path}/races/:raceId`, async (req, res) => {
    const db = pitstophubData();
    if (!db) {
      unavailable(res);
      return;
    }
    const { raceId } = req.params;
    try {
      const resolved = await resolveSeason(categoryId);
      if (resolved.season == null) {
        notFound(res, `Corrida "${raceId}" não encontrada.`);
        return;
      }
      let raceQuery = db
        .from('synced_races')
        .select(RACE_COLUMNS)
        .eq('category_id', categoryId)
        .eq('race_id', raceId);
      if (resolved.bySeasonColumn) raceQuery = raceQuery.eq('season', resolved.season);
      const { data, error } = await raceQuery.maybeSingle();
      if (error) throw error;
      if (!data || (!resolved.bySeasonColumn && !String((data as RaceRow).date ?? '').startsWith(`${resolved.season}-`))) {
        notFound(res, `Corrida "${raceId}" não encontrada.`);
        return;
      }

      const results = await db
        .from('race_results')
        .select('session, official, rows')
        .eq('category_id', categoryId)
        .eq('season', resolved.season)
        .eq('race_id', raceId)
        .order('session', { ascending: true });
      // Se a tabela race_results nao existir no banco legado, devolve sessions: [] sem falhar a corrida.
      const resultRows = results.error && /relation .* does not exist/i.test(results.error.message) ? [] : null;
      if (results.error && resultRows === null) throw results.error;

      const sessions: BrasilRaceSession[] = (resultRows ?? results.data ?? []).map((row) => ({
        session: row.session,
        official: row.official ?? true,
        rows: mapResultRows(row.rows),
      }));

      const detail: BrasilRaceDetail = { ...mapRace(data as RaceRow), sessions };
      res.json(detail);
    } catch (error) {
      serverError(res, req.path, error);
    }
  });

  router.get(`${path}/standings`, async (req, res) => {
    const db = pitstophubData();
    if (!db) {
      unavailable(res);
      return;
    }
    try {
      const resolved = await resolveSeason(categoryId);
      if (resolved.season == null) {
        res.json({ season: null, asOfRound: null, drivers: null, teams: null } satisfies BrasilStandings);
        return;
      }

      let mainQuery = db
        .from('synced_standings')
        .select('position, name, team, points, as_of_round')
        .eq('category_id', categoryId);
      if (resolved.bySeasonColumn) mainQuery = mainQuery.eq('season', resolved.season);

      const [main, detail] = await Promise.all([
        mainQuery.order('position', { ascending: true }),
        db
          .from('standings_detail')
          .select('grp, position, name, team, points, as_of_round')
          .eq('category_id', categoryId)
          .eq('season', resolved.season)
          .order('position', { ascending: true }),
      ]);
      if (main.error) throw main.error;
      const detailData =
        detail.error && /relation .* does not exist/i.test(detail.error.message) ? [] : null;
      if (detail.error && detailData === null) throw detail.error;

      const standings = buildEngineStandings(
        config,
        resolved.season,
        (main.data ?? []) as StandingRowInput[],
        (detailData ?? detail.data ?? []) as StandingDetailRowInput[],
      );
      res.json(standings);
    } catch (error) {
      serverError(res, req.path, error);
    }
  });

  router.get(`${path}/drivers`, async (req, res) => {
    const db = pitstophubData();
    if (!db) {
      unavailable(res);
      return;
    }
    try {
      const resolved = await resolveSeason(categoryId);
      if (resolved.season == null) {
        res.json([]);
        return;
      }

      let mainQuery = db.from('synced_standings').select('name').eq('category_id', categoryId);
      if (resolved.bySeasonColumn) mainQuery = mainQuery.eq('season', resolved.season);

      const [results, main, detail] = await Promise.all([
        db.from('race_results').select('rows').eq('category_id', categoryId).eq('season', resolved.season),
        mainQuery,
        db.from('standings_detail').select('grp, name').eq('category_id', categoryId).eq('season', resolved.season),
      ]);
      const resultsData =
        results.error && /relation .* does not exist/i.test(results.error.message) ? [] : null;
      if (results.error && resultsData === null) throw results.error;
      if (main.error) throw main.error;
      const detailData =
        detail.error && /relation .* does not exist/i.test(detail.error.message) ? [] : null;
      if (detail.error && detailData === null) throw detail.error;

      const drivers = buildEngineDrivers(
        config,
        (resultsData ?? results.data ?? []) as { rows: unknown }[],
        (main.data ?? []) as { name: string }[],
        (detailData ?? detail.data ?? []) as { grp: string; name: string }[],
      );
      res.json(drivers);
    } catch (error) {
      serverError(res, req.path, error);
    }
  });
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

for (const [path, config] of Object.entries(ENGINE_CATEGORIES)) {
  registerCategory(config, `/${path}`);
}

export default router;

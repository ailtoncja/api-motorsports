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

type CategoryConfig = {
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

// A Porsche Cup disputa dois campeonatos (Sprint e Endurance) divididos em
// Carrera/Challenge/Trophy. A lista principal do motor e a Carrera do Sprint;
// as outras vem de standings_detail. A NASCAR Brasil tem uma lista so.
const CATEGORIES: Record<string, CategoryConfig> = {
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
};

const MAIN_GROUP = 'drivers';

function unavailable(res: Response): void {
  res.setHeader('Cache-Control', CACHE_NONE);
  res.status(503).json({ error: 'Categoria temporariamente indisponível.' });
}

/**
 * Temporada publicada: a mais recente que tem calendario. Tudo numa resposta sai
 * dessa mesma temporada -- calendario de 2027 com classificacao de 2026 seria
 * misturar dois campeonatos diferentes.
 */
async function currentSeason(categoryId: string): Promise<number | null> {
  const db = pitstophubData();
  if (!db) return null;
  const { data, error } = await db
    .from('synced_races')
    .select('season')
    .eq('category_id', categoryId)
    .not('season', 'is', null)
    .order('season', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.season ?? null;
}

type RaceRow = {
  race_id: string;
  round: number | null;
  name: string;
  location: string | null;
  circuit: string | null;
  date: string;
  starts_at: string | null;
  status: string | null;
  winner: string | null;
  official: boolean | null;
  source_url: string | null;
};

function mapRace(row: RaceRow): BrasilRace {
  const status = row.status === 'completed' || row.status === 'cancelled' ? row.status : 'upcoming';
  return {
    raceId: row.race_id,
    round: row.round,
    name: row.name,
    location: row.location,
    circuit: row.circuit,
    date: row.date,
    startsAt: row.starts_at,
    status,
    winner: row.winner,
    official: row.official ?? true,
    sourceUrl: row.source_url,
  };
}

const RACE_COLUMNS = 'race_id, round, name, location, circuit, date, starts_at, status, winner, official, source_url';

function mapResultRows(rows: unknown): BrasilResultRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      position: typeof r.position === 'number' ? r.position : null,
      driver: typeof r.driver === 'string' ? r.driver : '',
      number: typeof r.number === 'string' ? r.number : null,
      points: typeof r.points === 'number' ? r.points : null,
      status: typeof r.status === 'string' ? r.status : null,
    };
  });
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
      const season = await currentSeason(categoryId);
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
      const season = await currentSeason(categoryId);
      if (season == null) {
        res.json([]);
        return;
      }
      const { data, error } = await db
        .from('synced_races')
        .select(RACE_COLUMNS)
        .eq('category_id', categoryId)
        .eq('season', season)
        .order('round', { ascending: true });
      if (error) throw error;
      res.json(((data ?? []) as RaceRow[]).map(mapRace));
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
      const season = await currentSeason(categoryId);
      if (season == null) {
        notFound(res, `Corrida "${raceId}" não encontrada.`);
        return;
      }
      const { data, error } = await db
        .from('synced_races')
        .select(RACE_COLUMNS)
        .eq('category_id', categoryId)
        .eq('season', season)
        .eq('race_id', raceId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        notFound(res, `Corrida "${raceId}" não encontrada.`);
        return;
      }

      const results = await db
        .from('race_results')
        .select('session, official, rows')
        .eq('category_id', categoryId)
        .eq('season', season)
        .eq('race_id', raceId)
        .order('session', { ascending: true });
      if (results.error) throw results.error;

      const sessions: BrasilRaceSession[] = (results.data ?? []).map((row) => ({
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
      const season = await currentSeason(categoryId);
      if (season == null) {
        res.json({ season: null, asOfRound: null, drivers: null, teams: null } satisfies BrasilStandings);
        return;
      }

      const [main, detail] = await Promise.all([
        db
          .from('synced_standings')
          .select('position, name, team, points, as_of_round')
          .eq('category_id', categoryId)
          .eq('season', season)
          .order('position', { ascending: true }),
        db
          .from('standings_detail')
          .select('grp, position, name, team, points, as_of_round')
          .eq('category_id', categoryId)
          .eq('season', season)
          .order('position', { ascending: true }),
      ]);
      if (main.error) throw main.error;
      if (detail.error) throw detail.error;

      const classes: BrasilStandingsClass[] = [];
      let asOfRound: number | null = null;

      const mainEntries = (main.data ?? []).map((row) => {
        asOfRound = Math.max(asOfRound ?? 0, row.as_of_round ?? 0);
        return { position: row.position, name: row.name, team: row.team ?? null, points: Number(row.points) };
      });
      if (mainEntries.length > 0) classes.push({ classLabel: config.mainClassLabel, entries: mainEntries });

      const byGroup = new Map<string, BrasilStandingsClass>();
      for (const row of detail.data ?? []) {
        if (row.grp === MAIN_GROUP) continue;
        asOfRound = Math.max(asOfRound ?? 0, row.as_of_round ?? 0);
        let group = byGroup.get(row.grp);
        if (!group) {
          group = { classLabel: config.groupLabels[row.grp] ?? row.grp, entries: [] };
          byGroup.set(row.grp, group);
        }
        group.entries.push({
          position: row.position,
          name: row.name,
          team: row.team ?? null,
          points: Number(row.points),
        });
      }

      const rank = (grp: string) => {
        const index = config.groupOrder.indexOf(grp);
        return index === -1 ? config.groupOrder.length : index;
      };
      const ordered = [...byGroup.entries()].sort(
        ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b),
      );
      for (const [, group] of ordered) classes.push(group);

      const standings: BrasilStandings = {
        season,
        asOfRound,
        drivers: classes.length > 0 ? classes : null,
        teams: null,
      };
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
      const season = await currentSeason(categoryId);
      if (season == null) {
        res.json([]);
        return;
      }

      // A fonte oficial destas duas categorias nao publica uma lista de
      // inscritos: o grid sai de quem aparece nos resultados e na
      // classificacao de cada divisao.
      const [results, main, detail] = await Promise.all([
        db.from('race_results').select('rows').eq('category_id', categoryId).eq('season', season),
        db.from('synced_standings').select('name').eq('category_id', categoryId).eq('season', season),
        db.from('standings_detail').select('grp, name').eq('category_id', categoryId).eq('season', season),
      ]);
      if (results.error) throw results.error;
      if (main.error) throw main.error;
      if (detail.error) throw detail.error;

      const drivers = new Map<string, BrasilDriver>();
      const add = (name: string, number: string | null, className: string | null) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const driverId = slugify(trimmed);
        let driver = drivers.get(driverId);
        if (!driver) {
          driver = { driverId, name: trimmed, number: null, classes: [] };
          drivers.set(driverId, driver);
        }
        if (number && !driver.number) driver.number = number;
        if (className && !driver.classes.includes(className)) driver.classes.push(className);
      };

      for (const row of results.data ?? []) {
        for (const entry of mapResultRows(row.rows)) add(entry.driver, entry.number, null);
      }
      for (const row of main.data ?? []) add(row.name, null, config.mainClassLabel);
      for (const row of detail.data ?? []) {
        if (row.grp === MAIN_GROUP) continue;
        add(row.name, null, config.groupLabels[row.grp] ?? row.grp);
      }

      res.json([...drivers.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      serverError(res, req.path, error);
    }
  });
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

for (const [path, config] of Object.entries(CATEGORIES)) {
  registerCategory(config, `/${path}`);
}

export default router;

import { Router } from 'express';
import { CACHE_NONE, serverError } from '../http.js';
import { pitstophubData } from '../pitstophub-data.js';
import { supabase } from '../supabase.js';
import type {
  BrasilDriver,
  BrasilRace,
  BrasilStandings,
} from '../brasil-types.js';
import type { EbDriver, EbDriverRef, EbRace, EbStandings, EbStandingsClass, EbTeam } from '../endurance-brasil-types.js';
import type { Driver, Race, SeriesId, SeriesStandings, StandingsClass, TeamSummary } from '../types.js';
import {
  buildEngineDrivers,
  buildEngineStandings,
  ENGINE_CATEGORIES,
  mapRace,
  RACE_COLUMNS,
  type RaceRow,
  type StandingDetailRowInput,
  type StandingRowInput,
} from './brasil.js';

const router = Router();

const SERIES_IDS: SeriesId[] = ['europe', 'america', 'asia'];
const SERIES_NAMES: Record<SeriesId, string> = {
  europe: 'GT World Challenge Europe',
  america: 'GT World Challenge America',
  asia: 'GT World Challenge Asia',
};

export interface BootstrapGtwcData {
  races: Race[];
  teams: TeamSummary[];
  standings: SeriesStandings;
}

export interface BootstrapEbData {
  races: EbRace[];
  teams: EbTeam[];
  drivers: EbDriver[];
  standings: EbStandings;
}

export interface BootstrapCategoryData {
  id: string;
  name: string;
  season: number | null;
  source: string | null;
  lastUpdate: string | null;
  asOfRound: number | null;
  degraded: boolean;
  races: BrasilRace[];
  standings: BrasilStandings;
  drivers: BrasilDriver[];
}

export interface BootstrapResponse {
  gtwc: Record<SeriesId, BootstrapGtwcData | null>;
  enduranceBrasil: BootstrapEbData | null;
  categories: Record<string, BootstrapCategoryData | null>;
}

router.get('/categories', (_req, res) => {
  const list = [
    ...SERIES_IDS.map((id) => ({
      id: `gtwc-${id}`,
      name: SERIES_NAMES[id],
      path: `/series/${id}`,
    })),
    {
      id: 'endurance-brasil',
      name: 'Endurance Brasil',
      path: '/endurance-brasil',
    },
    ...Object.values(ENGINE_CATEGORIES).map((c) => ({
      id: c.categoryId,
      name: c.name,
      path: `/${c.categoryId}`,
    })),
  ];
  res.json(list);
});

async function loadGtwcAll(): Promise<Record<SeriesId, BootstrapGtwcData | null>> {
  const [racesRes, entriesRes, standingsRes] = await Promise.all([
    supabase.from('gtwc_races').select('*').order('round', { ascending: true }),
    supabase.from('gtwc_entries').select('series_id, team_name, car, class, car_number, drivers'),
    supabase.from('gtwc_standings').select('series_id, standing_type, class_label, position, name, points').order('position', { ascending: true }),
  ]);
  if (racesRes.error) throw racesRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (standingsRes.error) throw standingsRes.error;

  const result: Record<SeriesId, BootstrapGtwcData | null> = {
    europe: null,
    america: null,
    asia: null,
  };

  for (const seriesId of SERIES_IDS) {
    const races: Race[] = (racesRes.data ?? [])
      .filter((r) => r.series_id === seriesId)
      .map((row) => ({
        seriesId: row.series_id as SeriesId,
        raceId: row.race_id,
        round: row.round,
        name: row.name,
        location: row.location,
        date: row.date,
        sourceUrl: row.source_url,
        winner: row.winner,
      }));

    const byTeamName = new Map<string, TeamSummary>();
    for (const row of (entriesRes.data ?? []).filter((e) => e.series_id === seriesId)) {
      let team = byTeamName.get(row.team_name);
      if (!team) {
        team = { name: row.team_name, car: row.car, class: row.class, carNumber: row.car_number, drivers: [] };
        byTeamName.set(row.team_name, team);
      }
      for (const driver of (row.drivers ?? []) as Driver[]) {
        if (driver?.name && !team.drivers.some((d) => d.name === driver.name)) {
          team.drivers.push(driver);
        }
      }
    }
    const teams = [...byTeamName.values()].sort((a, b) => a.name.localeCompare(b.name));

    const byType: Record<'drivers' | 'teams', Map<string, StandingsClass>> = {
      drivers: new Map(),
      teams: new Map(),
    };
    for (const row of (standingsRes.data ?? []).filter((s) => s.series_id === seriesId)) {
      const type = row.standing_type as 'drivers' | 'teams';
      let cls = byType[type].get(row.class_label);
      if (!cls) {
        cls = { classLabel: row.class_label, entries: [] };
        byType[type].set(row.class_label, cls);
      }
      cls.entries.push({ position: row.position, name: row.name, points: Number(row.points) });
    }

    const standings: SeriesStandings = {
      drivers: byType.drivers.size > 0 ? [...byType.drivers.values()] : null,
      teams: byType.teams.size > 0 ? [...byType.teams.values()] : null,
    };

    result[seriesId] = { races, teams, standings };
  }

  return result;
}

async function loadEnduranceBrasilAll(): Promise<BootstrapEbData> {
  const [racesRes, teamsRes, driversRes, standingsRes] = await Promise.all([
    supabase.from('eb_races').select('*').order('round', { ascending: true }),
    supabase.from('eb_teams').select('*').order('name', { ascending: true }),
    supabase.from('eb_drivers').select('*').order('name', { ascending: true }),
    supabase.from('eb_standings').select('class_label, position, name, points, uf').order('position', { ascending: true }),
  ]);
  if (racesRes.error) throw racesRes.error;
  if (teamsRes.error) throw teamsRes.error;
  if (driversRes.error) throw driversRes.error;
  if (standingsRes.error) throw standingsRes.error;

  const races: EbRace[] = (racesRes.data ?? []).map((row) => ({
    raceId: row.race_id,
    round: row.round,
    name: row.name,
    location: row.location,
    date: row.date,
    sourceUrl: row.source_url,
    completed: row.completed,
    winner: row.winner,
  }));

  const teams: EbTeam[] = (teamsRes.data ?? []).map((row) => ({
    teamId: row.team_id,
    name: row.name,
    teamPrincipal: row.team_principal,
    sourceUrl: row.source_url,
    drivers: (row.drivers ?? []) as EbDriverRef[],
  }));

  const drivers: EbDriver[] = (driversRes.data ?? []).map((row) => ({
    driverId: row.driver_id,
    name: row.name,
    uf: row.uf,
    class: row.class,
    teamId: row.team_id,
    sourceUrl: row.source_url,
  }));

  const byClass = new Map<string, EbStandingsClass>();
  for (const row of standingsRes.data ?? []) {
    let cls = byClass.get(row.class_label);
    if (!cls) {
      cls = { classLabel: row.class_label, entries: [] };
      byClass.set(row.class_label, cls);
    }
    cls.entries.push({
      position: row.position,
      name: row.name,
      points: Number(row.points),
      uf: row.uf,
    });
  }

  const standings: EbStandings = {
    drivers: byClass.size > 0 ? [...byClass.values()] : null,
    teams: null,
  };

  return { races, teams, drivers, standings };
}

type BulkStandingRow = StandingRowInput & { category_id: string; season?: number | null };
type BulkDetailRow = StandingDetailRowInput & { category_id: string; season?: number | null };
type BulkResultRow = { category_id: string; season?: number | null; rows: unknown };
type BulkFreshnessRow = {
  category_id: string;
  season?: number | null;
  as_of_round?: number | null;
  last_success_at?: string | null;
  degraded?: boolean | null;
};

async function loadEngineCategoriesAll(): Promise<Record<string, BootstrapCategoryData | null> | null> {
  const db = pitstophubData();
  if (!db) return null;

  const [racesRes, mainRes, detailRes, resultsRes, freshnessRes] = await Promise.all([
    db
      .from('synced_races')
      .select(`category_id, season, source, updated_at, ${RACE_COLUMNS}`)
      .order('round', { ascending: true }),
    db
      .from('synced_standings')
      .select('category_id, season, position, name, team, points, as_of_round')
      .order('position', { ascending: true }),
    db
      .from('standings_detail')
      .select('category_id, season, grp, position, name, team, points, as_of_round')
      .order('position', { ascending: true }),
    db.from('race_results').select('category_id, season, rows'),
    db.from('sync_freshness').select('category_id, season, as_of_round, last_success_at, degraded'),
  ]);

  if (racesRes.error) throw racesRes.error;
  if (mainRes.error) throw mainRes.error;
  // standings_detail, race_results e sync_freshness sao opcionais caso o schema legado ainda nao as tenha.
  if (detailRes.error && !/relation .* does not exist/i.test(detailRes.error.message)) throw detailRes.error;
  if (resultsRes.error && !/relation .* does not exist/i.test(resultsRes.error.message)) throw resultsRes.error;

  const allRaces = (racesRes.data ?? []) as unknown as RaceRow[];
  const allMain = (mainRes.data ?? []) as unknown as BulkStandingRow[];
  const allDetail = (detailRes.data ?? []) as unknown as BulkDetailRow[];
  const allResults = (resultsRes.data ?? []) as unknown as BulkResultRow[];
  const allFreshness = (freshnessRes.error ? [] : (freshnessRes.data ?? [])) as unknown as BulkFreshnessRow[];

  const freshnessByCat = new Map<string, BulkFreshnessRow>();
  for (const f of allFreshness) {
    if (f?.category_id) freshnessByCat.set(f.category_id, f);
  }

  const out: Record<string, BootstrapCategoryData | null> = {};

  for (const [categoryId, config] of Object.entries(ENGINE_CATEGORIES)) {
    const catRaces = allRaces.filter((r) => r.category_id === categoryId);
    if (catRaces.length === 0) {
      out[categoryId] = null;
      continue;
    }

    const withSeason = catRaces.map((r) => r.season).filter((s): s is number => typeof s === 'number');
    const bySeasonColumn = withSeason.length > 0;
    const season = bySeasonColumn
      ? Math.max(...withSeason)
      : Math.max(
          ...catRaces
            .map((r) => Number(String(r.date ?? '').slice(0, 4)))
            .filter((y) => Number.isFinite(y) && y > 1900),
        );

    if (!Number.isFinite(season)) {
      out[categoryId] = null;
      continue;
    }

    const seasonRaces = catRaces.filter((r) =>
      bySeasonColumn ? r.season === season : String(r.date ?? '').startsWith(`${season}-`),
    );

    const latestSorted = [...seasonRaces].sort((a, b) =>
      String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')),
    );

    const seasonMain = allMain.filter(
      (r) => r.category_id === categoryId && (bySeasonColumn ? r.season === season : r.season == null || r.season === season),
    );
    const seasonDetail = allDetail.filter((r) => r.category_id === categoryId && r.season === season);
    const seasonResults = allResults.filter((r) => r.category_id === categoryId && r.season === season);

    const standings = buildEngineStandings(config, season, seasonMain, seasonDetail);
    const drivers = buildEngineDrivers(config, seasonResults, seasonMain, seasonDetail);
    const freshness = freshnessByCat.get(categoryId);

    out[categoryId] = {
      id: categoryId,
      name: config.name,
      season,
      source: latestSorted[0]?.source ?? null,
      lastUpdate: freshness?.last_success_at ?? latestSorted[0]?.updated_at ?? null,
      asOfRound: freshness?.as_of_round ?? standings.asOfRound ?? null,
      degraded: Boolean(freshness?.degraded),
      races: seasonRaces.map(mapRace),
      standings,
      drivers,
    };
  }

  return out;
}

router.get('/bootstrap', async (req, res) => {
  const [gtwcRes, ebRes, engineRes] = await Promise.allSettled([
    loadGtwcAll(),
    loadEnduranceBrasilAll(),
    loadEngineCategoriesAll(),
  ]);

  const hasPitstopDb = Boolean(pitstophubData());
  const gtwcFailed = gtwcRes.status === 'rejected';
  const ebFailed = ebRes.status === 'rejected';
  const engineFailed = engineRes.status === 'rejected';

  // Se todas as fontes configuradas falharam, responde 500 sem cache.
  if (gtwcFailed && ebFailed && (!hasPitstopDb || engineFailed)) {
    const err = gtwcRes.reason ?? ebRes.reason ?? (engineRes.status === 'rejected' ? engineRes.reason : new Error('Bootstrap error'));
    serverError(res, req.path, err);
    return;
  }

  // Se houve falha parcial em alguma fonte ou o banco do PitStopHub nao esta configurado,
  // entrega o que funcionou mas nao cacheia no CDN para nao segurar estado incompleto.
  if (gtwcFailed || ebFailed || engineFailed) {
    if (gtwcFailed) console.error('[/bootstrap gtwc]', gtwcRes.reason);
    if (ebFailed) console.error('[/bootstrap eb]', ebRes.reason);
    if (engineFailed) console.error('[/bootstrap engine]', engineRes.reason);
    res.setHeader('Cache-Control', CACHE_NONE);
  }

  const emptyCategories: Record<string, BootstrapCategoryData | null> = Object.fromEntries(
    Object.keys(ENGINE_CATEGORIES).map((id) => [id, null]),
  );

  const response: BootstrapResponse = {
    gtwc: gtwcRes.status === 'fulfilled' ? gtwcRes.value : { europe: null, america: null, asia: null },
    enduranceBrasil: ebRes.status === 'fulfilled' ? ebRes.value : null,
    categories: engineRes.status === 'fulfilled' && engineRes.value ? engineRes.value : emptyCategories,
  };

  res.json(response);
});

export default router;

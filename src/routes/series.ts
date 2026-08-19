import { Router } from 'express';
import { supabase } from '../supabase.js';
import type { Driver, Entry, Race, SeriesId, SeriesStandings, StandingsClass, TeamSummary } from '../types.js';

const router = Router();

const SERIES_IDS: SeriesId[] = ['europe', 'america', 'asia'];
const SERIES_NAMES: Record<SeriesId, string> = {
  europe: 'GT World Challenge Europe',
  america: 'GT World Challenge America',
  asia: 'GT World Challenge Asia',
};

function isSeriesId(value: string): value is SeriesId {
  return (SERIES_IDS as string[]).includes(value);
}

function mapRaceRow(row: {
  series_id: SeriesId;
  race_id: string;
  round: number | null;
  name: string;
  location: string | null;
  date: string;
  source_url: string | null;
}): Race {
  return {
    seriesId: row.series_id,
    raceId: row.race_id,
    round: row.round,
    name: row.name,
    location: row.location,
    date: row.date,
    sourceUrl: row.source_url,
  };
}

function mapEntryRow(row: { car_number: string | null; team_name: string; car: string | null; class: string | null; drivers: Driver[] }): Entry {
  return {
    carNumber: row.car_number,
    teamName: row.team_name,
    car: row.car,
    class: row.class,
    drivers: row.drivers ?? [],
  };
}

router.get('/series', (_req, res) => {
  res.json(SERIES_IDS.map((id) => ({ id, name: SERIES_NAMES[id] })));
});

router.get('/series/:seriesId', (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  res.json({ id: seriesId, name: SERIES_NAMES[seriesId] });
});

router.get('/series/:seriesId/races', async (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  const { data, error } = await supabase
    .from('gtwc_races')
    .select('*')
    .eq('series_id', seriesId)
    .order('round', { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json((data ?? []).map(mapRaceRow));
});

router.get('/series/:seriesId/races/:raceId', async (req, res) => {
  const { seriesId, raceId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }

  const { data: raceRow, error: raceError } = await supabase
    .from('gtwc_races')
    .select('*')
    .eq('series_id', seriesId)
    .eq('race_id', raceId)
    .maybeSingle();
  if (raceError) {
    res.status(500).json({ error: raceError.message });
    return;
  }
  if (!raceRow) {
    res.status(404).json({ error: `Corrida "${raceId}" não encontrada.` });
    return;
  }

  const { data: entryRows, error: entriesError } = await supabase
    .from('gtwc_entries')
    .select('car_number, team_name, car, class, drivers')
    .eq('series_id', seriesId)
    .eq('race_id', raceId)
    .order('car_number', { ascending: true });
  if (entriesError) {
    res.status(500).json({ error: entriesError.message });
    return;
  }

  res.json({ ...mapRaceRow(raceRow), entryList: (entryRows ?? []).map(mapEntryRow) });
});

router.get('/series/:seriesId/teams', async (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  const { data, error } = await supabase
    .from('gtwc_entries')
    .select('team_name, car, class, car_number, drivers')
    .eq('series_id', seriesId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const byName = new Map<string, TeamSummary>();
  for (const row of data ?? []) {
    let team = byName.get(row.team_name);
    if (!team) {
      team = { name: row.team_name, car: row.car, class: row.class, carNumber: row.car_number, drivers: [] };
      byName.set(row.team_name, team);
    }
    for (const driver of (row.drivers ?? []) as Driver[]) {
      if (driver?.name && !team.drivers.some((d) => d.name === driver.name)) {
        team.drivers.push(driver);
      }
    }
  }
  res.json([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
});

router.get('/series/:seriesId/drivers', async (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  const { data, error } = await supabase
    .from('gtwc_entries')
    .select('drivers')
    .eq('series_id', seriesId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const byName = new Map<string, Driver>();
  for (const row of data ?? []) {
    for (const driver of (row.drivers ?? []) as Driver[]) {
      if (driver?.name && !byName.has(driver.name)) {
        byName.set(driver.name, driver);
      }
    }
  }
  res.json([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
});

router.get('/series/:seriesId/standings', async (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  const { data, error } = await supabase
    .from('gtwc_standings')
    .select('standing_type, class_label, position, name, points')
    .eq('series_id', seriesId)
    .order('position', { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const byType: Record<'drivers' | 'teams', Map<string, StandingsClass>> = {
    drivers: new Map(),
    teams: new Map(),
  };
  for (const row of data ?? []) {
    const type = row.standing_type as 'drivers' | 'teams';
    let cls = byType[type].get(row.class_label);
    if (!cls) {
      cls = { classLabel: row.class_label, entries: [] };
      byType[type].set(row.class_label, cls);
    }
    cls.entries.push({ position: row.position, name: row.name, points: row.points });
  }

  const result: SeriesStandings = {
    drivers: byType.drivers.size > 0 ? [...byType.drivers.values()] : null,
    teams: byType.teams.size > 0 ? [...byType.teams.values()] : null,
  };
  res.json(result);
});

export default router;

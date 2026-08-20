import { Router } from 'express';
import { supabase } from '../supabase.js';
import type { EbDriver, EbDriverRef, EbRace, EbStandings, EbStandingsClass, EbTeam } from '../endurance-brasil-types.js';

const router = Router();

const CATEGORY = { id: 'endurance-brasil', name: 'Endurance Brasil' };

function mapRaceRow(row: {
  race_id: string;
  round: number | null;
  name: string;
  location: string | null;
  date: string;
  source_url: string | null;
  completed: boolean;
  winner: string | null;
}): EbRace {
  return {
    raceId: row.race_id,
    round: row.round,
    name: row.name,
    location: row.location,
    date: row.date,
    sourceUrl: row.source_url,
    completed: row.completed,
    winner: row.winner,
  };
}

function mapTeamRow(row: {
  team_id: string;
  name: string;
  team_principal: string | null;
  source_url: string | null;
  drivers: EbDriverRef[] | null;
}): EbTeam {
  return {
    teamId: row.team_id,
    name: row.name,
    teamPrincipal: row.team_principal,
    sourceUrl: row.source_url,
    drivers: row.drivers ?? [],
  };
}

function mapDriverRow(row: {
  driver_id: string;
  name: string;
  uf: string | null;
  class: string | null;
  team_id: string | null;
  source_url: string | null;
}): EbDriver {
  return {
    driverId: row.driver_id,
    name: row.name,
    uf: row.uf,
    class: row.class,
    teamId: row.team_id,
    sourceUrl: row.source_url,
  };
}

router.get('/endurance-brasil', (_req, res) => {
  res.json(CATEGORY);
});

router.get('/endurance-brasil/races', async (_req, res) => {
  const { data, error } = await supabase
    .from('eb_races')
    .select('*')
    .order('round', { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json((data ?? []).map(mapRaceRow));
});

router.get('/endurance-brasil/races/:raceId', async (req, res) => {
  const { raceId } = req.params;
  const { data, error } = await supabase
    .from('eb_races')
    .select('*')
    .eq('race_id', raceId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: `Corrida "${raceId}" não encontrada.` });
    return;
  }
  res.json(mapRaceRow(data));
});

router.get('/endurance-brasil/teams', async (_req, res) => {
  const { data, error } = await supabase
    .from('eb_teams')
    .select('*')
    .order('name', { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json((data ?? []).map(mapTeamRow));
});

router.get('/endurance-brasil/teams/:teamId', async (req, res) => {
  const { teamId } = req.params;
  const { data, error } = await supabase
    .from('eb_teams')
    .select('*')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: `Equipe "${teamId}" não encontrada.` });
    return;
  }
  res.json(mapTeamRow(data));
});

router.get('/endurance-brasil/drivers', async (_req, res) => {
  const { data, error } = await supabase
    .from('eb_drivers')
    .select('*')
    .order('name', { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json((data ?? []).map(mapDriverRow));
});

router.get('/endurance-brasil/drivers/:driverId', async (req, res) => {
  const { driverId } = req.params;
  const { data, error } = await supabase
    .from('eb_drivers')
    .select('*')
    .eq('driver_id', driverId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: `Piloto "${driverId}" não encontrado.` });
    return;
  }
  res.json(mapDriverRow(data));
});

router.get('/endurance-brasil/standings', async (_req, res) => {
  const { data, error } = await supabase
    .from('eb_standings')
    .select('class_label, position, name, points, uf')
    .order('position', { ascending: true });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const byClass = new Map<string, EbStandingsClass>();
  for (const row of data ?? []) {
    let cls = byClass.get(row.class_label);
    if (!cls) {
      cls = { classLabel: row.class_label, entries: [] };
      byClass.set(row.class_label, cls);
    }
    cls.entries.push({
      position: row.position,
      name: row.name,
      points: row.points,
      uf: row.uf,
    });
  }

  const result: EbStandings = {
    drivers: byClass.size > 0 ? [...byClass.values()] : null,
    teams: null,
  };
  res.json(result);
});

export default router;

import { Router } from 'express';
import { SERIES_BY_ID, listSeries } from '../data/index.js';
import { computeEntryList } from '../lib/entry-list.js';
import type { SeriesId } from '../types.js';

const router = Router();

function isSeriesId(value: string): value is SeriesId {
  return value in SERIES_BY_ID;
}

router.get('/series', (_req, res) => {
  res.json(
    listSeries().map(({ id, name, teams, drivers, races }) => ({
      id,
      name,
      teamCount: teams.length,
      driverCount: drivers.length,
      raceCount: races.length,
    }))
  );
});

router.get('/series/:seriesId', (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  res.json(SERIES_BY_ID[seriesId]);
});

router.get('/series/:seriesId/teams', (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  res.json(SERIES_BY_ID[seriesId].teams);
});

router.get('/series/:seriesId/teams/:teamId', (req, res) => {
  const { seriesId, teamId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  const team = SERIES_BY_ID[seriesId].teams.find((t) => t.id === teamId);
  if (!team) {
    res.status(404).json({ error: `Time "${teamId}" não encontrado.` });
    return;
  }
  res.json(team);
});

router.get('/series/:seriesId/drivers', (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  res.json(SERIES_BY_ID[seriesId].drivers);
});

router.get('/series/:seriesId/drivers/:driverId', (req, res) => {
  const { seriesId, driverId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  const driver = SERIES_BY_ID[seriesId].drivers.find((d) => d.id === driverId);
  if (!driver) {
    res.status(404).json({ error: `Piloto "${driverId}" não encontrado.` });
    return;
  }
  res.json(driver);
});

router.get('/series/:seriesId/races', (req, res) => {
  const { seriesId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  // entryOverrides so importa pra corrida especifica (endpoint abaixo) --
  // no calendario geral, so poluiria a resposta.
  res.json(SERIES_BY_ID[seriesId].races.map(({ entryOverrides: _entryOverrides, ...race }) => race));
});

router.get('/series/:seriesId/races/:raceId', (req, res) => {
  const { seriesId, raceId } = req.params;
  if (!isSeriesId(seriesId)) {
    res.status(404).json({ error: `Série "${seriesId}" não encontrada.` });
    return;
  }
  const series = SERIES_BY_ID[seriesId];
  const race = series.races.find((r) => r.id === raceId);
  if (!race) {
    res.status(404).json({ error: `Corrida "${raceId}" não encontrada.` });
    return;
  }
  const { entryOverrides: _entryOverrides, ...raceInfo } = race;
  res.json({ ...raceInfo, entryList: computeEntryList(series, race) });
});

export default router;

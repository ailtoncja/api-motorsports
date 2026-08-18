import type { Driver, Race, SeriesData } from '../types.js';

export interface EntryListItem {
  teamId: string;
  teamName: string;
  car: string;
  driverIds: string[];
  drivers: Driver[];
  isOverride: boolean;
  note?: string;
}

function resolveDrivers(ids: string[], byId: Map<string, Driver>): Driver[] {
  return ids
    .map((id) => byId.get(id))
    .filter((driver): driver is Driver => Boolean(driver));
}

// Junta o roster base da temporada com os overrides de UMA corrida (se
// houver): times da temporada trocam o grid quando têm override, e overrides
// com um teamId novo (não existe no roster da temporada) entram como time
// convidado extra -- é isso que dá a flexibilidade pras clássicas de
// endurance sem precisar mexer no roster da temporada inteira.
export function computeEntryList(series: SeriesData, race: Race): EntryListItem[] {
  const driverById = new Map(series.drivers.map((d) => [d.id, d]));
  const overridesByTeam = new Map((race.entryOverrides ?? []).map((o) => [o.teamId, o]));

  const baseEntries: EntryListItem[] = series.teams.map((team) => {
    const override = overridesByTeam.get(team.id);
    const driverIds = override?.driverIds ?? team.driverIds;
    return {
      teamId: team.id,
      teamName: team.name,
      car: override?.car ?? team.car,
      driverIds,
      drivers: resolveDrivers(driverIds, driverById),
      isOverride: Boolean(override),
      note: override?.note,
    };
  });

  const knownTeamIds = new Set(series.teams.map((t) => t.id));
  const guestEntries: EntryListItem[] = (race.entryOverrides ?? [])
    .filter((o) => !knownTeamIds.has(o.teamId))
    .map((o) => ({
      teamId: o.teamId,
      teamName: o.teamName ?? o.teamId,
      car: o.car ?? 'N/A',
      driverIds: o.driverIds,
      drivers: resolveDrivers(o.driverIds, driverById),
      isOverride: true,
      note: o.note,
    }));

  return [...baseEntries, ...guestEntries];
}

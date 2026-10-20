// Acesso ao banco: so via funcoes SQL (RPC) de
// supabase/migrations/*_edge_sync.sql. Cada uma roda numa transacao e
// recusa lista vazia, entao uma raspagem que volta 0 linhas nunca apaga o
// que ja esta gravado (o script antigo fazia delete + insert soltos).

import { createClient, type SupabaseClient } from './deps.ts';
import type { GtwcState, GtwcStore } from './gtwc-sync.ts';
import type { EbState, EbStore } from './eb-sync.ts';
import type { SeriesId } from './gtwc-parse.ts';

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rpc<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

interface GtwcStateJson {
  races: { race_id: string; winner: string | null; date: string; entries: number }[];
  standings: { standing_type: string; class_label: string; rows: number }[];
}

export function gtwcDbStore(db: SupabaseClient): GtwcStore {
  return {
    async load(series: SeriesId): Promise<GtwcState> {
      const data = await rpc<GtwcStateJson>(db, 'gtwc_sync_state', { p_series: series });
      return {
        races: new Map(data.races.map((r) => [r.race_id, { winner: r.winner, date: r.date, entries: Number(r.entries) }])),
        standings: new Map(data.standings.map((s) => [`${s.standing_type}|${s.class_label}`, Number(s.rows)])),
      };
    },
    async saveRaces(series, seasonYear, rows) {
      await rpc(db, 'sync_gtwc_races', { p_series: series, p_season_year: seasonYear, p_rows: rows });
    },
    async replaceEntries(series, raceId, sourceUrl, entries) {
      await rpc(db, 'replace_gtwc_entries', {
        p_series: series,
        p_race_id: raceId,
        p_source_url: sourceUrl,
        p_rows: entries.map((e) => ({ car_number: e.carNumber, team_name: e.teamName, car: e.car, class: e.class, drivers: e.drivers })),
      });
    },
    async replaceStandings(series, rows) {
      await rpc(db, 'replace_gtwc_standings', { p_series: series, p_rows: rows });
    },
  };
}

interface EbStateJson {
  races: { race_id: string; winner: string | null; date: string }[];
  teams: number;
  drivers: number;
  standings: number;
}

export function ebDbStore(db: SupabaseClient): EbStore {
  return {
    async load(): Promise<EbState> {
      const data = await rpc<EbStateJson>(db, 'eb_sync_state', {});
      return {
        races: new Map(data.races.map((r) => [r.race_id, { winner: r.winner, date: r.date }])),
        teams: Number(data.teams),
        drivers: Number(data.drivers),
        standings: Number(data.standings),
      };
    },
    async saveRaces(_seasonYear, races) {
      await rpc(db, 'sync_eb_races', {
        p_rows: races.map((r) => ({
          race_id: r.raceId,
          round: r.round,
          name: r.name,
          location: r.location,
          date: r.date,
          source_url: r.sourceUrl,
          completed: r.completed,
          winner: r.winner,
        })),
      });
    },
    async replaceRoster(teams, drivers) {
      await rpc(db, 'replace_eb_roster', {
        p_teams: teams.map((t) => ({
          team_id: t.teamId,
          name: t.name,
          team_principal: t.teamPrincipal,
          source_url: t.sourceUrl,
          drivers: t.drivers,
        })),
        p_drivers: drivers.map((d) => ({
          driver_id: d.driverId,
          name: d.name,
          uf: d.uf,
          class: d.class,
          team_id: d.teamId,
          source_url: d.sourceUrl,
        })),
      });
    },
    async replaceStandings(rows) {
      await rpc(db, 'replace_eb_standings', {
        p_rows: rows.map((r) => ({ class_label: r.classLabel, position: r.position, name: r.name, points: r.points, uf: r.uf })),
      });
    },
  };
}

// Tipos da API Endurance Brasil. Os dados vem do Supabase (tabelas eb_*),
// sincronizado por scripts/sync-endurance-brasil.mjs a partir de
// endurancebrasiloficial.com.br. Independente do GTWC (src/types.ts).

export interface EbDriverRef {
  name: string;
  driverId: string;
}

export interface EbDriver {
  driverId: string;
  name: string;
  uf: string | null;
  class: string | null;
  teamId: string | null;
  sourceUrl: string | null;
}

export interface EbTeam {
  teamId: string;
  name: string;
  teamPrincipal: string | null;
  sourceUrl: string | null;
  drivers: EbDriverRef[];
}

export interface EbRace {
  raceId: string;
  round: number | null;
  name: string;
  location: string | null;
  date: string; // YYYY-MM-DD
  sourceUrl: string | null;
  completed: boolean;
  winner: string | null; // nome do time vencedor (geral/P1), null se a etapa ainda nao rolou
}

export interface EbStandingEntry {
  position: number;
  name: string;
  points: number;
  uf: string | null;
}

export interface EbStandingsClass {
  classLabel: string;
  entries: EbStandingEntry[];
}

export interface EbStandings {
  drivers: EbStandingsClass[] | null;
  teams: null;
}

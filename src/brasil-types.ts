// Tipos das categorias brasileiras servidas a partir do Supabase do
// PitStopHub (ver src/pitstophub-data.ts): NASCAR Brasil e Porsche Cup Brasil.
// Mesmo formato de StandingsClass do GTWC/Endurance Brasil, para o site e o
// app lerem tudo igual.

export interface BrasilRace {
  raceId: string;
  round: number | null;
  name: string;
  location: string | null;
  circuit: string | null;
  date: string; // YYYY-MM-DD
  startsAt: string | null;
  status: 'upcoming' | 'completed' | 'cancelled';
  /** Vencedor da etapa. Mais de um nome quando o fim de semana tem duas corridas. */
  winner: string | null;
  /** false enquanto o resultado da fonte oficial ainda e provisorio. */
  official: boolean;
  sourceUrl: string | null;
}

export interface BrasilResultRow {
  position: number | null;
  driver: string;
  number: string | null;
  points: number | null;
  status: string | null;
}

export interface BrasilRaceSession {
  session: string;
  official: boolean;
  rows: BrasilResultRow[];
}

export interface BrasilRaceDetail extends BrasilRace {
  sessions: BrasilRaceSession[];
}

export interface BrasilStandingEntry {
  position: number;
  name: string;
  team: string | null;
  points: number;
}

export interface BrasilStandingsClass {
  classLabel: string;
  entries: BrasilStandingEntry[];
}

export interface BrasilStandings {
  season: number | null;
  asOfRound: number | null;
  drivers: BrasilStandingsClass[] | null;
  teams: null;
}

export interface BrasilDriver {
  driverId: string;
  name: string;
  number: string | null;
  /** Divisao/campeonato em que o piloto aparece (ex.: Sprint Trophy). */
  classes: string[];
}

export interface BrasilCategory {
  id: string;
  name: string;
  season: number | null;
  source: string | null;
  lastUpdate: string | null;
}

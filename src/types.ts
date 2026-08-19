// Tipos da API GT World Challenge (Europe/America/Asia). Os dados vem do
// Supabase (ver src/supabase.ts), sincronizado por scripts/sync-gtwc.mjs --
// ver README.md pra como funciona o sync e as limitacoes conhecidas (Asia
// nao tem entry list automatico).

export type SeriesId = 'europe' | 'america' | 'asia';

export interface Series {
  id: SeriesId;
  name: string;
}

export interface Driver {
  name: string;
  nationality: string;
}

// Cada corrida guarda o proprio grid, raspado da pagina oficial daquela
// corrida especifica -- nao existe "roster da temporada + excecao pra
// corrida grande" (era assim que o pitstophub tentava representar isso via
// TheSportsDB, e misturava Sprint Cup com Endurance Cup).
export interface Entry {
  carNumber: string | null;
  teamName: string;
  car: string | null;
  class: string | null;
  drivers: Driver[];
}

export interface Race {
  seriesId: SeriesId;
  raceId: string;
  round: number | null;
  name: string;
  location: string | null;
  date: string; // YYYY-MM-DD
  sourceUrl: string | null;
}

export interface RaceWithEntryList extends Race {
  entryList: Entry[];
}

// /teams e /drivers sao vistas derivadas: nome unico agregado em cima de
// todos os entries da serie, nao uma tabela propria.
export interface TeamSummary {
  name: string;
  car: string | null;
  class: string | null;
  carNumber: string | null;
  drivers: Driver[];
}

export interface StandingEntry {
  position: number;
  name: string;
  points: number;
}

// Uma classificacao pode ter mais de uma classe (ex.: America so tem
// classificacao de times, dividida em Pro/Pro-Am/Am -- nunca misturadas
// numa unica lista de posicoes, pra nao sugerir uma classificacao geral
// que a serie nao tem de verdade).
export interface StandingsClass {
  classLabel: string;
  entries: StandingEntry[];
}

export interface SeriesStandings {
  drivers: StandingsClass[] | null;
  teams: StandingsClass[] | null;
}

// Tipos base da API GT World Challenge (Europe/America/Asia). Ver README.md
// para como adicionar/editar dados reais -- os arquivos em src/data/ vêm com
// dados de exemplo (times/pilotos/corridas fictícios), não a temporada real.

export interface Driver {
  id: string;
  name: string;
  nationality: string;
}

export interface Team {
  id: string;
  name: string;
  car: string;
  driverIds: string[]; // titulares da temporada
}

// Grid extra/alternativo só para UMA corrida específica -- cobre as
// clássicas de endurance (ex.: 24 Horas de Spa), onde um time usa um 3º
// piloto só naquela corrida, ou aparece um time "convidado" que só disputa
// aquele evento. teamId pode ser o id de um time que já existe no roster da
// temporada (só troca o grid dele) ou um id novo (vira um time extra só
// naquela corrida -- nesse caso teamName é obrigatório).
export interface EntryOverride {
  teamId: string;
  teamName?: string;
  car?: string;
  driverIds: string[];
  note?: string;
}

export interface Race {
  id: string;
  round: number;
  name: string;
  circuit: string;
  location: string;
  date: string; // YYYY-MM-DD
  entryOverrides?: EntryOverride[];
}

export type SeriesId = 'europe' | 'america' | 'asia';

export interface SeriesData {
  id: SeriesId;
  name: string;
  teams: Team[];
  drivers: Driver[];
  races: Race[];
}

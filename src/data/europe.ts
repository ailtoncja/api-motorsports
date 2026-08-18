// DADOS DE EXEMPLO -- times, pilotos e datas fictícios, só pra provar a
// estrutura da API ponta a ponta (incluindo o mecanismo de entryOverrides
// na 24 Horas de Spa, abaixo). Troque pelo roster/calendário real do GT
// World Challenge Europe -- ver README.md.
import type { SeriesData } from '../types.js';

const series: SeriesData = {
  id: 'europe',
  name: 'GT World Challenge Europe',
  teams: [
    { id: 'nordlicht-racing', name: 'Nordlicht Racing', car: 'Mercedes-AMG GT3 Evo', driverIds: ['a-berg', 'l-fontaine'] },
    { id: 'meridian-motorsport', name: 'Meridian Motorsport', car: 'Ferrari 296 GT3 Evo', driverIds: ['s-conti', 'p-alba'] },
  ],
  drivers: [
    { id: 'a-berg', name: 'Anders Berg', nationality: 'Suécia' },
    { id: 'l-fontaine', name: 'Léa Fontaine', nationality: 'França' },
    { id: 's-conti', name: 'Sofia Conti', nationality: 'Itália' },
    { id: 'p-alba', name: 'Pedro Alba', nationality: 'Espanha' },
    // Pilotos convidados que só aparecem na 24h de Spa (round 4, abaixo).
    { id: 'guest-h-larsen', name: 'Henrik Larsen', nationality: 'Dinamarca' },
    { id: 'guest-m-rossi', name: 'Marco Rossi', nationality: 'Itália' },
    { id: 'guest-j-keller', name: 'Jonas Keller', nationality: 'Alemanha' },
    { id: 'guest-t-nakamura', name: 'Taro Nakamura', nationality: 'Japão' },
  ],
  races: [
    {
      id: 'round-1-brands-hatch',
      round: 1,
      name: 'Sprint Cup Brands Hatch',
      circuit: 'Brands Hatch',
      location: 'Kent, Reino Unido',
      date: '2026-04-19',
    },
    {
      id: 'round-4-spa-24h',
      round: 4,
      name: '24 Horas de Spa',
      circuit: 'Circuit de Spa-Francorchamps',
      location: 'Stavelot, Bélgica',
      date: '2026-06-27',
      entryOverrides: [
        {
          teamId: 'nordlicht-racing',
          driverIds: ['a-berg', 'l-fontaine', 'guest-h-larsen'],
          note: '3º piloto extra só pra prova de 24h.',
        },
        {
          teamId: 'guest-team-solari',
          teamName: 'Solari Racing Team',
          car: 'Audi R8 LMS GT3 Evo II',
          driverIds: ['guest-m-rossi', 'guest-j-keller', 'guest-t-nakamura'],
          note: 'Time convidado que só disputa a 24h de Spa.',
        },
      ],
    },
  ],
};

export default series;

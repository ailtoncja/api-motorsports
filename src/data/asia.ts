// DADOS DE EXEMPLO -- times, pilotos e datas fictícios, só pra provar a
// estrutura da API. Troque pelo roster/calendário real do GT World
// Challenge Asia -- ver README.md.
import type { SeriesData } from '../types.js';

const series: SeriesData = {
  id: 'asia',
  name: 'GT World Challenge Asia',
  teams: [
    { id: 'kaze-motorsport', name: 'Kaze Motorsport', car: 'Nissan GT-R NISMO GT3', driverIds: ['y-tanaka', 'w-lim'] },
    { id: 'golden-dragon-racing', name: 'Golden Dragon Racing', car: 'Lamborghini Huracán GT3 EVO2', driverIds: ['c-wong', 'a-suwan'] },
  ],
  drivers: [
    { id: 'y-tanaka', name: 'Yuki Tanaka', nationality: 'Japão' },
    { id: 'w-lim', name: 'Wei Lim', nationality: 'Cingapura' },
    { id: 'c-wong', name: 'Chloe Wong', nationality: 'Hong Kong' },
    { id: 'a-suwan', name: 'Anan Suwan', nationality: 'Tailândia' },
    // Piloto convidado que só aparece na rodada de endurance (round 2, abaixo).
    { id: 'guest-d-park', name: 'Dae-Ho Park', nationality: 'Coreia do Sul' },
  ],
  races: [
    {
      id: 'round-1-buriram',
      round: 1,
      name: 'Sprint Buriram',
      circuit: 'Chang International Circuit',
      location: 'Buriram, Tailândia',
      date: '2026-05-03',
    },
    {
      id: 'round-2-sepang-endurance',
      round: 2,
      name: 'Sepang Endurance Cup',
      circuit: 'Sepang International Circuit',
      location: 'Sepang, Malásia',
      date: '2026-08-09',
      entryOverrides: [
        {
          teamId: 'kaze-motorsport',
          driverIds: ['y-tanaka', 'w-lim', 'guest-d-park'],
          note: '3º piloto extra só pra rodada de endurance.',
        },
      ],
    },
  ],
};

export default series;

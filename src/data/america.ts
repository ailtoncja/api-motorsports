// DADOS DE EXEMPLO -- times, pilotos e datas fictícios, só pra provar a
// estrutura da API. Troque pelo roster/calendário real do GT World
// Challenge America -- ver README.md.
import type { SeriesData } from '../types.js';

const series: SeriesData = {
  id: 'america',
  name: 'GT World Challenge America',
  teams: [
    { id: 'lonestar-motorsports', name: 'Lonestar Motorsports', car: 'Chevrolet Corvette Z06 GT3.R', driverIds: ['c-walker', 'r-diaz'] },
    { id: 'summit-racing-team', name: 'Summit Racing Team', car: 'Porsche 911 GT3 R', driverIds: ['j-carter', 'k-oliveira'] },
  ],
  drivers: [
    { id: 'c-walker', name: 'Caleb Walker', nationality: 'EUA' },
    { id: 'r-diaz', name: 'Ricardo Diaz', nationality: 'México' },
    { id: 'j-carter', name: 'Jordan Carter', nationality: 'EUA' },
    { id: 'k-oliveira', name: 'Kaique Oliveira', nationality: 'Brasil' },
    // Piloto convidado que só aparece na prova de endurance (round 3, abaixo).
    { id: 'guest-b-summers', name: 'Blake Summers', nationality: 'Canadá' },
  ],
  races: [
    {
      id: 'round-1-cota',
      round: 1,
      name: 'Sprint COTA',
      circuit: 'Circuit of the Americas',
      location: 'Austin, EUA',
      date: '2026-03-08',
    },
    {
      id: 'round-3-indianapolis-8h',
      round: 3,
      name: 'Indianapolis 8 Hour',
      circuit: 'Indianapolis Motor Speedway',
      location: 'Indianapolis, EUA',
      date: '2026-07-11',
      entryOverrides: [
        {
          teamId: 'lonestar-motorsports',
          driverIds: ['c-walker', 'r-diaz', 'guest-b-summers'],
          note: '3º piloto extra só pra prova de endurance.',
        },
      ],
    },
  ],
};

export default series;

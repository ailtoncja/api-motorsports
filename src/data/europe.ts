// Dados reais da temporada 2026 do GT World Challenge Europe, levantados via
// busca na web em ago/2026 (calendário oficial + reportagens de entry list:
// dailysportscar.com, gt-report.com, Wikipedia). Cobertura parcial de
// propósito: 4 times reais (não os ~30 do grid completo) só pra ilustrar a
// estrutura -- amplie conforme precisar.
import type { SeriesData } from '../types.js';

const series: SeriesData = {
  id: 'europe',
  name: 'GT World Challenge Europe',
  teams: [
    { id: 'af-corse-50', name: 'AF Corse #50', car: 'Ferrari 296 GT3 Evo', driverIds: ['arthur-leclerc', 'sean-gelael'] },
    { id: 'winward-racing-48', name: 'Winward Racing #48', car: 'Mercedes-AMG GT3 Evo', driverIds: ['lucas-auer', 'maro-engel'] },
    { id: 'emil-frey-racing-14', name: 'Emil Frey Racing #14', car: 'Ferrari 296 GT3 Evo', driverIds: ['matteo-cairoli', 'konsta-lappalainen'] },
    { id: 'comtoyou-racing-7', name: 'Comtoyou Racing #7', car: 'Aston Martin Vantage AMR GT3 Evo', driverIds: ['mattia-drudi', 'marco-sorensen', 'nicki-thiim'] },
  ],
  drivers: [
    { id: 'arthur-leclerc', name: 'Arthur Leclerc', nationality: 'Mônaco' },
    { id: 'sean-gelael', name: 'Sean Gelael', nationality: 'Indonésia' },
    { id: 'lucas-auer', name: 'Lucas Auer', nationality: 'Áustria' },
    { id: 'maro-engel', name: 'Maro Engel', nationality: 'Alemanha' },
    { id: 'matteo-cairoli', name: 'Matteo Cairoli', nationality: 'Itália' },
    { id: 'konsta-lappalainen', name: 'Konsta Lappalainen', nationality: 'Finlândia' },
    { id: 'mattia-drudi', name: 'Mattia Drudi', nationality: 'Itália' },
    { id: 'marco-sorensen', name: 'Marco Sørensen', nationality: 'Dinamarca' },
    { id: 'nicki-thiim', name: 'Nicki Thiim', nationality: 'Dinamarca' },
    // Pilotos extras confirmados só pra 24h de Spa (round 4, abaixo).
    { id: 'lilou-wadoux', name: 'Lilou Wadoux', nationality: 'França' },
    { id: 'sarah-bovy', name: 'Sarah Bovy', nationality: 'Bélgica' },
    { id: 'xavier-knauf', name: 'Xavier Knauf', nationality: 'Bélgica' },
    { id: 'gregory-servais', name: 'Grégory Servais', nationality: 'Bélgica' },
    { id: 'nicolas-baert', name: 'Nicolas Baert', nationality: 'Bélgica' },
  ],
  races: [
    { id: 'r1-paul-ricard', round: 1, name: 'Endurance Paul Ricard', circuit: 'Circuit Paul Ricard', location: 'Le Castellet, França', date: '2026-04-10' },
    { id: 'r2-brands-hatch', round: 2, name: 'Sprint Cup Brands Hatch', circuit: 'Brands Hatch', location: 'Kent, Reino Unido', date: '2026-05-02' },
    { id: 'r3-monza', round: 3, name: 'Endurance Monza', circuit: 'Autodromo Nazionale Monza', location: 'Monza, Itália', date: '2026-05-28' },
    {
      id: 'r4-spa-24h',
      round: 4,
      name: 'CrowdStrike 24 Hours of Spa',
      circuit: 'Circuit de Spa-Francorchamps',
      location: 'Stavelot, Bélgica',
      date: '2026-06-23',
      entryOverrides: [
        {
          teamId: 'af-corse-50',
          driverIds: ['arthur-leclerc', 'sean-gelael', 'lilou-wadoux'],
          note: '3ª piloto confirmada só pra 24h de Spa.',
        },
        {
          teamId: 'comtoyou-700',
          teamName: 'Comtoyou Racing #700',
          car: 'Aston Martin Vantage AMR GT3 Evo',
          driverIds: ['sarah-bovy', 'xavier-knauf', 'gregory-servais', 'nicolas-baert'],
          note: 'Carro extra que a Comtoyou só coloca em pista na 24h de Spa.',
        },
      ],
    },
    { id: 'r5-misano', round: 5, name: 'Sprint Cup Misano', circuit: 'Misano World Circuit', location: 'Misano Adriatico, Itália', date: '2026-07-16' },
    { id: 'r6-magny-cours', round: 6, name: 'Sprint Cup Magny-Cours', circuit: 'Circuit de Nevers Magny-Cours', location: 'Magny-Cours, França', date: '2026-07-30' },
    { id: 'r7-nurburgring', round: 7, name: 'Endurance Nürburgring', circuit: 'Nürburgring', location: 'Nürburg, Alemanha', date: '2026-08-28' },
    { id: 'r8-zandvoort', round: 8, name: 'Sprint Cup Zandvoort', circuit: 'Circuit Zandvoort', location: 'Zandvoort, Países Baixos', date: '2026-09-18' },
    { id: 'r9-barcelona', round: 9, name: 'Sprint Cup Barcelona', circuit: 'Circuit de Barcelona-Catalunya', location: 'Montmeló, Espanha', date: '2026-10-02' },
    { id: 'r10-algarve', round: 10, name: 'Endurance Algarve', circuit: 'Algarve International Circuit', location: 'Portimão, Portugal', date: '2026-10-16' },
  ],
};

export default series;

// Dados reais da temporada 2026 do GT World Challenge America, levantados via
// busca na web em ago/2026 (calendário e entry list oficiais). Cobertura
// parcial de propósito: 3 times reais (não o grid completo).
//
// Sem entryOverrides aqui: a rodada de Indianápolis (round 7) é a clássica de
// endurance da série (Indy 8 Hour), que normalmente ganha pilotos extras --
// mas o entry list estendido de 2026 ainda não tinha sido divulgado na data
// dessa curadoria. Adicione o override quando sair.
import type { SeriesData } from '../types.js';

const series: SeriesData = {
  id: 'america',
  name: 'GT World Challenge America',
  teams: [
    { id: 'jmf-motorsports-34', name: 'JMF Motorsports #34', car: 'Mercedes-AMG GT3 Evo', driverIds: ['michai-stephens', 'mikael-grenier'] },
    { id: 'wright-motorsports-31', name: 'Wright Motorsports #31', car: 'Porsche 911 GT3 R (992)', driverIds: ['dave-musial-jr', 'ryan-yardley'] },
    { id: 'chicago-performance-tuning', name: 'Chicago Performance and Tuning Co.', car: 'Lamborghini Huracán GT3 EVO2', driverIds: ['nicolai-elghanayan', 'mads-siljehaug'] },
  ],
  drivers: [
    { id: 'michai-stephens', name: 'Michai Stephens', nationality: 'EUA' },
    { id: 'mikael-grenier', name: 'Mikaël Grenier', nationality: 'Canadá' },
    { id: 'dave-musial-jr', name: 'Dave Musial Jr.', nationality: 'EUA' },
    { id: 'ryan-yardley', name: 'Ryan Yardley', nationality: 'Nova Zelândia' },
    { id: 'nicolai-elghanayan', name: 'Nicolai Elghanayan', nationality: 'EUA' },
    { id: 'mads-siljehaug', name: 'Mads Siljehaug', nationality: 'Noruega' },
  ],
  races: [
    { id: 'r1-sonoma', round: 1, name: 'Sonoma', circuit: 'Sonoma Raceway', location: 'Sonoma, EUA', date: '2026-03-27' },
    { id: 'r2-cota', round: 2, name: 'Circuit of the Americas', circuit: 'Circuit of the Americas', location: 'Austin, EUA', date: '2026-04-24' },
    { id: 'r3-sebring', round: 3, name: 'Sebring', circuit: 'Sebring International Raceway', location: 'Sebring, EUA', date: '2026-05-08' },
    { id: 'r4-road-atlanta', round: 4, name: 'Road Atlanta', circuit: 'Michelin Raceway Road Atlanta', location: 'Braselton, EUA', date: '2026-06-12' },
    { id: 'r5-road-america', round: 5, name: 'Road America', circuit: 'Road America', location: 'Elkhart Lake, EUA', date: '2026-08-28' },
    { id: 'r6-barber', round: 6, name: 'Barber', circuit: 'Barber Motorsports Park', location: 'Birmingham, EUA', date: '2026-09-25' },
    { id: 'r7-indianapolis-8h', round: 7, name: 'Indianapolis 8 Hour', circuit: 'Indianapolis Motor Speedway', location: 'Indianapolis, EUA', date: '2026-10-08' },
  ],
};

export default series;

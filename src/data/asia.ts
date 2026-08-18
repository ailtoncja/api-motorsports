// Dados reais da temporada 2026 do GT World Challenge Asia, levantados via
// busca na web em ago/2026 (calendário oficial + Wikipedia + reportagens de
// entry list). Cobertura parcial de propósito: 4 times reais (não o grid
// completo).
//
// Sem entryOverrides aqui: diferente da Europe (24h de Spa) e da America
// (Indy 8 Hour), as 6 rodadas de 2026 são todas em formato de fim de semana
// padrão -- não achei uma clássica de endurance com grid estendido nesta
// temporada pra ilustrar o mecanismo com dado real.
import type { SeriesData } from '../types.js';

const series: SeriesData = {
  id: 'asia',
  name: 'GT World Challenge Asia',
  teams: [
    { id: 'origine-motorsport-4', name: 'Origine Motorsport #4', car: 'Porsche 911 GT3 R (992.2)', driverIds: ['alessio-picariello', 'lu-wei'] },
    { id: 'plus-bmw-team-studie-5', name: 'PLUS with BMW M Team Studie #5', car: 'BMW M4 GT3 Evo', driverIds: ['seiji-ara', 'tomohide-yamaguchi'] },
    { id: 'harmony-racing-13', name: '33R Harmony Racing #13', car: 'Ferrari 296 GT3 Evo', driverIds: ['sun-jingzu', 'adderly-fong'] },
    { id: 'craft-bamboo-77', name: 'Craft-Bamboo Racing #77', car: 'Mercedes-AMG GT3 Evo', driverIds: ['liang-jiatong', 'dean-chen'] },
  ],
  drivers: [
    { id: 'alessio-picariello', name: 'Alessio Picariello', nationality: 'Bélgica' },
    { id: 'lu-wei', name: 'Lu Wei', nationality: 'China' },
    { id: 'seiji-ara', name: 'Seiji Ara', nationality: 'Japão' },
    { id: 'tomohide-yamaguchi', name: 'Tomohide Yamaguchi', nationality: 'Japão' },
    { id: 'sun-jingzu', name: 'Sun Jingzu', nationality: 'China' },
    { id: 'adderly-fong', name: 'Adderly Fong', nationality: 'Hong Kong' },
    { id: 'liang-jiatong', name: 'Liang Jiatong', nationality: 'China' },
    { id: 'dean-chen', name: 'Dean Chen', nationality: 'China' },
  ],
  races: [
    { id: 'r1-sepang', round: 1, name: 'Sepang', circuit: 'Sepang International Circuit', location: 'Sepang, Malásia', date: '2026-04-04' },
    { id: 'r2-mandalika', round: 2, name: 'Lombok', circuit: 'Mandalika International Street Circuit', location: 'Lombok Central, Indonésia', date: '2026-05-02' },
    { id: 'r3-fuji', round: 3, name: 'Fuji', circuit: 'Fuji Speedway', location: 'Oyama, Japão', date: '2026-07-11' },
    { id: 'r4-okayama', round: 4, name: 'Okayama', circuit: 'Okayama International Circuit', location: 'Mimasaka, Japão', date: '2026-08-29' },
    { id: 'r5-beijing', round: 5, name: 'Beijing', circuit: 'Beijing E-Town Street Circuit', location: 'Pequim, China', date: '2026-10-03' },
    { id: 'r6-shanghai', round: 6, name: 'Shanghai', circuit: 'Shanghai International Circuit', location: 'Xangai, China', date: '2026-10-31' },
  ],
};

export default series;

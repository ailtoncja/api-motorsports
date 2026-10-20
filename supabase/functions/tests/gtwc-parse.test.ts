// Parsers do GTWC contra paginas reais salvas em 2026-10-20 (temporada 2026).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  calendarSeasonYear,
  parseCalendar,
  parseEntryTable,
  parsePastDateRange,
  parseRaceSessionOptions,
  parseRounds,
  parseSeasonOptions,
  parseSessionWinnerTeam,
  parseStandingOptions,
  parseStandingsTable,
  pickStandingOptions,
} from '../_shared/gtwc-parse.ts';
import { fixture } from './helpers.ts';

Deno.test('parseRounds: rodada simples, dupla (Asia) e sem numero', () => {
  assertEquals(parseRounds('Round 1'), [1]);
  assertEquals(parseRounds('Round 1 & 2, GT World Challenge Asia'), [1, 2]);
  assertEquals(parseRounds('Round 11 & 12'), [11, 12]);
  assertEquals(parseRounds('Round 3 - Spa'), [3]);
  assertEquals(parseRounds('Round'), []);
  assertEquals(parseRounds('Test Day'), []);
});

Deno.test('parsePastDateRange: mantem a data do script antigo e acha o fim real', () => {
  assertEquals(parsePastDateRange('10 - 12 April 2026'), { date: '2026-04-12', endDate: '2026-04-12' });
  assertEquals(parsePastDateRange('30 July 2026 - 2 August 2026'), { date: '2026-07-30', endDate: '2026-08-02' });
});

Deno.test('calendario Europe 2026: 10 rodadas, test days fora', () => {
  const races = parseCalendar(fixture('gtwc-europe-calendar.html'));
  assertEquals(races.length, 10);
  assertEquals(races.map((r) => r.round), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assertEquals(races[0], {
    round: 1,
    rounds: [1],
    raceId: 'circuit-paul-ricard',
    eventId: '246',
    name: 'Circuit Paul Ricard',
    location: 'France',
    date: '2026-04-12',
    endDate: '2026-04-12',
  });
  const spa = races.find((r) => r.round === 4)!;
  assertEquals([spa.raceId, spa.eventId], ['crowdstrike-24-hours-of-spa', '249']);
  const magny = races.find((r) => r.raceId === 'magny-cours')!;
  assertEquals([magny.date, magny.endDate], ['2026-07-30', '2026-08-02']);
  assertEquals(races.find((r) => r.round === 7)!.raceId, 'nürburgring');
  assertEquals(races[9].raceId, 'portimao');
  assert(!races.some((r) => /test-days/.test(r.raceId)));
  assertEquals(calendarSeasonYear(races), 2026);
});

Deno.test('calendario America 2026: 7 rodadas, gala de fim de ano fora', () => {
  const races = parseCalendar(fixture('gtwc-america-calendar.html'));
  assertEquals(races.length, 7);
  assertEquals(races[0].raceId, 'sonoma-raceway');
  assertEquals(races[6].raceId, 'indianpolis-8-hour'); // (sic) slug oficial
  assert(!races.some((r) => /gala/.test(r.raceId)));
});

Deno.test('calendario Asia 2026: eventos de 2 rodadas e rodada futura', () => {
  const races = parseCalendar(fixture('gtwc-asia-calendar.html'));
  assertEquals(races.length, 6);
  assertEquals(races.map((r) => r.rounds), [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]]);
  assertEquals(races[0].raceId, 'sepang');
  assertEquals(races[0].round, 1);
  const shanghai = races[5];
  assertEquals([shanghai.raceId, shanghai.date, shanghai.endDate], ['shanghai-international-circuit', '2026-10-30', '2026-11-01']);
});

Deno.test('select de temporada: id interno x ano, selecionada = 2026', () => {
  const eu = parseSeasonOptions(fixture('gtwc-europe-standings-teams.html'));
  assertEquals(eu.find((o) => o.selected), { id: '26', year: 2026, selected: true });
  assertEquals(eu.find((o) => o.year === 2027)?.id, '27');
  assertEquals(eu.find((o) => o.year === 2014)?.id, '1'); // ids nao seguem o ano
  assertEquals(parseSeasonOptions(fixture('gtwc-america-standings.html')).find((o) => o.selected)?.id, '11');
  assertEquals(parseSeasonOptions(fixture('gtwc-asia-standings.html')).find((o) => o.selected)?.id, '10');
});

Deno.test('select de classificacao: escolhe pelos rotulos (mesmos params do script antigo)', () => {
  const pick = (series: 'europe' | 'america' | 'asia', file: string) =>
    pickStandingOptions(series, parseStandingOptions(fixture(file))).map((t) => `${t.standingType}/${t.classLabel}=${t.param}`);
  assertEquals(pick('europe', 'gtwc-europe-standings-teams.html'), ['drivers/Geral=0_0_drivers', 'teams/Geral=0_0_teams']);
  assertEquals(pick('america', 'gtwc-america-standings.html'), [
    'teams/Pro=16_31_teams',
    'teams/Pro-Am=16_30_teams',
    'teams/Am=16_29_teams',
  ]);
  assertEquals(pick('asia', 'gtwc-asia-standings.html'), ['drivers/Geral=11_0_1_drivers', 'teams/Geral=11_0_1_teams']);
});

Deno.test('classificacao Europe: cabecalho disfarcado no tbody, empate na lideranca', () => {
  const drivers = parseStandingsTable(fixture('gtwc-europe-standings-drivers.html'));
  assertEquals(drivers[0], { position: 1, name: 'Lucas Auer', points: 131.5 });
  assertEquals(drivers[1], { position: 1, name: 'Maro Engel', points: 131.5 });
  const teams = parseStandingsTable(fixture('gtwc-europe-standings-teams.html'));
  assertEquals(teams[0], { position: 1, name: 'Team WRT', points: 152.5 });
});

Deno.test('classificacao America (times Pro) e Asia (times geral)', () => {
  const am = parseStandingsTable(fixture('gtwc-america-standings.html'));
  assertEquals(am.slice(0, 3), [
    { position: 1, name: 'Turner Motorsport', points: 154 },
    { position: 2, name: 'JMF Motorsports', points: 144 },
    { position: 3, name: 'AF Corse USA', points: 141 },
  ]);
  const as = parseStandingsTable(fixture('gtwc-asia-standings.html'));
  assertEquals(as[0], { position: 1, name: 'Absolute Racing', points: 184 });
  assertEquals(as[1], { position: 2, name: 'Audi Sport Asia Team Phantom', points: 165 });
});

Deno.test('sessoes de corrida: so Main Race / Race N, sem checkpoints nem treinos', () => {
  assertEquals(parseRaceSessionOptions(fixture('gtwc-europe-results-portimao.html')), [{ id: '1824', label: 'Main Race', order: 0 }]);
  assertEquals(parseRaceSessionOptions(fixture('gtwc-europe-results-brands-hatch.html')).map((s) => s.label), ['Race 1', 'Race 2']);
  assertEquals(parseRaceSessionOptions(fixture('gtwc-asia-results-beijing.html')).map((s) => s.id), ['499', '500']);
});

Deno.test('vencedor da sessao (coluna Team por nome, ordem diferente em cada site)', () => {
  assertEquals(parseSessionWinnerTeam(fixture('gtwc-europe-results-portimao-main-race.html')), 'Mercedes-AMG Team GetSpeed');
  assertEquals(parseSessionWinnerTeam(fixture('gtwc-america-results-indianapolis-race.html')), 'GMG Racing');
  assertEquals(parseSessionWinnerTeam(fixture('gtwc-asia-results-beijing-race1.html')), 'Harmony Racing');
  assertEquals(parseSessionWinnerTeam('<table><thead><tr><th>Pos</th><th>Team</th></tr></thead><tbody></tbody></table>'), null);
});

Deno.test('entry list Europe (Team antes dos pilotos) e America (Team depois)', () => {
  const eu = parseEntryTable(fixture('gtwc-europe-entry-list-portimao.html'));
  assertEquals(eu[0], {
    carNumber: '2',
    teamName: 'Boutsen VDS',
    car: 'Porsche 911 GT3 R (992) EVO',
    class: 'PRO',
    drivers: [
      { name: 'Morris SCHURING', nationality: 'Países Baixos' },
      { name: 'Dorian BOCCOLACCI', nationality: 'França' },
      { name: 'Alessio PICARIELLO', nationality: 'Bélgica' },
    ],
  });
  assertEquals(eu[1].drivers.map((d) => d.name), ['Ben BARNICOAT', 'Chris LULHAM', 'Max VERSTAPPEN']);
  const am = parseEntryTable(fixture('gtwc-america-entry-list-indianapolis.html'));
  assertEquals([am[0].carNumber, am[0].teamName, am[0].class], ['6', 'Dollahite Racing', 'Pro-Am']);
  assertEquals(am[0].drivers[2], { name: 'Christopher Mies', nationality: 'Alemanha' });
});

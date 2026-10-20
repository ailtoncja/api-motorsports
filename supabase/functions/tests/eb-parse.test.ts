// Parsers do Endurance Brasil contra paginas reais salvas em 2026-10-20.
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  assignWinners,
  type EbReport,
  enrichDrivers,
  flattenStandings,
  isOverallWinCandidate,
  parseEbCalendar,
  parseEbNewsIndex,
  parseEbSeason,
  parseEbTeams,
  parseOverallWinnerFromHtml,
  parseSeasonClassifications,
  resolveTeamName,
} from '../_shared/eb-parse.ts';
import { fixture } from './helpers.ts';

Deno.test('temporada do site: <select id="season_select"> = 2026', () => {
  assertEquals(parseEbSeason(fixture('eb-calendario.html')), { id: 'cf10af8b-9608-4638-a4f5-31f882acf918', year: 2026 });
  assertEquals(parseEbSeason(fixture('eb-classificacao.html'))?.year, 2026);
  assertEquals(parseEbSeason('<html></html>'), null);
});

Deno.test('calendario 2026: 8 etapas, 6 encerradas', () => {
  const races = parseEbCalendar(fixture('eb-calendario.html'));
  assertEquals(races.length, 8);
  assertEquals(races.filter((r) => r.completed).length, 6);
  assertEquals(races[0], {
    raceId: '1-etapa-quatro-horas-de-brasilia',
    round: 1,
    name: races[0].name,
    location: 'Autódromo Internacional de Brasília',
    date: '2026-04-11',
    completed: true,
    sourceUrl: 'https://endurancebrasiloficial.com.br/calendario/1-etapa-quatro-horas-de-brasilia',
    winner: null,
  });
  assertEquals(races[6].raceId, 'etapa-7-tres-horas-de-brasilia');
  assertEquals([races[6].date, races[6].completed], ['2026-10-24', false]);
});

Deno.test('classificacao: objeto JS lido com JSON5 (sem eval), general ignorada', () => {
  const byClass = parseSeasonClassifications(fixture('eb-classificacao.html'))!;
  assert(Array.isArray(byClass.general));
  const rows = flattenStandings(byClass);
  assertEquals(rows.length, 48);
  assertEquals([...new Set(rows.map((r) => r.classLabel))].sort(), ['GT3', 'GT4', 'P1']);
  const p1 = rows.filter((r) => r.classLabel === 'P1');
  // Empate: posicao "" no site herda a anterior (#1).
  assertEquals(p1.slice(0, 3), [
    { classLabel: 'P1', position: 1, name: 'Gabriel Koenigkan', points: 580, uf: 'DF' },
    { classLabel: 'P1', position: 1, name: 'Lucas Foresti', points: 580, uf: 'DF' },
    { classLabel: 'P1', position: 1, name: 'Victor Foresti', points: 580, uf: 'MG' },
  ]);
  assertEquals(rows.find((r) => r.classLabel === 'GT4')?.name, 'Alan Hellmeister');
});

Deno.test('classificacao: codigo no lugar de dado e rejeitado, nunca executado', () => {
  (globalThis as Record<string, unknown>).__pwned = false;
  const html = 'const season_classifications = { "P1": [ (globalThis.__pwned = true) ] };';
  assertThrows(() => parseSeasonClassifications(html), Error, 'season_classifications');
  assertEquals((globalThis as Record<string, unknown>).__pwned, false);
  // virgula sobrando e aspas simples (JS valido, JSON invalido) continuam ok
  assertEquals(
    parseSeasonClassifications("const season_classifications = { 'P1': [ { position: '#1', points: 10, pilot: { name: 'X', }, }, ], };"),
    {
      P1: [{ position: '#1', points: 10, pilot: { name: 'X' } }],
    },
  );
});

Deno.test('equipes: nome, chefe e pilotos', () => {
  const teams = parseEbTeams(fixture('eb-equipes.html'));
  assertEquals(teams.length, 4);
  const foresti = teams.find((t) => t.teamId === 'foresti-sports')!;
  assertEquals(foresti.name, 'Foresti Sports');
  assertEquals(foresti.teamPrincipal, 'Pedro Henrique Moises');
  assertEquals(foresti.drivers.length, 10);
  assert(teams.some((t) => t.name === 'GForce Autorsport')); // (sic) grafia do site
});

Deno.test('noticias + materia: vencedor geral pela lista numerada (P1)', () => {
  const items = parseEbNewsIndex(fixture('eb-noticias.html'));
  assertEquals(items.length, 8);
  const win = items.find((i) => i.slug === 'em-interlagos-elias-e-rosario-superam-adversidades')!;
  assertEquals(win.date, '2026-09-12');
  assert(isOverallWinCandidate(win.title));
  assert(!isOverallWinCandidate('Campeões da GT4, Quartiero e Hellmeister dão mais uma vitória à Stuttgart Motorsport em Interlagos'));
  assertEquals(parseOverallWinnerFromHtml(fixture('eb-noticia-etapa6.html')), 'Foresti Sports');
});

Deno.test('assignWinners: casa materia com a etapa e respeita vencedor ja gravado', () => {
  const races = parseEbCalendar(fixture('eb-calendario.html'));
  const teams = parseEbTeams(fixture('eb-equipes.html'));
  const drivers = enrichDrivers([], teams, []);
  const item = parseEbNewsIndex(fixture('eb-noticias.html')).find((i) => i.slug.startsWith('em-interlagos'))!;
  const report: EbReport = { ...item, fromOl: 'Foresti Sports', body: '' };
  races[0].winner = 'Ja Gravado';
  assignWinners(races, [report], teams, drivers);
  assertEquals(races.find((r) => r.round === 6)!.winner, 'Foresti Sports');
  assertEquals(races[0].winner, 'Ja Gravado');
  assertEquals(resolveTeamName('GForce Autosport', teams), 'GForce Autorsport');
});

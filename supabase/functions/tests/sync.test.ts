// Logica de sync (incremental, protecao contra raspagem encolhida, virada
// de temporada, retry/timeout, alerta) com fetch falso servindo fixtures.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { fetchHtml, fetchStats, HTTP_CONFIG, HttpError, resetLimiters } from '../_shared/http.ts';
import { type GtwcState, type GtwcStore, type RaceRow, type StandingDbRow, syncGtwcSeries } from '../_shared/gtwc-sync.ts';
import { type EbState, type EbStore, syncEnduranceBrasil } from '../_shared/eb-sync.ts';
import { RunContext, shrinkGuard } from '../_shared/run.ts';
import { buildAlert } from '../_shared/status.ts';
import { checkSecret } from '../_shared/handler.ts';
import { parseCalendar } from '../_shared/gtwc-parse.ts';
import type { Entry } from '../_shared/gtwc-parse.ts';
import { fakeFetch, fixture, type Route } from './helpers.ts';

HTTP_CONFIG.retryDelaysMs = [5, 5];
HTTP_CONFIG.gapPerHostMs = 0;
resetLimiters();

const NOW = new Date('2026-10-20T12:00:00Z');

function recordingStore(state: GtwcState) {
  const saved: { races: RaceRow[][]; entries: [string, string, number][]; standings: StandingDbRow[][]; years: number[] } = {
    races: [],
    entries: [],
    standings: [],
    years: [],
  };
  const store: GtwcStore = {
    load: () => Promise.resolve(state),
    saveRaces: (_s, year, rows) => (saved.years.push(year), saved.races.push(rows), Promise.resolve()),
    replaceEntries: (_s, raceId, url, entries: Entry[]) => (saved.entries.push([raceId, url, entries.length]), Promise.resolve()),
    replaceStandings: (_s, rows) => (saved.standings.push(rows), Promise.resolve()),
  };
  return { store, saved };
}

const europeRoutes: Route[] = [
  [/\/calendar$/, 'gtwc-europe-calendar.html'],
  [/\/standings$/, 'gtwc-europe-standings-teams.html'],
  [/filter_standing_type=0_0_drivers/, 'gtwc-europe-standings-drivers.html'],
  [/filter_standing_type=0_0_teams/, 'gtwc-europe-standings-teams.html'],
  [/\/results\?.*filter_race_id=/, 'gtwc-europe-results-portimao-main-race.html'],
  [/\/results\?filter_season_id=26&filter_meeting_id=\d+$/, 'gtwc-europe-results-portimao.html'],
  [/\/entry-list\/2026\//, 'gtwc-europe-entry-list-portimao.html'],
];

function fullEuropeState(entriesPerRace: number): GtwcState {
  const races = parseCalendar(fixture('gtwc-europe-calendar.html'));
  return {
    races: new Map(races.map((r) => [r.raceId, { winner: 'Gravado', date: r.date!, entries: entriesPerRace }])),
    standings: new Map([['drivers|Geral', 5], ['teams|Geral', 5]]),
  };
}

Deno.test('gtwc europe, banco vazio: raspa tudo e grava', async () => {
  const fake = fakeFetch(europeRoutes);
  try {
    const { store, saved } = recordingStore({ races: new Map(), standings: new Map() });
    const ctx = new RunContext('t', 110_000, false);
    const summary = await syncGtwcSeries('europe', store, ctx, NOW);
    assertEquals(ctx.status, 'ok', JSON.stringify(ctx.problems));
    assertEquals([summary.seasonYear, summary.seasonId], [2026, '26']);
    assertEquals(saved.years, [2026]);
    assertEquals(saved.races[0].length, 10);
    assertEquals(summary.winners.scraped, 10);
    assertEquals(saved.races[0].find((r) => r.race_id === 'portimao')?.winner, 'Mercedes-AMG Team GetSpeed');
    assertEquals(saved.entries.length, 10);
    assert(saved.entries.every(([, url]) => url.includes('/entry-list/2026/')));
    assertEquals(saved.standings.length, 1);
    assertEquals(new Set(saved.standings[0].map((r) => `${r.standing_type}/${r.class_label}`)), new Set(['drivers/Geral', 'teams/Geral']));
  } finally {
    fake.restore();
  }
});

Deno.test('gtwc europe, incremental: so re-raspa a rodada recente (Portimao)', async () => {
  const fake = fakeFetch(europeRoutes);
  try {
    const { store, saved } = recordingStore(fullEuropeState(5));
    const ctx = new RunContext('t', 110_000, false);
    const summary = await syncGtwcSeries('europe', store, ctx, NOW);
    assertEquals(ctx.status, 'ok', JSON.stringify(ctx.problems));
    assertEquals(summary.winners, { scraped: 1, found: 1, skipped: 9 });
    assertEquals(summary.entries.skipped, 9);
    assertEquals(saved.entries.map(([id]) => id), ['portimao']);
    // vencedor null pras outras = banco mantem o gravado
    assertEquals(saved.races[0].filter((r) => r.winner != null).map((r) => r.race_id), ['portimao']);
    assertEquals(fake.calls.filter((u) => u.includes('/results')).length, 2);
    assertEquals(fake.calls.length, 7);
  } finally {
    fake.restore();
  }
});

Deno.test('gtwc europe: entry list encolhida nao substitui o grid gravado e alerta', async () => {
  const fake = fakeFetch(europeRoutes);
  try {
    const { store, saved } = recordingStore(fullEuropeState(61)); // banco tem 61 carros, fixture tem 5
    const ctx = new RunContext('t', 110_000, false);
    await syncGtwcSeries('europe', store, ctx, NOW);
    assertEquals(saved.entries.length, 0);
    const p = ctx.problems.find((x) => x.code === 'entry_list_suspeito');
    assert(p && p.alert && p.level === 'warning');
    assertEquals(ctx.status, 'warning');
  } finally {
    fake.restore();
  }
});

Deno.test('gtwc: virada pra 2027 sem mudar codigo (season id e ano do entry list descobertos)', async () => {
  const fake = fakeFetch([
    [/\/calendar$/, 'gtwc-europe-calendar-2027.html'],
    // o site ainda mostra a classificacao 2026 mesmo pedindo 2027
    [/\/standings(\?filter_season_id=27)?$/, 'gtwc-europe-standings-teams.html'],
    [/\/entry-list\/2027\//, 404],
  ]);
  try {
    const { store, saved } = recordingStore(fullEuropeState(50));
    const ctx = new RunContext('t', 110_000, false);
    const summary = await syncGtwcSeries('europe', store, ctx, new Date('2027-01-10T12:00:00Z'));
    assertEquals(ctx.status, 'ok', JSON.stringify(ctx.problems));
    assertEquals([summary.seasonYear, summary.seasonId], [2027, '27']);
    assertEquals(saved.years, [2027]);
    assertEquals(saved.races[0].length, 10);
    assert(saved.races[0].some((r) => r.race_id === 'imola'));
    assert(saved.races[0].every((r) => r.winner === null)); // nada disputado ainda
    assertEquals(saved.standings.length, 0); // 2026 fica no banco ate sair a de 2027
    assert(fake.calls.some((u) => u.endsWith('/standings?filter_season_id=27')));
    assertEquals(fake.calls.filter((u) => u.includes('/entry-list/2027/')).length, 10);
    assertEquals(fake.calls.filter((u) => u.includes('/results')).length, 0);
  } finally {
    fake.restore();
  }
});

Deno.test('gtwc: calendario fora do ar -> erro (depois de retry)', async () => {
  const fake = fakeFetch([[/\/calendar$/, 503]]);
  try {
    const { store } = recordingStore({ races: new Map(), standings: new Map() });
    const ctx = new RunContext('t', 110_000, false);
    await assertRejects(() => syncGtwcSeries('europe', store, ctx, NOW), HttpError, 'HTTP 503');
    assertEquals(fake.calls.length, HTTP_CONFIG.maxAttempts);
  } finally {
    fake.restore();
  }
});

function ebStore(state: EbState) {
  const saved = { races: 0, roster: 0, standings: 0, winners: {} as Record<string, string | null> };
  const store: EbStore = {
    load: () => Promise.resolve(state),
    saveRaces: (_y, races) => {
      saved.races++;
      for (const r of races) saved.winners[r.raceId] = r.winner;
      return Promise.resolve();
    },
    replaceRoster: () => (saved.roster++, Promise.resolve()),
    replaceStandings: () => (saved.standings++, Promise.resolve()),
  };
  return { store, saved };
}

const ebRoutes: Route[] = [
  [/\/calendario$/, 'eb-calendario.html'],
  [/\/equipes$/, 'eb-equipes.html'],
  [/\/pilotos$/, 'eb-pilotos.html'],
  [/\/classificacao$/, 'eb-classificacao.html'],
  [/\/noticias$/, 'eb-noticias.html'],
  [/\/noticias\?page=/, () => new Response('<html></html>')],
  [/\/noticia\/em-interlagos/, 'eb-noticia-etapa6.html'],
];

Deno.test('eb, banco vazio: le noticias e acha o vencedor da etapa 6', async () => {
  const fake = fakeFetch(ebRoutes);
  try {
    const { store, saved } = ebStore({ races: new Map(), teams: 0, drivers: 0, standings: 0 });
    const ctx = new RunContext('t', 110_000, false);
    const summary = await syncEnduranceBrasil(store, ctx, NOW);
    assertEquals(summary.seasonYear, 2026);
    assertEquals(saved.winners['etapa-6-tres-horas-de-interlagos'], 'Foresti Sports');
    assertEquals([saved.races, saved.roster, saved.standings], [1, 1, 1]);
    // etapas 1-5 sem materia na fixture -> warning (nao erro)
    assertEquals(ctx.problems.filter((p) => p.code === 'vencedor_nao_encontrado').length, 5);
    assertEquals(ctx.status, 'warning');
  } finally {
    fake.restore();
  }
});

Deno.test('eb, incremental: etapas encerradas ja tem vencedor -> nem abre /noticias', async () => {
  const fake = fakeFetch(ebRoutes);
  try {
    const races = new Map(
      [
        '1-etapa-quatro-horas-de-brasilia',
        '2-etapa-autodromo-de-interlagos',
        'etapa-3-tres-horas-de-interlagos',
        'etapa-4-a-definir',
        'etapa-5-tres-horas-de-goiania',
        'etapa-6-tres-horas-de-interlagos',
      ]
        .map((id) => [id, { winner: 'Gravado', date: '2026-06-01' }]),
    );
    const { store, saved } = ebStore({ races, teams: 4, drivers: 7, standings: 48 });
    const ctx = new RunContext('t', 110_000, false);
    const summary = await syncEnduranceBrasil(store, ctx, NOW);
    assertEquals(ctx.status, 'ok', JSON.stringify(ctx.problems));
    assert(summary.news.skipped);
    assert(!fake.calls.some((u) => u.includes('/noticia')));
    assertEquals(fake.calls.length, 4);
    assertEquals(saved.winners['etapa-6-tres-horas-de-interlagos'], 'Gravado');
  } finally {
    fake.restore();
  }
});

Deno.test('eb: roster encolhido (10 -> 4 equipes) nao e gravado e alerta', async () => {
  const fake = fakeFetch(ebRoutes);
  try {
    const { store, saved } = ebStore({ races: new Map(), teams: 10, drivers: 54, standings: 48 });
    const ctx = new RunContext('t', 110_000, false);
    await syncEnduranceBrasil(store, ctx, NOW);
    assertEquals(saved.roster, 0);
    assertEquals(saved.standings, 1);
    assert(ctx.problems.some((p) => p.code === 'roster_suspeito' && p.alert));
  } finally {
    fake.restore();
  }
});

Deno.test('fetchHtml: retry em 503/429, sem retry em 404, User-Agent honesto', async () => {
  let n = 0;
  let ua = '';
  const fake = fakeFetch([
    [/\/flaky$/, () => (++n < 3 ? new Response('x', { status: n === 1 ? 503 : 429 }) : new Response('ok'))],
    [/\/missing$/, 404],
  ]);
  const inner = globalThis.fetch;
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    ua = new Headers(init?.headers).get('user-agent') ?? '';
    return inner(input, init);
  }) as typeof fetch;
  try {
    fetchStats.retries = 0;
    assertEquals(await fetchHtml('https://example.test/flaky'), 'ok');
    assertEquals(fetchStats.retries, 2);
    assert(ua.startsWith('api-motorsports-sync/') && !/Mozilla/.test(ua));
    await assertRejects(() => fetchHtml('https://example.test/missing'), HttpError, 'HTTP 404');
    assertEquals(fake.calls.filter((u) => u.endsWith('/missing')).length, 1);
  } finally {
    globalThis.fetch = inner;
    fake.restore();
  }
});

Deno.test('fetchHtml: timeout aborta request pendurado', async () => {
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, async () => {
    await new Promise((r) => setTimeout(r, 2000));
    return new Response('tarde demais');
  });
  const { timeoutMs, maxAttempts } = HTTP_CONFIG;
  HTTP_CONFIG.timeoutMs = 100;
  HTTP_CONFIG.maxAttempts = 1;
  try {
    await assertRejects(() => fetchHtml(`http://localhost:${server.addr.port}/`), Error, 'timeout');
  } finally {
    HTTP_CONFIG.timeoutMs = timeoutMs;
    HTTP_CONFIG.maxAttempts = maxAttempts;
    ac.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test('checkSecret: fechado sem SYNC_SECRET, 401 com segredo errado', async () => {
  const req = (secret?: string) => new Request('http://x/sync-gtwc?series=europe', { headers: secret ? { 'x-sync-secret': secret } : {} });
  const previous = Deno.env.get('SYNC_SECRET');
  try {
    Deno.env.delete('SYNC_SECRET');
    assertEquals(checkSecret(req('qualquer'))?.status, 500);
    Deno.env.set('SYNC_SECRET', 'certo');
    assertEquals(checkSecret(req())?.status, 401);
    const denied = checkSecret(req('errado'))!;
    assertEquals(denied.status, 401);
    await denied.body?.cancel();
    assertEquals(checkSecret(req('certo')), null);
  } finally {
    if (previous == null) Deno.env.delete('SYNC_SECRET');
    else Deno.env.set('SYNC_SECRET', previous);
  }
});

Deno.test('shrinkGuard', () => {
  assertEquals(shrinkGuard(0, 0, false), { ok: false, suspicious: false });
  assertEquals(shrinkGuard(0, 10, false), { ok: false, suspicious: true });
  assertEquals(shrinkGuard(4, 10, false), { ok: false, suspicious: true });
  assertEquals(shrinkGuard(4, 10, true), { ok: true, suspicious: false }); // virada de temporada
  assertEquals(shrinkGuard(9, 10, false), { ok: true, suspicious: false });
  assertEquals(shrinkGuard(2, 3, false), { ok: true, suspicious: false }); // base pequena demais pra julgar
});

Deno.test('buildAlert: so na 2a falha seguida, suspeitos na hora, recuperacao', () => {
  const err = [{ level: 'error' as const, code: 'falha_geral', scope: 'x', message: 'HTTP 503' }];
  assertEquals(buildAlert('gtwc-europe', 'error', 1, 0, err), null);
  const second = buildAlert('gtwc-europe', 'error', 2, 1, err)!;
  assert(second.text.includes('falhou 2x'));
  // chave estavel entre a 2a e a 3a falha -> dedupe de 12 h funciona
  assertEquals(buildAlert('gtwc-europe', 'error', 3, 2, err)!.key, second.key);
  const sus = buildAlert('endurance-brasil', 'warning', 0, 0, [{
    level: 'warning',
    code: 'roster_suspeito',
    scope: 'eb_teams',
    message: 'm',
    alert: true,
  }])!;
  assert(sus.text.includes('suspeitos'));
  assertEquals(buildAlert('gtwc-asia', 'ok', 0, 3, [])!.key, 'gtwc-asia|recovered');
  assertEquals(buildAlert('gtwc-asia', 'ok', 0, 1, []), null);
});

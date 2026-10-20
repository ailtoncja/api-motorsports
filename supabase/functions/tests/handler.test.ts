// Casca da Edge Function (runSync) de ponta a ponta, com supabase-js de
// verdade falando com um PostgREST falso e os sites servidos por fixtures:
// confere os payloads das RPCs, o sync_status gravado, o HTTP 500 em falha
// e o alerta (2a falha seguida + dedupe de 12 h).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { HTTP_CONFIG, resetLimiters } from '../_shared/http.ts';
import { runSync } from '../_shared/handler.ts';
import { gtwcDbStore } from '../_shared/db.ts';
import { syncGtwcSeries } from '../_shared/gtwc-sync.ts';
import { fakeFetch, type FakeRequest, type Route } from './helpers.ts';

HTTP_CONFIG.retryDelaysMs = [5, 5];
HTTP_CONFIG.gapPerHostMs = 0;
resetLimiters();

const NOW = new Date('2026-10-20T12:00:00Z');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const asiaSite: Route[] = [
  [/asia\.com\/calendar$/, 'gtwc-asia-calendar.html'],
  [/asia\.com\/standings$/, 'gtwc-asia-standings.html'],
  [/asia\.com\/standings\?filter_season_id=10&filter_standing_type=/, 'gtwc-asia-standings.html'],
  [/asia\.com\/results\?.*filter_race_id=/, 'gtwc-asia-results-beijing-race1.html'],
  [/asia\.com\/results\?filter_season_id=10&filter_meeting_id=\d+$/, 'gtwc-asia-results-beijing.html'],
];

function postgrest(previousStatus: Record<string, unknown> | null): Route[] {
  return [
    [/fake\.supabase\/rest\/v1\/rpc\/gtwc_sync_state/, () => json({ races: [], standings: [] })],
    [/fake\.supabase\/rest\/v1\/rpc\//, () => json({ ok: true })],
    [
      /fake\.supabase\/rest\/v1\/sync_status/,
      (req: FakeRequest) => (req.method === 'GET' ? json(previousStatus ? [previousStatus] : []) : new Response(null, { status: 201 })),
    ],
    [/fake\.alert\/hook/, () => new Response(null, { status: 204 })],
  ];
}

function withEnv(fn: () => Promise<void>) {
  return async () => {
    Deno.env.set('SUPABASE_URL', 'http://fake.supabase');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-de-teste');
    Deno.env.set('ALERT_WEBHOOK_URL', 'http://fake.alert/hook');
    try {
      await fn();
    } finally {
      for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ALERT_WEBHOOK_URL']) Deno.env.delete(k);
    }
  };
}

const run = () =>
  runSync('gtwc-asia', async (db, ctx) => {
    const summary = await syncGtwcSeries('asia', gtwcDbStore(db), ctx, NOW);
    return { seasonYear: summary.seasonYear, summary };
  });

const bodyOf = (reqs: FakeRequest[], re: RegExp, method = 'POST') => {
  const r = reqs.find((x) => re.test(x.url) && x.method === method);
  return r?.body ? JSON.parse(r.body) : null;
};

Deno.test(
  'runSync ok: RPCs com payload certo, sync_status ok, HTTP 200, sem alerta',
  withEnv(async () => {
    const fake = fakeFetch([...asiaSite, ...postgrest(null)]);
    try {
      const res = await run();
      const body = await res.json();
      assertEquals(res.status, 200, JSON.stringify(body.problems));
      assertEquals([body.status, body.seasonYear], ['ok', 2026]);

      const races = bodyOf(fake.requests, /rpc\/sync_gtwc_races/);
      assertEquals([races.p_series, races.p_season_year, races.p_rows.length], ['asia', 2026, 6]);
      assertEquals(races.p_rows[0].race_id, 'sepang');
      // o fetch falso serve a mesma fixture (Race 1 de Pequim) pras 2 sessoes
      assertEquals(races.p_rows[4].winner, 'Harmony Racing / Harmony Racing');
      assertEquals(races.p_rows[5].winner, null); // Xangai ainda nao aconteceu
      const standings = bodyOf(fake.requests, /rpc\/replace_gtwc_standings/);
      assertEquals(standings.p_series, 'asia');
      assert(standings.p_rows.length > 0);
      assert(!fake.calls.some((u) => /entry-list|replace_gtwc_entries/.test(u))); // Asia: PDF, sem entry list

      const status = bodyOf(fake.requests, /sync_status/);
      assertEquals([status.category, status.last_status, status.consecutive_failures, status.season_year], ['gtwc-asia', 'ok', 0, 2026]);
      assert(status.last_success_at);
      assert(!fake.calls.some((u) => u.includes('fake.alert')));
    } finally {
      fake.restore();
    }
  }),
);

Deno.test(
  'runSync falha: 2a falha seguida -> HTTP 500, consecutive_failures 2, alerta no webhook',
  withEnv(async () => {
    const fake = fakeFetch([
      [/asia\.com\/calendar$/, 503],
      ...postgrest({
        category: 'gtwc-asia',
        consecutive_failures: 1,
        last_success_at: '2026-10-19T00:00:00Z',
        last_alert_key: null,
        last_alert_at: null,
      }),
    ]);
    try {
      const res = await run();
      const body = await res.json();
      assertEquals(res.status, 500);
      assertEquals([body.status, body.consecutiveFailures], ['error', 2]);
      const status = bodyOf(fake.requests, /sync_status/);
      assertEquals([status.last_status, status.consecutive_failures, status.last_success_at], ['error', 2, '2026-10-19T00:00:00Z']);
      assert(String(status.last_error).includes('HTTP 503'));
      const alert = bodyOf(fake.requests, /fake\.alert/);
      assert(alert.content.includes('gtwc-asia') && alert.content.includes('falhou 2x'));
      assert(status.last_alert_key?.startsWith('gtwc-asia|failure'));
    } finally {
      fake.restore();
    }
  }),
);

Deno.test(
  'runSync falha: 1a falha nao alerta; mesmo alerta dentro de 12 h nao repete',
  withEnv(async () => {
    let fake = fakeFetch([[/asia\.com\/calendar$/, 503], ...postgrest(null)]);
    try {
      const res = await run();
      await res.body?.cancel();
      assertEquals(res.status, 500);
      assert(!fake.calls.some((u) => u.includes('fake.alert')));
    } finally {
      fake.restore();
    }
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fake = fakeFetch([
      [/asia\.com\/calendar$/, 503],
      ...postgrest({
        category: 'gtwc-asia',
        consecutive_failures: 2,
        last_success_at: null,
        last_alert_key: 'gtwc-asia|failure:falha_geral',
        last_alert_at: recent,
      }),
    ]);
    try {
      const res = await run();
      await res.body?.cancel();
      assertEquals(res.status, 500);
      assert(!fake.calls.some((u) => u.includes('fake.alert')));
      assertEquals(bodyOf(fake.requests, /sync_status/).consecutive_failures, 3);
    } finally {
      fake.restore();
    }
  }),
);

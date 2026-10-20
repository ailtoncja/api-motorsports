// Edge Function: sync de UMA serie do GT World Challenge por chamada.
//
//   POST /functions/v1/sync-gtwc?series=europe|america|asia
//   header x-sync-secret: <SYNC_SECRET>
//
// Disparada pelo pg_cron (supabase/setup_cron.sql), uma serie por vez e em
// horarios diferentes -- as 3 juntas nao cabem no limite de 150 s.
// Substitui scripts/sync-gtwc.mjs + .github/workflows/sync-gtwc.yml.

import { checkSecret, runSync } from '../_shared/handler.ts';
import { gtwcDbStore } from '../_shared/db.ts';
import { isSeriesId, SERIES_IDS, syncGtwcSeries } from '../_shared/gtwc-sync.ts';

Deno.serve(async (req) => {
  const denied = checkSecret(req);
  if (denied) return denied;

  const series = new URL(req.url).searchParams.get('series');
  if (!isSeriesId(series)) {
    return new Response(JSON.stringify({ error: `use ?series=${SERIES_IDS.join('|')}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return await runSync(`gtwc-${series}`, async (db, ctx) => {
    const summary = await syncGtwcSeries(series, gtwcDbStore(db), ctx);
    return { seasonYear: summary.seasonYear, summary };
  });
});

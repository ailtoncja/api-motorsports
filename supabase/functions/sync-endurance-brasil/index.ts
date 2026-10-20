// Edge Function: sync do Endurance Brasil.
//
//   POST /functions/v1/sync-endurance-brasil
//   header x-sync-secret: <SYNC_SECRET>
//
// Disparada pelo pg_cron (supabase/setup_cron.sql). Substitui
// scripts/sync-endurance-brasil.mjs + .github/workflows/sync-endurance-brasil.yml.

import { checkSecret, runSync } from '../_shared/handler.ts';
import { ebDbStore } from '../_shared/db.ts';
import { syncEnduranceBrasil } from '../_shared/eb-sync.ts';

Deno.serve(async (req) => {
  const denied = checkSecret(req);
  if (denied) return denied;

  return await runSync('endurance-brasil', async (db, ctx) => {
    const summary = await syncEnduranceBrasil(ebDbStore(db), ctx);
    return { seasonYear: summary.seasonYear, summary };
  });
});

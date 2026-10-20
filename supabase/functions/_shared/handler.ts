// Casca comum das Edge Functions de sync: autenticacao por x-sync-secret,
// execucao com orcamento de tempo, gravacao em sync_status, alerta e
// resposta JSON (HTTP 500 quando a execucao falha -- o script antigo saia
// com codigo 0 mesmo com erro).

import { fetchStats } from './http.ts';
import { serviceClient } from './db.ts';
import { recordRun } from './status.ts';
import { errorMessage, RunContext } from './run.ts';
import type { SupabaseClient } from './deps.ts';

// Limite de uma Edge Function e 150 s; para de raspar coisa opcional
// (entry lists) bem antes disso.
const RUN_BUDGET_MS = 110_000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function checkSecret(req: Request): Response | null {
  const expected = Deno.env.get('SYNC_SECRET');
  // Sem segredo configurado a funcao fica fechada (nunca aberta por engano).
  if (!expected) return json({ error: 'SYNC_SECRET nao configurado' }, 500);
  const got = req.headers.get('x-sync-secret') ?? '';
  if (!timingSafeEqual(got, expected)) return json({ error: 'unauthorized' }, 401);
  return null;
}

export interface SyncOutcome {
  seasonYear: number | null;
  summary: unknown;
}

export async function runSync(
  category: string,
  fn: (db: SupabaseClient, ctx: RunContext) => Promise<SyncOutcome>,
): Promise<Response> {
  const ctx = new RunContext(category, RUN_BUDGET_MS);
  fetchStats.requests = 0;
  fetchStats.retries = 0;

  let db: SupabaseClient;
  try {
    db = serviceClient();
  } catch (error) {
    return json({ category, status: 'error', error: errorMessage(error) }, 500);
  }

  let outcome: SyncOutcome = { seasonYear: null, summary: null };
  try {
    outcome = await fn(db, ctx);
  } catch (error) {
    ctx.error('falha_geral', category, errorMessage(error));
  }

  const body: Record<string, unknown> = {
    category,
    status: ctx.status,
    durationMs: ctx.elapsedMs(),
    requests: fetchStats.requests,
    retries: fetchStats.retries,
    seasonYear: outcome.seasonYear,
    problems: ctx.problems,
    summary: outcome.summary,
  };
  try {
    const { consecutiveFailures, alerted } = await recordRun(db, category, ctx, outcome.seasonYear, {
      requests: fetchStats.requests,
      retries: fetchStats.retries,
      ...(outcome.summary as Record<string, unknown> ?? {}),
    });
    body.consecutiveFailures = consecutiveFailures;
    body.alerted = alerted;
  } catch (error) {
    console.error(`[${category}] nao consegui gravar sync_status: ${errorMessage(error)}`);
    body.statusError = errorMessage(error);
    return json(body, 500);
  }
  return json(body, ctx.status === 'error' ? 500 : 200);
}

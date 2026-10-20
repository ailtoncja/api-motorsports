// Tabela sync_status (1 linha por categoria) + alertas.
//
// Alerta (Telegram e/ou webhook estilo Discord) quando:
//   - a categoria falha pela 2a vez seguida (ou mais);
//   - algum problema veio marcado como suspeito (alert: true), ex.: raspagem
//     com bem menos linhas que o banco;
//   - a categoria volta a funcionar depois de um alerta de falha.
// O mesmo alerta (mesma chave) nao e reenviado dentro de 12 h.

import type { SupabaseClient } from './deps.ts';
import { errorMessage, type Problem, type RunContext } from './run.ts';

const DEDUPE_MS = 12 * 60 * 60 * 1000;

interface StatusRow {
  category: string;
  consecutive_failures: number;
  last_success_at: string | null;
  last_alert_key: string | null;
  last_alert_at: string | null;
}

export interface Alert {
  key: string;
  text: string;
}

// Decide o alerta da execucao (no maximo 1 mensagem por execucao).
export function buildAlert(category: string, status: string, failures: number, prevFailures: number, problems: Problem[]): Alert | null {
  const errors = problems.filter((p) => p.level === 'error');
  const suspicious = problems.filter((p) => p.alert);
  const parts: string[] = [];
  const keyParts: string[] = [];
  if (status === 'error' && failures >= 2) {
    parts.push(`falhou ${failures}x seguidas:\n${errors.slice(0, 5).map((p) => `- ${p.scope}: ${p.message}`).join('\n')}`);
    keyParts.push(`failure:${[...new Set(errors.map((p) => p.code))].sort().join(',')}`);
  }
  if (suspicious.length > 0) {
    parts.push(`dados suspeitos (nada foi apagado):\n${suspicious.slice(0, 5).map((p) => `- ${p.scope}: ${p.message}`).join('\n')}`);
    keyParts.push(`suspicious:${[...new Set(suspicious.map((p) => `${p.code}@${p.scope}`))].sort().join(',')}`);
  }
  if (parts.length === 0 && status !== 'error' && prevFailures >= 2) {
    parts.push(`voltou a funcionar depois de ${prevFailures} falha(s) seguidas.`);
    keyParts.push('recovered');
  }
  if (parts.length === 0) return null;
  return { key: `${category}|${keyParts.join('|')}`, text: `[api-motorsports] sync ${category} ${parts.join('\n\n')}` };
}

export async function sendAlert(text: string): Promise<string[]> {
  const sent: string[] = [];
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  const webhook = Deno.env.get('ALERT_WEBHOOK_URL');
  const jobs: Promise<void>[] = [];
  if (token && chatId) {
    jobs.push((async () => {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`telegram HTTP ${res.status}`);
      sent.push('telegram');
    })());
  }
  if (webhook) {
    jobs.push((async () => {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text.slice(0, 1900) }),
        signal: AbortSignal.timeout(10_000),
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
      sent.push('webhook');
    })());
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') console.error(`alerta nao enviado: ${errorMessage(r.reason)}`);
  return sent;
}

// Grava o resultado da execucao em sync_status e manda alerta se preciso.
// Devolve o numero de falhas seguidas (ja contando esta).
export async function recordRun(
  db: SupabaseClient,
  category: string,
  ctx: RunContext,
  seasonYear: number | null,
  summary: unknown,
): Promise<{ consecutiveFailures: number; alerted: string[] }> {
  const { data: prev, error: readError } = await db
    .from('sync_status')
    .select('category, consecutive_failures, last_success_at, last_alert_key, last_alert_at')
    .eq('category', category)
    .maybeSingle<StatusRow>();
  if (readError) throw new Error(`sync_status: ${readError.message}`);

  const nowIso = new Date().toISOString();
  const status = ctx.status;
  const prevFailures = prev?.consecutive_failures ?? 0;
  const failures = status === 'error' ? prevFailures + 1 : 0;
  const errors = ctx.problems.filter((p) => p.level === 'error');

  let alertKey = prev?.last_alert_key ?? null;
  let alertAt = prev?.last_alert_at ?? null;
  let alerted: string[] = [];
  const alert = buildAlert(category, status, failures, prevFailures, ctx.problems);
  const duplicate = alert && alert.key === prev?.last_alert_key && prev?.last_alert_at &&
    Date.now() - Date.parse(prev.last_alert_at) < DEDUPE_MS;
  if (alert && !duplicate) {
    alerted = await sendAlert(alert.text);
    if (alerted.length > 0) {
      alertKey = alert.key;
      alertAt = nowIso;
    }
  }

  const { error: writeError } = await db.from('sync_status').upsert({
    category,
    last_run_at: nowIso,
    last_status: status,
    last_success_at: status === 'error' ? prev?.last_success_at ?? null : nowIso,
    consecutive_failures: failures,
    last_error: errors.length > 0 ? errors.map((p) => `${p.scope}: ${p.message}`).join(' | ').slice(0, 2000) : null,
    problems: ctx.problems,
    last_duration_ms: ctx.elapsedMs(),
    season_year: seasonYear,
    last_summary: summary ?? null,
    last_alert_key: alertKey,
    last_alert_at: alertAt,
  }, { onConflict: 'category' });
  if (writeError) throw new Error(`sync_status: ${writeError.message}`);
  return { consecutiveFailures: failures, alerted };
}

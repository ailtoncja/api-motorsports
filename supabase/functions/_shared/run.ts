// Contexto de uma execucao: log, lista de problemas e orcamento de tempo.
//
// Dois niveis de problema:
//   error   -> a execucao FALHOU (HTTP 500, conta em consecutive_failures).
//              Ex.: site fora do ar depois dos retries, calendario vazio,
//              erro de banco.
//   warning -> rodou, mas tem algo estranho (HTTP 200, fica em problems).
//              Ex.: vencedor nao achado, tempo esgotado antes do fim.
// `alert: true` marca o problema como "suspeito" (ex.: raspagem trouxe bem
// menos linhas que o banco ja tem) -- dispara alerta na hora, sem esperar a
// 2a falha seguida.

export type ProblemLevel = 'error' | 'warning';

export interface Problem {
  level: ProblemLevel;
  code: string;
  scope: string;
  message: string;
  alert?: boolean;
}

export class RunContext {
  readonly problems: Problem[] = [];
  readonly startedAt = Date.now();
  private readonly lines: string[] = [];

  constructor(readonly label: string, private readonly budgetMs = 120_000, private readonly echo = true) {}

  log(message: string): void {
    const line = `[${this.label}] ${message}`;
    this.lines.push(line);
    if (this.echo) console.log(line);
  }

  problem(p: Problem): void {
    this.problems.push(p);
    const line = `[${this.label}] ${p.level.toUpperCase()} ${p.code} (${p.scope}): ${p.message}`;
    this.lines.push(line);
    if (this.echo) (p.level === 'error' ? console.error : console.warn)(line);
  }

  error(code: string, scope: string, message: string, alert = false): void {
    this.problem({ level: 'error', code, scope, message, alert });
  }

  warn(code: string, scope: string, message: string, alert = false): void {
    this.problem({ level: 'warning', code, scope, message, alert });
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  timeLeftMs(): number {
    return this.budgetMs - this.elapsedMs();
  }

  get status(): 'ok' | 'warning' | 'error' {
    if (this.problems.some((p) => p.level === 'error')) return 'error';
    if (this.problems.length > 0) return 'warning';
    return 'ok';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}

// "Hoje" em UTC no formato YYYY-MM-DD (mesmo formato das datas das corridas).
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

// Protecao contra raspagem "meia boca": decide se um conjunto novo de linhas
// pode substituir o que ja esta no banco.
//   - 0 linhas: nunca grava (as funcoes SQL tambem recusam).
//   - menos da metade do que ja existe (com base >= minBase), fora de virada
//     de temporada: nao grava e marca como suspeito.
export function shrinkGuard(
  newCount: number,
  storedCount: number,
  seasonChanged: boolean,
  minBase = 4,
): { ok: boolean; suspicious: boolean } {
  if (newCount === 0) return { ok: false, suspicious: storedCount > 0 };
  if (!seasonChanged && storedCount >= minBase && newCount < storedCount * 0.5) return { ok: false, suspicious: true };
  return { ok: true, suspicious: false };
}

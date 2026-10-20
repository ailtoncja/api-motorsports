// Dry-run local: raspa de verdade, mas NAO grava nada (store em memoria,
// banco "vazio" = pior caso, tudo e raspado como na primeira execucao).
// Mostra o que seria gravado e quanto tempo levou.
//
//   deno run -A supabase/functions/tools/probe.ts gtwc europe|america|asia|all
//   deno run -A supabase/functions/tools/probe.ts eb
//
// Nao precisa de env var nenhuma.

import { fetchStats } from '../_shared/http.ts';
import { RunContext } from '../_shared/run.ts';
import { type GtwcState, type GtwcStore, isSeriesId, SERIES_IDS, syncGtwcSeries } from '../_shared/gtwc-sync.ts';
import { type EbStore, syncEnduranceBrasil } from '../_shared/eb-sync.ts';
import type { SeriesId } from '../_shared/gtwc-parse.ts';

const verbose = Deno.args.includes('--verbose');

function memoryGtwcStore(): GtwcStore & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    load: (): Promise<GtwcState> => Promise.resolve({ races: new Map(), standings: new Map() }),
    saveRaces: (series, year, rows) => {
      writes.push(`sync_gtwc_races(${series}, ${year}): ${rows.length} corrida(s)`);
      return Promise.resolve();
    },
    replaceEntries: (series, raceId, _url, entries) => {
      writes.push(`replace_gtwc_entries(${series}, ${raceId}): ${entries.length} carro(s)`);
      return Promise.resolve();
    },
    replaceStandings: (series, rows) => {
      writes.push(`replace_gtwc_standings(${series}): ${rows.length} linha(s)`);
      return Promise.resolve();
    },
  };
}

function memoryEbStore(): EbStore & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    load: () => Promise.resolve({ races: new Map(), teams: 0, drivers: 0, standings: 0 }),
    saveRaces: (year, races) => {
      writes.push(`sync_eb_races(${year}): ${races.length} etapa(s)`);
      return Promise.resolve();
    },
    replaceRoster: (teams, drivers) => {
      writes.push(`replace_eb_roster: ${teams.length} equipe(s), ${drivers.length} piloto(s)`);
      return Promise.resolve();
    },
    replaceStandings: (rows) => {
      writes.push(`replace_eb_standings: ${rows.length} linha(s)`);
      return Promise.resolve();
    },
  };
}

function report(ctx: RunContext, writes: string[]) {
  console.log(
    `  status: ${ctx.status}, ${fetchStats.requests} request(s), ${fetchStats.retries} retry(s), ${(ctx.elapsedMs() / 1000).toFixed(1)} s`,
  );
  for (const w of writes) console.log(`  [dry-run] ${w}`);
  for (const p of ctx.problems) console.log(`  problema ${p.level}${p.alert ? ' (alerta)' : ''}: ${p.code} ${p.scope} -- ${p.message}`);
}

async function probeGtwc(series: SeriesId): Promise<number> {
  fetchStats.requests = 0;
  fetchStats.retries = 0;
  const ctx = new RunContext(`gtwc-${series}`, 110_000, verbose);
  const store = memoryGtwcStore();
  console.log(`\n=== gtwc ${series} ===`);
  try {
    const s = await syncGtwcSeries(series, store, ctx);
    console.log(`  temporada ${s.seasonYear} (season id ${s.seasonId})`);
    for (const r of s.races) {
      const cars = s.entries.cars[r.raceId];
      console.log(
        `  R${r.rounds.join('&').padEnd(5)} ${r.date} -> ${r.endDate}  ${r.raceId.padEnd(38)} winner=${r.winner ?? '-'}${
          cars != null ? `  carros=${cars}` : ''
        }`,
      );
    }
    for (const st of s.standings) {
      console.log(
        `  standings ${st.standingType}/${st.classLabel}: ${st.rows} linha(s), lider ${st.top ? `${st.top.name} ${st.top.points}` : '-'}`,
      );
    }
  } catch (error) {
    ctx.error('falha_geral', series, (error as Error).message);
  }
  report(ctx, store.writes);
  return ctx.elapsedMs();
}

async function probeEb(): Promise<number> {
  fetchStats.requests = 0;
  fetchStats.retries = 0;
  const ctx = new RunContext('endurance-brasil', 110_000, verbose);
  const store = memoryEbStore();
  console.log('\n=== endurance-brasil ===');
  try {
    const s = await syncEnduranceBrasil(store, ctx);
    console.log(
      `  temporada ${s.seasonYear}, ${s.teams} equipe(s), ${s.drivers} piloto(s), noticias: ${s.news.pages} pagina(s), ${s.news.articles} materia(s)`,
    );
    for (const r of s.races) {
      console.log(`  E${r.round} ${r.date} ${r.completed ? 'ENCERRADA' : '         '} ${r.raceId.padEnd(45)} winner=${r.winner ?? '-'}`);
    }
    for (const [cls, leader] of Object.entries(s.standings.leaders)) console.log(`  standings ${cls}: lider ${leader}`);
  } catch (error) {
    ctx.error('falha_geral', 'endurance-brasil', (error as Error).message);
  }
  report(ctx, store.writes);
  return ctx.elapsedMs();
}

const [kind, target] = Deno.args.filter((a) => !a.startsWith('--'));
const timings: [string, number][] = [];
if (kind === 'gtwc' && (isSeriesId(target ?? null) || target === 'all' || !target)) {
  const list = isSeriesId(target ?? null) ? [target as SeriesId] : SERIES_IDS;
  for (const series of list) timings.push([`gtwc ${series}`, await probeGtwc(series)]);
} else if (kind === 'eb') {
  timings.push(['endurance-brasil', await probeEb()]);
} else {
  console.error('uso: deno run -A supabase/functions/tools/probe.ts gtwc europe|america|asia|all  |  eb   [--verbose]');
  Deno.exit(2);
}
console.log('\ntempos:');
for (const [name, ms] of timings) {
  console.log(`  ${name.padEnd(20)} ${(ms / 1000).toFixed(1)} s${ms >= 60_000 ? '  (ACIMA DE 60 s!)' : ''}`);
}

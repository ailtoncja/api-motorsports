import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente de leitura do projeto Supabase do PitStopHub (outro projeto, nao o
// desta API). NASCAR Brasil e Porsche Cup Brasil ja sao raspadas das fontes
// oficiais pelo motor do pitstophub-data, que grava em synced_races,
// synced_standings, standings_detail e race_results. Esta API so publica esses
// dados no mesmo formato das outras categorias -- raspar de novo aqui criaria
// duas verdades diferentes para a mesma etapa.
//
// Sao tabelas de leitura publica (anon so tem SELECT). O cliente e criado na
// primeira chamada: sem as env vars, as rotas respondem 503 em vez de derrubar
// o resto da API (GTWC e Endurance Brasil continuam de pe).

let client: SupabaseClient | null = null;

export function pitstophubData(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.PITSTOPHUB_SUPABASE_URL;
  const key = process.env.PITSTOPHUB_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}

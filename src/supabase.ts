import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Faltam env vars: SUPABASE_URL, SUPABASE_ANON_KEY');
}

// Cliente de leitura -- a API nunca escreve no banco. Quem escreve e
// scripts/sync-gtwc.mjs, com a service_role key (nunca exposta aqui).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

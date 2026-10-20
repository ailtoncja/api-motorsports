// Dependencias externas num lugar so (versoes fixas). Edge Functions do
// Supabase rodam Deno, entao tudo vem por especificador npm: -- sem
// package.json/node_modules.
//
// cheerio 1.0.0-rc.12 de proposito: mesmo parser (parse5) e mesma API que a
// 1.x usada pelos scripts Node, mas sem a dependencia de undici/node:stream
// que a 1.x puxa so pra fromURL() -- menos coisa pra dar errado no runtime
// das Edge Functions. Saida conferida identica a da 1.2.0 (probe + testes).
export * as cheerio from 'npm:cheerio@1.0.0-rc.12';
export type { CheerioAPI } from 'npm:cheerio@1.0.0-rc.12';
export { createClient } from 'npm:@supabase/supabase-js@2';
export type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
export { default as JSON5 } from 'npm:json5@2.2.3';

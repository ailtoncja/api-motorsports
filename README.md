# api-motorsports

API (Node.js + TypeScript + Express + Supabase) do franchise **GT World Challenge**: Europe, America e Asia. Times, pilotos e calendário de cada série.

**Sincronizada automaticamente**, direto dos sites oficiais de cada série (`gt-world-challenge-europe.com`, `-america.com`, `-asia.com`) — não existe API pública estruturada pra essa categoria, então `scripts/sync-gtwc.mjs` raspa as páginas HTML de calendário e entry list e grava no Supabase. Roda 1x/dia via GitHub Actions (`.github/workflows/sync-gtwc.yml`).

> **Limitação conhecida (Asia)**: o entry list oficial da GT World Challenge Asia só é publicado em PDF, não em tabela HTML — não dá pra raspar isso com confiança. Só o calendário da Asia é automático; times/pilotos ficam com carga manual (`supabase/seed_asia.sql`).

## Por que cada corrida tem seu próprio grid

Diferente de assumir "um roster fixo pra temporada + uma exceção pras corridas grandes" (foi assim que o pitstophub tentou representar isso via TheSportsDB, e misturou o grid de Sprint Cup com o de Endurance Cup — por isso o GT World Challenge foi removido de lá), aqui **cada corrida grava o grid raspado da própria página oficial daquela corrida**. Sprint Cup e Endurance Cup nunca se confundem, porque cada um vem da sua própria fonte.

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha com as chaves do seu projeto Supabase
npm run dev
```

Sobe em `http://localhost:3000` (mude a porta com a env var `PORT`).

## Endpoints

| Rota | Descrição |
|---|---|
| `GET /health` | Healthcheck |
| `GET /series` | Lista as 3 séries (`europe`, `america`, `asia`) |
| `GET /series/:seriesId` | Nome/id da série |
| `GET /series/:seriesId/races` | Calendário |
| `GET /series/:seriesId/races/:raceId` | Uma corrida, com `entryList` (grid completo raspado daquela corrida) |
| `GET /series/:seriesId/teams` | Times únicos que apareceram em algum entry list da série (visão derivada) |
| `GET /series/:seriesId/drivers` | Pilotos únicos que apareceram em algum entry list da série (visão derivada) |

`seriesId` é `europe`, `america` ou `asia`. `raceId` é o slug oficial da corrida (ex.: `circuit-paul-ricard`, `crowdstrike-24-hours-of-spa`) — bate com a URL do site oficial.

## Banco de dados (Supabase)

Duas tabelas, definidas em `supabase/schema.sql` (rode no SQL Editor do seu projeto Supabase):

- `gtwc_races` — calendário (série, corrida, rodada, nome, local, data).
- `gtwc_entries` — grid de cada corrida (número do carro, time, carro, classe, pilotos em `jsonb`).

Leitura pública (RLS `select` liberado pra qualquer um); escrita só via `service_role` (usada pelo script de sync).

Pra popular os dados da Asia (sem sync automático), rode `supabase/seed_asia.sql` uma vez.

## Sincronização (`scripts/sync-gtwc.mjs`)

```bash
npm run sync:gtwc
```

Precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no `.env` (ou como env var). Passo a passo, por série:

1. Busca `/calendar` no site oficial, extrai cada rodada (número, nome do circuito, país, data, slug do evento) — tanto as rodadas futuras quanto as já disputadas (o site usa duas seções HTML diferentes pras duas).
2. Pra Europe e America: busca `/entry-list/{ano}/{slug}` de cada rodada, lê o cabeçalho da tabela pra mapear as colunas (a ordem/quantidade difere entre os dois sites — por isso lê por nome da coluna, não posição fixa) e grava o grid completo.
3. Pra Asia: só grava o calendário (entry list é PDF, ver limitação acima).

O ano da URL do entry-list (`YEAR` no topo do script) precisa ser atualizado manualmente na virada de temporada.

## Build / produção (local)

```bash
npm run build   # compila src/ -> dist/
npm start        # roda dist/server.js
```

## Deploy na Vercel

O projeto já vem pronto pra Vercel (`vercel.json` + `api/index.ts`):

1. Suba o repo pro GitHub.
2. Na Vercel, "Add New Project" → importe o repo. Framework "Other", sem build command — a Vercel detecta `api/index.ts` como função serverless sozinha.
3. Nas env vars do projeto na Vercel, adicione `SUPABASE_URL` e `SUPABASE_ANON_KEY` (só leitura -- nunca a `service_role` aqui).
4. Pronto: `https://<seu-projeto>.vercel.app/series` já responde.

`api/index.ts` exporta o mesmo app Express de `src/app.ts` (o de `npm run dev`), então o comportamento é idêntico local e em produção. `vercel.json` só redireciona toda rota pra essa função, já que as rotas reais (`/series`, `/health` etc.) são definidas dentro do Express, não em arquivos separados por rota.

A API já libera CORS pra qualquer origem (ver `src/app.ts`), então dá pra chamar direto do navegador a partir de outro site/app (ex.: o PitStopHub).

## GitHub Actions

`.github/workflows/sync-gtwc.yml` roda o sync 1x/dia (06:00 UTC) e também aceita disparo manual (`workflow_dispatch`, aba Actions no GitHub). Precisa dos secrets `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` cadastrados no repositório (Settings → Secrets and variables → Actions).

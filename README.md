# api-motorsports

API (Node.js + TypeScript + Express + Supabase) do franchise **GT World Challenge** (Europe, America e Asia) e do **Endurance Brasil**. Times, pilotos e calendário de cada campeonato.

O GTWC é **sincronizado automaticamente** dos sites oficiais (`gt-world-challenge-europe.com`, `-america.com`, `-asia.com`) — não existe API pública estruturada pra essa categoria, então `scripts/sync-gtwc.mjs` raspa as páginas HTML de calendário e entry list e grava no Supabase. Roda 1x/dia via GitHub Actions (`.github/workflows/sync-gtwc.yml`).

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
| `winner` (em `/races` e `/races/:raceId`) | Nome do time vencedor (`null` se a corrida ainda não rolou ou o resultado não foi encontrado) |
| `GET /series/:seriesId/teams` | Times únicos que apareceram em algum entry list da série (visão derivada), cada um já com `drivers[]` embutido |
| `GET /series/:seriesId/drivers` | Pilotos únicos que apareceram em algum entry list da série (visão derivada) |
| `GET /series/:seriesId/standings` | Classificação de pilotos e/ou times, `{ drivers: StandingsClass[] \| null, teams: StandingsClass[] \| null }` |

`StandingsClass` é `{ classLabel: string, entries: { position, name, points }[] }` — uma classificação pode ter mais de uma classe (ex.: `classLabel: 'Pro'`, `'Pro-Am'`, `'Am'`), nunca misturadas numa lista só de posições. **Nem toda série tem os dois tipos**: a America não tem uma classificação "geral" de pilotos nem de times em 2026 no site oficial, só classificação de times por classe (Pro/Pro-Am/Am) — por isso `drivers` vem `null` pra ela. Ver `SERIES_CONFIG` em `scripts/sync-gtwc.mjs` pra saber exatamente o que cada série sincroniza.

`seriesId` é `europe`, `america` ou `asia`. `raceId` é o slug oficial da corrida (ex.: `circuit-paul-ricard`, `crowdstrike-24-hours-of-spa`) — bate com a URL do site oficial.

### Endurance Brasil

Rotas irmãs do GTWC — **não substituem** `/series`. Fonte: [endurancebrasiloficial.com.br](https://endurancebrasiloficial.com.br/). O site não publica entry list por corrida nem resultado estruturado da etapa, então não há `entryList` e `winner` vem `null`.

| Rota | Descrição |
|---|---|
| `GET /endurance-brasil` | `{ id: "endurance-brasil", name: "Endurance Brasil" }` |
| `GET /endurance-brasil/races` | Calendário (`completed` = badge ENCERRADA no site) |
| `GET /endurance-brasil/races/:raceId` | Uma etapa (slug oficial, ex.: `1-etapa-quatro-horas-de-brasilia`) |
| `GET /endurance-brasil/teams` | Equipes da temporada, cada uma com `drivers[]` |
| `GET /endurance-brasil/teams/:teamId` | Uma equipe |
| `GET /endurance-brasil/drivers` | Pilotos da temporada (`uf` = estado, `class` = P1/GT3/…) |
| `GET /endurance-brasil/drivers/:driverId` | Um piloto |
| `GET /endurance-brasil/standings` | `{ drivers: StandingsClass[] \| null, teams: null }` — uma lista por classe (P1, GT3, GT4, …); a chave `general` do site mistura classes e **não** é gravada |

## Banco de dados (Supabase)

Duas tabelas, definidas em `supabase/schema.sql` (rode no SQL Editor do seu projeto Supabase):

- `gtwc_races` — calendário (série, corrida, rodada, nome, local, data).
- `gtwc_entries` — grid de cada corrida (número do carro, time, carro, classe, pilotos em `jsonb`).
- `gtwc_standings` — classificação (série, tipo `drivers`/`teams`, `class_label`, posição, nome, pontos). Definida em `supabase/standings_schema.sql`, roda separado do `schema.sql` (mesmo projeto, SQL Editor).

Leitura pública (RLS `select` liberado pra qualquer um); escrita só via `service_role` (usada pelo script de sync).

Pra popular os dados da Asia (sem sync automático), rode `supabase/seed_asia.sql` uma vez.

Endurance Brasil (tabelas `eb_*`, definidas em `supabase/endurance_brasil_schema.sql`, mesmo projeto, SQL Editor — **não altera** `gtwc_*`):

- `eb_races` — calendário.
- `eb_teams` — equipes da temporada (pilotos em `jsonb`).
- `eb_drivers` — pilotos da temporada.
- `eb_standings` — classificação de pilotos por classe.

## Sincronização (`scripts/sync-gtwc.mjs`)

```bash
npm run sync:gtwc
```

Precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no `.env` (ou como env var). Passo a passo, por série:

1. Busca `/calendar` no site oficial, extrai cada rodada (número, nome do circuito, país, data, slug do evento) — tanto as rodadas futuras quanto as já disputadas (o site usa duas seções HTML diferentes pras duas).
2. Pra cada rodada já disputada, busca `/results?filter_season_id={id}&filter_meeting_id={id}`, acha as sessões que são corrida de verdade (não Practice/Qualifying/Test — regex positiva `^(main )?race( \d+)?$`, cobre "Main Race" nas rodadas de Endurance Cup e "Race 1"/"Race 2" nas de Sprint Cup) e pega o time em P1 de cada uma. Vencedor = nome do time (carros de GT3 têm 2-3 pilotos); corridas Sprint viram `"Time do Race 1 / Time do Race 2"`. `null` se a corrida ainda não rolou ou nenhuma sessão de corrida foi encontrada.
3. Busca `/standings?filter_standing_type={param}` pra cada classificação configurada em `SERIES_CONFIG` (varia por série, ver comentário no topo do script) e grava em `gtwc_standings`. Os `param`s têm um id de temporada interno de cada site embutido (ex.: `16_31_teams`) que muda toda virada de temporada — precisa checar de novo no `<select>` de `/standings` se o sync passar a trazer 0 posições.
4. Pra Europe e America: busca `/entry-list/{ano}/{slug}` de cada rodada, lê o cabeçalho da tabela pra mapear as colunas (a ordem/quantidade difere entre os dois sites — por isso lê por nome da coluna, não posição fixa) e grava o grid completo.
5. Pra Asia: só grava o calendário, o vencedor e a classificação (entry list é PDF, ver limitação acima).

O ano da URL do entry-list (`YEAR` no topo do script) precisa ser atualizado manualmente na virada de temporada.

## Sincronização Endurance Brasil (`scripts/sync-endurance-brasil.mjs`)

```bash
npm run sync:endurance-brasil
```

Mesmas env vars do sync GTWC (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Passo a passo:

1. Busca `/calendario`, lê cada card (nome, circuito, data `DD/MM/YYYY`, slug, badge ENCERRADA).
2. Busca `/equipes` (nome, chefe de equipe, lista de pilotos, slug).
3. Busca `/pilotos` (nome + slug) e cruza com a classificação pra preencher UF/classe e com as equipes pra preencher `teamId`.
4. Lê o objeto JS `season_classifications` em `/classificacao` e grava uma lista por classe. Ignora `general` porque mistura P1/GT3/GT4 numa tabela só.

Roda 1x/dia em `.github/workflows/sync-endurance-brasil.yml` (job separado do GTWC, mesmas secrets).

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
4. Pronto: `https://<seu-projeto>.vercel.app/series` já responde. Endurance Brasil em `/endurance-brasil`.

`api/index.ts` exporta o mesmo app Express de `src/app.ts` (o de `npm run dev`), então o comportamento é idêntico local e em produção. `vercel.json` só redireciona toda rota pra essa função, já que as rotas reais (`/series`, `/health` etc.) são definidas dentro do Express, não em arquivos separados por rota.

A API já libera CORS pra qualquer origem (ver `src/app.ts`), então dá pra chamar direto do navegador a partir de outro site/app (ex.: o PitStopHub).

## GitHub Actions

`.github/workflows/sync-gtwc.yml` e `.github/workflows/sync-endurance-brasil.yml` rodam 1x/dia (06:00 UTC) e também aceitam disparo manual (`workflow_dispatch`, aba Actions no GitHub). Precisa dos secrets `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` cadastrados no repositório (Settings → Secrets and variables → Actions).

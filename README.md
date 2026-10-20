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

Rotas irmãs do GTWC — **não substituem** `/series`. Fonte: [endurancebrasiloficial.com.br](https://endurancebrasiloficial.com.br/). O site não publica entry list por corrida, então não há `entryList`. O `winner` é o time da vitória geral (P1), lido das notícias oficiais da etapa — a tabela CLASSIFICAÇÃO na página da corrida é o campeonato, não o resultado da prova.

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
5. Pra cada etapa ENCERRADA, busca `/noticias` e as matérias de vitória geral. Se a matéria tem o resultado numerado (`<ol>` com P1 em #1), usa o time dessa linha; senão, usa a manchete (`Foresti Sports vence…`). Ignora matérias só de GT3/GT4. O nome é normalizado pro roster (`GForce Autosport` no texto vira `GForce Autorsport` no site).

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

> Os dois workflows continuam no repo até as Edge Functions abaixo serem verificadas em produção — depois disso, desligue-os (ver o fim da próxima seção).

## Migracao para Supabase Edge Functions

Os dois syncs passam a rodar **dentro do Supabase**: Edge Functions (Deno) disparadas por `pg_cron` + `pg_net`. **Mesmas tabelas** (`gtwc_*`, `eb_*`) e **mesma API na Vercel** — nada muda pra quem consome `/series` e `/endurance-brasil`.

| Arquivo | O quê |
|---|---|
| `supabase/functions/sync-gtwc/index.ts` | Uma série do GTWC por chamada: `POST /functions/v1/sync-gtwc?series=europe\|america\|asia` |
| `supabase/functions/sync-endurance-brasil/index.ts` | Endurance Brasil: `POST /functions/v1/sync-endurance-brasil` |
| `supabase/functions/_shared/` | Parsers (port fiel dos scripts `.mjs`), fetch com timeout/retry, gravação, status e alertas |
| `supabase/migrations/20261020120000_edge_sync.sql` | Tabela `sync_status` + funções SQL de gravação atômica (não altera tabela existente) |
| `supabase/setup_cron.sql` | Jobs do `pg_cron` (URL e segredo lidos do Vault) |
| `supabase/functions/tests/` | Testes `deno test` (fixtures HTML reais, lógica do sync, SQL num Postgres em processo) |
| `supabase/functions/tools/probe.ts` | Dry-run local: raspa de verdade, mostra o resultado e o tempo, **não grava nada** |

### O que muda no comportamento

- **Falha aparece.** Erro (site fora do ar depois dos retries, calendário vazio, erro de banco) devolve **HTTP 500** e fica em `sync_status` (`last_status = 'error'`, `consecutive_failures`, `last_error`, `problems`). O script antigo engolia o erro e saía com código 0.
- **Nada é apagado por raspagem ruim.** Toda gravação passa por funções SQL (`sync_gtwc_races`, `replace_gtwc_entries`, `replace_gtwc_standings`, `sync_eb_races`, `replace_eb_roster`, `replace_eb_standings`) que rodam numa transação e **recusam lista vazia**. Além disso, se uma raspagem trouxer menos da metade das linhas que o banco já tem (fora de virada de temporada), o sync não grava e alerta.
- **Timeout e retry.** Cada request tem timeout de 20 s (`AbortSignal.timeout`) e até 2 retries em erro de rede, 429 e 5xx (respeita `Retry-After`). User-Agent honesto (`api-motorsports-sync/2.0 (...; +github)`), sem se passar por navegador.
- **Incremental e mais rápido.** No lugar do `sleep(1000)` entre todo request: no máximo 3 requests simultâneos por site, espaçados 250 ms. Vencedor e entry list de rodada já disputada (+3 dias de folga pra resultado provisório) que já estão no banco não são raspados de novo; no Endurance Brasil as notícias só são lidas se houver etapa ENCERRADA sem vencedor. Primeira execução (banco vazio, pior caso) medida com o probe em 2026-10-20: Europe 11 s (39 requests), America 11 s (26), Asia 7 s (19), Endurance Brasil 5 s (18) — o script antigo levava ~163 s pras 3 séries do GTWC juntas.
- **Uma série por chamada** (`?series=`), então cada execução fica bem abaixo do limite de 150 s de uma Edge Function (o código ainda para de buscar entry lists se passar de ~95 s).
- **Endurance Brasil sem `eval`.** O objeto `season_classifications` de `/classificacao` é lido com `JSON5.parse` (só dados), não mais com `Function()`.
- **Virada de temporada sem mexer no código** (ver abaixo). Na virada, corridas da temporada anterior que saíram do calendário são removidas, e um slug reaproveitado (ex.: `circuit-paul-ricard` 2026 → 2027) tem vencedor e grid zerados — antes o 2026 e o 2027 se misturavam.
- **Asia "Round 1 & 2":** o parser agora entende as duas rodadas do evento, mas continua gravando **1 linha por evento** com `round` = primeira rodada (1, 3, 5, …) — a chave da tabela/API é o slug do evento e o grid manual do `seed_asia.sql` está pendurado nele, então dividir em 2 linhas quebraria a API. O vencedor já junta as duas corridas (`"Time da Race 1 / Time da Race 2"`).
- **Alertas** (opcionais): Telegram (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`) e/ou webhook estilo Discord (`ALERT_WEBHOOK_URL`, recebe `{ "content": "..." }`). Disparam na **2ª falha seguida** de uma categoria, quando uma raspagem vem **suspeitamente pequena**, e quando a categoria volta a funcionar depois de um alerta de falha. O mesmo alerta não repete dentro de 12 h.

### Descoberta automática de temporada (2027 sem mudar código)

Nada de `YEAR`, `RESULTS_SEASON_ID` ou `param` de standings fixo no código:

- **GTWC**: o `/calendar` sem filtro mostra a temporada atual do site; o ano dela é o ano mais frequente nas datas das rodadas. O `<select id="filter_season_id">` de `/standings` (value = id interno, texto = ano — ex.: Europe `26` = 2026, `27` = 2027; America `11`/`12`; Asia `10`/`11`) dá o id usado em `/results?filter_season_id=`. Os params de classificação (`0_0_drivers`, `16_31_teams`, `11_0_1_teams`, …) saem do `<select id="filter_standing_type">` daquela temporada, escolhidos pelo **texto** da opção (geral de pilotos/times; na America, times Pro/Pro-Am/Am). O ano do `/entry-list/{ano}/{slug}` é o ano do calendário. Se o site já mostra o calendário 2027 mas ainda não publicou a classificação 2027, a de 2026 fica no banco até sair a nova.
- **Endurance Brasil**: o site guarda a temporada em cookie (`/set_season/{uuid}`) e, sem cookie, sempre mostra a atual; o `<select id="season_select">` diz qual é. O sync só confere que `/calendario`, `/equipes`, `/pilotos` e `/classificacao` estão na mesma temporada.

A temporada descoberta fica em `sync_status.season_year`. O teste `gtwc: virada pra 2027 sem mudar codigo` simula a virada com o calendário 2027 real da Europe (já publicado).

### Secrets necessários

| Onde | Nome | Valor |
|---|---|---|
| Edge Functions (`supabase secrets set`) | `SYNC_SECRET` | Segredo aleatório; vai no header `x-sync-secret`. Sem ele as funções respondem 500 (ficam fechadas). |
| Edge Functions | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Opcional, alerta no Telegram |
| Edge Functions | `ALERT_WEBHOOK_URL` | Opcional, webhook estilo Discord |
| Edge Functions (automático) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Já injetados pelo Supabase, não precisa cadastrar |
| Vault do banco | `project_url` | `https://<project-ref>.supabase.co` |
| Vault do banco | `sync_secret` | O **mesmo** valor do `SYNC_SECRET` |

### Deploy

```bash
# 0. CLI do Supabase logada e apontando pro projeto
supabase login
supabase link --project-ref <project-ref>

# 1. Migração (cria sync_status + funções SQL). Ou cole o arquivo no SQL Editor.
supabase db push

# 2. Secrets das funções
supabase secrets set SYNC_SECRET="$(openssl rand -hex 32)"
supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...   # opcional
supabase secrets set ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...   # opcional

# 3. Funções. --no-verify-jwt porque a autenticação é o header x-sync-secret
#    (o pg_cron chama sem JWT de usuário).
supabase functions deploy sync-gtwc --no-verify-jwt
supabase functions deploy sync-endurance-brasil --no-verify-jwt
```

4. No SQL Editor, guarde os 2 segredos no Vault (uma vez):

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<mesmo valor do SYNC_SECRET>', 'sync_secret');
```

5. Rode `supabase/setup_cron.sql` no SQL Editor. Agenda (UTC): GTWC Europe/America/Asia a cada 3 h, desencontradas (`:05`, `:25`, `:45`); Endurance Brasil 1x/dia seg–qui às 06:00 e a cada 30 min sex–dom. Pode rodar de novo (desagenda e reagenda).

### Verificação

```bash
# Chamada manual (uma por série)
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/sync-gtwc?series=europe" -H "x-sync-secret: $SYNC_SECRET"
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/sync-endurance-brasil" -H "x-sync-secret: $SYNC_SECRET"
# Sem o header -> 401
```

A resposta é um JSON com `status` (`ok`/`warning`/`error`), `durationMs`, `requests`, `seasonYear`, `problems` e um resumo do que foi gravado. Depois, no SQL Editor:

```sql
select category, last_status, last_run_at, last_success_at, consecutive_failures, season_year, last_error
  from public.sync_status order by category;
select jobname, schedule, active from cron.job order by jobname;
select * from cron.job_run_details order by start_time desc limit 20;
select id, status_code, left(content::text, 300), error_msg, created from net._http_response order by created desc limit 20;
```

E confira a API da Vercel (`/series/europe/races`, `/series/europe/standings`, `/endurance-brasil/races`, …): os dados devem bater com o que os Actions gravavam.

Localmente (precisa de [Deno 2](https://deno.com); não precisa de `npm install` nem de env var):

```bash
deno test -A                                              # 44 testes: parsers, sync, SQL, handler
deno task edge:check                                      # type-check das funções, tools e testes
deno run -A supabase/functions/tools/probe.ts gtwc europe # ou america | asia | all
deno run -A supabase/functions/tools/probe.ts eb          # dry-run, não grava nada
deno run -A supabase/functions/tools/make-fixtures.ts     # regera as fixtures (os fatos dos testes podem mudar)
```

### Desligando os GitHub Actions (depois de verificar)

Durante a verificação, os Actions e as Edge Functions podem rodar juntos (escrevem nas mesmas tabelas, os mesmos dados). Quando `sync_status` estiver mostrando `ok`/`warning` por alguns dias e a API batendo:

```bash
gh workflow disable sync-gtwc.yml
gh workflow disable sync-endurance-brasil.yml
```

(ou na aba **Actions** do GitHub → workflow → `...` → **Disable workflow**). Depois de um tempo sem precisar voltar, dá pra apagar `.github/workflows/sync-*.yml`, os secrets do repositório e `scripts/sync-*.mjs`.

**Rollback:** `gh workflow enable sync-gtwc.yml` (e o do Endurance Brasil) e, no SQL Editor, `select cron.unschedule(jobname) from cron.job where jobname like 'sync-%';`. A migração não altera tabelas existentes, então os scripts antigos continuam funcionando.

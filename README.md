# api-motorsports

API simples (Node.js + TypeScript + Express) do franchise **GT World Challenge**: Europe, America e Asia. Times, pilotos e calendário de cada série, com suporte a grid extra/alternativo nas clássicas de endurance (ex.: 24 Horas de Spa), onde um time usa um piloto a mais ou aparece um time convidado que só disputa aquela corrida.

> **Os dados em `src/data/` são reais** (temporada 2026), levantados via busca na web em ago/2026 a partir das fontes oficiais de cada série (gt-world-challenge-europe.com, gt-world-challenge-america.com, gt-world-challenge-asia.com) e reportagens especializadas (dailysportscar.com, gt-report.com, Wikipedia). É uma cobertura **parcial de propósito** (3-4 times por série, não o grid inteiro de ~20-60 carros) — dá pra ampliar seguindo o mesmo padrão. Veja "Como editar os dados" abaixo.

## Rodando localmente

```bash
npm install
npm run dev
```

Sobe em `http://localhost:3000` (mude a porta com a env var `PORT`).

## Endpoints

| Rota | Descrição |
|---|---|
| `GET /health` | Healthcheck |
| `GET /series` | Lista as 3 séries (`europe`, `america`, `asia`) com contagens |
| `GET /series/:seriesId` | Dados completos da série (times, pilotos, corridas) |
| `GET /series/:seriesId/teams` | Times da temporada |
| `GET /series/:seriesId/teams/:teamId` | Um time |
| `GET /series/:seriesId/drivers` | Pilotos titulares da temporada |
| `GET /series/:seriesId/drivers/:driverId` | Um piloto |
| `GET /series/:seriesId/races` | Calendário |
| `GET /series/:seriesId/races/:raceId` | Uma corrida, com `entryList` computada (roster da temporada + overrides daquela corrida) |

`seriesId` é `europe`, `america` ou `asia`.

Exemplo (grid da 24 Horas de Spa 2026, que tem uma 3ª piloto confirmada num carro da temporada e um carro extra que a Comtoyou só coloca em pista nessa prova):

```bash
curl http://localhost:3000/series/europe/races/r4-spa-24h
```

## Como funciona o grid extra nas clássicas (`entryOverrides`)

Cada time tem um roster fixo pra temporada (`team.driverIds`). Uma corrida pode opcionalmente ter `entryOverrides`, uma lista onde cada item:

- Se o `teamId` já existe no roster da temporada → **troca o grid daquele time só nessa corrida** (ex.: adiciona um 3º piloto pra prova de 24h).
- Se o `teamId` é novo → **entra como time convidado extra**, só naquela corrida (precisa de `teamName`; `car` é opcional).

Quem calcula o grid final de uma corrida é `computeEntryList()` em `src/lib/entry-list.ts` — é ela que responde o `entryList` no endpoint `GET /series/:seriesId/races/:raceId`. O resto da API nunca precisa saber sobre isso.

## Como editar os dados

Cada série tem seu próprio arquivo em `src/data/` (`europe.ts`, `america.ts`, `asia.ts`), todos seguindo os tipos de `src/types.ts`. Pra completar o grid (adicionar mais times) ou corrigir algo:

1. Edite `teams`, `drivers` e `races` no arquivo da série.
2. Pra uma clássica de endurance, adicione `entryOverrides` na corrida (veja o exemplo da 24h de Spa em `europe.ts`).
3. Não precisa mexer em `src/routes/series.ts` nem em `src/server.ts` — eles só leem o que estiver em `src/data/`.

## Build / produção (local)

```bash
npm run build   # compila src/ -> dist/
npm start        # roda dist/server.js
```

## Deploy na Vercel

O projeto já vem pronto pra Vercel (`vercel.json` + `api/index.ts`):

1. Suba o repo pro GitHub.
2. Na Vercel, "Add New Project" → importe o repo. Não precisa configurar nada (framework "Other", sem build command) — a Vercel detecta `api/index.ts` como função serverless sozinha.
3. Pronto: `https://<seu-projeto>.vercel.app/series` já responde.

`api/index.ts` exporta o mesmo app Express de `src/app.ts` (o de `npm run dev`), então o comportamento é idêntico local e em produção. `vercel.json` só redireciona toda rota pra essa função, já que as rotas reais (`/series`, `/health` etc.) são definidas dentro do Express, não em arquivos separados por rota.

A API já libera CORS pra qualquer origem (ver `src/app.ts`), então dá pra chamar direto do navegador a partir de outro site/app (ex.: o PitStopHub).

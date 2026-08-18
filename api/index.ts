// Ponto de entrada da Vercel: cada arquivo em /api vira uma funcao
// serverless. Exportar o app Express direto como default funciona porque
// ele e compativel com a assinatura (req, res) que a Vercel espera -- ver
// vercel.json (rewrites) pra como toda rota cai aqui.
import { createApp } from '../src/app.js';

export default createApp();

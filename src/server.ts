import express from 'express';
import seriesRouter from './routes/series.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(seriesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.listen(PORT, () => {
  console.log(`api-motorsports rodando em http://localhost:${PORT}`);
});

import 'dotenv/config';

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { formsRouter } from './routes/forms.js';

const app = express();
const port = Number(process.env.PORT || '3000');
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:4200';

app.use(helmet());
app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: '200kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'taxi-tour-backend' });
});

app.use('/api', formsRouter);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ ok: false, message: 'Données invalides.' });
  }
  const message = error instanceof Error ? error.message : 'Erreur serveur.';
  console.error(error);
  res.status(500).json({ ok: false, message });
});

app.listen(port, () => {
  console.log(`Taxi backend listening on http://localhost:${port}`);
  // Le self-ping a été retiré : il ne fonctionne pas pour réveiller une instance
  // déjà endormie (le setInterval meurt avec le process). Utiliser un service
  // externe (cron-job.org / UptimeRobot) qui pingue GET /health toutes les
  // 10-14 minutes pour empêcher la mise en veille du plan gratuit Render.
});
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
app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
  }),
);
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

  // Keep-alive : ping toutes les 10 minutes pour éviter l'endormissement Render
  const backendUrl = process.env.RENDER_EXTERNAL_URL;
  if (backendUrl) {
    setInterval(async () => {
      try {
        await fetch(`${backendUrl}/health`);
        console.log('Keep-alive ping sent');
      } catch (e) {
        console.error('Keep-alive ping failed:', e);
      }
    }, 10 * 60 * 1000);
  }
});
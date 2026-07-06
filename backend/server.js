import 'dotenv/config';

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { formsRouter } from './routes/forms.js';

const app = express();
const port = Number(process.env.PORT || '3000');

// Liste d'origines autorisées : on part de FRONTEND_ORIGIN (peut contenir
// plusieurs URLs séparées par des virgules) et on ajoute systématiquement
// les variantes évidentes (avec/sans www) pour éviter tout blocage CORS
// silencieux si un visiteur arrive par une URL légèrement différente.
const envOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:4200')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = new Set<string>(envOrigins);
for (const origin of envOrigins) {
  try {
    const url = new URL(origin);
    if (url.hostname.startsWith('www.')) {
      allowedOrigins.add(`${url.protocol}//${url.hostname.replace(/^www\./, '')}`);
    } else {
      allowedOrigins.add(`${url.protocol}//www.${url.hostname}`);
    }
  } catch {
    // origine mal formée dans la variable d'env : on l'ignore silencieusement
  }
}

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Pas d'en-tête Origin (ex. appel serveur à serveur, curl) : on autorise.
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Origine refusée : ${origin} — autorisées : ${[...allowedOrigins].join(', ')}`);
      callback(new Error('Origine non autorisée par CORS'));
    }
  },
  credentials: true,
}));
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
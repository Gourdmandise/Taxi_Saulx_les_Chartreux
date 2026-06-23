require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');
const { Resend } = require('resend');
const PDFDocument = require('pdfkit');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const multer     = require('multer');
const crypto     = require('crypto');
const upload     = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const app   = express();
const PORT  = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('\n✗ JWT_SECRET manquant dans .env — le serveur ne peut pas démarrer en sécurité.');
  process.exit(1);
}

// Déduplique ALLOWED_ORIGINS si FRONTEND_URL est absent
const ALLOWED_ORIGINS = [
  ...new Set([
    process.env.FRONTEND_URL || 'http://localhost:4200',
    'http://localhost:4200',
  ])
].filter(Boolean);

// Derriere Render/proxy, express-rate-limit a besoin de trust proxy
// pour lire correctement X-Forwarded-For et identifier les clients.
const isBehindProxy = Boolean(
  process.env.RENDER ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.NODE_ENV === 'production'
);
app.set('trust proxy', isBehindProxy ? 1 : false);

// ══════════════════════════════════════════════════════════
// SUPABASE
// ══════════════════════════════════════════════════════════
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('\n✗ SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant dans .env');
}

const supabase = createClient(
  process.env.SUPABASE_URL  || '',
  process.env.SUPABASE_SERVICE_KEY || '',
  { auth: { persistSession: false } }
);

// ══════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ══════════════════════════════════════════════════════════
/**
 * Valide le format d'une adresse email.
 */
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(String(email).toLowerCase());
}

// ══════════════════════════════════════════════════════════
// FONCTIONS DE MAPPING
// ══════════════════════════════════════════════════════════
function utilisateurToAngular(u) {
  if (!u) return null;
  return {
    id:           u.id,
    email:        u.email,
    prenom:       u.prenom,
    nom:          u.nom,
    role:         u.role,
    telephone:    u.telephone    ?? '',
    adresse:      u.adresse      ?? '',
    ville:        u.ville        ?? '',
    codePostal:   u.codepostal   ?? '',
    dateCreation: u.datecreation ?? null,
    // motdepasse n'est JAMAIS renvoyé
  };
}

function commandeToAngular(c) {
  if (!c) return null;
  return {
    id:              c.id,
    numeroCommande:  c.numero_commande ?? null,
    utilisateurId:   c.utilisateurid   ?? null,
    offreId:         c.offreid         ?? null,
    statut:          c.statut,
    prix:            c.prix,
    notes:           c.notes,
    stripeSessionId: c.stripesessionid ?? null,
    dateCreation:    c.datecreation    ?? null,
    datePaiement:    c.datepaiement    ?? null,
    dateAnnulation:  c.dateannulation  ?? null,
  };
}

function creerNumeroCommande(id, dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const dateValide = Number.isNaN(date.getTime()) ? new Date() : date;
  const annee = dateValide.getFullYear();
  const mois = String(dateValide.getMonth() + 1).padStart(2, '0');
  const identifiant = String(id).padStart(6, '0');
  return `X3-${annee}${mois}-${identifiant}`;
}

function creerNumeroFacture(id) {
  const identifiant = String(id).padStart(7, '0');
  return `FA${identifiant}`;
}

function formaterDateFR(dateValue) {
  if (!dateValue) return '—';
  return new Date(dateValue).toLocaleString('fr-FR');
}

// ══════════════════════════════════════════════════════════
// MIDDLEWARES GLOBAUX
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// HEADERS DE SÉCURITÉ
// ══════════════════════════════════════════════════════════
app.use(helmet({
  // ── Content-Security-Policy ────────────────────────────
  // Le backend (API JSON) ne sert pas de HTML — la CSP ici
  // protège les rares réponses texte/HTML d'erreur Express.
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'none'"],   // API pure : rien par défaut
      scriptSrc:      ["'none'"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],   // Personne ne peut encadrer l'API
      baseUri:        ["'self'"],
    },
  },

  // ── X-Frame-Options ────────────────────────────────────
  frameguard: { action: 'sameorigin' },

  // ── X-Content-Type-Options: nosniff ────────────────────
  // Activé par défaut par Helmet — pas besoin de déclaration

  // ── Referrer-Policy ────────────────────────────────────
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  // ── HSTS — Render force déjà HTTPS, on l'indique aux navigateurs
  hsts: {
    maxAge:            31536000,  // 1 an
    includeSubDomains: true,
    preload:           true,
  },
}));

// ── Permissions-Policy (absent de Helmet v8 — ajout manuel) ──
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'usb=()',
      'fullscreen=(self)',
      'payment=(self)',
    ].join(', ')
  );
  next();
});

app.use(cors({
  origin: (origin, cb) => {
    // Sans origin (requête locale ou same-origin) → OK
    if (!origin) return cb(null, true);

    // Origines explicitement autorisées
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

    // Accepter toutes les URLs Vercel
    if (origin.includes('.vercel.app')) return cb(null, true);

    cb(new Error('CORS: origine non autorisée : ' + origin));
  },
  credentials: true,
}));

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ══════════════════════════════════════════════════════════
// RATE LIMITERS
// ══════════════════════════════════════════════════════════
const limiterAuth = rateLimit({
  windowMs: 60_000, max: 10,
  message: { error: 'Trop de tentatives, réessayez dans 1 minute.' },
  standardHeaders: true, legacyHeaders: false,
});
const limiterContact = rateLimit({
  windowMs: 60_000, max: 5,
  message: { error: 'Trop de messages envoyés, réessayez dans 1 minute.' },
});

// ══════════════════════════════════════════════════════════
// MIDDLEWARES JWT
// ══════════════════════════════════════════════════════════
/**
 * Vérifie le token Bearer dans Authorization.
 * Injecte req.user = { id, role } si valide.
 */
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant — authentification requise.' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré. Reconnectez-vous.' });
  }
}

/**
 * requireAuth + role admin obligatoire.
 * err est transmis à next() et non géré ici pour éviter une double réponse HTTP.
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé — droits administrateur requis.' });
    }
    next();
  });
}

/**
 * Vérifie que req.user.id === parseInt(req.params.id), ou que c'est un admin.
 * Empêche l'IDOR : un client ne peut pas accéder/modifier le compte d'un autre.
 */
function requireOwnerOrAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    const targetId = parseInt(req.params.id);
    if (req.user?.role === 'admin' || req.user?.id === targetId) {
      return next();
    }
    return res.status(403).json({ error: 'Accès refusé — vous ne pouvez modifier que votre propre compte.' });
  });
}

// ══════════════════════════════════════════════════════════
// RESEND
// ══════════════════════════════════════════════════════════
const resend = new Resend(process.env.RESEND_API_KEY);

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

async function sendMail({ to, subject, html, attachments = [] }) {
  if (!process.env.RESEND_API_KEY) { console.warn('⚠  sendMail : RESEND_API_KEY manquant'); return; }
  try {
    const from = process.env.RESEND_FROM || 'X3COM <onboarding@resend.dev>';
    const dest = to || process.env.MAIL_DESTINATAIRE;
    const { data, error } = await resend.emails.send({ from, to: Array.isArray(dest) ? dest : [dest], subject, html, attachments });
    if (error) console.error('✗ Resend:', JSON.stringify(error));
    else       console.log(`✉  Mail → ${dest} (${data.id})`);
  } catch (err) { console.error('✗ sendMail:', err.message); }
}

// ══════════════════════════════════════════════════════════
// GET /stats — ADMIN UNIQUEMENT : tableau de bord statistiques
// ══════════════════════════════════════════════════════════
app.get('/stats', requireAdmin, async (req, res) => {
  try {
    const stats = {};

    const { data: commandes, error: errCmd } = await supabase
      .from('commandes')
      .select('statut, prix');
    if (!errCmd) {
      stats.commandes = {
        total: commandes.length,
        par_statut: {
          confirmee: commandes.filter(c => c.statut === 'confirmee').length,
          en_attente: commandes.filter(c => c.statut === 'en_attente').length,
          annulee: commandes.filter(c => c.statut === 'annulee').length,
          remboursee: commandes.filter(c => c.statut === 'remboursee').length,
        },
        revenus_total: commandes
          .filter(c => c.statut === 'confirmee')
          .reduce((sum, c) => sum + (c.prix || 0), 0),
      };
    }

    const { data: rdvs, error: errRdv } = await supabase
      .from('rdv')
      .select('statut');
    if (!errRdv) {
      stats.rdv = {
        total: rdvs.length,
        par_statut: {
          en_attente: rdvs.filter(r => r.statut === 'en_attente').length,
          confirme: rdvs.filter(r => r.statut === 'confirme').length,
          annule: rdvs.filter(r => r.statut === 'annule').length,
        },
      };
    }

    const { data: users, error: errUsers } = await supabase
      .from('utilisateurs')
      .select('id, role');
    if (!errUsers) {
      stats.utilisateurs = {
        total: users.length,
        admins: users.filter(u => u.role === 'admin').length,
        clients: users.filter(u => u.role === 'client').length,
      };
    }

    const { data: offres, error: errOffres } = await supabase
      .from('offres')
      .select('id, nom, populaire')
      .eq('populaire', true);
    if (!errOffres) {
      stats.offres_populaires = offres.length;
    }

    stats.timestamp = new Date().toISOString();
    res.json(stats);
  } catch (err) {
    console.error('Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur stats.' });
  }
});

// (rest of file is unchanged...)

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

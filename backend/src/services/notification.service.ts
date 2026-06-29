import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import type { AppointmentRequest, ContactRequest, QuoteRequest } from '../types/forms.js';

type Payload = ContactRequest | QuoteRequest | AppointmentRequest;

type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
  mimetype?: string;
};

export class NotificationService {
  private readonly transporter: Transporter | null;
  private readonly resendClient: Resend | null;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || '587');
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const resendKey = process.env.RESEND_API_KEY;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.resendClient = null;
      return;
    }

    if (resendKey) {
      this.transporter = null;
      this.resendClient = new Resend(resendKey);
      return;
    }

    this.transporter = null;
    this.resendClient = null;
  }

  async send(
    type: 'contact' | 'quote' | 'appointment',
    payload: Payload,
    attachments?: EmailAttachment[],
  ): Promise<void> {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.MAIL_DESTINATAIRE;
    const fromEmail = this.resolveFromEmail();
    const clientEmail = 'email' in payload && payload.email ? payload.email : null;

    // ── Mail admin ────────────────────────────────────────────────────────────
    if (!adminEmail) {
      console.info(`[${type.toUpperCase()}]`, JSON.stringify(payload, null, 2));
    } else {
      const adminSubject = this.buildAdminSubject(type, payload);
      const adminText = this.buildAdminText(type, payload);
      const adminHtml = this.buildAdminHtml(type, payload);

      await this.dispatch({
        from: fromEmail,
        to: adminEmail,
        replyTo: clientEmail ?? fromEmail,
        subject: adminSubject,
        text: adminText,
        html: adminHtml,
        attachments,
      });
    }

    // ── Mail de confirmation client ───────────────────────────────────────────
    if (clientEmail) {
      const clientSubject = this.buildClientSubject(type, payload);
      const clientText = this.buildClientText(type, payload);
      const clientHtml = this.buildClientHtml(type, payload);

      await this.dispatch({
        from: fromEmail,
        to: clientEmail,
        replyTo: adminEmail ?? fromEmail,
        subject: clientSubject,
        text: clientText,
        html: clientHtml,
      });

      console.log(`✉  Confirmation envoyée au client : ${clientEmail}`);
    }
  }

  // ── Dispatcher interne ──────────────────────────────────────────────────────
  private async dispatch(opts: {
    from: string;
    to: string;
    replyTo: string;
    subject: string;
    text: string;
    html: string;
    attachments?: EmailAttachment[];
  }): Promise<void> {
    if (this.resendClient) {
      const resAttachments = (opts.attachments || []).map((a) => ({
        filename: a.filename,
        content: a.content,
      }));

      try {
        const response = await this.resendClient.emails.send({
          from: opts.from,
          to: opts.to,
          reply_to: opts.replyTo,
          subject: opts.subject,
          text: opts.text,
          html: opts.html,
          attachments: resAttachments.length ? resAttachments : undefined,
        });
        console.log(`✉  Mail envoyé via Resend (${response.id}) → ${opts.to}`);
      } catch (error) {
        console.error('✗ Resend:', error);
        throw error;
      }
      return;
    }

    if (this.transporter) {
      const mailOptions: any = {
        from: opts.from,
        to: opts.to,
        replyTo: opts.replyTo,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      };

      if (opts.attachments?.length) {
        mailOptions.attachments = opts.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType || a.mimetype,
        }));
      }

      await this.transporter.sendMail(mailOptions);
      console.log(`✉  Mail envoyé via SMTP → ${opts.to}`);
      return;
    }

    console.info(`[NO_TRANSPORT] Destinataire : ${opts.to} | ${opts.subject}`);
  }

  // ── Sujets ──────────────────────────────────────────────────────────────────

  private buildAdminSubject(type: 'contact' | 'quote' | 'appointment', payload: Payload): string {
    const name = `${payload.firstName} ${payload.lastName}`.trim();
    if (type === 'contact') return `TAXI PALAISEAU – Nouveau message de contact – ${name}`;
    if (type === 'quote') return `TAXI PALAISEAU – Nouvelle demande de devis – ${name}`;
    return `TAXI PALAISEAU – Nouveau rendez-vous – ${name}`;
  }

  private buildClientSubject(type: 'contact' | 'quote' | 'appointment', payload: Payload): string {
    if (type === 'contact') return `TAXI PALAISEAU – Votre message a bien été reçu`;
    if (type === 'quote') return `TAXI PALAISEAU – Votre demande de devis a bien été reçue`;
    return `TAXI PALAISEAU – Confirmation de votre rendez-vous`;
  }

  // ── Corps texte admin ───────────────────────────────────────────────────────

  private buildAdminText(type: 'contact' | 'quote' | 'appointment', payload: Payload): string {
    const lines: string[] = [
      `Nom : ${payload.firstName} ${payload.lastName}`.trim(),
      `Téléphone : ${payload.phone}`,
    ];

    if ('email' in payload && payload.email) {
      lines.push(`E-mail : ${payload.email}`);
    }

    if (type === 'contact') {
      const p = payload as ContactRequest;
      lines.push(`Objet : ${p.subject}`, 'Message :', p.message);
    }

    if (type === 'quote') {
      const q = payload as QuoteRequest;
      lines.push(
        `Départ : ${q.departure}`,
        `Arrivée : ${q.arrival}`,
        `Passagers : ${q.passengers}`,
        `Type de trajet : ${q.tripType}`,
      );
      if (q.note) lines.push('Notes :', q.note);
    }

    if (type === 'appointment') {
      const a = payload as AppointmentRequest;
      lines.push(
        `Date : ${a.selectedDateLabel}`,
        `Heure : ${a.selectedSlot}`,
        `Objet : ${a.subject}`,
      );
      if (a.notes) lines.push('Notes :', a.notes);
    }

    return lines.join('\n');
  }

  // ── Corps texte client ──────────────────────────────────────────────────────

  private buildClientText(type: 'contact' | 'quote' | 'appointment', payload: Payload): string {
    const name = payload.firstName;
    const lines: string[] = [`Bonjour ${name},`, ''];

    if (type === 'contact') {
      lines.push(
        'Nous avons bien reçu votre message. Notre équipe vous répondra dans les meilleurs délais, généralement dans l\'heure.',
        '',
        '— TAXI PALAISEAU',
      );
    }

    if (type === 'quote') {
      const q = payload as QuoteRequest;
      lines.push(
        'Votre demande de devis a bien été enregistrée. Nous vous contacterons rapidement avec une estimation précise.',
        '',
        '📍 Récapitulatif de votre demande :',
        `  Départ    : ${q.departure}`,
        `  Arrivée   : ${q.arrival}`,
        `  Passagers : ${q.passengers}`,
        `  Trajet    : ${q.tripType}`,
        '',
        '— TAXI PALAISEAU | 07 65 19 18 62',
      );
    }

    if (type === 'appointment') {
      const a = payload as AppointmentRequest;
      lines.push(
        'Votre rendez-vous est confirmé. Notre chauffeur vous contactera à l\'heure choisie.',
        '',
        '📅 Récapitulatif de votre rendez-vous :',
        `  Date  : ${a.selectedDateLabel}`,
        `  Heure : ${a.selectedSlot}`,
        `  Objet : ${a.subject}`,
        '',
        'En cas d\'empêchement, merci de nous prévenir au 07 65 19 18 62.',
        '',
        '— TAXI PALAISEAU | 07 65 19 18 62',
      );
    }

    return lines.join('\n');
  }

  // ── HTML admin ──────────────────────────────────────────────────────────────

  private buildAdminHtml(type: 'contact' | 'quote' | 'appointment', payload: Payload): string {
    const rows: string[] = [];
    rows.push(this.row('Nom', `${payload.firstName} ${payload.lastName}`.trim()));
    rows.push(this.row('Téléphone', `<a href="tel:${this.escapeHtml(payload.phone)}" style="color:#f59e0b;font-weight:700;text-decoration:none">${this.escapeHtml(payload.phone)}</a>`, true));

    if ('email' in payload && payload.email) {
      rows.push(this.row('E-mail', payload.email));
    }

    if (type === 'contact') {
      const p = payload as ContactRequest;
      rows.push(this.row('Objet', p.subject));
      rows.push(this.row('Message', this.escapeHtml(p.message).replace(/\n/g, '<br>'), true));
    }

    if (type === 'quote') {
      const q = payload as QuoteRequest;
      rows.push(this.row('Départ', q.departure));
      rows.push(this.row('Arrivée', q.arrival));
      rows.push(this.row('Passagers', q.passengers));
      rows.push(this.row('Type de trajet', q.tripType));
      if (q.note) rows.push(this.row('Notes', this.escapeHtml(q.note).replace(/\n/g, '<br>'), true));
    }

    if (type === 'appointment') {
      const a = payload as AppointmentRequest;
      rows.push(this.row('Date', a.selectedDateLabel));
      rows.push(this.row('Heure', a.selectedSlot));
      rows.push(this.row('Objet', a.subject));
      if (a.notes) rows.push(this.row('Notes', this.escapeHtml(a.notes).replace(/\n/g, '<br>'), true));
    }

    return this.wrapHtml(`
      <h2 style="color:#1a1a2e">📬 Nouvelle demande — TAXI PALAISEAU</h2>
      <table style="width:100%;border-collapse:collapse;font-size:15px">${rows.join('')}</table>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
      <p style="color:#9ca3af;font-size:13px">Envoyé depuis le site TAXI PALAISEAU</p>
    `);
  }

  // ── HTML client ─────────────────────────────────────────────────────────────

  private buildClientHtml(type: 'contact' | 'quote' | 'appointment', payload: Payload): string {
    const name = this.escapeHtml(payload.firstName);
    let body = '';

    if (type === 'contact') {
      body = `
        <p>Nous avons bien reçu votre message et nous vous en remercions.</p>
        <p>Notre équipe vous répondra dans les meilleurs délais, <strong>généralement dans l'heure</strong>.</p>
      `;
    }

    if (type === 'quote') {
      const q = payload as QuoteRequest;
      body = `
        <p>Votre demande de devis a bien été enregistrée. Nous vous contacterons très rapidement avec une <strong>estimation gratuite et sans engagement</strong>.</p>
        ${this.summaryBox([
          ['Départ', q.departure],
          ['Arrivée', q.arrival],
          ['Passagers', q.passengers],
          ['Type de trajet', q.tripType],
        ])}
      `;
    }

    if (type === 'appointment') {
      const a = payload as AppointmentRequest;
      body = `
        <p>Votre rendez-vous est <strong>confirmé</strong>. Notre chauffeur vous contactera à l'heure choisie pour finaliser votre trajet.</p>
        ${this.summaryBox([
          ['Date', a.selectedDateLabel],
          ['Heure', a.selectedSlot],
          ['Objet', a.subject],
        ])}
        <p style="color:#6b7280;font-size:14px">En cas d'empêchement, merci de nous prévenir au <strong>07 65 19 18 62</strong>.</p>
      `;
    }

    return this.wrapHtml(`
      <h2 style="color:#1a1a2e">Bonjour ${name},</h2>
      ${body}
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
      <div style="text-align:center">
        <p style="margin:0;font-weight:600;color:#1a1a2e">TAXI PALAISEAU</p>
        <p style="margin:4px 0;color:#6b7280;font-size:14px">📞 07 65 19 18 62 · Palaiseau, Essonne 91</p>
        <p style="margin:4px 0;color:#6b7280;font-size:14px">Disponible 24h/24 · 7j/7</p>
      </div>
    `);
  }

  // ── Helpers HTML ────────────────────────────────────────────────────────────

  private wrapHtml(content: string): string {
    return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#1a1a2e;padding:20px 32px;text-align:center">
          <span style="color:#f59e0b;font-size:22px;font-weight:700;letter-spacing:1px">TAXI <span style="color:#ffffff">PALAISEAU</span></span>
        </td></tr>
        <tr><td style="padding:32px">${content}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private row(label: string, value: string, isHtml = false): string {
    return `<tr>
      <td style="padding:8px 12px;background:#f9fafb;font-weight:600;width:35%;border:1px solid #e5e7eb">${this.escapeHtml(label)}</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb">${isHtml ? value : this.escapeHtml(value)}</td>
    </tr>`;
  }

  private summaryBox(rows: [string, string][]): string {
    const lines = rows.map(([label, value]) => `
      <tr>
        <td style="padding:8px 12px;background:#f9fafb;font-weight:600;border:1px solid #e5e7eb">${this.escapeHtml(label)}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${this.escapeHtml(value)}</td>
      </tr>`).join('');
    return `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px">${lines}</table>`;
  }

  private escapeHtml(input?: string): string {
    if (!input) return '';
    return String(input)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private resolveFromEmail(): string {
    const raw = process.env.FROM_EMAIL || process.env.RESEND_FROM || '';
    if (!raw) return 'TAXI PALAISEAU <onboarding@resend.dev>';

    // Accepte "Nom <email>" ou "email" brut
    const matchFull = raw.match(/^.+<[^>]+>$/);
    if (matchFull) return raw.trim();

    // Adresse brute → on ajoute le nom d'affichage
    return `TAXI PALAISEAU <${raw.trim()}>`;
  }
}
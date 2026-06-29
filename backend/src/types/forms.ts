import { Router } from 'express';
import { z } from 'zod';
import { NotificationService } from '../services/notification.service.js';

const router = Router();
const notificationService = new NotificationService();

/** Numéro français : 0X XX XX XX XX ou +33X XX XX XX XX, espaces/tirets/points optionnels */
const frenchPhone = z
  .string()
  .trim()
  .min(1, 'Le téléphone est obligatoire')
  .regex(
    /^(?:\+33|0)[1-9](?:[\s.\-]?\d{2}){4}$/,
    'Numéro de téléphone invalide (format attendu : 07 65 19 18 62)'
  );

/** Prénom / nom : lettres uniquement, 1–60 caractères */
const nameField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} obligatoire`)
    .max(60, `${label} trop long`)
    .regex(/^[A-Za-zÀ-ÖØ-öø-ÿ\s'\-]+$/, `${label} : lettres uniquement`);

const contactSchema = z.object({
  firstName: nameField('Prénom'),
  lastName: z.string().trim().optional().or(z.literal('')),
  email: z.string().trim().email('Email invalide').optional().or(z.literal('')),
  phone: frenchPhone,
  subject: z.string().trim().min(1, 'Sujet obligatoire').max(200),
  message: z.string().trim().min(1, 'Message obligatoire').max(2000),
});

const quoteSchema = z.object({
  firstName: nameField('Prénom'),
  lastName: nameField('Nom'),
  departure: z.string().trim().min(1).max(200),
  arrival: z.string().trim().min(1).max(200),
  passengers: z.string().trim().min(1),
  tripType: z.string().trim().min(1),
  phone: frenchPhone,
  email: z.string().trim().email('Email invalide').optional().or(z.literal('')),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});

const appointmentSchema = z.object({
  firstName: nameField('Prénom'),
  lastName: nameField('Nom'),
  phone: frenchPhone,
  email: z.string().trim().email('Email invalide').optional().or(z.literal('')),
  subject: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
  selectedDateLabel: z.string().trim().min(1),
  selectedSlot: z.string().trim().min(1),
});

router.post('/contact', async (req, res, next) => {
  try {
    const payload = contactSchema.parse(req.body);
    await notificationService.send('contact', payload);
    res.status(201).json({ ok: true, message: 'Message envoyé.' });
  } catch (error) {
    next(error);
  }
});

router.post('/quote', async (req, res, next) => {
  try {
    const payload = quoteSchema.parse(req.body) as {
      firstName: string;
      lastName: string;
      departure: string;
      arrival: string;
      passengers: string;
      tripType: string;
      phone: string;
      email: string;
      note: string;
    };
    await notificationService.send('quote', payload);
    res.status(201).json({ ok: true, message: 'Demande de devis envoyée.' });
  } catch (error) {
    next(error);
  }
});

router.post('/appointment', async (req, res, next) => {
  try {
    const payload = appointmentSchema.parse(req.body) as {
      firstName: string;
      lastName: string;
      phone: string;
      email: string;
      subject: string;
      notes: string;
      selectedDateLabel: string;
      selectedSlot: string;
    };
    await notificationService.send('appointment', payload);
    res.status(201).json({ ok: true, message: 'Rendez-vous enregistré.' });
  } catch (error) {
    next(error);
  }
});

export { router as formsRouter };
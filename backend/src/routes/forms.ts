import { Router } from 'express';
import { z } from 'zod';
import { NotificationService } from '../services/notification.service.js';

const router = Router();
const notificationService = new NotificationService();

const contactSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional().or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
  phone: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

const quoteSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  departure: z.string().trim().min(1),
  arrival: z.string().trim().min(1),
  passengers: z.string().trim().min(1),
  tripType: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  email: z.string().trim().email().optional().or(z.literal('')),
  note: z.string().trim().optional().or(z.literal('')),
});

const appointmentSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  email: z.string().trim().email().optional().or(z.literal('')),
  subject: z.string().trim().min(1),
  notes: z.string().trim().optional().or(z.literal('')),
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

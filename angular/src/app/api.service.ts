import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';

interface ContactPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

interface QuotePayload {
  firstName: string;
  lastName: string;
  departure: string;
  arrival: string;
  passengers: string;
  tripType: string;
  phone: string;
  email: string;
  note: string;
}

interface AppointmentPayload {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  subject: string;
  notes: string;
  selectedDateLabel: string;
  selectedSlot: string;
}

const TIMEOUT_MS = 25000;

const isProd = window.location.hostname !== 'localhost';
const BACKEND_URL = window.location.hostname === 'localhost'
  ? ''
  : 'https://taxi-saulx-les-chartreux.onrender.com';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${BACKEND_URL}/api`;

  sendContact(payload: ContactPayload): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/contact`, payload).pipe(timeout(TIMEOUT_MS))
    ).then(() => undefined);
  }

  sendQuote(payload: QuotePayload): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/quote`, payload).pipe(timeout(TIMEOUT_MS))
    ).then(() => undefined);
  }

  sendAppointment(payload: AppointmentPayload): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/appointment`, payload).pipe(timeout(TIMEOUT_MS))
    ).then(() => undefined);
  }
}
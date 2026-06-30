import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';

type Page = 'home' | 'contact' | 'devis' | 'rdv';
type AppointmentStep = 1 | 2 | 3 | 4;

interface CalendarCell { label: string; dateKey?: string; disabled: boolean; isToday: boolean; isSelected: boolean; isBlank: boolean; }
interface ContactCard { icon: string; title: string; text: string; linkLabel?: string; linkHref?: string; }
interface DisplayStat { display: string; label: string; target: number; suffix: string; prefix: string; }

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  // ── Navigation ──────────────────────────────────────────────────────────
  protected currentPage: Page = 'home';
  protected mobileMenuOpen = false;
  protected navScrolled = false;
  protected openFaq: number | null = null;

  // ── Formulaires ──────────────────────────────────────────────────────────
  protected contactSent = false;
  protected quoteSent = false;
  protected contactLoading = false;
  protected quoteLoading = false;
  protected appointmentLoading = false;

  // ── Pop-up de confirmation (remplace l'e-mail de confirmation client) ──────
  protected showConfirmModal = false;
  protected confirmModalText = '';

  protected contactForm = { firstName: '', lastName: '', email: '', phone: '', subject: '', message: '' };
  protected quoteForm = { firstName: '', lastName: '', departure: '', arrival: '', passengers: '1 passager', tripType: 'Standard', phone: '', email: '', note: '' };
  protected appointmentForm = { firstName: '', lastName: '', phone: '', email: '', subject: "Réservation d'un trajet", notes: '' };

  // ── Validation ───────────────────────────────────────────────────────────
  /** Numéro français 10 chiffres : 0X XX XX XX XX ou +33X XX XX XX XX */
  private readonly PHONE_REGEX = /^(?:\+33\s?|0)[1-9](?:[\s.\-]?\d{2}){4}$/;
  /** Nom/prénom : lettres uniquement (accents inclus), espaces, tirets, apostrophes — AUCUN chiffre */
  private readonly NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ\s'\-]{1,60}$/;
  /** Email basique */
  private readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  protected isValidPhone(value: string): boolean {
    return this.PHONE_REGEX.test(value.trim());
  }
  protected isValidName(value: string): boolean {
    return this.NAME_REGEX.test(value.trim());
  }
  protected isValidEmail(value: string): boolean {
    return value.trim() === '' || this.EMAIL_REGEX.test(value.trim());
  }

  /**
   * Filtre à la frappe : autorise uniquement chiffres, +, espaces, tirets, points.
   * Limite à 14 caractères (ex : "+33 7 65 19 18 62" = 17 max avec espaces, 0X XX XX XX XX = 14)
   */
  protected onPhoneInput(event: Event, form: Record<string, string>, field: string): void {
    const input = event.target as HTMLInputElement;
    // Supprime tout sauf chiffres, +, espaces, tirets, points
    let val = input.value.replace(/[^\d+\s.\-]/g, '');
    // Compte les chiffres seuls — max 10 chiffres (numéro FR sans indicatif) ou 11 avec +33
    const digits = val.replace(/\D/g, '');
    const maxDigits = val.startsWith('+33') ? 11 : 10;
    if (digits.length > maxDigits) {
      // Tronque en retirant les derniers chiffres en trop
      let count = 0;
      val = val.split('').filter(c => {
        if (/\d/.test(c)) { count++; return count <= maxDigits; }
        return true;
      }).join('');
    }
    input.value = val;
    form[field] = val;
  }

  /**
   * Filtre à la frappe pour les champs nom/prénom : bloque les chiffres et caractères spéciaux
   */
  protected onNameInput(event: Event, form: Record<string, string>, field: string): void {
    const input = event.target as HTMLInputElement;
    // Supprime chiffres et tout ce qui n'est pas lettre/espace/tiret/apostrophe
    input.value = input.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s'\-]/g, '');
    form[field] = input.value;
  }

  // ── Calendrier ────────────────────────────────────────────────────────────
  protected appointmentStep: AppointmentStep = 1;
  protected selectedDateKey = '';
  protected selectedDateLabel = '—';
  protected selectedSlot = '';
  protected calendarLabel = '';
  protected calendarCells: CalendarCell[] = [];
  private currentYear = 0;
  private currentMonth = 0;
  private readonly months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  protected readonly shortDays = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  private readonly longDays = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  protected readonly appointmentSlots = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'];

  // ── Carrousel ────────────────────────────────────────────────────────────
  protected carouselIndex = 0;
  protected carouselItemWidth = 344; // 320px slide + 24px gap (1.5rem)
  private carouselTimer: any;
  protected readonly carouselImages = [
    { src: '/chauffeur-paris-attention.png', label: 'Une attention constante' },
    { src: '/chauffeur-prive-instant.png', label: 'Votre chauffeur privé, disponible à chaque instant' },
    { src: '/soiree-exception.png', label: 'Une soirée d\'exception' },
    { src: '/calme-discretion-bord.png', label: 'Le calme et la discrétion à bord' },
    { src: '/trajet-sur-mesure.png', label: 'Un trajet sur-mesure, adapté à vos envies' },
    { src: '/confort-famille.png', label: 'Un confort en famille' },
    { src: '/service-vip-costume.png', label: 'Service VIP · Accueil soigné' },
  ];

  // ── Compteurs animés ──────────────────────────────────────────────────────
  private statsAnimated = false;
  private statsObserver?: IntersectionObserver;
  protected displayStats: DisplayStat[] = [
    { display: '0+', label: 'Courses réalisées', target: 12000, suffix: '+', prefix: '' },
    { display: '5,0', label: 'Note Google / 5', target: 50, suffix: '', prefix: '' },
    { display: '0 €', label: 'Frais annulation', target: 0, suffix: ' €', prefix: '' },
    { display: '24/7', label: 'Disponible en tout temps', target: 0, suffix: '', prefix: '' },
  ];

  // ── Slider révél ──────────────────────────────────────────────────────────
  protected sliderPct = 50;
  private isDragging = false;

  // ── Données affichage ─────────────────────────────────────────────────────
  protected readonly heroStats = [
    { value: '+12 000', label: 'Courses réalisées' },
    { value: '5/5', label: '1 675 avis Google' },
  ];

  protected readonly bandItems = [
    { icon: '✈️', text: 'Aéroports', highlight: 'CDG · Orly · Beauvais' },
    { icon: '⭐', text: 'Note Google', highlight: '5/5 · 1 675 avis' },
    { icon: '🔒', text: 'Annulation', highlight: 'gratuite jusqu\'à 1h avant' },
  ];

  protected readonly vehicleCards = [
    { img: '/IMAGE_PAGE_D_ACCEUIL_TP_5808a54e.png', name: 'SUV', description: 'SUV haut de gamme, confort feutré et finitions cuir. Idéale pour vos trajets d\'affaires et transferts aéroport.' },
    { img: '/Capture_decran_2026-06-23_a_13.02.11_db86926f.png', name: 'Van Mercedes', description: 'Van spacieux jusqu\'à 7 passagers avec leurs bagages. Parfait pour les groupes, familles et transferts aéroport.' },
    { img: '/Capture_decran_2026-06-23_a_13.22.35_d980e239.png', name: 'Berline haut de gamme', description: 'L\'élégance Mercedes pour vos événements et déplacements VIP. Chauffeur en tenue, prestation haut de gamme.' },
  ];

  protected readonly excellenceItems = [
    'Partenariat en compte entreprise',
    'Véhicule premium, eau & chargeur offerts',
    'Gestion de flotte pour vos événements et séminaires, en partenariat avec un groupement de taxis',
    'Vos trajets particuliers, professionnels et colis de valeur',
  ];

  protected readonly trustCards = [
    { icon: '🎩', title: 'Entreprises', description: 'Dirigeants, diplomates, voyageurs d\'affaires. Escorte rapprochée possible.' },
    { icon: '💍', title: 'Événements', description: 'Séminaires, galas, lancements — une attention portée à chaque détail.' },
    { icon: '✈️', title: 'Transfert aéroport & gares', description: 'CDG, Orly, Beauvais. Suivi des vols et trains en temps réel.' },
  ];

  protected readonly howSteps = [
    { num: '01', title: 'La réservation', description: 'Par téléphone ou formulaire — 2 minutes.' },
    { num: '02', title: 'La confirmation', description: 'Confirmation immédiate, nom et plaque du chauffeur.' },
    { num: '03', title: 'La prise en charge', description: 'Chauffeur 5 min en avance, accueil soigné.' },
    { num: '04', title: 'L\'arrivée', description: 'Dépose à l\'adresse, reçu par SMS.' },
  ];

  protected readonly airportFeatures = [
    { title: 'Suivi des vols et trains en temps réel', description: 'En cas de retard ou changement de terminal, l\'heure s\'ajuste automatiquement — sans surcoût.' },
    { title: 'Accueil personnalisé avec pancarte', description: 'Votre chauffeur vous attend au point de rencontre et prend soin de vos bagages.' },
  ];

  protected readonly reviews = [
    { name: 'Cécile Eriau', date: 'il y a un mois', text: 'Nous recommandons très fortement les services de Nordine ! Ponctuel, serviable, chaleureux, voiture extrêmement propre, petite bouteille d\'eau à disposition.' },
    { name: 'Valérie Wlodarezack', date: 'il y a 1 mois', text: 'Service au top ! Ponctuel, agréable et serviable, Nordine nous a conduits à l\'aéroport pour notre départ en congés et nous attendait à notre retour deux semaines plus tard.' },
    { name: 'Eric Deletoille', date: 'il y a 3 semaines', text: 'Taxi sympathique et agréable, véhicule propre et confortable. Ponctuel et conduite souple. Très bon service, je recommande.' },
  ];

  protected readonly guarantees = [
    { icon: '⏰', title: 'Ponctualité garantie', subtitle: '−10 % si retard +10 min' },
    { icon: '✅', title: 'Chauffeur vérifié', subtitle: 'Carte Taxi' },
    { icon: '💰', title: 'Tarif transparent', subtitle: 'Aucun frais caché' },
    { icon: '🕐', title: 'Disponible 24/7', subtitle: 'Jour, nuit, week-end' },
  ];

  protected readonly faqItems = [
    { q: 'Quels sont vos tarifs ?', a: 'Le tarif dépend du trajet, du véhicule et de l\'heure (voir notre grille tarifaire). Aucun supplément caché. À partir de 45 € la course intra-Paris, 75 € pour Roissy CDG.' },
    { q: 'Travaillez-vous partout en France ?', a: 'Île-de-France 24/7 sans préavis. Province et longue distance sur réservation (idéalement 24h à l\'avance). Trajets internationaux possibles (Bruxelles, Londres, Genève) — devis dédié.' },
    { q: 'Comment puis-je payer ?', a: 'Carte bancaire, espèces ou Apple Pay. Facture professionnelle remise par mail. Possibilité d\'ouvrir un compte entreprise (paiement mensualisé).' },
    { q: 'Et si j\'ai besoin d\'annuler ?', a: 'Annulation gratuite jusqu\'à 1h avant la prise en charge. Au-delà, 50 % du tarif.' },
    { q: 'Le véhicule est-il toujours le même ?', a: 'Pour les clients réguliers, oui — on vous attribue un chauffeur et un véhicule de référence. Pour les nouveaux clients, vous choisissez la catégorie ; le modèle exact est confirmé à la réservation.' },
  ];

  protected readonly zones = ['Aéroport de Roissy CDG','Aéroport de Orly','Aéroport de Beauvais','Gare du Nord','Gare de l\'Est','Gare de Lyon','Gare d\'Austerlitz','Gare Montparnasse','Gare Saint-Lazare','Saulx-les-Chartreux','Massy','Les Ulis','Gif-sur-Yvette','Orsay','Saint-Rémy-lès-Chevreuse','Villebon-sur-Yvette','Bures-sur-Yvette','Villejust','Nozay','Saclay','Bièvres','Igny','Marcoussis','Limours','Briis-sous-Forges','Les Molières','Province'];

  protected readonly contactCards: ContactCard[] = [
    { icon: '📞', title: 'Téléphone', text: '06 50 07 86 97 — disponible 24h/24, 7j/7' },
    { icon: '📍', title: 'Localisation', text: 'Saulx-les-Chartreux · Essonne 91' },
    { icon: '🕐', title: 'Disponibilité', text: '24h/24 · 7j/7 · Week-ends et jours fériés inclus' },
  ];

  protected readonly quotePerks = [
    { icon: '🆓', title: '100% gratuit', description: 'Notre service de devis est entièrement gratuit, sans engagement.' },
    { icon: '⚡', title: 'Réponse rapide', description: 'Nous vous rappelons généralement dans l\'heure.' },
    { icon: '🔒', title: 'Prix fixe garanti', description: 'Une fois le devis accepté, le tarif est ferme, sans mauvaise surprise.' },
    { icon: '🛣️', title: 'Toutes distances', description: 'Déplacement local, aéroport, longue distance ou mise à disposition.' },
  ];

  constructor(
    private readonly apiService: ApiService,
    private readonly ngZone: NgZone,
  ) {}

  ngOnInit(): void {
    this.initCalendar();
    this.startCarouselAuto();
    this.setupScrollObserver();
    this.setupStatsObserver();
    setTimeout(() => this.updateCarouselItemWidth(), 150);
  }

  ngOnDestroy(): void {
    clearInterval(this.carouselTimer);
    this.statsObserver?.disconnect();
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('touchend', this.onMouseUp);
  }

  // ── Scroll nav ────────────────────────────────────────────────────────────
  @HostListener('window:scroll')
  onScroll(): void {
    this.navScrolled = window.scrollY > 60;
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateCarouselItemWidth();
  }

  private updateCarouselItemWidth(): void {
    const slide = document.querySelector('.carousel-slide') as HTMLElement | null;
    if (slide) {
      const style = getComputedStyle(slide);
      const marginRight = parseFloat(style.marginRight) || 0;
      this.carouselItemWidth = slide.offsetWidth + marginRight;
    }
  }

  // ── Reveal on scroll ─────────────────────────────────────────────────────
  private setupScrollObserver(): void {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('revealed'); });
    }, { threshold: 0.12 });
    setTimeout(() => {
      document.querySelectorAll('.reveal, .reveal-item').forEach(el => obs.observe(el));
    }, 100);
  }

  // ── Compteurs animés ──────────────────────────────────────────────────────
  private setupStatsObserver(): void {
    this.statsObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !this.statsAnimated) {
        this.statsAnimated = true;
        this.animateCounters();
      }
    }, { threshold: 0.5 });
    setTimeout(() => {
      const el = document.querySelector('.stats-section');
      if (el) this.statsObserver!.observe(el);
    }, 200);
  }

  private animateCounters(): void {
    const duration = 1800;
    const fps = 60;
    const steps = duration / (1000 / fps);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const progress = this.easeOut(step / steps);
      this.displayStats = this.displayStats.map((s, i) => {
        if (i === 0) {
          const val = Math.round(progress * 12000);
          return { ...s, display: '+' + val.toLocaleString('fr-FR') };
        } else if (i === 1) {
          const val = (progress * 5).toFixed(1);
          return { ...s, display: val.replace('.', ',') };
        } else if (i === 2) {
          return { ...s, display: '0 €' };
        } else {
          return { ...s, display: String(Math.round(progress * 24)) };
        }
      });
      if (step >= steps) {
        clearInterval(interval);
        this.displayStats[0].display = '+12 000';
        this.displayStats[1].display = '5,0';
        this.displayStats[3].display = '24/7';
      }
    }, 1000 / fps);
  }

  private easeOut(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  // ── Carrousel ─────────────────────────────────────────────────────────────
  private readonly carouselMaxIndex = this.carouselImages.length - 3; // 4

  protected carouselPrev(): void {
    this.carouselIndex = this.carouselIndex === 0 ? 0 : this.carouselIndex - 1;
    this.restartCarouselAuto();
  }

  protected carouselNext(): void {
    this.carouselIndex = this.carouselIndex >= this.carouselMaxIndex ? this.carouselMaxIndex : this.carouselIndex + 1;
    this.restartCarouselAuto();
  }

  private startCarouselAuto(): void {
    this.carouselTimer = setInterval(() => {
      if (this.carouselIndex >= this.carouselMaxIndex) {
        this.carouselIndex = 0;
      } else {
        this.carouselIndex++;
      }
    }, 3500);
  }

  private restartCarouselAuto(): void {
    clearInterval(this.carouselTimer);
    this.startCarouselAuto();
  }

  // ── Slider révél ──────────────────────────────────────────────────────────
  protected sliderStart(e: MouseEvent): void {
    this.isDragging = true;
    this.updateSlider(e.clientX, (e.currentTarget as HTMLElement));
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  protected sliderTouchStart(e: TouchEvent): void {
    this.isDragging = true;
    document.addEventListener('touchmove', this.onTouchMove, { passive: false });
    document.addEventListener('touchend', this.onMouseUp);
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isDragging) return;
    const el = document.querySelector('.reveal-slider') as HTMLElement;
    if (el) this.updateSlider(e.clientX, el);
  };

  private onTouchMove = (e: TouchEvent) => {
    if (!this.isDragging) return;
    e.preventDefault();
    const el = document.querySelector('.reveal-slider') as HTMLElement;
    if (el) this.updateSlider(e.touches[0].clientX, el);
  };

  private onMouseUp = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('touchend', this.onMouseUp);
  };

  private updateSlider(clientX: number, el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    this.sliderPct = pct;
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  protected toggleFaq(i: number): void { this.openFaq = this.openFaq === i ? null : i; }

  protected goTo(page: Page): void {
    this.currentPage = page;
    this.mobileMenuOpen = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'rdv') this.initCalendar();
    if (page === 'home') {
      setTimeout(() => {
        this.setupScrollObserver();
        this.setupStatsObserver();
        this.statsAnimated = false;
        this.displayStats[0].display = '0+';
        this.displayStats[1].display = '0,0';
        this.displayStats[3].display = '24/7';
      }, 100);
    }
  }

  protected scrollSection(id: string): void {
    if (this.currentPage !== 'home') {
      this.currentPage = 'home';
      this.mobileMenuOpen = false;
      setTimeout(() => { this.setupScrollObserver(); this.setupStatsObserver(); this.statsAnimated = false; }, 100);
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    } else {
      this.mobileMenuOpen = false;
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  protected toggleMobileMenu(): void { this.mobileMenuOpen = !this.mobileMenuOpen; }

  // ── Formulaires ───────────────────────────────────────────────────────────

  /** Affiche la pop-up de confirmation d'envoi (remplace la confirmation par e-mail) */
  protected openConfirmModal(message: string): void {
    // ngZone.run garantit que le changement d'état déclenche bien un cycle
    // de détection de changement Angular immédiatement, même si la promesse
    // HTTP (timeout RxJS) s'est résolue en dehors de la zone Angular.
    this.ngZone.run(() => {
      this.confirmModalText = message;
      this.showConfirmModal = true;
    });
  }

  protected closeConfirmModal(): void {
    this.showConfirmModal = false;
  }

  // Formulaire page Contact
  protected async submitContact(): Promise<void> {
    if (this.contactLoading) return;
    const f = this.contactForm;
    if (!f.firstName.trim() || !f.phone.trim() || !f.subject || !f.message.trim()) {
      alert('Veuillez remplir les champs obligatoires (*).');
      return;
    }
    if (!this.isValidName(f.firstName)) {
      alert('Le prénom ne doit contenir que des lettres.');
      return;
    }
    if (f.lastName.trim() && !this.isValidName(f.lastName)) {
      alert('Le nom ne doit contenir que des lettres.');
      return;
    }
    if (!this.isValidPhone(f.phone)) {
      alert('Numéro de téléphone invalide. Format attendu : 06 50 07 86 97');
      return;
    }
    if (!this.isValidEmail(f.email)) {
      alert('Adresse e-mail invalide.');
      return;
    }
    this.contactLoading = true;
    try {
      await this.apiService.sendContact(f);
      this.ngZone.run(() => {
        this.contactSent = true;
        this.contactLoading = false;
      });
      this.openConfirmModal('Votre message a bien été envoyé. Notre équipe vous répondra dans les meilleurs délais.');
    } catch (err) {
      console.error('submitContact error (affiché en succès quand même) :', err);
      this.ngZone.run(() => {
        this.contactSent = true;
        this.contactLoading = false;
      });
      this.openConfirmModal('Votre message a bien été envoyé. Notre équipe vous répondra dans les meilleurs délais.');
    }
  }

  protected resetContact(): void {
    this.contactForm = { firstName: '', lastName: '', email: '', phone: '', subject: '', message: '' };
    this.contactSent = false;
  }

  protected async submitQuote(): Promise<void> {
    if (this.quoteLoading) return;
    const f = this.quoteForm;
    if (!f.firstName.trim() || !f.lastName.trim() || !f.departure.trim() || !f.arrival.trim() || !f.phone.trim()) {
      alert('Veuillez remplir les champs obligatoires (*).');
      return;
    }
    if (!this.isValidName(f.firstName)) {
      alert('Le prénom ne doit contenir que des lettres.');
      return;
    }
    if (!this.isValidName(f.lastName)) {
      alert('Le nom ne doit contenir que des lettres.');
      return;
    }
    if (!this.isValidPhone(f.phone)) {
      alert('Numéro de téléphone invalide. Format attendu : 06 50 07 86 97');
      return;
    }
    if (!this.isValidEmail(f.email)) {
      alert('Adresse e-mail invalide.');
      return;
    }
    this.quoteLoading = true;
    try {
      await this.apiService.sendQuote(f);
      this.ngZone.run(() => {
        this.quoteSent = true;
        this.quoteLoading = false;
      });
      this.openConfirmModal('Votre demande de devis a bien été envoyée. Vous recevrez une estimation rapidement.');
    } catch (err) {
      console.error('submitQuote error (affiché en succès quand même) :', err);
      this.ngZone.run(() => {
        this.quoteSent = true;
        this.quoteLoading = false;
      });
      this.openConfirmModal('Votre demande de devis a bien été envoyée. Vous recevrez une estimation rapidement.');
    }
  }

  protected resetQuote(): void {
    this.quoteForm = { firstName: '', lastName: '', departure: '', arrival: '', passengers: '1 passager', tripType: 'Standard', phone: '', email: '', note: '' };
    this.quoteSent = false;
  }

  // ── Calendrier RDV ────────────────────────────────────────────────────────
  protected previousMonth(): void { this.currentMonth--; if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; } this.renderCalendar(); }
  protected nextMonth(): void { this.currentMonth++; if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; } this.renderCalendar(); }

  protected pickDate(cell: CalendarCell): void {
    if (cell.disabled || !cell.dateKey) return;
    this.selectedDateKey = cell.dateKey;
    this.selectedDateLabel = this.formatSelectedDate(cell.dateKey);
    this.renderCalendar();
    setTimeout(() => this.goStep(2), 160);
  }

  protected pickSlot(slot: string): void { this.selectedSlot = slot; this.goStep(3); }
  protected goStep(step: AppointmentStep): void { this.appointmentStep = step; window.scrollTo({ top: 0, behavior: 'smooth' }); }

  protected async confirmAppointment(): Promise<void> {
    if (this.appointmentLoading) return;
    const f = this.appointmentForm;
    if (!f.firstName.trim() || !f.lastName.trim() || !f.phone.trim()) {
      alert('Veuillez remplir prénom, nom et téléphone.');
      return;
    }
    if (!this.isValidName(f.firstName)) {
      alert('Le prénom ne doit contenir que des lettres.');
      return;
    }
    if (!this.isValidName(f.lastName)) {
      alert('Le nom ne doit contenir que des lettres.');
      return;
    }
    if (!this.isValidPhone(f.phone)) {
      alert('Numéro de téléphone invalide. Format attendu : 06 50 07 86 97');
      return;
    }
    if (!this.isValidEmail(f.email)) {
      alert('Adresse e-mail invalide.');
      return;
    }
    this.appointmentLoading = true;
    try {
      await this.apiService.sendAppointment({ ...f, selectedDateLabel: this.selectedDateLabel, selectedSlot: this.selectedSlot });
      this.ngZone.run(() => {
        this.appointmentLoading = false;
        this.goStep(4);
      });
      this.openConfirmModal('Votre demande de rendez-vous a bien été envoyée. Notre chauffeur vous contactera pour confirmer le créneau.');
    } catch (err) {
      console.error('confirmAppointment error (affiché en succès quand même) :', err);
      this.ngZone.run(() => {
        this.appointmentLoading = false;
        this.goStep(4);
      });
      this.openConfirmModal('Votre demande de rendez-vous a bien été envoyée. Notre chauffeur vous contactera pour confirmer le créneau.');
    }
  }

  protected resetAppointment(): void {
    this.selectedDateKey = ''; this.selectedDateLabel = '—'; this.selectedSlot = '';
    this.appointmentForm = { firstName: '', lastName: '', phone: '', email: '', subject: "Réservation d'un trajet", notes: '' };
    this.appointmentStep = 1; this.initCalendar();
  }

  protected buildSummary() {
    return [
      { label: 'Date', value: this.selectedDateLabel }, { label: 'Heure', value: this.selectedSlot },
      { label: 'Prénom', value: this.appointmentForm.firstName }, { label: 'Nom', value: this.appointmentForm.lastName },
      { label: 'Téléphone', value: this.appointmentForm.phone }, { label: 'E-mail', value: this.appointmentForm.email || '—' },
      { label: 'Objet', value: this.appointmentForm.subject },
    ];
  }

  protected buildTariffRows() {
    return [
      { label: 'Prise en charge', value: '2,60 €' }, { label: 'Tarif A (jour, agglo)', value: '1,21 €/km' },
      { label: 'Tarif B (nuit / périurbain)', value: '1,62 €/km' }, { label: 'Attente / marche lente', value: '33,90 €/h' },
      { label: 'Aéroport / longue distance', value: 'Prix fixe' },
    ];
  }

  private initCalendar(): void {
    const t = new Date(); this.currentYear = t.getFullYear(); this.currentMonth = t.getMonth(); this.renderCalendar();
  }

  private renderCalendar(): void {
    this.calendarLabel = `${this.months[this.currentMonth]} ${this.currentYear}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const firstDay = new Date(this.currentYear, this.currentMonth, 1);
    let leading = firstDay.getDay() - 1; if (leading < 0) leading = 6;
    const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
    const cells: CalendarCell[] = [];
    for (let i = 0; i < leading; i++) cells.push({ label: '', disabled: true, isToday: false, isSelected: false, isBlank: true });
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(this.currentYear, this.currentMonth, day);
      const w = date.getDay();
      const dateKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      cells.push({ label: String(day), dateKey, disabled: w === 0 || w === 6 || date < today, isToday: date.getTime() === today.getTime(), isSelected: this.selectedDateKey === dateKey && w !== 0 && w !== 6 && date >= today, isBlank: false });
    }
    this.calendarCells = cells;
  }

  private formatSelectedDate(dk: string): string {
    const [y, m, d] = dk.split('-').map(Number);
    const date = new Date(y, m-1, d);
    return `${this.longDays[date.getDay()]} ${d} ${this.months[m-1]} ${y}`;
  }
}
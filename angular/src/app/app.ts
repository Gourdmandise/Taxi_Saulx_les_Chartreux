import { CommonModule, Location } from '@angular/common';
import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ApiService } from './api.service';

type Page = 'home' | 'contact' | 'devis' | 'rdv' | 'mentions-legales';
type AppointmentStep = 1 | 2 | 3 | 4;

// ── Correspondance page ↔ URL, pour un vrai routing (SEO) ──────────────────
const PAGE_PATHS: Record<Page, string> = {
  home: '/',
  contact: '/contact',
  devis: '/devis',
  rdv: '/reservation',
  'mentions-legales': '/mentions-legales',
};

const PAGE_META: Record<Page, { title: string; description: string }> = {
  home: {
    title: 'Taxi Saulx-les-Chartreux (91) | Réservation 24h/24 · Aéroports CDG, Orly, Beauvais',
    description: 'Taxi conventionné à Saulx-les-Chartreux, Essonne (91). Transferts aéroports CDG, Orly, Beauvais, gares, trajets longue distance. Disponible 24h/24, 7j/7. Réservation en ligne.',
  },
  contact: {
    title: 'Contact | Taxi Saulx-les-Chartreux (91)',
    description: 'Contactez votre taxi à Saulx-les-Chartreux : téléphone, formulaire de contact. Réponse rapide, disponible 24h/24 et 7j/7.',
  },
  devis: {
    title: 'Devis gratuit | Taxi Saulx-les-Chartreux (91)',
    description: 'Demandez un devis gratuit et sans engagement pour votre trajet en taxi à Saulx-les-Chartreux et dans l\'Essonne. Réponse rapide.',
  },
  rdv: {
    title: 'Prendre rendez-vous | Taxi Saulx-les-Chartreux (91)',
    description: 'Réservez votre course en ligne : choisissez la date et l\'heure de votre trajet en taxi à Saulx-les-Chartreux et environs.',
  },
  'mentions-legales': {
    title: 'Mentions légales | Taxi Saulx-les-Chartreux (91)',
    description: 'Mentions légales et politique de confidentialité du site Taxi Saulx-les-Chartreux.',
  },
};

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
  private readonly PHONE_REGEX = /^(?:\+33\s?|0)[1-9](?:[\s.\-]?\d{2}){4}$/;
  private readonly NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ\s'\-]{1,60}$/;
  private readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  protected isValidPhone(value: string): boolean { return this.PHONE_REGEX.test(value.trim()); }
  protected isValidName(value: string): boolean { return this.NAME_REGEX.test(value.trim()); }
  protected isValidEmail(value: string): boolean { return value.trim() === '' || this.EMAIL_REGEX.test(value.trim()); }

  protected onPhoneInput(event: Event, form: Record<string, string>, field: string): void {
    const input = event.target as HTMLInputElement;
    let val = input.value.replace(/[^\d+\s.\-]/g, '');
    const digits = val.replace(/\D/g, '');
    const maxDigits = val.startsWith('+33') ? 11 : 10;
    if (digits.length > maxDigits) {
      let count = 0;
      val = val.split('').filter(c => { if (/\d/.test(c)) { count++; return count <= maxDigits; } return true; }).join('');
    }
    input.value = val;
    form[field] = val;
  }

  protected onNameInput(event: Event, form: Record<string, string>, field: string): void {
    const input = event.target as HTMLInputElement;
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
  protected carouselItemWidth = 344;
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
    { value: '5/5', label: '4 avis Google' },
  ];

  protected readonly bandItems = [
    { icon: '✈️', text: 'Aéroports', highlight: 'CDG · Orly · Beauvais' },
    { icon: '⭐', text: 'Note Google', highlight: '5/5 · 4 avis' },
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
    { icon: '🎩', title: 'Entreprises', description: 'Dirigeants, diplomates, voyageurs d\'affaires. Mise a disposition possible.' },
    { icon: '💍', title: 'Événements', description: 'Séminaires, galas, lancements — une attention portée à chaque détail, mise a disposition possible.' },
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
    { name: 'Manuel Bras Gomes', date: 'il y a un mois', text: 'Excellente prestation pour un trajet vers l\'aéroport de Roissy. Julien est très sympathique, ponctuel et sérieux. La prise en charge a été parfaite, avec un véhicule propre et confortable. Conduite souple et rassurante. Arrivé à l\'heure au terminal sans aucun stress. Je referai appel à ses services sans hésiter pour mes prochains déplacements. Merci encore !' },
    { name: 'Nono Abou', date: 'il y a un mois', text: 'Excellent service. Le taxi est arrivé à l\'heure à l\'aéroport et le trajet s\'est déroulé sans souci. Chauffeur professionnel, véhicule propre et conduite agréable. Je recommande vivement. Merci pour votre service !' },
    { name: 'Dida Didadida', date: 'il y a un mois', text: 'Chauffeur sérieux et ponctuel, voiture confortable et propre. Service au top, je recommande. Merci à Julien, Saulx les chartreux' },
  ];

  protected readonly guarantees = [
    { icon: '⏰', title: 'Ponctualité garantie', subtitle: '−10 % si retard +10 min' },
    { icon: '✅', title: 'Chauffeur vérifié', subtitle: 'Carte Taxi' },
    { icon: '💰', title: 'Tarif transparent', subtitle: 'Aucun frais caché' },
    { icon: '🕐', title: 'Disponible 24/7', subtitle: 'Jour, nuit, week-end' },
  ];

  protected readonly faqItems = [
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

  // ── Mentions légales ──────────────────────────────────────────────────────
  protected readonly legalSections = [
    {
      title: '1. Éditeur du site',
      content: [
        'Nom commercial : Taxi Saulx-les-Chartreux',
        'Exploitant : Julien (chauffeur taxi indépendant)',
        'Adresse : Saulx-les-Chartreux, Essonne (91)',
        'Téléphone : 06 50 07 86 97',
        'Statut : Auto-entrepreneur / Taxi indépendant',
        'Carte professionnelle : délivrée par la Préfecture de l\'Essonne',
      ]
    },
    {
      title: '2. Hébergement',
      content: [
        'Frontend : Vercel Inc., 340 Pine Street, Suite 701, San Francisco, CA 94104, USA — vercel.com',
        'Backend : Render Services Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, USA — render.com',
      ]
    },
    {
      title: '3. Propriété intellectuelle',
      content: [
        'L\'ensemble du contenu de ce site (textes, images, graphismes, logo) est la propriété exclusive de Taxi Saulx-les-Chartreux ou de ses partenaires. Toute reproduction, même partielle, est interdite sans autorisation préalable.',
      ]
    },
    {
      title: '4. Données personnelles',
      content: [
        'Les données collectées via les formulaires (nom, téléphone, e-mail) sont utilisées exclusivement pour répondre à vos demandes de réservation ou de devis. Elles ne sont ni vendues, ni transmises à des tiers.',
        'Conformément au RGPD et à la loi Informatique et Libertés, vous disposez d\'un droit d\'accès, de rectification et de suppression de vos données. Pour exercer ce droit : 06 50 07 86 97.',
        'Durée de conservation : vos données sont conservées 12 mois maximum à compter de votre dernière demande.',
      ]
    },
    {
      title: '5. Cookies',
      content: [
        'Ce site n\'utilise pas de cookies publicitaires ni de traceurs tiers. Aucune donnée de navigation n\'est collectée à des fins commerciales.',
      ]
    },
    {
      title: '6. Responsabilité',
      content: [
        'Taxi Saulx-les-Chartreux s\'efforce de maintenir les informations de ce site à jour mais ne peut garantir leur exactitude absolue. L\'utilisation des informations du site se fait sous la seule responsabilité de l\'utilisateur.',
      ]
    },
    {
      title: '7. Droit applicable',
      content: [
        'Le présent site est soumis au droit français. Tout litige relatif à son utilisation sera soumis à la juridiction compétente du ressort de l\'Essonne.',
      ]
    },
  ];

  constructor(
    private readonly apiService: ApiService,
    private readonly ngZone: NgZone,
    private readonly location: Location,
    private readonly titleService: Title,
    private readonly metaService: Meta,
  ) {}

  ngOnInit(): void {
    this.initFromUrl();
    this.initCalendar();
    this.startCarouselAuto();
    this.setupScrollObserver();
    this.setupStatsObserver();
    setTimeout(() => this.updateCarouselItemWidth(), 150);
  }

  /** Détermine la page à afficher au chargement à partir de l'URL (permet les liens directs /contact, /devis, etc.) */
  private initFromUrl(): void {
    const path = this.location.path(true) || '/';
    const match = (Object.entries(PAGE_PATHS) as [Page, string][]).find(([, p]) => p === path);
    this.currentPage = match ? match[0] : 'home';
    this.applyPageMeta(this.currentPage);
  }

  /** Met à jour le <title> et la meta description pour la page courante (SEO) */
  private applyPageMeta(page: Page): void {
    const meta = PAGE_META[page];
    this.titleService.setTitle(meta.title);
    this.metaService.updateTag({ name: 'description', content: meta.description });
  }

  @HostListener('window:popstate')
  onPopState(): void {
    this.initFromUrl();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  ngOnDestroy(): void {
    clearInterval(this.carouselTimer);
    this.statsObserver?.disconnect();
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('touchend', this.onMouseUp);
  }

  @HostListener('window:scroll')
  onScroll(): void { this.navScrolled = window.scrollY > 60; }

  @HostListener('window:resize')
  onResize(): void { this.updateCarouselItemWidth(); }

  private updateCarouselItemWidth(): void {
    const slide = document.querySelector('.carousel-slide') as HTMLElement | null;
    if (slide) {
      const style = getComputedStyle(slide);
      const marginRight = parseFloat(style.marginRight) || 0;
      this.carouselItemWidth = slide.offsetWidth + marginRight;
    }
  }

  private setupScrollObserver(): void {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('revealed'); });
    }, { threshold: 0.12 });
    setTimeout(() => { document.querySelectorAll('.reveal, .reveal-item').forEach(el => obs.observe(el)); }, 100);
  }

  private setupStatsObserver(): void {
    this.statsObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !this.statsAnimated) { this.statsAnimated = true; this.animateCounters(); }
    }, { threshold: 0.5 });
    setTimeout(() => {
      const el = document.querySelector('.stats-section');
      if (el) this.statsObserver!.observe(el);
    }, 200);
  }

  private animateCounters(): void {
    const duration = 1800; const fps = 60; const steps = duration / (1000 / fps); let step = 0;
    const interval = setInterval(() => {
      step++;
      const progress = this.easeOut(step / steps);
      this.displayStats = this.displayStats.map((s, i) => {
        if (i === 0) { const val = Math.round(progress * 12000); return { ...s, display: '+' + val.toLocaleString('fr-FR') }; }
        else if (i === 1) { const val = (progress * 5).toFixed(1); return { ...s, display: val.replace('.', ',') }; }
        else if (i === 2) { return { ...s, display: '0 €' }; }
        else { return { ...s, display: String(Math.round(progress * 24)) }; }
      });
      if (step >= steps) {
        clearInterval(interval);
        this.displayStats[0].display = '+12 000';
        this.displayStats[1].display = '5,0';
        this.displayStats[3].display = '24/7';
      }
    }, 1000 / fps);
  }

  private easeOut(t: number): number { return 1 - Math.pow(1 - t, 3); }

  private readonly carouselMaxIndex = this.carouselImages.length - 3;

  protected carouselPrev(): void { this.carouselIndex = this.carouselIndex === 0 ? 0 : this.carouselIndex - 1; this.restartCarouselAuto(); }
  protected carouselNext(): void { this.carouselIndex = this.carouselIndex >= this.carouselMaxIndex ? this.carouselMaxIndex : this.carouselIndex + 1; this.restartCarouselAuto(); }

  private startCarouselAuto(): void {
    this.carouselTimer = setInterval(() => {
      if (this.carouselIndex >= this.carouselMaxIndex) { this.carouselIndex = 0; } else { this.carouselIndex++; }
    }, 3500);
  }

  private restartCarouselAuto(): void { clearInterval(this.carouselTimer); this.startCarouselAuto(); }

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

  private onMouseMove = (e: MouseEvent) => { if (!this.isDragging) return; const el = document.querySelector('.reveal-slider') as HTMLElement; if (el) this.updateSlider(e.clientX, el); };
  private onTouchMove = (e: TouchEvent) => { if (!this.isDragging) return; e.preventDefault(); const el = document.querySelector('.reveal-slider') as HTMLElement; if (el) this.updateSlider(e.touches[0].clientX, el); };
  private onMouseUp = () => { this.isDragging = false; document.removeEventListener('mousemove', this.onMouseMove); document.removeEventListener('mouseup', this.onMouseUp); document.removeEventListener('touchmove', this.onTouchMove); document.removeEventListener('touchend', this.onMouseUp); };

  private updateSlider(clientX: number, el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    this.sliderPct = pct;
  }

  protected toggleFaq(i: number): void { this.openFaq = this.openFaq === i ? null : i; }

  protected goTo(page: Page): void {
    this.currentPage = page;
    this.mobileMenuOpen = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (this.location.path(true) !== PAGE_PATHS[page]) {
      this.location.go(PAGE_PATHS[page]);
    }
    this.applyPageMeta(page);
    if (page === 'rdv') this.initCalendar();
    if (page === 'home') {
      setTimeout(() => {
        this.setupScrollObserver(); this.setupStatsObserver();
        this.statsAnimated = false;
        this.displayStats[0].display = '0+'; this.displayStats[1].display = '0,0'; this.displayStats[3].display = '24/7';
      }, 100);
    }
  }

  /** À utiliser sur les <a href="..."> pour garder la navigation SPA (pas de rechargement complet) tout en restant crawlable */
  protected navigate(event: Event, page: Page): void {
    event.preventDefault();
    this.goTo(page);
  }

  protected scrollSection(id: string): void {
    if (this.currentPage !== 'home') {
      this.currentPage = 'home'; this.mobileMenuOpen = false;
      if (this.location.path(true) !== PAGE_PATHS.home) this.location.go(PAGE_PATHS.home);
      this.applyPageMeta('home');
      setTimeout(() => { this.setupScrollObserver(); this.setupStatsObserver(); this.statsAnimated = false; }, 100);
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    } else {
      this.mobileMenuOpen = false;
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  protected toggleMobileMenu(): void { this.mobileMenuOpen = !this.mobileMenuOpen; }

  // ── Formulaires ───────────────────────────────────────────────────────────

  protected openConfirmModal(message: string): void {
    this.ngZone.run(() => { this.confirmModalText = message; this.showConfirmModal = true; });
  }

  protected closeConfirmModal(): void { this.showConfirmModal = false; }

  protected async submitContact(): Promise<void> {
    if (this.contactLoading) return;
    const f = this.contactForm;
    if (!f.firstName.trim() || !f.phone.trim() || !f.subject || !f.message.trim()) { alert('Veuillez remplir les champs obligatoires (*).'); return; }
    if (!this.isValidName(f.firstName)) { alert('Le prénom ne doit contenir que des lettres.'); return; }
    if (f.lastName.trim() && !this.isValidName(f.lastName)) { alert('Le nom ne doit contenir que des lettres.'); return; }
    if (!this.isValidPhone(f.phone)) { alert('Numéro de téléphone invalide. Format attendu : 06 50 07 86 97'); return; }
    if (!this.isValidEmail(f.email)) { alert('Adresse e-mail invalide.'); return; }
    this.contactLoading = true;
    try {
      await this.apiService.sendContact(f);
      this.ngZone.run(() => { this.contactSent = true; this.contactLoading = false; });
      this.openConfirmModal('Votre message a bien été envoyé. Notre équipe vous répondra dans les meilleurs délais.');
    } catch (err) {
      console.error('submitContact error (affiché en succès quand même) :', err);
      this.ngZone.run(() => { this.contactSent = true; this.contactLoading = false; });
      this.openConfirmModal('Votre message a bien été envoyé. Notre équipe vous répondra dans les meilleurs délais.');
    }
  }

  protected resetContact(): void { this.contactForm = { firstName: '', lastName: '', email: '', phone: '', subject: '', message: '' }; this.contactSent = false; }

  protected async submitQuote(): Promise<void> {
    if (this.quoteLoading) return;
    const f = this.quoteForm;
    if (!f.firstName.trim() || !f.lastName.trim() || !f.departure.trim() || !f.arrival.trim() || !f.phone.trim()) { alert('Veuillez remplir les champs obligatoires (*).'); return; }
    if (!this.isValidName(f.firstName)) { alert('Le prénom ne doit contenir que des lettres.'); return; }
    if (!this.isValidName(f.lastName)) { alert('Le nom ne doit contenir que des lettres.'); return; }
    if (!this.isValidPhone(f.phone)) { alert('Numéro de téléphone invalide. Format attendu : 06 50 07 86 97'); return; }
    if (!this.isValidEmail(f.email)) { alert('Adresse e-mail invalide.'); return; }
    this.quoteLoading = true;
    try {
      await this.apiService.sendQuote(f);
      this.ngZone.run(() => { this.quoteSent = true; this.quoteLoading = false; });
      this.openConfirmModal('Votre demande de devis a bien été envoyée. Vous recevrez une estimation rapidement.');
    } catch (err) {
      console.error('submitQuote error :', err);
      this.ngZone.run(() => { this.quoteLoading = false; });
      alert('Une erreur est survenue pendant l\'envoi de votre demande de devis. Merci de réessayer dans un instant, ou de nous appeler directement au 06 50 07 86 97.');
    }
  }

  protected resetQuote(): void { this.quoteForm = { firstName: '', lastName: '', departure: '', arrival: '', passengers: '1 passager', tripType: 'Standard', phone: '', email: '', note: '' }; this.quoteSent = false; }

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
    if (!f.firstName.trim() || !f.lastName.trim() || !f.phone.trim()) { alert('Veuillez remplir prénom, nom et téléphone.'); return; }
    if (!this.isValidName(f.firstName)) { alert('Le prénom ne doit contenir que des lettres.'); return; }
    if (!this.isValidName(f.lastName)) { alert('Le nom ne doit contenir que des lettres.'); return; }
    if (!this.isValidPhone(f.phone)) { alert('Numéro de téléphone invalide. Format attendu : 06 50 07 86 97'); return; }
    if (!this.isValidEmail(f.email)) { alert('Adresse e-mail invalide.'); return; }
    this.appointmentLoading = true;
    try {
      await this.apiService.sendAppointment({ ...f, selectedDateLabel: this.selectedDateLabel, selectedSlot: this.selectedSlot });
      this.ngZone.run(() => { this.appointmentLoading = false; this.goStep(4); });
      this.openConfirmModal('Votre demande de rendez-vous a bien été envoyée. Notre chauffeur vous contactera pour confirmer le créneau.');
    } catch (err) {
      console.error('confirmAppointment error (affiché en succès quand même) :', err);
      this.ngZone.run(() => { this.appointmentLoading = false; this.goStep(4); });
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
      { label: 'Prise en charge', a: '2,70 €', b: '2,70 €', c: '2,70 €', d: '2,70 €'},
      { label: 'Tarif kilométrique', a: '1,01 €', b: '1,51 €', c: '2,02 €', d: '3,03 €'},
      { label: 'Taux horaire d\'attente / marche lente', a: '41,40 €', b: '41,40 €', c: '41,40 €', d: '41,40 €'},
      { label: 'Distance parcourue (en metre) par chute de 0,10 €', a: '99,01 m', b: '66,22 m', c: '49,50 m', d: '33,00 m'},
      { label: 'Durée d\'attente / ou de marche lente par chute de 0,10 € en seconde', a: '8,70 s', b: '8,70 s', c: '8,70 s', d: '8,70 s'},
    ];
  }

  private initCalendar(): void { const t = new Date(); this.currentYear = t.getFullYear(); this.currentMonth = t.getMonth(); this.renderCalendar(); }

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
      cells.push({ label: String(day), dateKey, disabled: date < today, isToday: date.getTime() === today.getTime(), isSelected: this.selectedDateKey === dateKey && date >= today, isBlank: false });
    }
    this.calendarCells = cells;
  }

  private formatSelectedDate(dk: string): string {
    const [y, m, d] = dk.split('-').map(Number);
    const date = new Date(y, m-1, d);
    return `${this.longDays[date.getDay()]} ${d} ${this.months[m-1]} ${y}`;
  }
}
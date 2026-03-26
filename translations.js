/**
 * translations.js
 * Keyify Global Translation Dictionary – SR / EN
 *
 * Usage:
 *   t('nav.home')          → "Početna"  (if lang = 'sr')
 *   t('cart.checkout')     → "Checkout" (if lang = 'en')
 *
 * Keys are dot-separated paths into the TRANSLATIONS object.
 * Add this file BEFORE keyify.js on every page:
 *   <script src="translations.js"></script>
 *   <script src="keyify.js"></script>
 */

const TRANSLATIONS = {

  /* ═══════════════════════════════════════════════════
     SERBIAN (default)
  ═══════════════════════════════════════════════════ */
  sr: {

    /* — NAVIGATION — */
    nav: {
      home:            'Početna',
      shopSoftware:    'Shop Software',
      shopStreaming:   'Shop Streaming',
      shopAI:          'Shop AI',
      aboutUs:         'O nama',
      contact:         'Kontakt',
      login:           'Prijavi se',
      design:          'Design & Creativity',
      business:        'Business Software',
      windows:         'Windows & Office',
      music:           'Music Streaming',
      streaming:       'TV/Video Streaming',
      searchPlaceholder: 'Pretraži...',
    },

    /* — CART — */
    cart: {
      title:            'Korpa',
      empty:            'Vaša korpa je prazna',
      emptyHint:        'Dodajte proizvode da biste nastavili',
      total:            'Ukupno',
      subtotal:         'Međuzbir',
      checkout:         'Naruči',
      continueShopping: 'Nastavi kupovinu',
      remove:           'Ukloni',
      qty:              'Kol.',
      itemAdded:        'Dodano u korpu!',
      itemRemoved:      'Uklonjeno iz korpe',
    },

    /* — BUTTONS — */
    btn: {
      addToCart:   'Dodaj u korpu',
      added:       '✓ Dodano!',
      buyNow:      'Kupi Sada',
      learnMore:   'Saznaj više',
      viewAll:     'Pogledaj sve',
      newsletter:  'Pretplati se',
      send:        'Pošalji',
      close:       'Zatvori',
      save:        'Sačuvaj',
      cancel:      'Otkaži',
      confirm:     'Potvrdi',
      backToShop:  'Nazad u prodavnicu',
      placeOrder:  'Potvrdi narudžbu',
    },

    /* — BADGES / STATUS — */
    badge: {
      sale:        'SALE',
      bestseller:  'Bestseller',
      new:         'Novo',
      inStock:     'Na Stanju',
      outOfStock:  'Nema na Stanju',
      popular:     'Popular',
      limited:     'Ograničeno',
    },

    /* — FOOTER — */
    footer: {
      tagline:    'Vaš pouzdani izvor originalnih digitalnih ključeva i pretplata po najboljim cijenama.',
      shop:       'Prodavnica',
      support:    'Podrška',
      newsletter: 'Newsletter',
      newsletterDesc: 'Prijavite se za ekskluzivne popuste i obavijesti o novim proizvodima.',
      rights:     '© 2025 Keyify. Sva prava zadržana.',
      privacy:    'Privatnost',
      terms:      'Uslovi korišćenja',
      cookies:    'Kolačići',
      faq:        'FAQ',
      tracking:   'Praćenje narudžbe',
      returns:    'Politika vraćanja',
      about:      'O nama',
      allProducts:'Svi Proizvodi',
      actions:    'Akcije & Popusti',
      newItems:   'Novo u ponudi',
    },

    /* — TRUST STRIP (homepage / shop pages) — */
    trust: {
      secure:   'Sigurna Kupovina',
      delivery: 'Trenutna Isporuka',
      original: 'Originalni Ključevi',
      support:  '24/7 Podrška',
      guarantee:'Garancija Povrata',
    },

    /* — CHECKOUT PAGE — */
    checkout: {
      title:          'Blagajna',
      orderSummary:   'Pregled narudžbe',
      paymentMethod:  'Način plaćanja',
      paypalLabel:    'PayPal',
      cryptoLabel:    'Kripto (BTC / ETH / USDT)',
      bankLabel:      'Bankovna uplata',
      yourEmail:      'Vaš email',
      yourName:       'Vaše ime',
      emailPlaceholder: 'za dostavu licence',
      namePlaceholder:  'Ime i prezime',
      proceedToPayment: 'Nastavite na plaćanje',
      orderPlaced:    'Narudžba je primljena!',
      orderDesc:      'Primit ćete licencu na vaš email u roku od 15 minuta.',
      emptyCart:      'Vaša korpa je prazna.',
      backToShop:     'Nazad u prodavnicu',
      total:          'Ukupno za platiti',
      sendPayment:    'Pošaljite uplatu na:',
      afterPayment:   'Nakon uplate pošaljite potvrdu na:',
      supportEmail:   'podrska@keyify.com',
      vatNote:        'Cijena uključuje sve poreze i naknade.',
    },

    /* — PAGE: HOMEPAGE — */
    home: {
      heroBadge:     '2,400+ zadovoljnih kupaca',
      heroTitle:     'Digitalne Licence & Pretplate',
      heroSubtitle:  'Originalni ključevi za AI alate, softver i streaming po najboljim cijenama na tržištu.',
      ctaPrimary:    'Istraži Prodavnicu',
      ctaSecondary:  'Saznaj Više',
      categoriesTitle: 'Istraži Kategorije',
      categoriesSub: 'Pronađi savršeni digitalni produkt za sebe.',
      featuredTitle: 'Popularni Proizvodi',
      featuredSub:   'Najprodavanije licence po povoljnim cijenama.',
      reviewsTitle:  'Šta kažu naši kupci',
      statsCustomers:'kupaca',
      statsProducts: 'proizvoda',
      statsReviews:  'pozitivnih ocjena',
    },

    /* — PAGE: AI SHOP — */
    ai: {
      heroTitle:   'Shop AI Alati',
      heroSub:     'ChatGPT, Claude, Gemini i ostali AI asistenti.',
      filterAll:   'Sve',
      filterChat:  'Chatbot',
      filterCreate:'Kreativni AI',
      filterProd:  'Produktivnost',
      sortLabel:   'Sortiraj: Preporučeno',
    },

    /* — PAGE: DESIGN — */
    design: {
      heroTitle: 'Design & Creativity',
      heroSub:   'Adobe, Figma, Canva Pro i alati za kreatore.',
    },

    /* — PAGE: BUSINESS — */
    business: {
      heroTitle: 'Business Software',
      heroSub:   'Antivirus, VPN, projektni alati i poslovni softver.',
    },

    /* — PAGE: WINDOWS — */
    windows: {
      heroTitle: 'Windows & Office',
      heroSub:   'Originalni Windows i Microsoft Office ključevi.',
    },

    /* — PAGE: MUSIC — */
    music: {
      heroTitle: 'Music Streaming',
      heroSub:   'Spotify, Apple Music, YouTube Premium i više.',
    },

    /* — PAGE: STREAMING — */
    streaming: {
      heroTitle: 'TV/Video Streaming',
      heroSub:   'Netflix, HBO Max, Disney+ i druge platforme.',
    },

    /* — PAGE: LOGIN — */
    auth: {
      welcomeBadge:    'Dobrodošli u Keyify',
      pageTitle:       'Prijavite se ili kreirajte nalog',
      pageSubtitle:    'Pristupite svim vašim digitalnim licencama i kupite nove uz posebne pogodnosti za registrovane korisnike.',
      tabLogin:        'Prijava',
      tabRegister:     'Registracija',
      loginTitle:      'Dobrodošli nazad',
      loginSub:        'Unesite vaše podatke za pristup nalogu.',
      emailLabel:      'Email adresa',
      emailPlaceholder:'vas@email.com',
      passwordLabel:   'Lozinka',
      forgotPassword:  'Zaboravili ste lozinku?',
      loginBtn:        'Prijavi se',
      orWith:          'ili nastavite sa',
      googleBtn:       'Nastavi sa Google',
      regTitle:        'Kreirajte nalog',
      regSub:          'Besplatno i brzo. Pristup svim vašim licencama odmah.',
      nameLabel:       'Ime i prezime',
      namePlaceholder: 'npr. Amir Hadžić',
      confirmLabel:    'Potvrdi lozinku',
      confirmPlaceholder: 'Ponovite lozinku',
      termsText:       'Slažem se sa',
      termsLink:       'uslovima korišćenja',
      privacyLink:     'politikom privatnosti',
      and:             'i',
      registerBtn:     'Registruj se',
      strengthWeak:    'Slaba lozinka',
      strengthFair:    'Umjerena lozinka',
      strengthGood:    'Dobra lozinka',
      strengthStrong:  'Jaka lozinka',
      otpTitle:        'Verifikacija identiteta',
      otpSub:          'Unesite 6-cifreni kod koji smo poslali na:',
      otpVerify:       'Verificiraj kod',
      otpResend:       'Pošalji ponovo',
      otpBack:         '← Nazad na prijavu',
    },

    /* — PAGE: ABOUT — */
    about: {
      heroTitle:   'O nama',
      heroSub:     'Priča o Keyify – vašoj pouzdanoj digitalnoj prodavnici.',
    },

    /* — PAGE: CONTACT — */
    contact: {
      heroTitle:   'Kontaktirajte nas',
      heroSub:     'Tu smo za vas svaki dan. Odgovaramo u roku od 24 sata.',
    },
  },


  /* ═══════════════════════════════════════════════════
     ENGLISH
  ═══════════════════════════════════════════════════ */
  en: {

    nav: {
      home:            'Home',
      shopSoftware:    'Shop Software',
      shopStreaming:   'Shop Streaming',
      shopAI:          'Shop AI',
      aboutUs:         'About Us',
      contact:         'Contact',
      login:           'Sign In',
      design:          'Design & Creativity',
      business:        'Business Software',
      windows:         'Windows & Office',
      music:           'Music Streaming',
      streaming:       'TV/Video Streaming',
      searchPlaceholder: 'Search...',
    },

    cart: {
      title:            'Cart',
      empty:            'Your cart is empty',
      emptyHint:        'Add products to continue shopping',
      total:            'Total',
      subtotal:         'Subtotal',
      checkout:         'Checkout',
      continueShopping: 'Continue shopping',
      remove:           'Remove',
      qty:              'Qty.',
      itemAdded:        'Added to cart!',
      itemRemoved:      'Removed from cart',
    },

    btn: {
      addToCart:   'Add to Cart',
      added:       '✓ Added!',
      buyNow:      'Buy Now',
      learnMore:   'Learn More',
      viewAll:     'View All',
      newsletter:  'Subscribe',
      send:        'Send',
      close:       'Close',
      save:        'Save',
      cancel:      'Cancel',
      confirm:     'Confirm',
      backToShop:  'Back to shop',
      placeOrder:  'Place Order',
    },

    badge: {
      sale:        'SALE',
      bestseller:  'Bestseller',
      new:         'New',
      inStock:     'In Stock',
      outOfStock:  'Out of Stock',
      popular:     'Popular',
      limited:     'Limited',
    },

    footer: {
      tagline:    'Your trusted source for original digital keys and subscriptions at the best market prices.',
      shop:       'Shop',
      support:    'Support',
      newsletter: 'Newsletter',
      newsletterDesc: 'Sign up for exclusive discounts and new product notifications.',
      rights:     '© 2025 Keyify. All rights reserved.',
      privacy:    'Privacy',
      terms:      'Terms of Service',
      cookies:    'Cookies',
      faq:        'FAQ',
      tracking:   'Order Tracking',
      returns:    'Return Policy',
      about:      'About Us',
      allProducts:'All Products',
      actions:    'Sales & Discounts',
      newItems:   'New Arrivals',
    },

    trust: {
      secure:   'Secure Shopping',
      delivery: 'Instant Delivery',
      original: 'Original Keys',
      support:  '24/7 Support',
      guarantee:'Money-back Guarantee',
    },

    checkout: {
      title:          'Checkout',
      orderSummary:   'Order Summary',
      paymentMethod:  'Payment Method',
      paypalLabel:    'PayPal',
      cryptoLabel:    'Crypto (BTC / ETH / USDT)',
      bankLabel:      'Bank Transfer',
      yourEmail:      'Your email',
      yourName:       'Your name',
      emailPlaceholder: 'for license delivery',
      namePlaceholder:  'Full name',
      proceedToPayment: 'Proceed to Payment',
      orderPlaced:    'Order received!',
      orderDesc:      'You will receive your license by email within 15 minutes.',
      emptyCart:      'Your cart is empty.',
      backToShop:     'Back to shop',
      total:          'Total to pay',
      sendPayment:    'Send payment to:',
      afterPayment:   'After payment, send confirmation to:',
      supportEmail:   'support@keyify.com',
      vatNote:        'Price includes all taxes and fees.',
    },

    home: {
      heroBadge:     '2,400+ satisfied customers',
      heroTitle:     'Digital Licenses & Subscriptions',
      heroSubtitle:  'Original keys for AI tools, software and streaming at the best market prices.',
      ctaPrimary:    'Explore Shop',
      ctaSecondary:  'Learn More',
      categoriesTitle: 'Explore Categories',
      categoriesSub: 'Find the perfect digital product for yourself.',
      featuredTitle: 'Popular Products',
      featuredSub:   'Best-selling licenses at great prices.',
      reviewsTitle:  'What our customers say',
      statsCustomers:'customers',
      statsProducts: 'products',
      statsReviews:  'positive reviews',
    },

    ai: {
      heroTitle:   'Shop AI Tools',
      heroSub:     'ChatGPT, Claude, Gemini and other AI assistants.',
      filterAll:   'All',
      filterChat:  'Chatbot',
      filterCreate:'Creative AI',
      filterProd:  'Productivity',
      sortLabel:   'Sort: Recommended',
    },

    design: {
      heroTitle: 'Design & Creativity',
      heroSub:   'Adobe, Figma, Canva Pro and creator tools.',
    },

    business: {
      heroTitle: 'Business Software',
      heroSub:   'Antivirus, VPN, project tools and business software.',
    },

    windows: {
      heroTitle: 'Windows & Office',
      heroSub:   'Original Windows and Microsoft Office keys.',
    },

    music: {
      heroTitle: 'Music Streaming',
      heroSub:   'Spotify, Apple Music, YouTube Premium and more.',
    },

    streaming: {
      heroTitle: 'TV/Video Streaming',
      heroSub:   'Netflix, HBO Max, Disney+ and other platforms.',
    },

    auth: {
      welcomeBadge:    'Welcome to Keyify',
      pageTitle:       'Sign in or create an account',
      pageSubtitle:    'Access all your digital licenses and buy new ones with special benefits for registered users.',
      tabLogin:        'Sign In',
      tabRegister:     'Register',
      loginTitle:      'Welcome back',
      loginSub:        'Enter your credentials to access your account.',
      emailLabel:      'Email address',
      emailPlaceholder:'you@email.com',
      passwordLabel:   'Password',
      forgotPassword:  'Forgot your password?',
      loginBtn:        'Sign In',
      orWith:          'or continue with',
      googleBtn:       'Continue with Google',
      regTitle:        'Create an account',
      regSub:          'Free and quick. Access all your licenses instantly.',
      nameLabel:       'Full name',
      namePlaceholder: 'e.g. John Smith',
      confirmLabel:    'Confirm password',
      confirmPlaceholder: 'Repeat password',
      termsText:       'I agree to the',
      termsLink:       'terms of service',
      privacyLink:     'privacy policy',
      and:             'and',
      registerBtn:     'Register',
      strengthWeak:    'Weak password',
      strengthFair:    'Fair password',
      strengthGood:    'Good password',
      strengthStrong:  'Strong password',
      otpTitle:        'Identity verification',
      otpSub:          'Enter the 6-digit code we sent to:',
      otpVerify:       'Verify code',
      otpResend:       'Resend',
      otpBack:         '← Back to sign in',
    },

    about: {
      heroTitle:   'About Us',
      heroSub:     'The story of Keyify – your trusted digital marketplace.',
    },

    contact: {
      heroTitle:   'Contact Us',
      heroSub:     'We are here for you every day. We respond within 24 hours.',
    },
  },
};

/**
 * t(key) — resolve a dot-path key in the current language
 * Falls back to the same key in 'sr', then returns the key itself.
 *
 * @param {string} key  e.g. 'nav.home' or 'cart.checkout'
 * @param {string} [lang] override language (defaults to current)
 * @returns {string}
 */
function t(key, lang) {
  const L = lang || (typeof KEYIFY !== 'undefined' ? KEYIFY.lang : 'sr');
  const parts = key.split('.');
  let obj = TRANSLATIONS[L];
  for (const p of parts) {
    if (obj == null) break;
    obj = obj[p];
  }
  if (obj != null && typeof obj === 'string') return obj;
  // fallback to sr
  let fallback = TRANSLATIONS['sr'];
  for (const p of parts) {
    if (fallback == null) break;
    fallback = fallback[p];
  }
  return (fallback != null && typeof fallback === 'string') ? fallback : key;
}

# Keyify Platform

Premium digital software & subscription marketplace.
**Stack:** Node.js + Express · Supabase (PostgreSQL) · Vanilla JS + Tailwind CSS

---

## Struktura projekta

```
Keyify/
│
├── 🗄  BACKEND
│   ├── server.js           ← Express API (12 ruta)
│   ├── package.json
│   ├── .env.example        ← Template za env varijable
│   └── railway.json        ← Railway deployment config
│
├── 🌐 FRONTEND – Globalni sistem
│   ├── config.js           ← Jedino mesto za API URL  ⬅ EDITUJ OVO
│   ├── translations.js     ← SR/EN rječnik svih tekstova
│   └── keyify.js           ← Engine: korpa + jezik + navbar
│
├── 📄 STRANICE
│   ├── index.html          ← Početna
│   ├── login.html          ← Prijava + Registracija + OTP
│   ├── admin.html          ← Admin Dashboard (zaštićeno)
│   ├── checkout.html       ← Blagajna
│   ├── ai.html             ← Shop AI Alati
│   ├── design.html         ← Design & Creativity
│   ├── business.html       ← Business Software
│   ├── windows.html        ← Windows & Office
│   ├── music.html          ← Music Streaming
│   ├── streaming.html      ← TV/Video Streaming
│   ├── about.html
│   └── contact.html
│
├── 🗃  BAZA PODATAKA
│   └── schema.sql          ← Pokreni ovo u Supabase SQL Editoru
│
└── 🚀 DEPLOYMENT
    ├── vercel.json         ← Vercel (frontend) config
    ├── .vercelignore       ← Isključuje server fajlova sa Vercel-a
    └── .gitignore
```

---

## Brzi start (lokalno)

```bash
# 1. Instaliraj dependencies
npm install

# 2. Napravi .env fajl
cp .env.example .env
# Popuni sve varijable (Supabase, JWT, Gmail)

# 3. Pokreni backend
npm run dev
# API je dostupan na http://localhost:3001
```

Otvori `index.html` direktno u browseru — `config.js` automatski
detektuje `localhost` i koristi `http://localhost:3001/api`.

---

## Deployment: 3 koraka

### Korak 1 — Supabase (baza podataka)

1. Idi na [supabase.com](https://supabase.com) → tvoj projekt → **SQL Editor**
2. Otvori fajl `schema.sql`, selektuj sve (`Ctrl+A`) i klikni **Run**
3. Ovo kreira sve tabele + uzorak proizvoda + default admin nalog
4. Idi na **Settings → API** i kopiraj:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (ne anon!) → `SUPABASE_SERVICE_KEY`

> ⚠ Odmah promijeni admin lozinku nakon prvog logina!

---

### Korak 2 — Railway (backend)

1. Pushni projekat na GitHub (`.gitignore` već isključuje `.env` i `node_modules`)
2. Idi na [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Izaberi repo — Railway automatski detektuje Node.js
4. Dodaj env varijable u **Variables** tabu:

| Varijabla | Vrijednost |
|---|---|
| `SUPABASE_URL` | iz Supabase Settings |
| `SUPABASE_SERVICE_KEY` | service_role ključ |
| `JWT_SECRET` | random string, min 40 karaktera |
| `EMAIL_USER` | tvoja Gmail adresa |
| `EMAIL_PASS` | Gmail [App Password](https://myaccount.google.com/apppasswords) |
| `FRONTEND_URL` | tvoj Vercel URL (dodaj nakon Koraka 3) |
| `PORT` | `3001` |

5. Railway deployuje automatski. Kopiraj URL: `https://keyify-api.up.railway.app`

---

### Korak 3 — Vercel (frontend)

1. Idi na [vercel.com](https://vercel.com) → **Add New → Project**
2. Importuj GitHub repo
3. Framework preset: **Other** (nema build stepa)
4. Klikni **Deploy** — `vercel.json` sve ostalo radi sam
5. Kopiraj Vercel URL i dodaj ga kao `FRONTEND_URL` u Railway Variables (fix za CORS)

---

### Korak 4 — Promijeni API URL (samo 1 fajl!)

Otvori **`config.js`** i zamijeni URL:

```js
window.KEYIFY_CONFIG = {
  API_URL: 'https://keyify-api.up.railway.app/api',  // ← tvoj Railway URL
  ...
};
```

To je sve. `login.html`, `admin.html` i `checkout.html` automatski
koriste ovaj URL u produkciji, a `localhost:3001` lokalno.

---

## Globalni sistem: uključivanje

Dodaj ova 3 taga na **svaku HTML stranicu**, tačno prije `</body>`:

```html
<script src="config.js"></script>
<script src="translations.js"></script>
<script src="keyify.js"></script>
```

Nakon uključivanja, `keyify.js` **automatski**:
- Ubacuje SR/EN language switcher u navbar
- Spaja cart button sa slide-out drawer-om
- Pronalazi sve `Dodaj u korpu` / `Kupi Sada` dugmiće i dodaje cart logiku
- Vraća jezičku preferencu iz `localStorage` pri svakom učitavanju
- Prikazuje ime korisnika / `ADMIN` u navbaru nakon prijave

---

## Korpa — spajanje dugmića

### Metod A — Bez izmjena HTML-a (auto-wiring)

`keyify.js` automatski pronalazi dugmiće čiji tekst sadrži:
`Dodaj u korpu` · `Kupi Sada` · `Add to Cart` · `Buy Now`

Iz parent `.product-card` elementa vadi:
- **Ime** → iz `<h3>`
- **Cijenu** → iz `<span class="text-base font-bold text-blue-600">`
- **Opis** → iz `<p class="text-xs text-gray-500">`
- **Boju** → iz prvog `style="background:linear-gradient(..."` elementa

Radi na svim postojećim shop stranicama bez ijedne izmjene HTML-a.

### Metod B — `data-product` atribut (preporučeno za preciznost)

```html
<button
  class="w-full bg-blue-600 ..."
  data-product='{
    "id":       "chatgpt-plus",
    "name":     "ChatGPT Plus",
    "name_en":  "ChatGPT Plus",
    "price":    68.12,
    "desc":     "GPT-4o • DALL-E • Plugins",
    "desc_en":  "GPT-4o • DALL-E • Plugins",
    "color":    "#19c37d",
    "imageUrl": ""
  }'>
  Dodaj u korpu
</button>
```

`keyify.js` prvo provjerava `data-product` — ako postoji, koristi te podatke direktno.

### Metod C — Dinamički (API + admin panel)

```javascript
const lang     = localStorage.getItem('keyify_lang') || 'sr';
const res      = await fetch(window.KEYIFY_CONFIG.API_BASE + '/products');
const products = await res.json();

products.forEach(p => {
  const name = lang === 'en' && p.name_en ? p.name_en : p.name_sr;
  const desc = lang === 'en' && p.description_en ? p.description_en : p.description_sr;
  // napravi card element, dodaj u DOM
  // keyify.js MutationObserver automatski spaja novi dugmić
});
```

---

## Jezički sistem

### Označavanje elemenata

```html
<a href="ai.html"   data-i18n="nav.shopAI">Shop AI</a>
<button             data-i18n="btn.addToCart">Dodaj u korpu</button>
<h1                 data-i18n="home.heroTitle">Digitalne Licence</h1>
<input              data-i18n-placeholder="nav.searchPlaceholder"/>
```

### Dodavanje novih ključeva

Otvori `translations.js`, dodaj ključ u **oba** jezika:

```js
sr: { mojaStrana: { naslov: 'Moj naslov' } },
en: { mojaStrana: { naslov: 'My Heading'  } }
```

Koristi u HTML-u: `data-i18n="mojaStrana.naslov"`

### JavaScript API

```js
KEYIFY.LANG.set('en')      // promijeni jezik
KEYIFY.LANG.current        // → 'sr' ili 'en'
t('nav.home')              // → 'Početna' / 'Home'
```

---

## Korpa — JavaScript API

```javascript
KEYIFY.CART.add({ id, name, price, desc, color, imageUrl })
KEYIFY.CART.remove(id)      // ukloni po id-u
KEYIFY.CART.setQty(id, qty) // postavi količinu (0 = ukloni)
KEYIFY.CART.clear()         // isprazni korpu
KEYIFY.CART.open()          // otvori drawer
KEYIFY.CART.close()         // zatvori drawer
KEYIFY.CART.total()         // → Number (EUR)
KEYIFY.CART.count()         // → Number (ukupna količina)
KEYIFY.CART.items           // → Array (živi podaci iz localStorage)
```

Korpa se čuva u `localStorage` pod ključem `keyify_cart`:

```json
[
  {
    "id": "chatgpt-plus",
    "name": "ChatGPT Plus",
    "price": 68.12,
    "qty": 2,
    "desc": "GPT-4o • DALL-E • Plugins",
    "color": "#19c37d"
  }
]
```

---

## Plaćanje (Admin → Checkout)

### Postavljanje načina plaćanja

1. Prijavi se kao admin → `admin.html`
2. Sidebar → **Plaćanja**
3. Unesi PayPal email, kripto adrese (BTC/ETH/USDT), bankovni IBAN
4. Klikni **Sačuvaj podatke o plaćanju**

Podaci se čuvaju u Supabase tabeli `site_settings`.

### Kako checkout.html čita podatke

Poziva `GET /api/checkout-settings` — javni endpoint, bez auth:

```json
{
  "paypal_email": "shop@keyify.com",
  "btc_wallet":   "bc1q...",
  "eth_wallet":   "0x...",
  "usdt_wallet":  "T...",
  "bank_iban":    "RS35...",
  "bank_name":    "Raiffeisen Bank"
}
```

Prikazuju se samo konfigurisani načini — ako nema kripto adrese, kripto se ne pojavljuje.

---

## API rute

| Metod | Ruta | Auth | Opis |
|---|---|---|---|
| POST | `/api/register` | Javno | Registracija korisnika |
| POST | `/api/login` | Javno | Prijava + slanje OTP koda |
| POST | `/api/verify` | Javno | Verifikacija OTP → JWT token |
| GET | `/api/products` | Javno | Lista svih proizvoda |
| POST | `/api/products` | Admin | Kreiranje proizvoda |
| PUT | `/api/products/:id` | Admin | Ažuriranje proizvoda |
| DELETE | `/api/products/:id` | Admin | Brisanje proizvoda |
| GET | `/api/admin/stats` | Admin | Statistike dashboarda |
| GET | `/api/admin/settings` | Admin | Čitanje svih podešavanja |
| POST | `/api/admin/settings` | Admin | Snimanje podešavanja |
| GET | `/api/checkout-settings` | **Javno** | Podaci za plaćanje (checkout) |
| GET | `/api/health` | Javno | Health check |

**Admin auth header:** `Authorization: Bearer <jwt_token>`

---

## Admin nalog (default)

| | |
|---|---|
| Email | `admin@keyify.com` |
| Lozinka | `Admin1234!` |

> ⚠ **Odmah promijeni lozinku!**
> Supabase → Table Editor → `users` tabela → edituj `password_hash`.
> Novi hash generiši na [bcrypt-generator.com](https://bcrypt-generator.com) (cost: 12).

---

## Gmail App Password (za OTP emailove)

1. Uključi 2FA na Google nalogu
2. Idi na [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Napravi App Password za "Mail"
4. Taj 16-karakterni kod koristi kao `EMAIL_PASS` u `.env`

---

## Super Admin dodjela

Super admin ima neograničen pristup svim admin funkcijama (transakcije, SQL editor, itd.).

### Automatski (server bootstrap)
Server automatski promoviše `spasojep3@gmail.com` u super_admin pri svakom pokretanju.

### Manuelno (SQL u Supabase SQL Editor)
```sql
UPDATE users
SET role = 'admin',
    rank = 'super_admin',
    permissions = '{}'::jsonb
WHERE email = 'tvoj@email.com';
```

> **Važno:** `permissions` mora biti prazan `{}` (ne NULL). Prazan JSONB = neograničen pristup.
> Nakon SQL update-a, korisnik se mora ponovo ulogovati da bi JWT dobio `role: 'admin'`.

---

## .env konfiguracija

Kreiraj `.env` fajl u root direktorijumu:

```env
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUz...

# Auth
JWT_SECRET=tvoj_random_string_min_40_karaktera

# Email (Gmail)
EMAIL_USER=tvoj@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx

# Server
PORT=3001
FRONTEND_URL=https://keyify-nu.vercel.app

# Google OAuth (opcionalno)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URL=
GMAIL_REFRESH_TOKEN=

# Enkripcija (64 hex karaktera = 32 bajta)
AES_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Stripe (opcionalno)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Admin SQL Editor PIN
SQL_MASTER_PIN=tvoj_pin
```

> **Nikada ne commituj `.env`!** Fajl je u `.gitignore`.

---

## PayPal integracija

### Korak 1 — Kreiraj PayPal App
1. Idi na [developer.paypal.com](https://developer.paypal.com)
2. **My Apps & Credentials** → Create App
3. Kopiraj **Client ID** i **Secret**

### Korak 2 — Unesi u Admin Panel
1. `admin.html` → Sidebar → **Plaćanja**
2. Unesi PayPal email, Client ID i Secret
3. **Client ID** (javni) se koristi za PayPal SDK dugme na checkout stranici
4. **Secret** (tajni) se enkriptuje AES-256 prije upisa u bazu — frontend ga nikada ne vidi

### Korak 3 — Pokreni migraciju
```sql
-- Pokreni u Supabase SQL Editor:
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS paypal_client_id TEXT;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS paypal_secret_enc TEXT;
```

---

## Kripto plaćanje

### Postavljanje
1. `admin.html` → **Plaćanja**
2. Unesi wallet adrese: BTC, ETH (ERC-20), USDT (TRC-20)
3. Checkout automatski generiše QR kod za svaku adresu

### Podržane mreže
| Valuta | Mreža | Format adrese |
|--------|-------|---------------|
| BTC | Bitcoin Mainnet | `bc1q...` ili `1...` ili `3...` |
| ETH | Ethereum Mainnet | `0x...` |
| USDT | Tron (TRC-20) | `T...` |

---

## Bezbednost

### Šta je zaštićeno
- **`.env`** — svi tajni ključevi, nikada u Git-u (`.gitignore`)
- **AES-256-CBC enkripcija** — IP adrese, email-ovi i PayPal Secret u bazi
- **JWT + Session Binding** — IP + User-Agent verifikacija za svaki zahtjev
- **Rate Limiting** — 300 req/15min (API), 15 req/15min (auth)
- **RBAC** — permisije po adminu, super_admin = neograničen

### Šta frontend nikada ne dobija
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET`
- `paypal_secret_enc` (enkriptovan u bazi)
- `AES_KEY`
- `STRIPE_SECRET_KEY`

### Enkripcija u kodu
```javascript
// server.js koristi AES-256-CBC sa random IV
const encrypted = encryptField('osetljivi_podatak');  // → "iv_hex:ciphertext_hex"
const original  = decryptField(encrypted);            // → "osetljivi_podatak"
```

---

## Checklist za deployment

- [ ] Pokreni `schema.sql` u Supabase SQL Editoru
- [ ] Pokreni `schema_payment_secrets.sql` (PayPal Client ID + Secret kolone)
- [ ] Pokreni `schema_chat_queue.sql` (Chat queue sistem)
- [ ] Kopiraj Supabase URL + service_role key
- [ ] Generiši `AES_KEY` (64 hex) — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] Deployuj backend na **Railway**, dodaj sve env varijable
- [ ] Kopiraj Railway URL u **`config.js`** → `API_URL`
- [ ] Deployuj frontend na **Vercel** (importuj GitHub repo)
- [ ] Kopiraj Vercel URL → dodaj kao `FRONTEND_URL` u Railway Variables
- [ ] Provjeri `GET https://tvoj-api.up.railway.app/api/health` → `{"status":"ok"}`
- [ ] Promijeni default admin lozinku u Supabase
- [ ] Dodijeli super_admin rang svom nalogu (SQL gore)
- [ ] Postavi načine plaćanja u Admin Panel → Plaćanja
- [ ] (Opcionalno) Unesi PayPal Client ID + Secret za SDK integraciju
- [ ] Testiraj cijeli flow: registracija → OTP → login → korpa → checkout

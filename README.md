# Cold Mail Bot

An end-to-end **email outreach automation pipeline** built to explore full-stack
backend engineering: web scraping, AI text generation, a job scheduler, an SMTP
sending layer, and a live dashboard — all wired together on free-tier services.

> **Note:** This is a learning / portfolio project. It is intended for
> permission-based, compliant outreach only (e.g. emailing your own leads or
> contacts who expect to hear from you). Always follow anti-spam law
> (CAN-SPAM, GDPR) and include an opt-out in every message.

---

## What it demonstrates

- **Web scraping** — collecting business listings with Playwright and extracting
  contact emails from their websites.
- **AI integration** — generating personalized email copy per lead via the Groq
  LLM API.
- **Data modeling** — a MongoDB/Mongoose schema that tracks each lead through a
  finite-state lifecycle.
- **Email delivery** — sending and follow-up sequencing over Gmail SMTP with
  Nodemailer, respecting daily send caps.
- **Scheduling** — a cron layer (and a GitHub Actions workflow) to run the
  pipeline automatically.
- **Dashboard** — a Next.js app for tracking opens, unsubscribes, and lead
  status.

**Stack:** Node.js · MongoDB · Groq AI · Gmail SMTP · Playwright · Next.js

---

## Architecture

```
 Scraper            AI Layer           Sender           Dashboard
 ───────            ────────           ──────           ─────────
 Playwright   ──►   Groq LLM     ──►   Nodemailer  ──►  Next.js
 (find leads)       (personalize)      (Gmail SMTP)     (track/opt-out)
       │                 │                  │                 │
       └─────────────────┴──────┬───────────┴─────────────────┘
                                ▼
                          MongoDB (Lead store)
                                ▲
                                │
                          cron / GitHub Actions
```

### Lead lifecycle

```
new → ready → sent → followup_1 → followup_2 → done
                          ↘ (on reply) → replied
```

---

## Setup

```bash
# 1. install dependencies
npm install

# 2. install the Playwright browser used for scraping
npx playwright install chromium

# 3. create a .env file (see .env.example for all keys)
#    - MONGODB_URI
#    - GROQ_API_KEY
#    - SMTP_USER + SMTP_PASS   (Gmail App Password, not your real password)
```

### Creating a Gmail App Password
1. Enable **2-Step Verification** on your Google account.
2. Go to https://myaccount.google.com/apppasswords
3. Generate a new app password and put the 16-digit code in `SMTP_PASS`.

---

## Usage

```bash
# verify the database connection
npm run test:db

# 1. scrape leads:  node src/scraper/run.js "<query>" <count> <niche>
node src/scraper/run.js "web design agency in Lahore" 20 webdesign

# 2. generate personalized copy (edit the OFFER in src/ai/run.js first)
npm run personalize

# 3. send the first emails (respects the daily limit)
npm run send

# 4. send scheduled follow-ups
npm run followup
```

Run the whole thing on a schedule:

```bash
npm run cron   # e.g. emails in the morning, follow-ups in the afternoon
```

---

## Project structure

```
src/
├── db/
│   ├── connect.js          # MongoDB connection
│   ├── Lead.js             # Lead model (schema)
│   └── test.js             # connection test
├── scraper/
│   ├── googleMaps.js       # scrape business listings
│   ├── emailExtractor.js   # extract emails from websites
│   ├── verifyEmail.js      # basic email validation
│   └── run.js              # scraper entry point
├── ai/
│   ├── personalizer.js     # generate copy via Groq
│   └── run.js              # personalization entry point
├── sender/
│   ├── mailer.js           # Nodemailer / Gmail transport
│   ├── run.js              # send first emails
│   └── followup.js         # follow-up sequencing
├── tracker/
│   └── replyChecker.js     # detect replies → update status
├── utils/
│   └── notify.js           # notifications
├── report.js               # run summary
└── cron.js                 # scheduler

dashboard/                  # Next.js app: open tracking, unsubscribe, status
.github/workflows/          # scheduled run via GitHub Actions
```

---

## Responsible use

This project sends real email. Before using it against any real recipients:

- Only contact people who have a legitimate reason to hear from you.
- Include a working **unsubscribe / opt-out** in every message.
- Keep volume low on shared providers (Gmail caps out fast); use a dedicated
  domain with **SPF, DKIM, and DMARC** configured for anything at scale.
- Comply with **CAN-SPAM**, **GDPR**, and your target country's regulations.

---

## License

MIT — for educational use. You are responsible for how you use it.
```


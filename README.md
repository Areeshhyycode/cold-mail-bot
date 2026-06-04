# 🤖 Cold Mail Bot — AI Cold Email + Lead Finder

Leads dhundo → AI se personalized email banao → auto send + follow-up.
Stack: **Node.js + MongoDB + Groq AI + Gmail SMTP + Playwright** (sab free tier).

---

## 📦 Setup (ek baar)

```bash
# 1. dependencies install
npm install

# 2. Playwright browser install (scraping ke liye)
npx playwright install chromium

# 3. .env file ready karo (.env.example dekho)
#    - MONGODB_URI
#    - GROQ_API_KEY
#    - SMTP_USER + SMTP_PASS (Gmail App Password)
```

### Gmail App Password kaise banaye
1. Google account me **2-Step Verification** ON karo
2. Jao: https://myaccount.google.com/apppasswords
3. Naya app password banao → wo 16-digit code `.env` ke `SMTP_PASS` me daalo
   (apna normal Gmail password mat use karna)

---

## 🚀 Use kaise kare (workflow)

```bash
# Step 0: DB connection test
npm run test:db

# Step 1: leads scrape karo
#   node src/scraper/run.js "<query>" <kitne> <niche>
node src/scraper/run.js "web design agency in Lahore" 20 webdesign

# Step 2: AI se personalized emails banao (src/ai/run.js me OFFER edit karo)
npm run personalize

# Step 3: pehle emails bhejo (daily limit ke saath)
npm run send

# Step 4: follow-ups bhejo (3 din baad wale)
npm run followup
```

### Ya sab auto chalao (scheduler)
```bash
npm run cron   # roz 9AM emails, 2PM follow-ups
```

---

## 🔄 Lead ka safar (status flow)

```
new → ready → sent → followup_1 → followup_2 → done
                          ↘ (reply aaye to) → replied
```

---

## ⚠️ ZAROORI — pehle ye padho

1. **Gmail se start theek hai, par scale pe alag domain kharido.**
   Apna main email blacklist ho sakta hai. ~30-40/day se zyada mat bhejo.

2. **Deliverability:** SPF, DKIM, DMARC set karo (jab apna domain ho).

3. **Legal:** Har email me unsubscribe/opt-out option do. US me CAN-SPAM,
   EU me GDPR follow karo. Apne target country ke rules jaan lo.

4. **Reply tracking (TODO):** abhi manual — jab koi reply kare, us lead ka
   status DB me `replied` kar do taaki follow-up na jaye. (IMAP listener
   baad me add kar sakte hain.)

---

## 📁 Structure

```
src/
├── db/
│   ├── connect.js      # MongoDB connection
│   ├── Lead.js         # Lead model (schema)
│   └── test.js         # connection test
├── scraper/
│   ├── googleMaps.js   # businesses scrape
│   ├── emailExtractor.js # website se email
│   └── run.js          # scraper chalao
├── ai/
│   ├── personalizer.js # Groq se email banao
│   └── run.js          # personalization chalao
├── sender/
│   ├── mailer.js       # Nodemailer (Gmail)
│   ├── run.js          # pehle emails
│   └── followup.js     # follow-up sequence
└── cron.js             # daily scheduler
```

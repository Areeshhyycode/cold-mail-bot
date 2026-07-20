# 🤖 AI Job Assistant (Chrome Extension v2)

Job-search pages (Indeed, LinkedIn, Rozee, ya koi bhi ATS/careers page) se jobs
ki **poori details (30+ fields)** collect karo, har job ka **AI match score +
missing skills + tailored resume/cover letter** lo, aur sab kuch **MongoDB me
sync** karo. **Human-in-the-loop** — apply aap khud karti ho (koi auto-submit /
fake account / private-email scraping nahi).

## v1 se kya badla (short)
- **30+ fields** scrape hote hain (salary, skills, recruiter, applicants, JD…), sirf 4 nahi.
- Har job ka **AI analysis** (Groq): match score, strengths, weaknesses, missing skills, salary estimate, verdict.
- **Tailored resume + cover letter** har job ke liye (on-demand, cache).
- Sab jobs **MongoDB me sync** hoti hain — retry queue ke saath, koi job kabhi gum nahi hoti.
- **Job history**: saved / applied / interview / offer / rejected … har status ki timeline.
- **Backend ab secure**: token auth + CORS lockdown (pehle koi bhi website tumhara Groq quota jala sakti thi).

## Install (1 baar)
1. `npm run dashboard` chalao (backend + Mongo). Pehli baar console me ek **API token** dikhega.
2. Chrome me `chrome://extensions` kholo → **Developer mode** ON → **Load unpacked** → ye `extension/` folder select karo.
3. Popup me **⚙️ Backend settings** kholo → wahi API token paste karo → **Save & test connection** → 🟢 connected.

## Use kaise karein
1. Kisi job-search page pe jao (Indeed "React developer Karachi", ya LinkedIn jobs).
2. 🧩 icon → **"Scan this page"** → saare cards turant list me + background me:
   - har job ka **detail page** throttled queue se enrich hota hai (3–8s gap — LinkedIn-safe)
   - har job MongoDB me sync hoti hai + **AI analyze** hoti hai
3. Score badge: 🤖 = AI match score, warna local fit score (AI aane tak).
4. Kisi job pe **🤖 AI** dabao → analysis + **✍️ Tailored resume + cover letter**.
5. Status dropdown se job ko saved/applied/interview… mark karo → history MongoDB me.
6. Filters: All · Junior/Intern · Strong match (70+) · Applied. **⬇ CSV** se export.

## Dashboard
`http://localhost:4000/jobs` — saari jobs, search + filters (status, remote/hybrid,
seniority, tech, salary, AI score), status update, live AI-queue counter.

## 🤖 Daily auto-scrape (set & forget)
Popup → **"🤖 Daily auto-scrape"** → Indeed/LinkedIn pe search kholo →
**"➕ Add current page"** → toggle ON. Chrome khulte hi saved searches khud
scrape + enrich + AI-analyze ho jati hain. **"▶ Scrape now"** se turant.

> Chrome ki limits (bug nahi): scheduled waqt pe Chrome **on** hona chahiye,
> site me **logged-in** hona chahiye (khaas LinkedIn), aur din me 1–2 baar theek
> hai (4-ghante throttle laga hai).

## Apply autofill (no auto-submit)
Indeed smartapply / LinkedIn Easy Apply pe extension fields bharta hai aur
**"Continue"** dabata hai — **"Submit" KABHI nahi** (wo tum dabati ho). Screening
sawaal ka jawab **Auto-answers** se ya backend AI se aata hai. Jo tum khud likhti
ho wo yaad ho jata hai. Captcha/required field pe ruk jata hai.

> ❌ Full auto-apply LinkedIn/Indeed ki ToS todta hai (account ban). Isliye
> human-in-the-loop.

## Security
- API token ke baghair backend har request **401** karta hai (jobs local list me mehfooz rehti hain).
- CORS sirf `chrome-extension://` origins ko — koi website tumhare localhost:4000 ko hit nahi kar sakti.
- Content script API token **kabhi page me nahi** rakhta — network sab service worker se hota hai.
- Scraped data validate + length-capped hota hai; CSV exports formula-injection safe.

## Architecture (файл-guide)
| File | Kaam |
|---|---|
| `manifest.json` | MV3 config — least-privilege host permissions, module SW, CSP |
| `lib/core.js` | Shared logic: job shape, dedupe keys, classify, fit score, normQ (popup+SW+content script sab import karte hain) |
| `lib/extractor.js` | `extractCards()` (search page) + `extractDetail()` (30+ fields). Self-contained — `executeScript` ke liye |
| `lib/api.js` | Backend client (Bearer auth, retryable-error typing) — sirf SW use karta hai |
| `background.js` | **Single writer** — scrape, throttled enrich queue, sync+retry queue, status/history, message bus |
| `popup.js` / `popup.html` | UI — message-driven (khud `jobs` nahi likhta), AI panel, filters, sync bar, settings |
| `autofill-content.js` | Apply autofill + auto-advance + free detail-enrichment (jab tum khud job kholti ho) |

## Sites
Indeed, LinkedIn, Rozee ke liye tuned. ATS pages (Greenhouse, Lever, Ashby,
Workable, Workday…) pe **JSON-LD** se poora structured data nikaalta hai. Baaki
sites pe generic mode. Selector toote to bata dena.

# 🧩 Job Apply Assistant (Chrome Extension)

Job-search pages (Indeed, LinkedIn, Rozee, ya koi bhi careers page) se jobs +
company info **ek click me collect** karo, CSV export karo, aur har job ke liye
**cover letter** banao. **Human-in-the-loop** — apply aap khud karti ho (koi
auto-submit / fake account / private-email scraping nahi).

## Install (1 baar — 1 minute)
1. Chrome me kholo: `chrome://extensions`
2. Upar right me **Developer mode** ON karo
3. **Load unpacked** dabao
4. Is `extension/` folder ko select karo
5. Toolbar me 🧩 icon aa jayega (pin kar lo)

## Use kaise karein
1. Kisi job-search page pe jao (jaise Indeed pe "React developer Karachi" search)
2. 🧩 icon dabao → **"Scan this page"** → page ke saare jobs list me add ho jayenge
3. Scroll karke / agle page pe jaake phir Scan dabao — naye jobs add hote rahenge (duplicates apne aap skip)
4. **"My profile"** ek baar bhar ke Save karo (name, email, portfolio…) — cover letters me use hoga
5. Har job pe **"✍️ cover letter"** → tailored letter ban jayega → **Copy** → application form me paste
6. **"⬇ CSV"** se poori list download karo (Excel/Sheets me kholo)

## Kya safe hai (aur kya nahi)
- ✅ Sirf wahi data parhta hai jo **aapki screen pe already khula** hai
- ✅ Sab kuch **locally** rehta hai (aapke browser me) — koi server pe nahi jata
- ✅ Apply aap khud karti ho (review + submit)
- ❌ Ye auto-submit nahi karta, fake account nahi banata, private emails scrape nahi karta

## Sites
Indeed, LinkedIn, Rozee ke liye tuned hai. Doosri sites pe ek **generic mode**
chalta hai (job/career links pakadta hai) — har site pe 100% nahi, par kaafi
jagah kaam karega. Selectors kabhi toot jayein to bata dena, update kar denge.

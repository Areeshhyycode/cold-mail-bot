/**
 * AI OPPORTUNITY SCORE (Phase 5) — 0..100.
 *
 * ⚠️ JAAN-BOOJH KE RULE-BASED, LLM NAHI. Wajah:
 *   - Phase 5 khud "Reasons: ✅ No Website" maang raha hai — yaani EXPLAINABLE
 *     chahiye. Rules khud hi apni wajah bata dete hain; LLM ko wajah "banani"
 *     parti hai (aur wo jhooti bhi ho sakti hai).
 *   - Har business pe Groq call = paisa + latency + nondeterminism, bina faide ke.
 *   - `intent.js` me yehi pattern already kaam kar raha hai.
 *
 * Sabse bara signal: WEBSITE HAI YA NAHI. Jiske paas website nahi, wo tumhara
 * sabse aasan client hai — usko bechne ke liye pehle "convince" nahi karna parta.
 */
export function scoreBusiness(biz = {}) {
  const reasons = [];
  let score = 0;

  // band business = koi lead nahi
  if (biz.closed) return { score: 0, reasons: ["Permanently/temporarily closed"] };

  // ── website (sabse bara factor) ──
  if (!biz.hasWebsite) {
    score += 40;
    reasons.push("✅ No website — needs one (highest-value lead)");
  } else if (biz.websiteQuality === "outdated" || biz.websiteQuality === "none") {
    score += 25;
    reasons.push("✅ Website is outdated / broken — redesign opportunity");
    for (const p of (biz.websiteProblems || []).slice(0, 3)) reasons.push(`   • ${p}`);
  } else if (biz.websiteQuality === "ok") {
    score += 5;
    reasons.push("Website looks fine — lower priority (could still want SEO/apps)");
  }

  // ── business ZINDA hai? (rating + reviews = active, paying customers) ──
  if (biz.rating != null && biz.rating >= 4.0) {
    score += 15;
    reasons.push(`✅ Strong reputation (${biz.rating}★) — an active, real business`);
  } else if (biz.rating != null && biz.rating < 3.0) {
    score -= 5;
    reasons.push(`⚠️ Weak rating (${biz.rating}★)`);
  }

  if (biz.reviews != null && biz.reviews >= 50) {
    score += 10;
    reasons.push(`✅ ${biz.reviews} reviews — busy business, has budget`);
  } else if (biz.reviews != null && biz.reviews >= 10) {
    score += 5;
    reasons.push(`${biz.reviews} reviews — some traction`);
  }

  // ── reachable? (contact na ho to lead bekaar hai, chahe kitna acha ho) ──
  if (biz.hasWhatsapp) {
    score += 12;
    reasons.push("✅ WhatsApp number available — direct, high-response channel");
  } else if (biz.hasEmail) {
    score += 8;
    reasons.push("✅ Email available");
  } else if (!biz.contacts?.length) {
    score -= 15;
    reasons.push("❌ No contact found — can't reach them");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons,
  };
}

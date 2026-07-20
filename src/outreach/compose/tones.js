/**
 * TONES — Phase 4. Har tone AI ko ek alag "aawaaz" deta hai.
 *
 * Ye sirf prompt-guidance hai; final structure har tone me same rehta hai taake
 * deliverability/compliance na toote. Tone alfaaz badalta hai, dhaancha nahi.
 */
export const TONES = {
  friendly: {
    label: "Friendly",
    guide:
      "Warm aur approachable, jaise ek madadgar insaan baat kar raha ho. Contractions theek hain (I'd, you're). Halka gormjoshi, magar chaaploosi nahi. Corporate jargon bilkul nahi.",
  },
  professional: {
    label: "Professional",
    guide:
      "Saaf, respectful, business-appropriate. Na akkhar na zyada casual. Default agency tone. Value pe focus, waqt ki qadar.",
  },
  casual: {
    label: "Casual",
    guide:
      "Relaxed aur conversational, jaise kisi jaan-pehchan waale ko likh rahe ho. Chhote jumle. Halki-phulki language. Magar phir bhi respectful aur non-spammy.",
  },
  corporate: {
    label: "Corporate",
    guide:
      "Formal aur polished. Poore jumle, koi contraction nahi, koi emoji nahi. Enterprise/agency credibility jhalakni chahiye. Structured aur measured.",
  },
};

export const DEFAULT_TONE = "professional";

export function toneGuide(tone) {
  return (TONES[tone] || TONES[DEFAULT_TONE]).guide;
}

export function isTone(t) {
  return Object.prototype.hasOwnProperty.call(TONES, t);
}

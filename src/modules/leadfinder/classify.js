/**
 * LEAD CLASSIFICATION (Phase 7).
 *
 * Google apni category deta hai ("Dental clinic", "BPO company"). Usse hamari
 * taxonomy me map karo. RULE-BASED hai, LLM nahi — kyunki:
 *   - deterministic (wahi input = wahi output, hamesha)
 *   - free aur instant (har business pe Groq call = paisa + latency)
 *   - explainable
 * LLM sirf tab chahiye jab kuch bhi match na ho (abhi "other" me daal dete hain).
 */
const RULES = [
  ["restaurant", ["restaurant", "food", "bbq", "pizza", "burger", "biryani", "dhaba", "eatery"]],
  ["cafe", ["cafe", "coffee", "bakery", "tea", "dessert", "ice cream"]],
  ["dental", ["dental", "dentist", "orthodont"]],
  ["medical", ["hospital", "doctor", "physician", "medical", "pharmacy", "diagnostic", "lab", "surgeon"]],
  ["clinic", ["clinic", "polyclinic", "healthcare"]],
  ["gym", ["gym", "fitness", "yoga", "crossfit", "sports club"]],
  ["salon", ["salon", "spa", "beauty", "barber", "parlour", "parlor", "hair"]],
  ["real_estate", ["real estate", "property", "builder", "estate agent", "realtor"]],
  ["law_firm", ["law", "lawyer", "attorney", "legal", "advocate", "solicitor"]],
  ["school", ["school", "college", "university", "montessori", "education"]],
  ["academy", ["academy", "institute", "tuition", "coaching", "training center"]],
  ["software_house", ["software", "it company", "web design", "web develop", "digital agency", "bpo", "tech", "seo"]],
  ["clothing", ["clothing", "boutique", "fashion", "garment", "tailor", "apparel"]],
  ["electronics", ["electronic", "mobile shop", "computer", "hardware store", "appliance"]],
  ["construction", ["construction", "contractor", "architect", "interior design", "renovation"]],
  ["travel", ["travel", "tour", "visa", "ticketing", "hajj", "umrah"]],
  ["hotel", ["hotel", "guest house", "motel", "resort", "suites"]],
  ["event_planner", ["event", "wedding", "catering", "banquet", "marquee", "photograph"]],
  ["retail", ["store", "shop", "mart", "supermarket", "retail", "grocery"]],
];

/**
 * @param {string} googleCategory - Maps ka category
 * @param {string} name           - business ka naam (fallback signal)
 * @returns {string} hamari category
 */
export function classifyBusiness(googleCategory = "", name = "") {
  const t = `${googleCategory} ${name}`.toLowerCase();
  for (const [cat, keys] of RULES) {
    if (keys.some((k) => t.includes(k))) return cat;
  }
  return "other";
}

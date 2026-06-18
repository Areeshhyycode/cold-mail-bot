/**
 * QUERY GENERATOR — Google Maps (SERVICE) leads ke liye search queries banata hai.
 *
 * Intent/scoring logic ab src/ai/intent.js me hai (reusable). Ye file sirf
 * service-side scraping ke liye query combinations deta hai.
 *
 * NOTE: pehle is file me ek test-run block tha jo har IMPORT pe console pe fake
 * leads print karta tha — woh hata diya gaya (side-effect on import = bug).
 */

// agency service niches (business outreach ke liye)
const niches = [
  "web development",
  "seo services",
  "web design agency",
  "digital marketing agency",
  "real estate agency",
  "ecommerce store",
  "interior design",
  "law firm",
  "dental clinic",
  "restaurant",
];

// service-intent qualifiers
const intentLabels = ["small business", "local business", "startup", "company"];

const locations = ["karachi", "lahore", "islamabad", "pakistan"];

/**
 * Service-lead search queries banata hai (niche × qualifier × location), shuffled.
 * @returns {string[]}
 */
export function generateQueries() {
  const queries = [];
  for (const n of niches) {
    for (const i of intentLabels) {
      for (const l of locations) {
        queries.push(`${i} ${n} in ${l}`);
      }
    }
  }
  // shuffle taaki har run me alag queries upar aayen (variety)
  return queries.sort(() => Math.random() - 0.5);
}

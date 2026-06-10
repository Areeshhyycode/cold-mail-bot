/**
 * Single offer: "Digital Presence" agency pitch.
 * SEO + website redesign + social media / LinkedIn marketing + digital branding.
 * CAMPAIGN env ab matter nahi karta — har case me yahi offer chalta hai.
 */
const SENDER = {
  senderName: process.env.SENDER_NAME || "Areesha Rafiq",
  senderTitle: process.env.SENDER_TITLE || "AriLabs — Web & Digital Growth",
  links: {
    LinkedIn: "https://www.linkedin.com/in/areesha-rafiq-net/",
    Portfolio: "https://portfolio-szj4.vercel.app/",
    GitHub: "https://github.com/Areeshhyycode",
  },
};

const AGENCY = {
  type: "agency",
  ...SENDER,
  // AI ko context dene ke liye (kya offer karte hain)
  service:
    "We help businesses strengthen their online presence: modern website redesign (better UI/UX), SEO so they rank higher on Google, an AI customer-support chatbot that answers visitor questions 24/7 and auto-creates tickets for your team, plus social media & LinkedIn marketing and a consistent digital branding strategy.",
  // email ke "How we can help" section ke bullets
  serviceList: [
    "Website redesign — a modern, professional, industry-focused site that builds trust and improves conversions",
    "SEO — rank higher on Google so clients find you before competitors",
    "AI customer-support chatbot — trained on your services & FAQs, answers visitors 24/7, and auto-creates a ticket for your team when it can't",
    "Social media & LinkedIn marketing — keep your audience engaged and reach more decision-makers",
    "Digital branding — a consistent, credible online image that matches your service quality",
  ],
  // email ke "Why this matters" section ke bullets
  benefits: [
    "Attract more qualified leads",
    "Build greater trust with clients and partners",
    "Improve visibility against competitors",
    "Generate more inquiries from search and LinkedIn",
  ],
};

export const OFFERS = { agency: AGENCY };

export function getOffer() {
  return AGENCY;
}

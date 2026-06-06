/**
 * Do campaigns — CAMPAIGN env se choose karo:
 *   CAMPAIGN=dev      -> apni dev/AI services bechni (default)
 *   CAMPAIGN=website  -> chhote businesses ko sasta website offer ($5 + free demo)
 */
const SENDER = {
  senderName: process.env.SENDER_NAME || "Areesha Rafiq",
  senderTitle: process.env.SENDER_TITLE || "Full Stack & AI Developer | AriLabs",
  links: {
    LinkedIn: "https://www.linkedin.com/in/areesha-rafiq-net/",
    Portfolio: "https://portfolio-szj4.vercel.app/",
    GitHub: "https://github.com/Areeshhyycode",
  },
};

export const OFFERS = {
  dev: {
    type: "dev",
    ...SENDER,
    service:
      "I'm a full-stack (MERN) + AI developer. I build AI-powered web & mobile apps, AI chatbots & RAG support agents, and workflow automation.",
    serviceList: [
      "AI-powered web & mobile apps (Next.js, React Native)",
      "AI chatbots & RAG customer-support agents",
      "Workflow automation (Gmail, WhatsApp, Slack, n8n)",
      "Full-stack MERN development",
    ],
  },

  website: {
    type: "website",
    ...SENDER,
    service:
      "I build affordable, modern, mobile-friendly websites for small businesses. Promotional price + free demo/mockup before they pay.",
    promoPrice: process.env.PROMO_PRICE || "$5",
    serviceList: [
      "Modern, mobile-friendly design",
      "Fast loading & SEO-ready",
      "Free demo/mockup before you decide",
      "Done in days, not weeks",
    ],
  },
};

export function getOffer() {
  const key = (process.env.CAMPAIGN || "dev").toLowerCase();
  return OFFERS[key] || OFFERS.dev;
}

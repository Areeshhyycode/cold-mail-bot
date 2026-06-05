import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { generateEmail } from "./personalizer.js";

dotenv.config();

// Yahan apni service/offer define karo
const OFFER = {
  // Areesha ki asli services (portfolio se)
  service:
    "I'm a full-stack (MERN) + AI developer. I build AI-powered web & mobile apps, AI chatbots & customer-support agents (RAG), and workflow automation (Gmail, WhatsApp, Slack, n8n). 1+ year experience, 7 AI platforms shipped.",
  // ye services email me list hongi
  serviceList: [
    "AI-powered web & mobile apps (Next.js, React Native)",
    "AI chatbots & RAG customer-support agents",
    "Workflow automation (Gmail, WhatsApp, Slack, n8n)",
    "Full-stack MERN development",
  ],
  senderName: process.env.SENDER_NAME || "Areesha Rafiq",
  senderTitle: process.env.SENDER_TITLE || "Full Stack & AI Developer",
};

async function main() {
  await connectDB();

  // sirf wo leads jinki email abhi nahi bani (status: new)
  const leads = await Lead.find({ status: "new" }).limit(50);
  console.log(`✍️  ${leads.length} leads ke liye email banani hai...`);

  for (const lead of leads) {
    try {
      const { subject, body, ownerName } = await generateEmail(lead, OFFER);
      lead.subject = subject;
      lead.body = body;
      if (ownerName && !lead.ownerName) lead.ownerName = ownerName;
      lead.status = "ready";
      await lead.save();
      const who = lead.ownerName ? ` (👤 ${lead.ownerName})` : "";
      console.log(`   ✅ ${lead.businessName}${who} — "${subject}"`);
    } catch (err) {
      console.log(`   ⚠️  ${lead.businessName} — ${err.message}`);
    }
  }

  console.log("\n📊 Personalization done");
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});

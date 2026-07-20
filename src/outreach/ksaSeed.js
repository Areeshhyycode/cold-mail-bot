/**
 * KSA RECRUITER SEED — ek fixed list (screenshot se) ko JOB leads bana ke
 * personalize karta hai, taaki speculative CV-application email har ek ke liye
 * ready ho jaye.
 *
 *   node src/outreach/ksaSeed.js
 *
 * - leadType: JOB  (sender CV attach karega, jobLeadSendable speculative pass)
 * - campaign: ksa-recruiters  (batch sender sirf inhi ko bhejta hai)
 * - status:   ready  (email ban gayi)
 *
 * Idempotent: dobara chalane pe jo pehle se ready hain unhe skip karta hai.
 */
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { generateJobEmail } from "../ai/jobEmail.js";
import { getProfile } from "../ai/profile.js";

dotenv.config();

const CAMPAIGN = "ksa-recruiters";

// { email, company } — company sirf greeting/subject ke liye. Personal mailboxes
// (gmail/hotmail) ka company "" -> speculative "Hello," greeting.
const TARGETS = [
  { email: "cv@arabianfal.com", company: "Arabian Fal" },
  { email: "cv@aldawaa.com.sa", company: "Al Dawaa" },
  { email: "hr.qrm@hotmail.com", company: "" },
  { email: "rec@alojaimi.com", company: "Alojaimi" },
  { email: "recruitment@rawabiholding.com", company: "Rawabi Holding" },
  { email: "job.s6@hotmail.com", company: "" },
  { email: "careers@dnata.com", company: "dnata" },
  { email: "hr@alesayi_motors.com", company: "Alesayi Motors" },
  { email: "hr@alarayan.com", company: "Al Rayan" },
  { email: "recruiting.ksa@mcmermott.com", company: "McDermott" },
  { email: "recruitment@aytb.com", company: "AYTB" },
  { email: "wadaef@gtecorp.com", company: "GTE Corp" },
  { email: "careers@nesr.com", company: "NESR" },
  { email: "recruit@farm.com.sa", company: "FARM" },
  { email: "info@alhumamlaw.com", company: "Al Humam Law" },
  { email: "hr1@gulfteksaudi.com", company: "Gulftek Saudi" },
  { email: "catcosa@catcosa.com", company: "CATCOSA" },
  { email: "cv@tafear.com", company: "Tafear" },
  { email: "recruitment@sraco.com.sa", company: "SRACO" },
  { email: "career@sidco.com.sa", company: "SIDCO" },
  { email: "info@atco.com.sa", company: "ATCO" },
  { email: "hrdepartmental@sa.yokogawa.com", company: "Yokogawa" },
  { email: "recruitment@shadeco.com", company: "Shadeco" },
  { email: "klc.hr@alkafaa.com", company: "Al Kafaa" },
  { email: "kbr-amcdehr@kbr.com", company: "KBR" },
  { email: "recruitment@batook.com", company: "Batook" },
  { email: "career@shawarmer.com", company: "Shawarmer" },
  { email: "hrsupport@archirodon.net", company: "Archirodon" },
  { email: "jobs@binajinah.com", company: "Bin Ajinah" },
  { email: "marketing.np@nesma.com", company: "Nesma" },
  { email: "wadaef2019@abdulla-fouad.com", company: "Abdulla Fouad" },
  { email: "careers@innosoft.sa", company: "Innosoft" },
  { email: "m@startime.com.sa", company: "Startime" },
  { email: "job@musk.sa.com", company: "Musk" },
  { email: "shababwatansa@gmail.com", company: "" },
  { email: "j@sabksa.com", company: "SAB KSA" },
  { email: "al.alshaikh@bonyan.sa", company: "Bonyan" },
  { email: "ymohammed@innovest.com.sa", company: "Innovest" },
  { email: "s.alwadi@nhc.sa", company: "NHC" },
  { email: "i.atassi@artar.com.sa", company: "Artar" },
  { email: "oalkhunaizi@darwaemaar.com", company: "Darwa Emaar" },
  { email: "jobs@almasah.net", company: "Al Masah" },
  { email: "recruitment.amjad@gmail.com", company: "" },
  { email: "jobrydlaw@gmail.com", company: "" },
  { email: "job@almoosahospital.com.sa", company: "Al Moosa Hospital" },
  { email: "recruitment@almoosahospital.com.sa", company: "Al Moosa Hospital" },
  { email: "jobs@sghgroup.net", company: "SGH Group" },
  { email: "career.dmm@sghgroup.net", company: "SGH Group" },
  { email: "talent.acquisition@drsulaimanalhabib.com", company: "Dr. Sulaiman Al Habib" },
  { email: "careers@jhah.com", company: "JHAH" },
  { email: "hrd@alahsahospital.com.sa", company: "Al Ahsa Hospital" },
  { email: "career@almanahospital.com.sa", company: "Almana Hospital" },
  { email: "info@familycare.com.sa", company: "Family Care" },
  { email: "info@ramclinics.com", company: "RAM Clinics" },
  { email: "hr.dsfhr@fakeeh.care", company: "Fakeeh Care" },
  { email: "career@mouwasat.com", company: "Mouwasat" },
  { email: "careers@dallah-hospital.com", company: "Dallah Hospital" },
  { email: "hr.phc@drsulaimanalhabib.com", company: "Dr. Sulaiman Al Habib" },
  { email: "careers@almurjanhospital.com", company: "Al Murjan Hospital" },
  { email: "hiringnow.ksa@gmail.com", company: "" },
  { email: "recruitment@wecareksa.com", company: "WeCare KSA" },
];

async function main() {
  await connectDB();
  const profile = getProfile();

  let created = 0, reused = 0, drafted = 0, failed = 0;

  for (const t of TARGETS) {
    const email = t.email.toLowerCase().trim();
    try {
      let lead = await Lead.findOne({ email });

      if (!lead) {
        lead = await Lead.create({
          email,
          businessName: t.company || email,
          company: t.company || "",
          leadType: "JOB",
          intent: "JOB",
          jobTitle: "", // speculative application
          source: "manual-ksa",
          niche: "recruitment",
          campaign: CAMPAIGN,
          status: "new",
        });
        created++;
      } else {
        // pehle se DB me hai (kisi aur campaign se) — is run me chhedo mat agar
        // already contacted. Sirf abhi tak untouched (new/ready) ko refresh karo.
        if (!["new", "ready"].includes(lead.status)) {
          console.log(`   ⏭️  ${email} — already ${lead.status}, skip`);
          reused++;
          continue;
        }
        reused++;
      }

      // already ready? dobara AI call mat karo
      if (lead.status === "ready" && lead.subject && lead.body) {
        console.log(`   ✓ ${email} — already drafted`);
        continue;
      }

      const { subject, body } = await generateJobEmail(lead, profile);
      lead.subject = subject;
      lead.body = body;
      lead.leadType = "JOB";
      lead.campaign = CAMPAIGN;
      lead.status = "ready";
      await lead.save();
      drafted++;
      console.log(`   ✅ ${email} — "${subject}"`);
    } catch (err) {
      failed++;
      console.log(`   ⚠️  ${email} — ${err.message}`);
    }
  }

  const ready = await Lead.countDocuments({ campaign: CAMPAIGN, status: "ready" });
  console.log(
    `\n📊 Seed done | new:${created} existing:${reused} drafted:${drafted} failed:${failed}` +
      `\n   Campaign "${CAMPAIGN}" ready-to-send: ${ready}` +
      `\n   Ab bhejne ke liye: node src/sender/batchSend.js ${CAMPAIGN}`
  );
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});

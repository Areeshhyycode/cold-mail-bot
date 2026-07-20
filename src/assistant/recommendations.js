/**
 * PROACTIVE RECOMMENDATIONS — Task 8, Phase 7.
 *
 * Ye wo cheezein hain jo assistant BINA POOCHHE batati hai jab tum chat kholti ho:
 *   "12 jobs ka match score 90+ hai" · "5 businesses ko aaj follow-up chahiye"
 *   "reply rate is hafte gir gaya" · "tumhari best subject line ye hai"
 *
 * JAAN-BOOJH KE RULE-BASED (LLM nahi):
 *   - MUFT hai aur foran — chat kholte hi dikhta hai, koi Groq call nahi
 *   - DETERMINISTIC — wahi data, wahi jawab. Recommendation kabhi "hallucinate" nahi hoti
 *   - EXPLAINABLE — har item apni wajah, source aur confidence khud rakhta hai
 *
 * Har recommendation ek `action` bhi deta hai — wo text jo user chat me bhej sakta
 * hai (UI usse clickable chip bana deta hai).
 */
import { Job } from "../db/Job.js";
import { Business } from "../db/Business.js";
import { Message } from "../db/Message.js";
import { Reply } from "../db/Reply.js";
import { outreachAnalytics, bestSubjectLines } from "../outreach/analytics.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Saari recommendations. Priority se sorted (bara number = zyada zaroori).
 * @returns {Promise<{recommendations:Array, generatedAt:string}>}
 */
export async function getRecommendations() {
  const recs = [];
  const push = (r) => recs.push(r);

  const weekAgo = new Date(Date.now() - 7 * DAY);
  const twoWeeksAgo = new Date(Date.now() - 14 * DAY);

  /* ---------------------- JOB SIDE ---------------------- */
  const [strongUnapplied, interviews, staleApplied, noResume] = await Promise.all([
    Job.countDocuments({ "ai.matchScore": { $gte: 80 }, status: { $in: ["new", "saved"] } }),
    Job.countDocuments({ status: "interview" }),
    Job.countDocuments({ status: "applied", appliedAt: { $lte: twoWeeksAgo } }),
    Job.countDocuments({ "ai.matchScore": { $gte: 70 }, status: "saved", "ai.tailoredResume": null }),
  ]);

  if (strongUnapplied > 0) {
    push({
      icon: "🔥", priority: 95, kind: "jobs",
      title: `${strongUnapplied} strong-match job${strongUnapplied === 1 ? "" : "s"} abhi tak apply nahi ki`,
      detail: "Inka AI match score 80+ hai — sabse pehle inhi pe apply karna chahiye.",
      why: "Match score 80+ matlab tumhara stack aur level dono job se milte hain.",
      confidence: 90,
      sources: ["jobs collection (ai.matchScore)"],
      action: "Show me my strongest unapplied jobs",
    });
  }

  if (interviews > 0) {
    push({
      icon: "🗣", priority: 100, kind: "jobs",
      title: `${interviews} interview${interviews === 1 ? "" : "s"} pipeline me`,
      detail: "Inki tayyari karo — company research aur missing skills dekh lo.",
      why: "Status 'interview' pe set hai.",
      confidence: 100,
      sources: ["jobs collection (status)"],
      action: "Show my interviews and help me prepare",
    });
  }

  if (staleApplied >= 3) {
    push({
      icon: "⏰", priority: 60, kind: "jobs",
      title: `${staleApplied} applications 2 hafte purani hain`,
      detail: "Inpe follow-up bhejna ya band kar dena chahiye.",
      why: "2 hafte se zyada bina jawab ke = aam tor pe dead.",
      confidence: 70,
      sources: ["jobs collection (appliedAt)"],
      action: "Show applications older than 2 weeks",
    });
  }

  if (noResume > 0) {
    push({
      icon: "📝", priority: 55, kind: "documents",
      title: `${noResume} saved job${noResume === 1 ? "" : "s"} ka tailored resume nahi bana`,
      detail: "Apply karne se pehle resume tailor kar lo — ATS pe farq parta hai.",
      why: "Score 70+ hai par ai.tailoredResume khali hai.",
      confidence: 85,
      sources: ["jobs collection (ai.tailoredResume)"],
      action: "Generate tailored resumes for my saved jobs",
    });
  }

  /* -------------------- BUSINESS SIDE -------------------- */
  const [noWebsite, newNoWebsite, waNoEmail, highOpp] = await Promise.all([
    Business.countDocuments({ hasWebsite: false }),
    Business.countDocuments({ hasWebsite: false, createdAt: { $gte: weekAgo } }),
    Business.countDocuments({ hasWhatsapp: true, hasEmail: false }),
    Business.countDocuments({ score: { $gte: 70 } }),
  ]);

  if (newNoWebsite > 0) {
    push({
      icon: "🆕", priority: 85, kind: "businesses",
      title: `${newNoWebsite} nayi business${newNoWebsite === 1 ? "" : "es"} mili jinki website nahi`,
      detail: "Ye sabse garam leads hain — inhe website ki zaroorat hai aur abhi tak koi contact nahi hua.",
      why: "hasWebsite=false aur pichle 7 din me add hui.",
      confidence: 95,
      sources: ["businesses collection (hasWebsite, createdAt)"],
      action: "Show new businesses without websites",
    });
  } else if (noWebsite > 0) {
    push({
      icon: "🏢", priority: 50, kind: "businesses",
      title: `${noWebsite} businesses ki website nahi hai`,
      detail: "Ye tumhari core audience hai.",
      why: "hasWebsite=false.",
      confidence: 95,
      sources: ["businesses collection"],
      action: "Show businesses without websites",
    });
  }

  if (waNoEmail >= 5) {
    push({
      icon: "💬", priority: 45, kind: "outreach",
      title: `${waNoEmail} businesses pe WhatsApp hai par email nahi`,
      detail: "Inhe email se nahi pakad sakte — WhatsApp drafts banao.",
      why: "hasWhatsapp=true aur hasEmail=false.",
      confidence: 90,
      sources: ["businesses collection (contacts)"],
      action: "Show businesses with WhatsApp but no email",
    });
  }

  if (highOpp >= 5) {
    push({
      icon: "🎯", priority: 65, kind: "businesses",
      title: `${highOpp} high-opportunity leads (score 70+)`,
      detail: "Score inki website ki halat, rating aur contact-ability se bana hai.",
      why: "Opportunity score 70 se upar.",
      confidence: 85,
      sources: ["businesses collection (score)"],
      action: "Show my highest scoring business leads",
    });
  }

  /* -------------------- OUTREACH SIDE -------------------- */
  const [pendingApproval, newReplies, positiveReplies] = await Promise.all([
    Message.countDocuments({ status: "draft", requiresApproval: true }),
    Reply.countDocuments({ status: "new" }),
    Reply.countDocuments({ status: "new", classification: { $in: ["interested", "meeting_request", "quote_request"] } }),
  ]);

  if (positiveReplies > 0) {
    push({
      icon: "🎉", priority: 100, kind: "outreach",
      title: `${positiveReplies} POSITIVE repl${positiveReplies === 1 ? "y" : "ies"} ka jawab nahi diya`,
      detail: "Koi interested hai ya pricing/meeting maang raha hai — inka jawab sabse pehle.",
      why: "Reply classification interested / meeting_request / quote_request hai aur status abhi 'new'.",
      confidence: 95,
      sources: ["replies collection (classification, status)"],
      action: "Show me positive replies I haven't answered",
    });
  } else if (newReplies > 0) {
    push({
      icon: "📨", priority: 75, kind: "outreach",
      title: `${newReplies} naye replies pending hain`,
      detail: "Dekh lo — kuch me kaam ki baat ho sakti hai.",
      why: "Reply status 'new' hai.",
      confidence: 90,
      sources: ["replies collection"],
      action: "Show my new replies",
    });
  }

  if (pendingApproval > 0) {
    push({
      icon: "✋", priority: 70, kind: "outreach",
      title: `${pendingApproval} message${pendingApproval === 1 ? "" : "s"} approval ka intezaar kar rahe hain`,
      detail: "Approve karo tab hi ye send queue me jayenge.",
      why: "Message status 'draft' + requiresApproval=true.",
      confidence: 100,
      sources: ["messages collection"],
      action: "Show me messages pending approval",
    });
  }

  /* ------------------ PERFORMANCE / TRENDS ------------------ */
  try {
    const a = await outreachAnalytics();

    if (a.bounceRate > 5 && a.emailsSent >= 10) {
      push({
        icon: "⚠️", priority: 90, kind: "analytics",
        title: `Bounce rate ${a.bounceRate}% — bohat zyada hai`,
        detail: "5% se upar bounce rate tumhari sending reputation kharab karta hai. Email list clean karo.",
        why: `${a.bounced} bounced / ${a.emailsSent} sent.`,
        confidence: 95,
        sources: ["messages collection (status=bounced)"],
        action: "Why are my emails bouncing?",
      });
    }

    if (a.emailsSent >= 20 && a.replyRate < 2) {
      push({
        icon: "📉", priority: 80, kind: "analytics",
        title: `Reply rate sirf ${a.replyRate}% hai`,
        detail: "Targeting ya subject line badalne ki zaroorat hai — 2% se neeche matlab message ya audience galat hai.",
        why: `${a.replies} replies / ${a.emailsSent} sent.`,
        confidence: 80,
        sources: ["messages + replies aggregates"],
        action: "How can I improve my reply rate?",
      });
    }

    const subjects = await bestSubjectLines(null, 3);
    if (subjects.length && subjects[0].replyRate > 0) {
      const s = subjects[0];
      push({
        icon: "🏆", priority: 40, kind: "analytics",
        title: `Best subject line: "${String(s.subject).slice(0, 60)}"`,
        detail: `${s.replyRate}% reply rate (${s.replied}/${s.sent}). Aise hi subject aur banao.`,
        why: "Isi subject pe sabse zyada replies aaye.",
        confidence: s.sent >= 10 ? 85 : 55,
        sources: ["messages collection (subject → replies)"],
        action: "Show my best performing subject lines",
      });
    }
  } catch {
    /* analytics fail ho jaye to baaki recommendations phir bhi chalein */
  }

  recs.sort((a, b) => b.priority - a.priority);
  return { recommendations: recs.slice(0, 8), generatedAt: new Date().toISOString() };
}

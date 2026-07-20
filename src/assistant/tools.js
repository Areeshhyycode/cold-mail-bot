/**
 * TOOL REGISTRY — Task 8, Phase 3 (AI Tool Calling).
 *
 * Ye file assistant ka "haath" hai. Har tool sirf ek PATLA wrapper hai us
 * function ke upar jo PEHLE SE mojood hai (src/api/*, src/outreach/*, src/ai/*).
 *
 * ⚠️ USOOL: yahan koi business logic NAHI likhi jati. Agar assistant ko kuch
 * chahiye jo module me nahi hai, to wo module me add hoti hai — yahan nahi.
 * Warna do jagah logic ho jayegi aur dono drift kar jayengi.
 *
 * Har tool:
 *   name        — AI isi naam se bulata hai
 *   module      — permissions ke liye (jobs/businesses/outreach/…)
 *   risk        — read | write | send   (permissions.js dekho)
 *   description — AI ISI se decide karta hai kab use karna hai. Isliye ye
 *                 examples ke saath likhi gayi hai, sirf naam nahi.
 *   schema      — JSON Schema (Groq/OpenAI function-calling format)
 *   run(args)   — asli kaam. `_meta` return karta hai explainability ke liye.
 *
 * IMPORTANT (connection lifecycle): hum jaan-boojh ke src/api/* ke functions
 * call karte hain, CLI-level modules (runOutreach, scanArea) nahi — kyunki wo
 * apna connectDB()/disconnectDB() khud chalate hain aur server ka shared Mongo
 * connection beech me tod dete. api/* wale already HTTP context ke liye bane hain.
 */

/* ---- existing API layer (yehi "modules" hain) ---- */
import { listJobs, jobStats, getAnalysis, postStatus, postTailor } from "../api/jobsApi.js";
import { listBusinesses, businessStats, getContacts, getBusiness, startScan, getScan, refreshBusiness } from "../api/businessesApi.js";
import { getSummary, getActivity, getInsights, globalSearch } from "../api/dashboardApi.js";
import {
  listQueue, approveMessage, rejectMessage, markSent, editMessage,
  listReplies, sendReply, dismissReply,
  listCampaigns, upsertCampaign, setCampaignStatus,
  getAnalytics, outreachStats,
} from "../api/outreachApi.js";

/* ---- existing domain modules (jahan API layer nahi hai) ---- */
import { auditWebsite } from "../scraper/websiteAudit.js";
import { researchBusiness } from "../outreach/research/index.js";
import { buildEmailForLead } from "../ai/router.js";
import { Lead } from "../db/Lead.js";
import { Job } from "../db/Job.js";
import { Business } from "../db/Business.js";

/* URLSearchParams banane ka helper — api/* ke GET handlers isi shape ko lete hain */
const P = (obj = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return p;
};

/* har tool result ke saath meta — Phase 10 (explainability) */
const meta = (source, count, extra = {}) => ({ source, count, ...extra });

/* =========================================================================
   JOBS  (AI Job Hunter + Chrome Extension ka data)
   ========================================================================= */
const jobTools = [
  {
    name: "search_jobs",
    module: "jobs",
    risk: "read",
    description:
      "Scrape ki hui jobs me search karo. Use this for: 'React jobs in Karachi', 'remote internships', " +
      "'jobs with salary above 100k', 'jobs mentioning Next.js', 'strong match jobs', 'jobs I applied to'. " +
      "Filters combine ho sakte hain. Sort default AI match score pe hai.",
    schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Free-text search — title, company, location, skills, description me dhoondta hai" },
        status: { type: "string", description: "Comma-separated: new,saved,applied,ignored,archived,rejected,interview,offer,accepted" },
        workMode: { type: "string", description: "Comma-separated: remote,hybrid,onsite" },
        seniority: { type: "string", description: "Comma-separated: internship,junior,mid,senior" },
        company: { type: "string", description: "Company naam (partial match)" },
        tech: { type: "string", description: "Technology/skill, jaise 'Next.js' ya 'MongoDB'" },
        minScore: { type: "number", description: "Minimum AI match score 0-100. 70+ = strong match" },
        minSalary: { type: "number", description: "Minimum salary (numeric)" },
        hasSalary: { type: "string", enum: ["1"], description: "'1' = sirf wo jobs jinme salary di hui hai" },
        experience: { type: "string", description: "Experience text match, jaise '2 years'" },
        sort: { type: "string", enum: ["score", "fit", "recent", "salary"], description: "default: score" },
        limit: { type: "number", description: "default 20, max 500" },
      },
    },
    run: async (a) => {
      const r = await listJobs(P({ ...a, limit: a.limit || 20 }));
      return {
        total: r.total,
        showing: r.count,
        jobs: (r.jobs || []).map(slimJob),
        _meta: meta("jobs collection (search_jobs)", r.total),
      };
    },
  },

  {
    name: "job_stats",
    module: "jobs",
    risk: "read",
    description:
      "Job pipeline ke overall numbers: kitni total, kitni analyze hui, kitni strong match, " +
      "status breakdown (applied/interview/offer), seniority aur work-mode breakdown. " +
      "Use for: 'job stats', 'how many jobs do I have', 'how many interviews'.",
    schema: { type: "object", properties: {} },
    run: async () => {
      const r = await jobStats();
      return { ...r, _meta: meta("jobs collection (job_stats)", r.total) };
    },
  },

  {
    name: "get_job_analysis",
    module: "jobs",
    risk: "read",
    description:
      "Ek specific job ka poora AI analysis: match score, missing skills, strengths, weaknesses, " +
      "resume suggestions, interview difficulty, salary estimate, verdict. " +
      "Pehle search_jobs se dedupeKey lo. Use for: 'why is this a good match', 'what skills am I missing for X'.",
    schema: {
      type: "object",
      properties: { dedupeKey: { type: "string", description: "Job ka dedupeKey (search_jobs se milta hai)" } },
      required: ["dedupeKey"],
    },
    run: async (a) => {
      const r = await getAnalysis(P({ key: a.dedupeKey }));
      return { ...r, _meta: meta("jobs.ai (Groq analysis, cached)", r.ai ? 1 : 0) };
    },
  },

  {
    name: "update_job_status",
    module: "jobs",
    risk: "write",
    description:
      "Kisi job ka status badlo aur history me record karo. " +
      "Use for: 'mark X as applied', 'I got an interview at Y', 'ignore this job'.",
    schema: {
      type: "object",
      properties: {
        dedupeKey: { type: "string" },
        status: {
          type: "string",
          enum: ["new", "saved", "applied", "ignored", "archived", "rejected", "interview", "offer", "accepted"],
        },
        note: { type: "string", description: "Optional note jo history me save hoga" },
      },
      required: ["dedupeKey", "status"],
    },
    run: async (a) => {
      const r = await postStatus(a);
      return { ...r, _meta: meta("jobs collection (status updated)", 1) };
    },
  },

  {
    name: "generate_resume_and_cover_letter",
    module: "documents",
    risk: "write",
    description:
      "Kisi job ke liye TAILORED resume + cover letter banao (candidate ki asli profile se). " +
      "Result cache hota hai. Use for: 'generate resume for this job', 'write a cover letter for X'.",
    schema: {
      type: "object",
      properties: {
        dedupeKey: { type: "string" },
        force: { type: "boolean", description: "true = cache ignore kar ke naya banao" },
      },
      required: ["dedupeKey"],
    },
    run: async (a) => {
      const r = await postTailor(a);
      return {
        cached: r.cached,
        tailoredCoverLetter: r.tailoredCoverLetter,
        tailoredResume: r.tailoredResume,
        _meta: meta(r.cached ? "jobs.ai cache" : "Groq (tailorResume)", 1),
      };
    },
  },
];

/* =========================================================================
   BUSINESSES  (Business Lead Finder + Website Auditor)
   ========================================================================= */
const businessTools = [
  {
    name: "search_businesses",
    module: "businesses",
    risk: "read",
    description:
      "Scan ki hui businesses me search karo. Use for: 'businesses in DHA without websites', " +
      "'restaurants in Clifton', 'businesses with WhatsApp but no email', 'high opportunity leads'. " +
      "hasWebsite=false wale sabse qeemti leads hain (unhe website chahiye).",
    schema: {
      type: "object",
      properties: {
        area: { type: "string", description: "Area naam, jaise 'Clifton', 'DHA'" },
        category: { type: "string", description: "restaurant, cafe, dental, medical, gym, salon, real_estate, software_house, other" },
        hasWebsite: { type: "string", enum: ["true", "false"], description: "'false' = website nahi hai (best leads)" },
        hasWhatsapp: { type: "string", enum: ["true"] },
        hasEmail: { type: "string", enum: ["true"] },
        minScore: { type: "number", description: "0-100 opportunity score. 60+ = high opportunity" },
        q: { type: "string", description: "Business naam search" },
        limit: { type: "number", description: "default 20" },
      },
    },
    run: async (a) => {
      const r = await listBusinesses(P({ ...a, limit: a.limit || 20 }));
      return {
        total: r.total,
        showing: r.count,
        businesses: (r.businesses || []).map(slimBusiness),
        _meta: meta("businesses collection (search_businesses)", r.total),
      };
    },
  },

  {
    name: "business_stats",
    module: "businesses",
    risk: "read",
    description:
      "Business pipeline ke numbers: total, bina website wale, kharab website wale, email/WhatsApp wale, " +
      "high-opportunity, aur area/category breakdown. Use for: 'business stats', 'which area has most leads'.",
    schema: { type: "object", properties: {} },
    run: async () => {
      const r = await businessStats();
      return { ...r, _meta: meta("businesses collection (business_stats)", r.total) };
    },
  },

  {
    name: "get_business_contacts",
    module: "businesses",
    risk: "read",
    description:
      "Ek business ke saare contact details (email, phone, WhatsApp, socials) confidence ke saath. " +
      "Business ka Mongo _id chahiye (search_businesses se milta hai).",
    schema: {
      type: "object",
      properties: { id: { type: "string", description: "Business ka 24-char Mongo _id" } },
      required: ["id"],
    },
    run: async (a) => {
      const r = await getContacts(a.id);
      return { ...r, _meta: meta("businesses.contacts", (r.contacts || []).length) };
    },
  },

  {
    name: "scan_area",
    module: "businesses",
    risk: "write",
    description:
      "Kisi naye AREA me businesses dhoondo (Google Maps scrape → audit → score → save). " +
      "Ye BACKGROUND me chalta hai aur waqt leta hai. Use for: 'find businesses in Gulshan', " +
      "'scan DHA for leads'. Note: ye area-wide scan hai — niche filter baad me search_businesses se karo.",
    schema: {
      type: "object",
      properties: {
        area: { type: "string", description: "Area naam, jaise 'Clifton'" },
        max: { type: "number", description: "Kitni businesses (1-60, default 20)" },
      },
      required: ["area"],
    },
    run: async (a) => {
      const r = startScan({ area: a.area, max: a.max || 20 });
      return {
        ...r,
        note: "Scan background me chal raha hai. Progress ke liye check_scan use karo.",
        _meta: meta("leadfinder scanArea (background)", 0),
      };
    },
  },

  {
    name: "check_scan",
    module: "businesses",
    risk: "read",
    description: "Chalte hue area-scan ka status dekho (scan_area ne jo scanId diya tha).",
    schema: {
      type: "object",
      properties: { scanId: { type: "string" } },
      required: ["scanId"],
    },
    run: async (a) => {
      const r = getScan(a.scanId);
      return { ...r, _meta: meta("in-memory scan state", 1) };
    },
  },

  {
    name: "audit_website",
    module: "businesses",
    risk: "read",
    description:
      "Kisi website ka quality audit karo: HTTPS, mobile-friendly, purana copyright, table layout, " +
      "Flash, kam content. Returns quality (none/outdated/ok) + wajuhaat. " +
      "Use for: 'audit example.com', 'is this website outdated', 'generate website audit'.",
    schema: {
      type: "object",
      properties: { website: { type: "string", description: "Poora URL, jaise https://example.com" } },
      required: ["website"],
    },
    run: async (a) => {
      const r = await auditWebsite(a.website);
      return {
        website: a.website,
        quality: r.quality,
        problems: r.reasons,
        _meta: meta("websiteAudit (live fetch)", (r.reasons || []).length),
      };
    },
  },

  {
    name: "research_business",
    module: "businesses",
    risk: "read",
    description:
      "Kisi business ki DEEP research: website status/quality, tech stack, socials, emails, phones, " +
      "contact form, online presence score, gaps, AI summary aur outreach angle. " +
      "30 din cache hoti hai. Proposal/outreach likhne se PEHLE ye chalao — isse asli data milta hai.",
    schema: {
      type: "object",
      properties: {
        businessName: { type: "string" },
        website: { type: "string" },
        city: { type: "string" },
        niche: { type: "string" },
      },
      required: ["businessName"],
    },
    run: async (a) => {
      const r = await researchBusiness(a);
      return {
        businessName: r.businessName,
        website: r.website,
        websiteStatus: r.websiteStatus,
        websiteQuality: r.websiteQuality,
        problems: r.auditReasons,
        techStack: r.techStack,
        socials: r.socials,
        emails: r.emails,
        phones: r.phones,
        onlinePresenceScore: r.onlinePresenceScore,
        presenceGaps: r.presenceGaps,
        industry: r.industry,
        summary: r.aiSummary,
        outreachAngle: r.aiAngle,
        _meta: meta("research collection + live scrape", 1),
      };
    },
  },
];

/* =========================================================================
   OUTREACH  (AI Outreach Engine + CRM)
   ========================================================================= */
const outreachTools = [
  {
    name: "outreach_queue",
    module: "outreach",
    risk: "read",
    description:
      "Wo messages dekho jo approval ka intezaar kar rahe hain (ya kisi bhi status me). " +
      "Use for: 'what's pending approval', 'show me draft messages', 'what's ready to send'.",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Comma-separated: draft,approved,queued,sent,delivered,replied,bounced,rejected" },
        channel: { type: "string", enum: ["email", "contact_form", "whatsapp", "linkedin", "facebook", "instagram", "manual"] },
        campaign: { type: "string" },
        limit: { type: "number", description: "default 20" },
      },
    },
    run: async (a) => {
      const r = await listQueue(P({ ...a, limit: a.limit || 20 }));
      return {
        count: r.count,
        messages: (r.messages || []).map(slimMessage),
        _meta: meta("messages collection (outreach_queue)", r.count),
      };
    },
  },

  {
    name: "outreach_stats",
    module: "outreach",
    risk: "read",
    description:
      "Outreach pipeline ka overview: status breakdown, kitne approval pending, kitne send ke liye ready, " +
      "kitne replies pending, kitne campaigns active.",
    schema: { type: "object", properties: {} },
    run: async () => {
      const r = await outreachStats();
      return { ...r, _meta: meta("messages + replies collections", r.pendingApproval || 0) };
    },
  },

  {
    name: "outreach_analytics",
    module: "analytics",
    risk: "read",
    description:
      "Outreach ka poora funnel + performance: sent, delivered, bounce rate, open rate, reply rate, " +
      "positive/negative replies, BEST SUBJECT LINES, aur best send times. " +
      "Use for: 'how is my outreach performing', 'what's my reply rate', 'best subject line', " +
      "'has reply rate dropped'.",
    schema: {
      type: "object",
      properties: { campaign: { type: "string", description: "Optional — sirf ek campaign ka" } },
    },
    run: async (a) => {
      const r = await getAnalytics(P(a));
      return { ...r, _meta: meta("messages + replies aggregates", r.emailsSent || 0) };
    },
  },

  {
    name: "list_replies",
    module: "outreach",
    risk: "read",
    description:
      "Aaye hue replies dekho, AI classification ke saath (interested, meeting_request, quote_request, " +
      "not_interested, …) aur suggested reply. " +
      "Use for: 'who replied', 'show interested leads', 'anyone asking for pricing', 'clients who requested pricing'.",
    schema: {
      type: "object",
      properties: {
        classification: {
          type: "string",
          description: "interested, not_interested, need_info, meeting_request, quote_request, auto_reply, out_of_office, spam",
        },
        status: { type: "string", enum: ["new", "approved", "sent", "dismissed"] },
      },
    },
    run: async (a) => {
      const r = await listReplies(P(a));
      return {
        count: r.count,
        replies: (r.replies || []).map(slimReply),
        _meta: meta("replies collection", r.count),
      };
    },
  },

  {
    name: "approve_message",
    module: "outreach",
    risk: "write",
    description:
      "Kisi draft message ko approve karo taake wo send queue me chala jaye. " +
      "Ye KHUD SE SEND NAHI karta — sirf approve karta hai (dispatch alag chalta hai).",
    schema: {
      type: "object",
      properties: { id: { type: "string", description: "Message ka Mongo _id" } },
      required: ["id"],
    },
    run: async (a) => {
      const r = await approveMessage(a);
      return { ...r, _meta: meta("messages collection (approved)", 1) };
    },
  },

  {
    name: "reject_message",
    module: "outreach",
    risk: "write",
    description: "Kisi draft message ko reject karo (send nahi hoga).",
    schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    run: async (a) => {
      const r = await rejectMessage(a);
      return { ...r, _meta: meta("messages collection (rejected)", 1) };
    },
  },

  {
    name: "edit_message",
    module: "outreach",
    risk: "write",
    description: "Kisi draft message ka subject/body edit karo (send hone se pehle).",
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        previewText: { type: "string" },
      },
      required: ["id"],
    },
    run: async (a) => {
      const r = await editMessage(a);
      return { ...r, _meta: meta("messages collection (edited)", 1) };
    },
  },

  {
    name: "send_reply",
    module: "outreach",
    // ⚠️ SEND — asli insaan ko asli email jayega. Hamesha confirmation.
    risk: "send",
    description:
      "Kisi reply ka jawab ASLI ME BHEJO (AI ka suggestedReply email kar do). " +
      "⚠️ Ye asli email bhejta hai jo wapas nahi ho sakta — user ki explicit confirmation ke baad hi.",
    schema: {
      type: "object",
      properties: { id: { type: "string", description: "Reply ka Mongo _id" } },
      required: ["id"],
    },
    run: async (a) => {
      const r = await sendReply(a);
      return { ...r, _meta: meta("SMTP send (irreversible)", 1) };
    },
  },

  {
    name: "dismiss_reply",
    module: "outreach",
    risk: "write",
    description: "Kisi reply ko dismiss karo (koi jawab nahi dena).",
    schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    run: async (a) => {
      const r = await dismissReply(a);
      return { ...r, _meta: meta("replies collection (dismissed)", 1) };
    },
  },

  {
    name: "list_campaigns",
    module: "campaigns",
    risk: "read",
    description: "Saare outreach campaigns dekho — audience, style, schedule, status aur stats ke saath.",
    schema: { type: "object", properties: {} },
    run: async () => {
      const r = await listCampaigns();
      return { campaigns: r.campaigns, _meta: meta("campaigns collection", (r.campaigns || []).length) };
    },
  },

  {
    name: "upsert_campaign",
    module: "campaigns",
    risk: "write",
    description:
      "Campaign banao ya update karo (audience filters, tone, channels). " +
      "Use for: 'create a campaign for restaurants in DHA', 'save this as a campaign'.",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Slug naam, jaise 'dha-restaurants'" },
        label: { type: "string", description: "Insaani naam" },
        goal: { type: "string" },
        status: { type: "string", enum: ["draft", "active", "paused", "completed"] },
        audience: {
          type: "object",
          description: "{ leadType: JOB|SERVICE|ANY, minScore, niches[], cities[], websiteQuality[] }",
        },
        style: {
          type: "object",
          description: "{ tone: friendly|professional|casual|corporate, variants: 1-3, channels[] }",
        },
      },
      required: ["name"],
    },
    run: async (a) => {
      const r = await upsertCampaign(a);
      return { campaign: r.campaign, _meta: meta("campaigns collection (upserted)", 1) };
    },
  },

  {
    name: "set_campaign_status",
    module: "campaigns",
    risk: "write",
    description: "Campaign ko active/paused/draft/completed karo. Use for: 'pause the X campaign'.",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        status: { type: "string", enum: ["draft", "active", "paused", "completed"] },
      },
      required: ["name", "status"],
    },
    run: async (a) => {
      const r = await setCampaignStatus(a);
      return { ...r, _meta: meta("campaigns collection", 1) };
    },
  },

  {
    name: "draft_outreach_email",
    module: "outreach",
    risk: "read",
    description:
      "Kisi business ke liye personalized outreach email ka DRAFT banao (bhejta NAHI). " +
      "Business ki research automatically use hoti hai. " +
      "Use for: 'write an email to ABC company', 'generate follow-up for X', 'draft a proposal email'.",
    schema: {
      type: "object",
      properties: {
        businessName: { type: "string" },
        website: { type: "string" },
        email: { type: "string" },
        city: { type: "string" },
        niche: { type: "string" },
        leadType: { type: "string", enum: ["JOB", "SERVICE"], description: "JOB = job application, SERVICE = agency pitch" },
      },
      required: ["businessName"],
    },
    run: async (a) => {
      const r = await buildEmailForLead(a);
      return {
        subject: r.subject,
        body: r.body,
        leadType: r.leadType,
        note: "Ye sirf DRAFT hai — bheja nahi gaya.",
        _meta: meta("Groq (router → personalizer/jobEmail)", 1),
      };
    },
  },
];

/* =========================================================================
   ANALYTICS / CROSS-MODULE  (Dashboard + global search)
   ========================================================================= */
const analyticsTools = [
  {
    name: "dashboard_summary",
    module: "analytics",
    risk: "read",
    description:
      "Poore platform ka ek nazar me haal: aaj kitni jobs mili, kitni apply hui, kitni businesses, " +
      "kitni bina website, kitne emails gaye, kitne replies, bounce rate, reply rate, system health. " +
      "Use for: 'show today's analytics', 'how's everything going', 'give me an overview'.",
    schema: { type: "object", properties: {} },
    run: async () => {
      const r = await getSummary();
      return { ...r, _meta: meta("all collections (dashboard summary)", 0) };
    },
  },

  {
    name: "recent_activity",
    module: "analytics",
    risk: "read",
    description:
      "Recent activity timeline — jobs, businesses, outreach aur replies sab mila ke, naya pehle. " +
      "Use for: 'what happened recently', 'recent activity', 'what's new'.",
    schema: {
      type: "object",
      properties: { limit: { type: "number", description: "default 20, max 100" } },
    },
    run: async (a) => {
      const r = await getActivity(P({ limit: a.limit || 20 }));
      return { activity: r.activity, _meta: meta("cross-module activity feed", (r.activity || []).length) };
    },
  },

  {
    name: "get_insights",
    module: "analytics",
    risk: "read",
    description:
      "Data se nikle hue insights: best send time, best area for no-website leads, most requested skill, " +
      "strong-match jobs, top skills, top companies, reply breakdown. Ye rule-based hai (AI guess nahi).",
    schema: { type: "object", properties: {} },
    run: async () => {
      const r = await getInsights();
      return { ...r, _meta: meta("aggregates across jobs/businesses/replies", (r.insights || []).length) };
    },
  },

  {
    name: "global_search",
    module: "analytics",
    risk: "read",
    description:
      "SAB kuch me ek saath search karo — jobs, businesses, leads, replies. " +
      "Jab pata na ho cheez kis module me hai to ye use karo. " +
      "Use for: 'find everything about ABC company', 'search for Ahmed'.",
    schema: {
      type: "object",
      properties: { q: { type: "string", description: "Search text" } },
      required: ["q"],
    },
    run: async (a) => {
      const r = await globalSearch(P({ q: a.q }));
      return { ...r, _meta: meta("global search (jobs+businesses+leads+replies)", r.count) };
    },
  },

  {
    name: "count_records",
    module: "analytics",
    risk: "read",
    description:
      "Kisi bhi collection me MongoDB filter laga ke ginti karo — jab pehle se bana koi tool " +
      "tumhara sawaal cover na kare. Use for: unusual counting questions. " +
      "Filter plain MongoDB query object hai.",
    schema: {
      type: "object",
      properties: {
        collection: { type: "string", enum: ["jobs", "businesses", "leads"] },
        filter: { type: "object", description: "MongoDB query object, jaise {\"hasWebsite\": false, \"area\": \"DHA\"}" },
      },
      required: ["collection"],
    },
    run: async (a) => {
      const MODELS = { jobs: Job, businesses: Business, leads: Lead };
      const M = MODELS[a.collection];
      if (!M) throw new Error(`Unknown collection: ${a.collection}`);
      const filter = sanitizeFilter(a.filter || {});
      const n = await M.countDocuments(filter);
      return { collection: a.collection, filter, count: n, _meta: meta(`${a.collection} countDocuments`, n) };
    },
  },
];

/* =========================================================================
   REGISTRY
   ========================================================================= */
export const TOOLS = [...jobTools, ...businessTools, ...outreachTools, ...analyticsTools];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** Groq/OpenAI function-calling format me tool definitions (role ke hisaab se filtered) */
export function toolSchemas(allowedNames = null) {
  return TOOLS.filter((t) => !allowedNames || allowedNames.includes(t.name)).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.schema },
  }));
}

/* -------------------------------------------------------------------------
   Payload slimming — AI ko poore Mongo docs bhejna token jala deta hai aur
   context bhar deta hai. Sirf wo fields bhejte hain jo faisla lene ke liye
   zaroori hain (+ id/key taake agla tool call ho sake).
   ------------------------------------------------------------------------- */
const slimJob = (j) => ({
  dedupeKey: j.dedupeKey,
  title: j.title,
  company: j.company,
  location: j.location,
  workMode: j.workMode,
  seniority: j.seniority,
  salary: j.salary || (j.salaryMin ? `${j.salaryCurrency || ""}${j.salaryMin}-${j.salaryMax || ""}` : null),
  matchScore: j.ai?.matchScore ?? null,
  verdict: j.ai?.verdict ?? null,
  missingSkills: j.ai?.missingSkills?.slice(0, 5) ?? [],
  skills: (j.skills || []).slice(0, 8),
  status: j.status,
  experienceRequired: j.experienceRequired,
  url: j.url,
});

const slimBusiness = (b) => ({
  id: String(b._id),
  businessName: b.businessName,
  area: b.area,
  city: b.city,
  category: b.ourCategory,
  hasWebsite: b.hasWebsite,
  website: b.website || null,
  websiteQuality: b.websiteQuality,
  problems: (b.websiteProblems || []).slice(0, 4),
  hasEmail: b.hasEmail,
  hasWhatsapp: b.hasWhatsapp,
  score: b.score,
  scoreReasons: (b.scoreReasons || []).slice(0, 3),
  rating: b.rating,
  reviews: b.reviews,
});

const slimMessage = (m) => ({
  id: String(m._id),
  channel: m.channel,
  status: m.status,
  subject: m.subject,
  preview: (m.body || "").slice(0, 180),
  step: m.step,
  variant: m.variant,
  requiresApproval: m.requiresApproval,
  business: m.lead?.businessName || m.lead?.company || null,
  to: m.lead?.email || null,
  campaign: m.campaign,
});

const slimReply = (r) => ({
  id: String(r._id),
  from: r.from,
  subject: r.subject,
  classification: r.classification,
  sentiment: r.sentiment,
  confidence: r.confidence,
  summary: r.summary,
  suggestedReply: (r.suggestedReply || "").slice(0, 400),
  status: r.status,
  business: r.lead?.businessName || r.lead?.company || null,
  receivedAt: r.receivedAt,
});

/**
 * count_records ka filter user-influenced hai (AI ne banaya, jo user ke text se
 * bana). Mongo operators jaise $where / $function server pe code chala sakte
 * hain — unhe kaat do. Baaki query operators theek hain.
 */
function sanitizeFilter(f) {
  const BAD = new Set(["$where", "$function", "$accumulator", "$expr"]);
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (BAD.has(k)) continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(f);
}

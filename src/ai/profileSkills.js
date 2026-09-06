/**
 * ACTIVE PROFILE SKILLS — job matching ke liye tumhari asli CV ka skill-set.
 *
 * KYUN: pehle jobFilter.js me ek HARDCODED skill list (STACK) thi. Ab matching
 * tumhari asli CV (CareerProfile.parsed.skills) se hoti hai — jo `npm run parse-cv`
 * se aati hai. Multi-profile: default CareerProfile use hota hai (baad me user
 * kisi bhi profile ke against match kar sakega).
 *
 * FALLBACK: agar DB me koi CareerProfile na ho (ya DB off ho), to ai/profile.js
 * ka hardcoded PROFILE use hota hai — taake purana flow kabhi na tootay.
 */
import { CareerProfile } from "../db/CareerProfile.js";
import { PROFILE } from "./profile.js";

// market me common-demand skills — job me mile par profile me na ho to "missing
// keyword" (gap) flag hota hai (daily CV advisor + tailoring ke liye signal).
export const MARKET_SKILLS = [
  "react", "next", "node", "express", "nestjs", "mongodb", "typescript", "javascript",
  "redux", "graphql", "postgres", "postgresql", "mysql", "prisma", "tailwind",
  "docker", "kubernetes", "aws", "gcp", "azure", "ci/cd", "github actions", "jenkins",
  "redis", "kafka", "rabbitmq", "microservices", "rest", "grpc", "websocket",
  "react native", "flutter", "vue", "angular", "svelte", "three.js",
  "jest", "cypress", "playwright", "testing", "python", "django", "fastapi",
  "php", "laravel", "c#", ".net", "java", "spring", "go", "rust",
  "firebase", "supabase", "stripe", "oauth", "jwt", "webpack", "vite",
];

let _cache = null; // ek run me baar baar DB hit na ho

/**
 * Active (default) CareerProfile ka matching context lao.
 * @returns {Promise<{name, skills:string[], targetRoles:string[], seniority, source}>}
 */
export async function getMatchProfile() {
  if (_cache) return _cache;
  try {
    const p =
      (await CareerProfile.findOne({ isDefault: true, active: true }).lean()) ||
      (await CareerProfile.findOne({ active: true }).sort({ updatedAt: -1 }).lean());
    if (p && p.parsed && (p.parsed.skills || []).length) {
      _cache = {
        name: p.name,
        skills: dedupe([...(p.parsed.skills || []), ...(p.parsed.technologies || [])]),
        targetRoles: p.parsed.targetRoles || [],
        seniority: p.parsed.seniority || "junior",
        source: "career-profile",
      };
      return _cache;
    }
  } catch {
    /* DB off / model missing -> fallback niche */
  }
  // fallback: hardcoded PROFILE (purana behaviour)
  _cache = {
    name: PROFILE.title || "default",
    skills: dedupe((PROFILE.skills || []).map((s) => s.toLowerCase())),
    targetRoles: [],
    seniority: "junior",
    source: "hardcoded-profile",
  };
  return _cache;
}

/** cache reset (tests / long-running process ke liye) */
export function _resetProfileCache() {
  _cache = null;
}

// skill aliases -> canonical (taake postgres/postgresql, node/nodejs, next/nextjs
// alag count na hon). Comparison se pehle dono taraf canonicalize hota hai.
const ALIAS = {
  postgres: "postgresql", psql: "postgresql",
  nodejs: "node", "node.js": "node",
  nextjs: "next", "next.js": "next",
  nestjs: "nest", "nest.js": "nest",
  reactjs: "react", "react.js": "react",
  js: "javascript", ts: "typescript",
  "github actions": "ci/cd", cicd: "ci/cd",
  gcp: "google cloud", "amazon web services": "aws",
};
const canon = (s) => {
  const k = String(s || "").toLowerCase().trim();
  return ALIAS[k] || k;
};

/**
 * Job text ko profile ke against match karo (keyword-based, fast, no AI cost).
 * @param {string} jobText - jobTitle + jobDescription
 * @param {object} profile - getMatchProfile() ka output
 * @returns {{ matched:string[], missing:string[], matchPct:number }}
 */
export function matchAgainstProfile(jobText = "", profile = { skills: [] }) {
  const t = jobText.toLowerCase();
  const mine = new Set(profile.skills.map(canon));

  // job me tumhari kaunsi skills mention hui (matched)
  const matched = dedupe(profile.skills.filter((s) => t.includes(String(s).toLowerCase())));

  // job me demand hui market-skills jo profile me NAHI (missing / gap) — alias-aware
  const missing = dedupe(
    MARKET_SKILLS.filter((s) => t.includes(s.toLowerCase()) && !mine.has(canon(s)))
  );

  // match % — job me mile market-skills me se kitni tumhare paas hain (alias-aware)
  const jobSkills = dedupe(MARKET_SKILLS.filter((s) => t.includes(s.toLowerCase())).map(canon));
  const have = jobSkills.filter((s) => mine.has(s)).length;
  const matchPct = jobSkills.length ? Math.round((have / jobSkills.length) * 100) : 0;

  return { matched, missing, matchPct };
}

function dedupe(arr) {
  return [...new Set((arr || []).map((s) => String(s || "").trim()).filter(Boolean))];
}

/**
 * PERMISSIONS + RISK GATING — Task 8, Phase 12.
 *
 * Do alag cheezein hain, dono zaroori:
 *
 *   ROLE  — tum kaun ho (admin/manager/sales/recruiter/viewer). Kaunse MODULES
 *           chhoo sakte ho aur kis had tak.
 *   RISK  — tool khud kitna khatarnak hai:
 *             read  → sirf parhta hai. Bilkul safe.
 *             write → DB badalta hai (status, campaign). Wapas ho sakta hai.
 *             send  → BAHAR duniya me kuch bhejta hai (asli insaan ko email).
 *                     Ye WAPAS NAHI ho sakta.
 *
 * Ahem faisla: `send` tools ADMIN ke liye bhi hamesha confirmation maangte hain.
 * Role sirf ye tay karta hai ke tum confirm karne ke QAABIL ho ya nahi — koi bhi
 * role AI ko bina poochhe asli email bhejne nahi deta. AI ka galat samajhna
 * (ya prompt injection) tumhare client ko ghalat email bhej de — ye risk uthane
 * layak nahi hai.
 */

export const ROLES = ["admin", "manager", "sales", "recruiter", "viewer"];

/* Har role kaunse modules use kar sakta hai + max risk level */
const MATRIX = {
  admin: {
    label: "Admin",
    modules: ["jobs", "businesses", "outreach", "analytics", "campaigns", "documents", "system"],
    maxRisk: "send",
  },
  manager: {
    label: "Manager",
    modules: ["jobs", "businesses", "outreach", "analytics", "campaigns", "documents"],
    maxRisk: "send",
  },
  sales: {
    // sales business/outreach dekhta hai — job-hunt uska kaam nahi
    label: "Sales",
    modules: ["businesses", "outreach", "analytics", "campaigns", "documents"],
    maxRisk: "send",
  },
  recruiter: {
    // recruiter sirf job-hunt side
    label: "Recruiter",
    modules: ["jobs", "analytics", "documents"],
    maxRisk: "write",
  },
  viewer: {
    label: "Viewer",
    modules: ["jobs", "businesses", "outreach", "analytics", "campaigns"],
    maxRisk: "read",
  },
};

const RISK_ORDER = { read: 0, write: 1, send: 2 };

export function roleInfo(role) {
  return MATRIX[role] || MATRIX.viewer;
}

/**
 * Kya ye role ye tool chala sakta hai?
 * @returns {{ok:boolean, reason?:string, needsConfirm?:boolean}}
 */
export function checkPermission(tool, role = "admin") {
  const info = roleInfo(role);

  if (!info.modules.includes(tool.module)) {
    return {
      ok: false,
      reason: `"${info.label}" role ko ${tool.module} module ki ijazat nahi hai.`,
    };
  }

  if (RISK_ORDER[tool.risk] > RISK_ORDER[info.maxRisk]) {
    return {
      ok: false,
      reason: `"${info.label}" role sirf ${info.maxRisk}-level actions kar sakta hai; "${tool.name}" ${tool.risk}-level hai.`,
    };
  }

  // send-risk = hamesha insaani confirmation (role chahe admin hi ho)
  return { ok: true, needsConfirm: tool.risk === "send" };
}

/** UI/prompt ke liye — is role ko kya kya mil raha hai */
export function describeRole(role = "admin") {
  const i = roleInfo(role);
  return `${i.label} — modules: ${i.modules.join(", ")} · max action level: ${i.maxRisk}`;
}

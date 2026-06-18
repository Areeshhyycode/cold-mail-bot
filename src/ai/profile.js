/**
 * CANDIDATE PROFILE — JOB application emails ke liye "tum kaun ho" ki info.
 *
 * Service outreach (agency) ki sender identity offers.js me hai; ye file uske
 * personal/job-seeker pehlu ko define karti hai: skills, experience, CV, links.
 *
 * CV attach karne ke liye:
 *   - apni CV PDF repo me rakho (default path: assets/cv.pdf)
 *   - ya .env me CV_PATH=... set karo
 * Agar file mojood na ho to email bina attachment ke chala jata hai (link rehta hai).
 */
import path from "path";
import fs from "fs";

const links = {
  Portfolio: process.env.PORTFOLIO_URL || "https://portfolio-szj4.vercel.app/",
  GitHub: process.env.GITHUB_URL || "https://github.com/Areeshhyycode",
  LinkedIn: process.env.LINKEDIN_URL || "https://www.linkedin.com/in/areesha-rafiq-net/",
};

export const PROFILE = {
  name: process.env.CANDIDATE_NAME || process.env.SENDER_NAME || "Areesha Rafiq",
  title: process.env.CANDIDATE_TITLE || "Full Stack Developer (MERN Stack)",
  location: process.env.CANDIDATE_LOCATION || "Karachi, Pakistan (open to remote)",

  // AI ko context dene ke liye — yahi tumhari "pitch" ban-ti hai (CV se real data)
  summary:
    process.env.CANDIDATE_SUMMARY ||
    "Full-Stack Developer (MERN) with hands-on experience building scalable web and mobile applications using the MERN stack, Next.js, NestJS, and React Native. Experienced in shipping AI-powered features through Groq and OpenAI integrations, with a strong focus on performance, scalability, and user experience.",

  skills: [
    "JavaScript / React.js / Next.js 14 (App Router)",
    "Node.js, Express.js, NestJS",
    "MongoDB / Mongoose / PostgreSQL",
    "React Native (Expo, iOS & Android)",
    "Redux Toolkit, Context API, Socket.io",
    "AI/LLM integration (Groq, OpenAI, LLaMA 3.3 70B)",
    "REST APIs, JWT/OAuth, NextAuth.js",
    "Tailwind CSS, Framer Motion",
    "Git, GitHub Actions (CI/CD), Vercel",
  ],

  // real, concrete highlights (CV ke experience + projects se)
  highlights: [
    "Built ZVTalent, an AI hiring platform (Next.js + MongoDB + Groq/LLaMA 3.3) that auto-reads resumes and scores candidates against job descriptions",
    "Built JobGenie AI, an AI job-application tracker with match-scoring, tailored cover letters, and a real-time analytics dashboard",
    "Full-stack experience at Nexal IT Services & Zero Vertical Labs — React/Next.js/Angular frontends, Node/Express/NestJS APIs, MongoDB, and cross-platform React Native apps",
    "Designed end-to-end CI/CD automation with GitHub Actions (e.g. a fully automated daily content generator + deploy pipeline)",
  ],

  // ye roles target kar rahe hain (intent.js ke saath align)
  targetRoles: [
    "Full Stack Developer",
    "MERN Stack Developer",
    "Next.js Developer",
    "Nest.js Developer",
    "React / Frontend Developer",
    "Node.js / Backend Developer",
    "React Native Developer",
    "Junior Developer / Internship",
  ],

  links,

  // CV attachment ka resolved path (repo root se). File na ho to sender skip kar dega.
  cvPath: path.resolve(process.cwd(), process.env.CV_PATH || "assets/cv.pdf"),
  cvFileName: process.env.CV_FILENAME || "CV.pdf",
};

export function getProfile() {
  return PROFILE;
}

/**
 * CV attachment array (nodemailer format) — agar CV file mojood ho.
 * File na ho to khali array (email bina attachment ke chala jata hai).
 * @returns {Array<{filename:string, path:string}>}
 */
export function getCvAttachment() {
  try {
    if (fs.existsSync(PROFILE.cvPath)) {
      return [{ filename: PROFILE.cvFileName, path: PROFILE.cvPath }];
    }
  } catch {
    /* ignore */
  }
  return [];
}

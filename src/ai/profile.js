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
  Portfolio: process.env.PORTFOLIO_URL || "https://portfolio-delta-ruddy-88.vercel.app/",
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
    "JavaScript / React.js / Next.js 14 (App Router) / Vue / Angular / Svelte",
    "Node.js, Express.js, NestJS, PHP, Laravel, C#, ASP.NET",
    "MongoDB / Mongoose / PostgreSQL / Firebase Firestore",
    "React Native (Expo), Flutter — cross-platform mobile",
    "Redux Toolkit, Context API, Three.js, Tailwind CSS, Framer Motion",
    "AI/LLM integration (Groq, OpenAI, LLaMA 3.3 70B), prompt engineering",
    "REST APIs, JWT/OAuth, NextAuth.js",
    "WordPress (theme customization, plugin integration)",
    "Git, GitHub Actions (CI/CD), Vercel, Postman",
  ],

  // real, concrete highlights (naye CV ke experience se)
  highlights: [
    "Full Stack Developer at Nexal IT Services — scalable web apps with MERN, Next.js, NestJS, Angular & WordPress; RESTful APIs, authentication, and payment integrations",
    "Junior MERN Stack Developer at Zero Vertical Labs — React/Next.js/React Native apps, Node/Express APIs, Redux Toolkit, Firebase, and OpenAI-powered features",
    "MERN Stack Developer Intern at Lokhandwala Web Solutions — built 6+ Node/Express REST endpoints with JWT auth, improved React Native performance, wrote Jest tests",
    "Full Stack Engineer on 3D simulation platforms — PHP, NestJS, Three.js, and MySQL with responsive UIs and optimized databases",
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

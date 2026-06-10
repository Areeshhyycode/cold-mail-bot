import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP_USER / SMTP_PASS .env me missing hai");
  }
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS, // Gmail App Password (normal password nahi!)
    },
  });
  return transporter;
}

const TRACK_BASE = (process.env.TRACK_BASE_URL || "").replace(/\/$/, "");

// footer ki identity line — empty parts skip (koi dangling " · " nahi)
function identityLine() {
  const name = process.env.SENDER_NAME || "Areesha Rafiq";
  const address = process.env.SENDER_ADDRESS || "Karachi, Pakistan";
  return [name, address].filter(Boolean).join(" · ");
}

// CAN-SPAM/GDPR: har email me opt-out + physical address zaroori hai
function footerText(leadId) {
  let unsub = `Don't want these emails? Just reply "unsubscribe" and I'll remove you right away.`;
  if (TRACK_BASE && leadId) {
    unsub = `Don't want these emails? Unsubscribe: ${TRACK_BASE}/unsubscribe?id=${leadId}`;
  }
  return `\n\n—\n${identityLine()}\n${unsub}`;
}

// HTML version (open-tracking pixel + clickable unsubscribe ke saath)
function buildHtml(text, leadId) {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  const pixel = `<img src="${TRACK_BASE}/api/track/open?id=${leadId}" width="1" height="1" alt="" style="display:none">`;
  const unsubLink = `<a href="${TRACK_BASE}/unsubscribe?id=${leadId}" style="color:#888">unsubscribe</a>`;
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">
${safe}
<br><br>—<br>
<span style="color:#888;font-size:12px">${identityLine()}<br>Don't want these emails? ${unsubLink}.</span>
${pixel}
</div>`;
}

/**
 * Ek email bhejta hai (unsubscribe footer + header automatic add hote hain).
 * Agar TRACK_BASE_URL set hai aur leadId diya hai, to HTML + open-tracking pixel bhejta hai.
 * @param {object} opts - { to, subject, text, leadId }
 */
export async function sendEmail({ to, subject, text, leadId }) {
  const t = getTransporter();
  const fromName = process.env.SENDER_NAME || "Areesha Rafiq";
  const sender = process.env.SMTP_USER;

  const useTracking = TRACK_BASE && leadId;
  const listUnsub = useTracking
    ? `<${TRACK_BASE}/unsubscribe?id=${leadId}>, <mailto:${sender}?subject=Unsubscribe>`
    : `<mailto:${sender}?subject=Unsubscribe>`;

  const mail = {
    from: `"${fromName}" <${sender}>`,
    to,
    subject,
    text: text + footerText(leadId),
    // List-Unsubscribe header — Gmail/Outlook isse "Unsubscribe" button dikhate hain
    headers: {
      "List-Unsubscribe": listUnsub,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  // tracking on ho to HTML bhi bhejo (pixel ke liye HTML zaroori)
  if (useTracking) mail.html = buildHtml(text, leadId);

  const info = await t.sendMail(mail);
  return info.messageId;
}

// random delay (seconds) — taaki robot na lage
export function randomDelay() {
  const min = parseInt(process.env.MIN_DELAY_SECONDS || "45", 10);
  const max = parseInt(process.env.MAX_DELAY_SECONDS || "120", 10);
  const sec = min + Math.floor(Math.random() * (max - min));
  return sec * 1000;
}

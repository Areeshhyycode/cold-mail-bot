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

// CAN-SPAM/GDPR: har email me opt-out + physical address zaroori hai
function buildFooter() {
  const sender = process.env.SMTP_USER;
  const company = process.env.SENDER_TITLE || "";
  const address = process.env.SENDER_ADDRESS || "Lahore, Pakistan";
  return (
    `\n\n—\n` +
    `${company} · ${address}\n` +
    `Don't want these emails? Just reply "unsubscribe" and I'll remove you right away.`
  );
}

/**
 * Ek email bhejta hai (unsubscribe footer + header automatic add hote hain).
 * @param {object} opts - { to, subject, text }
 */
export async function sendEmail({ to, subject, text }) {
  const t = getTransporter();
  const fromName = process.env.SENDER_NAME || "Cold Mail Bot";
  const sender = process.env.SMTP_USER;

  const info = await t.sendMail({
    from: `"${fromName}" <${sender}>`,
    to,
    subject,
    text: text + buildFooter(),
    // List-Unsubscribe header — Gmail/Outlook isse "Unsubscribe" button dikhate hain
    headers: {
      "List-Unsubscribe": `<mailto:${sender}?subject=Unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    // plain text best hai cold email ke liye (spam kam)
  });

  return info.messageId;
}

// random delay (seconds) — taaki robot na lage
export function randomDelay() {
  const min = parseInt(process.env.MIN_DELAY_SECONDS || "45", 10);
  const max = parseInt(process.env.MAX_DELAY_SECONDS || "120", 10);
  const sec = min + Math.floor(Math.random() * (max - min));
  return sec * 1000;
}

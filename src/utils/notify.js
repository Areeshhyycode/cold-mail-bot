import dotenv from "dotenv";
import nodemailer from "nodemailer";
dotenv.config();

/**
 * Notification bhejta hai. DEFAULT: apne Gmail pe email (zero setup — Gmail already connected).
 * Phone pe Gmail app ki notification aa jayegi.
 *
 * Optional (chaaho to): Telegram / WhatsApp bhi — par zaroori nahi.
 */
export async function notify(message, subject = "🎉 Cold Mail Bot — Reply aaya!") {
  let sent = false;
  if (await sendSelfEmail(message, subject)) sent = true; // default
  if (await sendTelegram(message)) sent = true; // agar set ho
  if (await sendWhatsApp(message)) sent = true; // agar set ho
  return sent;
}

// apne aap ko email bhejo (notification ke liye) — koi extra setup nahi
let mailTransporter;
async function sendSelfEmail(message, subject) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return false;
  try {
    if (!mailTransporter) {
      mailTransporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
    const to = process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
    await mailTransporter.sendMail({
      from: `"Cold Mail Bot 🔔" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: message,
    });
    return true;
  } catch (err) {
    console.log("   ⚠️ Self-email notify fail:", err.message);
    return false;
  }
}

// purane code ke liye alias
export const notifyWhatsApp = notify;

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch (err) {
    console.log("   ⚠️ Telegram notify fail:", err.message);
    return false;
  }
}

async function sendWhatsApp(message) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return false;

  try {
    const url =
      `https://api.callmebot.com/whatsapp.php` +
      `?phone=${encodeURIComponent(phone)}` +
      `&text=${encodeURIComponent(message)}` +
      `&apikey=${encodeURIComponent(apikey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return res.ok;
  } catch (err) {
    console.log("   ⚠️ WhatsApp notify fail:", err.message);
    return false;
  }
}

import dotenv from "dotenv";
dotenv.config();

/**
 * Notification bhejta hai — Telegram (preferred) ya WhatsApp (CallMeBot).
 * Jo bhi configure hoga, usse bhej dega. Dono ho to dono pe.
 *
 * ---- TELEGRAM SETUP (1 min, reliable + instant) ----
 *   1. Telegram me @BotFather kholo -> /newbot -> naam do -> BOT TOKEN milega
 *   2. Apne naye bot ko koi bhi message bhejo (jaise "hi")
 *   3. Apna CHAT ID lene ke liye @userinfobot ko message karo -> wo ID dega
 *   4. .env me daalo:
 *        TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
 *        TELEGRAM_CHAT_ID=123456789
 *
 * ---- WHATSAPP SETUP (CallMeBot, optional) ----
 *        WHATSAPP_PHONE=92300...   CALLMEBOT_APIKEY=...
 */
export async function notify(message) {
  let sent = false;
  if (await sendTelegram(message)) sent = true;
  if (await sendWhatsApp(message)) sent = true;
  return sent;
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

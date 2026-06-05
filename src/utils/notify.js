import dotenv from "dotenv";
dotenv.config();

/**
 * WhatsApp pe notification bhejta hai (CallMeBot — free).
 *
 * Setup (ek baar):
 *   1. Apne WhatsApp me +34 644 84 71 89 ko contact me add karo (naam: CallMeBot)
 *   2. Us number ko WhatsApp message bhejo: "I allow callmebot to send me messages"
 *   3. Reply me ek API key milegi
 *   4. .env me daalo:
 *        WHATSAPP_PHONE=923001234567   (country code ke saath, + ke bina)
 *        CALLMEBOT_APIKEY=123456
 *
 * Agar phone/apikey set nahi hain to chup-chaap skip kar deta hai.
 */
export async function notifyWhatsApp(message) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;

  if (!phone || !apikey) {
    return false; // setup nahi hua, skip
  }

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

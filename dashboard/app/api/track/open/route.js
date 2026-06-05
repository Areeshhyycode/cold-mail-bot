import { connectDB } from "../../../../lib/mongoose.js";
import { Lead } from "../../../../lib/Lead.js";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64"
);

/**
 * Email me <img src=".../api/track/open?id=LEADID"> hota hai.
 * Jab koi email kholta hai, ye hit hota hai aur open record hota hai.
 */
export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id");

  if (id) {
    try {
      await connectDB();
      const now = new Date();
      await Lead.updateOne(
        { _id: id },
        {
          $set: { opened: true, lastOpenedAt: now },
          $setOnInsert: {},
          $inc: { openCount: 1 },
          ...({}),
        }
      );
      // firstOpenedAt sirf pehli baar set karo
      await Lead.updateOne(
        { _id: id, firstOpenedAt: { $exists: false } },
        { $set: { firstOpenedAt: now } }
      );
    } catch {
      /* tracking fail ho to bhi pixel return karo */
    }
  }

  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

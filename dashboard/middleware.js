import { NextResponse } from "next/server";

/**
 * Dashboard ko password se protect karta hai (HTTP Basic Auth).
 * Browser ek login popup dikhayega — email + password maangega.
 *
 * Vercel pe ye 2 env vars set karo:
 *   DASH_USER=areeshazv@gmail.com
 *   DASH_PASS=yourpassword
 *
 * NOTE: tracking pixel (/api/track) aur unsubscribe (/unsubscribe) PUBLIC rehte hain
 * (warna open-tracking aur recipients ka unsubscribe kaam nahi karega).
 */
export function middleware(req) {
  const { pathname } = req.nextUrl;

  // ye routes public rehne chahiye
  if (pathname.startsWith("/api/track") || pathname.startsWith("/unsubscribe")) {
    return NextResponse.next();
  }

  const USER = process.env.DASH_USER || "admin";
  const PASS = process.env.DASH_PASS || "changeme";

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    // Edge runtime: atob use karo (Buffer nahi)
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(":");
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    if (u === USER && p === PASS) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Cold Mail Bot Dashboard"' },
  });
}

export const config = {
  // static files chhod ke baaki sab pe chale
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

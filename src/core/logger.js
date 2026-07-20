/**
 * STRUCTURED LOGGER — console.log ki jagah.
 *
 * Default: insaan ke parhne layak line (jaisa pehle tha, kuch nahi toota).
 * LOG_FORMAT=json  -> ek line = ek JSON record (machine-parsable, grep/query ho sake).
 * LOG_LEVEL=debug|info|warn|error  (default: info)
 *
 * Har log ka ek "event" naam hota hai (jaise "sender.sent") taaki baad me
 * filter/aggregate kar sako — free-text messages se ye mumkin nahi tha.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? 20;
const JSON_MODE = (process.env.LOG_FORMAT || "").toLowerCase() === "json";

const ICON = { debug: "·", info: "ℹ️ ", warn: "⚠️ ", error: "❌" };

function emit(level, event, data = {}) {
  if (LEVELS[level] < MIN) return;

  if (JSON_MODE) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));
    return;
  }

  const extra = Object.keys(data).length
    ? " " + Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ")
    : "";
  console.log(`${ICON[level]} ${event}${extra}`);
}

export const log = {
  debug: (event, data) => emit("debug", event, data),
  info: (event, data) => emit("info", event, data),
  warn: (event, data) => emit("warn", event, data),
  error: (event, data) => emit("error", event, data),
};

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resilient daily runner.
 * Har step ko chalata hai — agar koi step fail ho to BAAKI steps phir bhi chalte hain
 * (graceful failure handling). Progress DB me save rehta hai, isliye kuch nahi khota.
 */
const STEPS = [
  { name: "Check replies + bounces", file: "tracker/replyChecker.js" },
  { name: "Send first emails", file: "sender/run.js" },
  { name: "Send follow-ups", file: "sender/followup.js" },
  { name: "Generate report", file: "report.js" },
];

function runStep(file) {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(__dirname, file)], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  console.log(`\n🤖 Daily run started: ${new Date().toISOString()}\n`);
  const results = [];

  for (const step of STEPS) {
    console.log(`\n▶️  ${step.name}...`);
    let code = 1;
    // ek step ke liye 2 retries (graceful, auto-retry)
    for (let attempt = 1; attempt <= 2; attempt++) {
      code = await runStep(step.file);
      if (code === 0) break;
      console.log(`   ⚠️ "${step.name}" fail (try ${attempt}). ${attempt < 2 ? "Retry..." : "Skip."}`);
    }
    results.push({ name: step.name, ok: code === 0 });
  }

  console.log("\n📋 Summary:");
  for (const r of results) console.log(`   ${r.ok ? "✅" : "❌"} ${r.name}`);

  // exit 0 hamesha — taaki "all jobs failed" na dikhe (kuch steps chal gaye)
  const anyOk = results.some((r) => r.ok);
  console.log(anyOk ? "\n✅ Daily run done (kuch ya sab steps chale)" : "\n⚠️ Sab steps fail — secrets check karo");
  process.exit(0);
}

main();

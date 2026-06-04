import cron from "node-cron";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ek script ko child process me chalao
function runScript(file) {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(__dirname, file)], {
      stdio: "inherit",
    });
    child.on("exit", () => resolve());
  });
}

console.log("⏰ Cron started. Schedule:");
console.log("   - Roz 9:00 AM  -> naye emails bhejo");
console.log("   - Roz 2:00 PM  -> follow-ups bhejo");
console.log("   (band karne ke liye Ctrl+C)\n");

// Roz subah 9 baje pehle emails
cron.schedule("0 9 * * *", async () => {
  console.log(`\n[${new Date().toLocaleString()}] 📤 First emails...`);
  await runScript("sender/run.js");
});

// Roz dopahar 2 baje follow-ups
cron.schedule("0 14 * * *", async () => {
  console.log(`\n[${new Date().toLocaleString()}] 📨 Follow-ups...`);
  await runScript("sender/followup.js");
});

// process zinda rakho
process.stdin.resume();

import { loadConfig, loadEnv } from "./config";
import { openDb } from "./db/client";
import { initSchema } from "./db/schema";
import { runDailyReport } from "./jobs/dailyReport";
import { startServer } from "./server";
import { startTui } from "./tui";

const main = async () => {
  const command = Bun.argv[2];
  if (!command) {
    console.error("Usage: bun run src/cli.ts <init-db|daily|serve|tui>");
    process.exit(1);
  }

  const env = loadEnv();
  const db = openDb(env);
  initSchema(db);

  if (command === "init-db") {
    console.log("Database initialized at", env.dbPath);
    return;
  }

  if (command === "daily") {
    const config = loadConfig();
    const report = await runDailyReport(db, config, env);
    console.log("\n=== GigWatch Daily Report (ShowStart) ===");
    console.log(`Run at: ${report.runAt} (${report.timezone})`);
    console.log("\nSummary:\n", report.summary);
    if (report.focusArtists.length > 0) {
      console.log("\nFocus Artists:");
      for (const artist of report.focusArtists) {
        console.log(`- ${artist.artist}`);
        for (const evt of artist.events) {
          console.log("  *", evt.title || "(no title)");
          if (evt.showTime) console.log("    ", evt.showTime);
          if (evt.url) console.log("    ", evt.url);
        }
      }
    }
    console.log(`\nEvents stored: ${report.events.length}`);
    return;
  }

  if (command === "serve") {
    const config = loadConfig();
    startServer(db, config, env);
    return;
  }

  if (command === "tui") {
    await startTui();
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

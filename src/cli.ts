import { loadConfig, loadEnv } from "./config";
import { openDb } from "./db/client";
import { initSchema } from "./db/schema";
import { runDailyReport } from "./jobs/dailyReport";

const main = async () => {
  const command = Bun.argv[2];
  if (!command) {
    console.error("Usage: bun run src/cli.ts <init-db|daily>");
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
    const report = await runDailyReport(db, config);
    console.log("\n=== GigWatch Daily Report ===");
    console.log(`Run at: ${report.runAt} (${report.timezone})`);
    console.log("\nSummary:\n", report.summary);
    if (report.highlights.length > 0) {
      console.log("\nHighlights:");
      for (const item of report.highlights) {
        console.log("-", item);
      }
    }
    if (report.focusArtists.length > 0) {
      console.log("\nFocus Artists:");
      for (const artist of report.focusArtists) {
        console.log(`- ${artist.artist}`);
        for (const update of artist.updates) {
          console.log("  *", update.title || "(no title)");
          if (update.url) console.log("    ", update.url);
        }
      }
    }
    console.log(`\nProjects: ${report.projects.length}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

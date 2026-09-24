require("dotenv").config();

const { checkAllPNRs } = require("./monitor");

(async () => {
  try {
    await checkAllPNRs();
    console.log("[CRON] Monitoring run completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("[CRON] Monitoring run failed:", error);
    process.exit(1);
  }
})();

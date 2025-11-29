const {scrapeAndStore} = require('./index.js');

(async () => {
  try {
    console.log("Starting main() from GitHub Actions...");
    await scrapeAndStore();
    console.log("main() finished successfully ✅");
  } catch (err) {
    console.error("Error in main():", err);
    process.exit(1);
  }
})();
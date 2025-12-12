const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { MongoClient } = require('mongodb');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

async function scrapeContest(contestUrl) {
    console.log(`Scraping contest: ${contestUrl}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    await page.goto(contestUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    await page.waitForSelector('div.flex.cursor-pointer.items-center.justify-between');

    const contestQuestions = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div.flex.cursor-pointer.items-center.justify-between')).map(question => {
            const titleDiv = question.querySelector('div.ellipsis.text-sm.font-semibold');
            const pointsDiv = question.querySelector('div.text-xs.text-sd-muted-foreground');
            
            let problemInUrl = titleDiv ? titleDiv.innerText.trim().replace(/\s+/g, '-').toLowerCase() : 'unknown';
            
            return {
                title: titleDiv ? titleDiv.innerText.trim() : 'Unknown',
                points: pointsDiv ? parseInt(pointsDiv.innerText.trim(), 10) : 0,
                link: `https://leetcode.com/problems/${problemInUrl}/`
            };
        });
    });

    await browser.close();
    return contestQuestions;
}

async function scrapeTopics(questionLink) {
    console.log(`Scraping topics for: ${questionLink}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto(questionLink, { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(resolve => setTimeout(resolve, randomDelay(2000, 5000))); 

    const topics = await page.evaluate(() => {
        return [...document.querySelectorAll('a[href^="/tag/"]')].map(tag => tag.innerText.trim());
    });

    await browser.close();
    return topics;
}

async function scrapeAndStore() {
  console.log("Starting the full scraping process (fetch previous weekend)...");

  const WEEKLY_BASE_CONTEST = 478;
  const WEEKLY_BASE_DATE = new Date("2025-11-30T02:30:00Z"); 

  const BIWEEKLY_BASE_CONTEST = 170;
  const BIWEEKLY_BASE_DATE = new Date("2025-11-22T14:30:00Z"); 


  function prevOrSameWeekdayDate(fromDate, targetWeekday) {
    const d = new Date(fromDate.getTime()); 
    const curr = d.getUTCDay(); 
    const delta = (curr - targetWeekday + 7) % 7; 
    d.setUTCDate(d.getUTCDate() - delta);
    return d;
  }




  function weeksBetween(startDate, targetDate) {
    const diffMs = targetDate.getTime() - startDate.getTime();
    return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  }

  const now = new Date(); 
    
  const prevSunday = prevOrSameWeekdayDate(now, 0); 
  const prevSaturday = prevOrSameWeekdayDate(now, 6);  


  const weeklyWeeks = weeksBetween(WEEKLY_BASE_DATE, prevSunday);
  const weeklyNum = WEEKLY_BASE_CONTEST + Math.max(0, weeklyWeeks);

  const biWeeks = weeksBetween(BIWEEKLY_BASE_DATE, prevSaturday);
  const isBiweeklyPrevWeekend = biWeeks >= 0 && biWeeks % 2 === 0;
  const biNum = isBiweeklyPrevWeekend
    ? BIWEEKLY_BASE_CONTEST + Math.floor(biWeeks / 2)
    : null;

  const contestUrls = [];

  console.log("Run time (UTC):", now.toISOString());
  console.log("Previous Saturday (UTC):", prevSaturday.toISOString());
  console.log("Previous Sunday   (UTC):", prevSunday.toISOString());
  console.log("Computed weekly contest (from prev Sunday):", weeklyNum);

  contestUrls.push({
    url: `https://leetcode.com/contest/weekly-contest-${weeklyNum}/`,
    name: `Weekly Contest ${weeklyNum}`,
    type: "Weekly",
  });

  if (isBiweeklyPrevWeekend) {
    console.log("Previous Saturday WAS a Biweekly contest →", biNum);
    contestUrls.push({
      url: `https://leetcode.com/contest/biweekly-contest-${biNum}/`,
      name: `Biweekly Contest ${biNum}`,
      type: "Biweekly",
    });
  } else {
    console.log("Previous Saturday was NOT a biweekly contest → skipping biweekly.");
  }

  console.log("Contests to scrape (previous weekend):", contestUrls);

  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB------------------------------------");
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    for (let i = 0; i < contestUrls.length; i++) {
      const contest = contestUrls[i];
      console.log(`Scraping ${contest.name} (${i + 1}/${contestUrls.length}) — ${contest.url}`);

      try {
        const contestQuestions = await scrapeContest(contest.url);

        if (!Array.isArray(contestQuestions)) {
          console.warn("scrapeContest returned non-array for", contest.url);
          continue;
        }

        await Promise.all(
          contestQuestions.map(async (question) => {
            if (question.link) {
              try {
                question.topics = await scrapeTopics(question.link);
              } catch (err) {
                console.warn("Failed to scrape topics for", question.link, err);
                question.topics = [];
              }
            } else {
              question.topics = [];
            }
            question._scrapedFrom = contest.name;
            question._scrapedAt = new Date().toISOString();
          })
        );

        console.log(`Final Scraped Data length for ${contest.name}:`, contestQuestions.length);

        console.log("Final Scraped Data:", contestQuestions);
            for (const question of contestQuestions) {
                // Add contest metadata to each problem
                const documentToInsert = {
                    contestName: contestUrls[i].name,
                    contestType: contestUrls[i].type,
                    title: question.title,
                    link: question.link,
                    points: question.points,
                    topics: question.topics
                };
                console.log(`Preparing to insert: ${documentToInsert.title} with points: ${documentToInsert.points}`);
                console.log(documentToInsert);

                const targetCollection = db.collection(`${COLLECTION_NAME}${question.points || 0}`);
                try {
                    await targetCollection.insertOne(documentToInsert);
                    console.log(`Inserted -> ${documentToInsert.title} into ${COLLECTION_NAME}${documentToInsert.points || 0}`);

                } catch (err) {
                    console.error(`Failed to insert ${documentToInsert.title}:`, err);
                }
                await new Promise((resolve) => setTimeout(resolve, randomDelay(2000, 5000)));
            }
      } catch (contestErr) {
        console.error(`Error scraping ${contest.name} (${contest.url}):`, contestErr);
      }

      await new Promise((resolve) => setTimeout(resolve, randomDelay(5000, 15000)));
    }
  } catch (err) {
    console.error("Error in scrapeAndStore outer try:", err);
  } finally {
    await client.close();
    console.log("MongoDB connection closed---------------------------------------");
  }
}

module.exports = { scrapeAndStore };

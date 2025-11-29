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
    console.log("Starting the full scraping process...");

    let contestUrls = [];
    for (let i = 470; i <= 477; i++) {
        contestUrls.push({ url: `https://leetcode.com/contest/weekly-contest-${i}/`, name: `Weekly Contest ${i}`, type: "Weekly" });
    }
    for (let i = 160; i <= 170; i++) {
        contestUrls.push({ url: `https://leetcode.com/contest/biweekly-contest-${i}/`, name: `Biweekly Contest ${i}`, type: "Biweekly" });
    }

    const client = new MongoClient(MONGO_URI);

    try {
        await client.connect();
        console.log("Connected to MongoDB------------------------------------");
        const db = client.db(DB_NAME);
        for (let i = 0; i < contestUrls.length; i++) {
            console.log(`Scraping ${contestUrls[i].name} (${i + 1}/${contestUrls.length})`);

            const contestQuestions = await scrapeContest(contestUrls[i].url);

            await Promise.all(contestQuestions.map(async (question) => {
                if (question.link) {
                    question.topics = await scrapeTopics(question.link);
                } else {
                    question.topics = [];
                }
            }));
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
            }
            await new Promise(resolve => setTimeout(resolve, randomDelay(5000, 15000))); 
        }
    } catch (error) {
        console.error("Error:", error);
    } finally {
        await client.close();
        console.log("MongoDB connection closed---------------------------------------");
    }
}

module.exports = { scrapeAndStore };

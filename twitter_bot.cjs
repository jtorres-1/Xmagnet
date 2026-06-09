require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const SESSION_PATH = "./session.json";
const REPLIED_PATH = "./replied.json";
const LOG_PATH = "./twitter_bot.log";

const MAX_REPLIES_PER_CYCLE = 20;
const MIN_DELAY_MS = 4 * 60 * 1000;
const MAX_DELAY_MS = 7 * 60 * 1000;
const CYCLE_INTERVAL_MS = 45 * 60 * 1000;

const DEVHIRE_QUERIES = [
  "I need a web developer",
  "need a website built",
  "looking for a developer",
  "need someone to build my website",
  "need a python developer",
  "looking to hire a developer",
  "need an app built",
  "need a freelance developer",
  "need a website for my business",
  "anyone know a good web developer",
  "looking for web developer recommendations",
  "need help with my website",
];

const MAPZAP_QUERIES = [
  "need leads for my business",
  "how do I find customers",
  "need more clients for my business",
  "looking for business leads",
  "need a lead list",
  "how to find local businesses",
  "need prospects for my business",
  "struggling to find clients",
  "need more customers",
  "where to get business leads",
];

const DEV_AGENCY_SIGNALS = [
  "i offer", "i build", "i provide", "my services", "check out my",
  "i am a developer", "i specialize in", "hire me", "my portfolio",
  "i can build", "i develop", "i create websites", "i code",
  "available for hire", "for hire", "i do freelance",
  "offering my services", "i am a programmer", "i am a freelancer",
  "looking for clients", "seeking clients", "web design agency",
  "digital agency", "we build", "we develop", "we offer",
  "our services", "our portfolio", "book a call", "free consultation",
  "taking on new clients", "accepting new clients", "open for work",
  "upwork", "fiverr", "toptal",
];

const FIRST_PERSON_BUYER_SIGNALS = [
  "i need", "i'm looking", "i am looking", "i want",
  "i have a budget", "i will pay", "i need to hire",
  "i'm trying", "i need help", "i need someone",
  "how do i", "how can i", "anyone know",
  "recommendations for", "looking for recommendations",
  "can anyone", "does anyone know",
];

const DEVHIRE_REPLIES = [
  `hey, I'm a Python dev in LA available this week. built claudiascleaningla.com and mapzap.org (live SaaS with Stripe payments). websites, scrapers, bots, AI integrations. 48hr delivery, flat fee from $500. DM me a scope`,
  `hey, I build websites and automation tools. recent work: claudiascleaningla.com and mapzap.org. flat fee, 48hr turnaround, no hourly. DM me what you need`,
  `hey, available for freelance work this week. built live production projects including mapzap.org and claudiascleaningla.com. websites start at $500, automation at $800. DM me`,
];

const MAPZAP_REPLIES = [
  `hey, built something that might help. mapzap.org pulls 100 local business leads from Google Maps in 60 seconds as a CSV. name, phone, address, website. $49/month unlimited searches. free preview, no card needed`,
  `hey, mapzap.org might be what you need. type a business type and city, get 100 leads as a CSV instantly. $49/month unlimited. try 5 free first at mapzap.org`,
  `hey check out mapzap.org. pulls local business leads from Google Maps in 60 seconds. name, phone, address, website as a downloadable CSV. $49/month unlimited searches, free preview available`,
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function log(tag, msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + "\n");
}

function loadReplied() {
  if (!fs.existsSync(REPLIED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(REPLIED_PATH)); } catch { return {}; }
}

function saveReplied(replied) {
  fs.writeFileSync(REPLIED_PATH, JSON.stringify(replied, null, 2));
}

async function loadSession(page) {
  if (!fs.existsSync(SESSION_PATH)) throw new Error("No session found. Run twitter_login.cjs first.");
  const cookies = JSON.parse(fs.readFileSync(SESSION_PATH));
  await page.setCookie(...cookies);
  await page.goto("https://twitter.com/home", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(rand(3000, 5000));
  if (page.url().includes("login")) throw new Error("Session expired. Run twitter_login.cjs again.");
  log("INFO", "Session loaded.");
}

async function searchTweets(page, query) {
  log("SEARCH", `Searching: "${query}"`);
  const url = `https://twitter.com/search?q=${encodeURIComponent(query)}&f=live&src=typed_query`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(rand(3000, 5000));

  // Scroll to load tweets
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(rand(1500, 2500));
  }

  const tweets = await page.evaluate((devAgencySignals, firstPersonBuyerSignals) => {
    const results = [];
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));

    for (const article of articles) {
      const textEl = article.querySelector('[data-testid="tweetText"]');
      if (!textEl) continue;
      const text = textEl.innerText?.toLowerCase() || '';
      if (!text || text.length < 20) continue;

      // Must have buyer signal
      const isBuyer = firstPersonBuyerSignals.some(s => text.includes(s));
      if (!isBuyer) continue;

      // Must not be seller
      const isSeller = devAgencySignals.some(s => text.includes(s));
      if (isSeller) continue;

      // Get tweet URL
      const timeEl = article.querySelector('time');
      const linkEl = timeEl?.closest('a');
      const tweetUrl = linkEl ? linkEl.href : null;
      if (!tweetUrl) continue;

      // Get tweet ID from URL
      const match = tweetUrl.match(/status\/(\d+)/);
      const tweetId = match ? match[1] : null;
      if (!tweetId) continue;

      // Get author
      const authorEl = article.querySelector('[data-testid="User-Name"]');
      const author = authorEl?.innerText?.split('\n')[0] || 'unknown';

      // Check tweet age - skip if older than 24 hours
      const timeAttr = timeEl?.getAttribute('datetime');
      if (timeAttr) {
        const tweetAge = Date.now() - new Date(timeAttr).getTime();
        if (tweetAge > 24 * 60 * 60 * 1000) continue;
      }

      results.push({ tweetId, tweetUrl, author, text: text.substring(0, 200) });
    }

    return results;
  }, DEV_AGENCY_SIGNALS, FIRST_PERSON_BUYER_SIGNALS);

  log("SEARCH", `Found ${tweets.length} buyer tweets for "${query}"`);
  return tweets;
}

async function replyToTweet(page, tweet, replyText) {
  try {
    await page.goto(tweet.tweetUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(3000, 5000));

    // Click reply button
    const replyBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('[data-testid="reply"]'));
      return btns[0] || null;
    });

    const replyEl = replyBtn.asElement();
    if (!replyEl) {
      log("SKIP", `No reply button found for ${tweet.tweetId}`);
      return "no_reply_btn";
    }

    await replyEl.click();
    await sleep(rand(2000, 3000));

    // Type reply in the modal
    const typed = await page.evaluate((text) => {
      const editor = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                     document.querySelector('[contenteditable="true"][role="textbox"]');
      if (!editor) return false;
      editor.focus();
      return true;
    }, replyText);

    if (!typed) {
      log("SKIP", `Could not focus reply box for ${tweet.tweetId}`);
      return "no_editor";
    }

    await page.keyboard.type(replyText, { delay: rand(30, 60) });
    await sleep(rand(2000, 3000));

    // Click reply/send button
    const sent = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[data-testid="tweetButton"]'));
      const sendBtn = btns.find(b => b.innerText?.trim().toLowerCase() === 'reply' && b.offsetParent !== null);
      if (sendBtn) { sendBtn.click(); return true; }
      return false;
    });

    if (!sent) {
      log("ERROR", `Could not click send for ${tweet.tweetId}`);
      return "no_send_btn";
    }

    await sleep(rand(3000, 5000));
    log("REPLIED", `@${tweet.author} — ${tweet.tweetUrl}`);
    return "replied";

  } catch (err) {
    log("ERROR", `Reply failed for ${tweet.tweetId}: ${err.message}`);
    return "error";
  }
}

async function runCycle() {
  const replied = loadReplied();
  let repliesThisCycle = 0;

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  try {
    await loadSession(page);

    const allQueries = [
      ...DEVHIRE_QUERIES.map(q => ({ query: q, type: "DEVHIRE" })),
      ...MAPZAP_QUERIES.map(q => ({ query: q, type: "MAPZAP" })),
    ];

    for (const { query, type } of allQueries) {
      if (repliesThisCycle >= MAX_REPLIES_PER_CYCLE) {
        log("INFO", `Hit max replies per cycle (${MAX_REPLIES_PER_CYCLE}). Stopping.`);
        break;
      }

      const tweets = await searchTweets(page, query);

      for (const tweet of tweets) {
        if (repliesThisCycle >= MAX_REPLIES_PER_CYCLE) break;
        if (replied[tweet.tweetId]) {
          log("SKIP", `Already replied to ${tweet.tweetId}`);
          continue;
        }

        const replyText = type === "DEVHIRE" ? pick(DEVHIRE_REPLIES) : pick(MAPZAP_REPLIES);
        const result = await replyToTweet(page, tweet, replyText);

        if (result === "replied") {
          replied[tweet.tweetId] = new Date().toISOString();
          saveReplied(replied);
          repliesThisCycle++;
          log("INFO", `${repliesThisCycle}/${MAX_REPLIES_PER_CYCLE} replies this cycle. Waiting ${Math.round(MIN_DELAY_MS / 60000)} to ${Math.round(MAX_DELAY_MS / 60000)}min...`);
          await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));
        }

        await sleep(rand(3000, 6000));
      }

      await sleep(rand(5000, 10000));
    }

  } catch (err) {
    log("ERROR", `Cycle failed: ${err.message}`);
  }

  await browser.close();
  log("INFO", `Cycle complete. Replied to ${repliesThisCycle} tweets.`);
}

(async () => {
  console.log("=".repeat(60));
  console.log("TwitterMagnet -- Search and Reply Bot");
  console.log("=".repeat(60));

  while (true) {
    await runCycle();
    log("INFO", `Next cycle in ${Math.round(CYCLE_INTERVAL_MS / 60000)} minutes.`);
    await sleep(CYCLE_INTERVAL_MS);
  }
})();

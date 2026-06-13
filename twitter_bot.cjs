require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const SESSION_PATH = "./session.json";
const REPLIED_PATH = "./replied.json";
const LOG_PATH = "./twitter_bot.log";
const MAX_REPLIES_PER_CYCLE = 15;
const MIN_DELAY_MS = 5 * 60 * 1000;
const MAX_DELAY_MS = 8 * 60 * 1000;
const CYCLE_INTERVAL_MS = 50 * 60 * 1000;
const MAPZAP_QUERIES = [
  "drop your project below",
  "what are you building",
  "founders drop your startup",
  "show us what you're working on",
  "what's your biggest challenge this month",
  "drop your startup link",
  "builders drop",
  "what are you working on right now",
  "drop what you're working on",
  "show me what you're building",
  "founders show your product",
  "entrepreneurs drop your business",
  "small business owners drop",
  "what problem are you solving",
  "drop your saas below",
  "show your product below",
  "what are you selling",
  "business owners drop",
  "drop your business below",
  "looking to connect with founders",
];
const AGENCYHIRE_QUERIES = [
  "how do I get clients for my agency",
  "struggling to get agency clients",
  "agency outreach not working",
  "how to scale my smma",
  "need more clients for my agency",
  "agency owner need help",
  "how to get smma clients",
  "cold outreach not converting",
  "agency growth problems",
  "how to automate outreach",
];
const AUTOSUB_QUERIES = [
  "how to automate Reddit outreach",
  "Reddit DM outreach strategy",
  "cold outreach on Reddit",
  "how to get clients on Reddit",
  "Reddit marketing for my business",
  "automate lead generation",
  "spending too much time on outreach",
  "how to scale outreach",
  "Reddit growth hacks",
  "outreach automation tools",
];
const ENGAGEMENT_SIGNALS = [
  "drop", "below", "building", "working on", "founders",
  "builders", "entrepreneurs", "startup", "saas", "business owners",
  "show us", "show me", "what are you", "connect with",
  "let's see", "lets see", "check out", "share your",
];
const AGENCY_SIGNALS = [
  "agency", "smma", "clients", "outreach", "scale", "automate",
  "cold outreach", "lead gen", "getting clients", "struggling",
];
const AUTOSUB_SIGNALS = [
  "reddit", "outreach", "automate", "dms", "lead gen",
  "clients", "marketing", "scale", "cold outreach", "prospecting",
];
const MAPZAP_REPLIES = [
  `building something? if you need local business leads for outreach or prospecting, mapzap.org pulls 100 leads from Google Maps in 60 seconds as a CSV. $49/month unlimited searches, free preview at mapzap.org`,
  `cool thread. if anyone here does cold outreach or needs local business leads, built mapzap.org for that. 100 leads in 60 seconds from Google Maps, name phone address website as a CSV. $49/month unlimited, free preview available`,
  `nice. if anyone in this thread needs local business leads for prospecting, mapzap.org pulls 100 from Google Maps in 60 seconds. free to try at mapzap.org`,
  `great thread. dropping this here for anyone who needs local business leads. mapzap.org pulls 100 businesses from Google Maps in 60 seconds as a downloadable CSV. $49/month unlimited searches`,
  `for anyone in this thread doing outreach or prospecting, built mapzap.org. pulls 100 local business leads from Google Maps in 60 seconds. name, phone, address, website as a CSV. free preview at mapzap.org`,
];
const AGENCYHIRE_REPLIES = [
  `i automate agency outreach. built a system that sends 1000+ targeted messages per day across Reddit, Facebook, Discord, and X to your ideal clients. $1,500 to deploy on your accounts in 48hrs, $500/month retainer. proof: mapzap.org. DM me`,
  `this is solvable with automation. i built an outreach stack that runs 24/7 across Reddit, Facebook, Discord, and X. finds buyers in your niche, messages them automatically. $1,500 setup, $500/month after. https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d`,
  `built an automated outreach system for exactly this. 1000+ targeted messages per day to people actively looking for your service. deploy on your agency in 48hrs for $1,500 flat. $500/month retainer. DM me a scope`,
  `scale outreach without hiring. full automation stack across Reddit, Facebook, Discord, X. finds your buyers, messages them, runs while you sleep. $1,500 setup, $500/month. proof: mapzap.org marketed entirely with this. https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d`,
];
const AUTOSUB_REPLIES = [
  `built AutoSub for exactly this. it automates your Reddit outreach. connect your account, set your keywords and offer, it finds people posting about needing what you sell and DMs them automatically 24/7. $47/month at autosub.mooo.com`,
  `this is what AutoSub solves. automated Reddit DM outreach. you set it up once, it runs forever finding buyers and messaging them. 200+ targeted DMs per day. $47/month at autosub.mooo.com`,
  `built a tool for this. AutoSub scrapes Reddit globally for buyer intent posts matching your keywords and sends your DM automatically. connect your Reddit account and it runs 24/7. $47/month. autosub.mooo.com`,
  `AutoSub handles this. connects to your Reddit account, finds people actively looking for what you sell, DMs them automatically. live dashboard showing all activity. $47/month at autosub.mooo.com`,
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
  await page.goto("https://x.com/home", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(rand(3000, 5000));
  if (page.url().includes("login")) throw new Error("Session expired. Run twitter_login.cjs again.");
  log("INFO", "Session loaded.");
}
async function searchTweets(page, query, signals) {
  log("SEARCH", `Searching: "${query}"`);
  const url = `https://x.com/search?q=${encodeURIComponent(query)}&f=live&src=typed_query`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(rand(3000, 5000));
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(rand(1500, 2500));
  }
  const tweets = await page.evaluate((sigs) => {
    const results = [];
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    for (const article of articles) {
      const textEl = article.querySelector('[data-testid="tweetText"]');
      if (!textEl) continue;
      const text = textEl.innerText?.toLowerCase() || '';
      if (!text || text.length < 20) continue;
      const isMatch = sigs.some(s => text.includes(s));
      if (!isMatch) continue;
      const replyCountEl = article.querySelector('[data-testid="reply"]');
      const replyCount = parseInt(replyCountEl?.innerText?.trim() || '0');
      if (replyCount < 2) continue;
      const timeEl = article.querySelector('time');
      const linkEl = timeEl?.closest('a');
      const tweetUrl = linkEl ? linkEl.href : null;
      if (!tweetUrl) continue;
      const match = tweetUrl.match(/status\/(\d+)/);
      const tweetId = match ? match[1] : null;
      if (!tweetId) continue;
      const authorEl = article.querySelector('[data-testid="User-Name"]');
      const author = authorEl?.innerText?.split('\n')[0] || 'unknown';
      const timeAttr = timeEl?.getAttribute('datetime');
      if (timeAttr) {
        const tweetAge = Date.now() - new Date(timeAttr).getTime();
        if (tweetAge > 6 * 60 * 60 * 1000) continue;
      }
      results.push({ tweetId, tweetUrl, author, text: text.substring(0, 200) });
    }
    return results;
  }, signals);
  log("SEARCH", `Found ${tweets.length} posts for "${query}"`);
  return tweets;
}
async function replyToTweet(page, tweet, replyText) {
  try {
    await page.goto(tweet.tweetUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(3000, 5000));
    const replyHandle = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('[data-testid="reply"]'));
      return btns[0] || null;
    });
    const replyEl = replyHandle.asElement();
    if (!replyEl) {
      log("SKIP", `No reply button for ${tweet.tweetId}`);
      return "no_reply_btn";
    }
    await replyEl.click();
    await sleep(rand(2000, 3000));
    const editorHandle = await page.evaluateHandle(() => {
      return document.querySelector('[data-testid="tweetTextarea_0"]') ||
             document.querySelector('[contenteditable="true"][role="textbox"]') ||
             null;
    });
    const editor = editorHandle.asElement();
    if (!editor) {
      log("SKIP", `No editor for ${tweet.tweetId}`);
      return "no_editor";
    }
    await editor.click();
    await sleep(rand(500, 1000));
    await page.keyboard.type(replyText, { delay: rand(30, 60) });
    await sleep(rand(2000, 3000));
    const sent = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[data-testid="tweetButton"]'));
      const sendBtn = btns.find(b =>
        b.innerText?.trim().toLowerCase() === 'reply' &&
        b.offsetParent !== null &&
        !b.disabled
      );
      if (sendBtn) { sendBtn.click(); return true; }
      return false;
    });
    if (!sent) {
      log("ERROR", `Could not click send for ${tweet.tweetId}`);
      return "no_send_btn";
    }
    await sleep(rand(3000, 5000));
    log("REPLIED", `@${tweet.author} ${tweet.tweetUrl}`);
    return "replied";
  } catch (err) {
    log("ERROR", `Reply failed for ${tweet.tweetId}: ${err.message}`);
    return "error";
  }
}
async function runCycle() {
  const replied = loadReplied();
  let repliesThisCycle = 0;
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  try {
    await loadSession(page);
    const allQueries = [
      ...MAPZAP_QUERIES.map(q => ({ query: q, type: "MAPZAP" })),
      ...AGENCYHIRE_QUERIES.map(q => ({ query: q, type: "AGENCYHIRE" })),
      ...AUTOSUB_QUERIES.map(q => ({ query: q, type: "AUTOSUB" })),
    ].sort(() => Math.random() - 0.5);
    for (const { query, type } of allQueries) {
      if (repliesThisCycle >= MAX_REPLIES_PER_CYCLE) {
        log("INFO", `Hit max replies (${MAX_REPLIES_PER_CYCLE}). Stopping.`);
        break;
      }
      let signals;
      if (type === "AGENCYHIRE") signals = AGENCY_SIGNALS;
      else if (type === "AUTOSUB") signals = AUTOSUB_SIGNALS;
      else signals = ENGAGEMENT_SIGNALS;
      const tweets = await searchTweets(page, query, signals);
      for (const tweet of tweets) {
        if (repliesThisCycle >= MAX_REPLIES_PER_CYCLE) break;
        if (replied[tweet.tweetId]) {
          log("SKIP", `Already replied to ${tweet.tweetId}`);
          continue;
        }
        let replyText;
        if (type === "AGENCYHIRE") replyText = pick(AGENCYHIRE_REPLIES);
        else if (type === "AUTOSUB") replyText = pick(AUTOSUB_REPLIES);
        else replyText = pick(MAPZAP_REPLIES);
        const result = await replyToTweet(page, tweet, replyText);
        if (result === "replied") {
          replied[tweet.tweetId] = new Date().toISOString();
          saveReplied(replied);
          repliesThisCycle++;
          log("INFO", `${repliesThisCycle}/${MAX_REPLIES_PER_CYCLE} replies [${type}]. Waiting ${Math.round(MIN_DELAY_MS/60000)} to ${Math.round(MAX_DELAY_MS/60000)}min...`);
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
  log("INFO", `Cycle complete. Replied to ${repliesThisCycle} posts.`);
}
(async () => {
  console.log("=".repeat(60));
  console.log("XMagnet -- MapZap + AgencyHire + AutoSub Engagement Poster");
  console.log("=".repeat(60));
  while (true) {
    await runCycle();
    log("INFO", `Next cycle in ${Math.round(CYCLE_INTERVAL_MS / 60000)} minutes.`);
    await sleep(CYCLE_INTERVAL_MS);
  }
})();

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

// Replaced generic engagement-bait queries ("drop your project below") with actual
// buyer-intent phrasing. The old queries matched viral threads, not people asking
// for leads, replying to those with a sales pitch reads as spam to anyone scrolling.
const MAPZAP_QUERIES = [
  "need more leads for my business",
  "need local business leads",
  "how do i find leads for my business",
  "struggling to find clients",
  "need a lead list",
  "where can i find business leads",
  "need business leads",
  "looking for local business contacts",
  "apollo too expensive",
  "need cheaper lead tool",
];

const FLOWMATE_QUERIES = [
  "losing leads slow response",
  "need to follow up with leads faster",
  "leads go cold",
  "contractor losing leads",
  "plumber losing customers",
  "HVAC company losing leads",
  "need automated lead follow up",
  "respond to leads faster",
  "GoHighLevel too expensive",
  "need instant lead response",
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

const MAPZAP_SIGNALS = [
  "need leads", "need clients", "need customers", "find leads",
  "lead list", "lead source", "business leads", "local business",
  "struggling to find", "apollo", "zoominfo", "prospecting",
];
const FLOWMATE_SIGNALS = [
  "losing leads", "lose leads", "leads go cold", "slow to respond",
  "follow up", "missed leads", "respond faster", "gohighlevel",
  "instant lead", "never miss a lead", "automated follow up",
];
const AUTOSUB_SIGNALS = [
  "reddit", "outreach", "automate", "dms", "lead gen",
  "clients", "marketing", "scale", "cold outreach", "prospecting",
];

const MAPZAP_REPLIES = [
  `if you need local business leads for outreach or prospecting, mapzap.org pulls 100 leads from Google Maps in 60 seconds as a CSV, emails included where available. $19.99/month unlimited searches, free preview at mapzap.org`,
  `built mapzap.org for exactly this. 100 leads in 60 seconds from Google Maps, name phone address website email as a CSV. $19.99/month unlimited, free preview available`,
  `mapzap.org might help. pulls 100 local business leads from Google Maps in 60 seconds, emails included. free to try at mapzap.org`,
  `built this for local business leads. mapzap.org pulls 100 businesses from Google Maps in 60 seconds as a downloadable CSV with emails where available. $19.99/month unlimited searches`,
  `for anyone doing outreach or prospecting, built mapzap.org. pulls 100 local business leads from Google Maps in 60 seconds. name, phone, address, website, email as a CSV. free preview at mapzap.org`,
];

const FLOWMATE_REPLIES = [
  `this is a lead response problem. roughly 78% of customers go with whoever responds first. built flowmate.live, it auto texts and emails every new lead within 60 seconds, runs 24/7. $297 first month, $797/month after. flowmate.live`,
  `built flowmate.live for exactly this. auto texts and emails every new lead within 60 seconds so you stop losing business to whoever responds first. i build it and run it for you. $297 first month, $797/month after.`,
  `if you're getting leads and not responding instantly you're losing most of them. flowmate.live fixes that, automated follow up within 60 seconds, done for you. $297 first month, $797/month after. flowmate.live`,
  `this is solvable with automation. flowmate.live texts and emails every new lead within 60 seconds, 24/7, done for you. $297 to try the first month, $797/month after.`,
];

const AUTOSUB_REPLIES = [
  `built AutoSub for exactly this. it automates your Reddit outreach. connect your account, set your keywords and offer, it finds people posting about needing what you sell and DMs them automatically 24/7. $19.99/month at autosub.online`,
  `this is what AutoSub solves. automated Reddit DM outreach. you set it up once, it runs forever finding buyers and messaging them. 200+ targeted DMs per day. $19.99/month at autosub.online`,
  `built a tool for this. AutoSub scrapes Reddit globally for buyer intent posts matching your keywords and sends your DM automatically. connect your Reddit account and it runs 24/7. $19.99/month. autosub.online`,
  `AutoSub handles this. connects to your Reddit account, finds people actively looking for what you sell, DMs them automatically. live dashboard showing all activity. $19.99/month at autosub.online`,
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
      ...FLOWMATE_QUERIES.map(q => ({ query: q, type: "FLOWMATE" })),
      ...AUTOSUB_QUERIES.map(q => ({ query: q, type: "AUTOSUB" })),
    ].sort(() => Math.random() - 0.5);
    for (const { query, type } of allQueries) {
      if (repliesThisCycle >= MAX_REPLIES_PER_CYCLE) {
        log("INFO", `Hit max replies (${MAX_REPLIES_PER_CYCLE}). Stopping.`);
        break;
      }
      let signals;
      if (type === "FLOWMATE") signals = FLOWMATE_SIGNALS;
      else if (type === "AUTOSUB") signals = AUTOSUB_SIGNALS;
      else signals = MAPZAP_SIGNALS;
      const tweets = await searchTweets(page, query, signals);
      for (const tweet of tweets) {
        if (repliesThisCycle >= MAX_REPLIES_PER_CYCLE) break;
        if (replied[tweet.tweetId]) {
          log("SKIP", `Already replied to ${tweet.tweetId}`);
          continue;
        }
        let replyText;
        if (type === "FLOWMATE") replyText = pick(FLOWMATE_REPLIES);
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
  console.log("XMagnet -- MapZap + FlowMate + AutoSub Engagement Poster");
  console.log("=".repeat(60));
  while (true) {
    await runCycle();
    log("INFO", `Next cycle in ${Math.round(CYCLE_INTERVAL_MS / 60000)} minutes.`);
    await sleep(CYCLE_INTERVAL_MS);
  }
})();

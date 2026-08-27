/* ============================================================
   FREEKARMELO FEED PIPELINE — Ingest Script (Node.js + Zod)
   Run: node feed-pipeline.js <input.json>
   Or: node feed-pipeline.js --interactive
   ============================================================ */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

const FEED_PATHS = {
  today: '/tmp/freekarmelo-today/updates/feed.json',
  net: '/tmp/freekarmelo-site/updates/feed.json',
  master: '/tmp/freekarmelo-shared/feed.json',
};

/* ── Schemas ── */
const BaseFeedItem = z.object({
  date: z.string().min(1),
  tag: z.string().min(1),
  headline: z.string().optional(),
  title: z.string().optional(),
  body: z.string().min(1),
  source: z.string().optional(),
  source_url: z.string().url().optional().or(z.literal("")),
  verified: z.boolean().default(false),
  organizer: z.string().optional(),
  id: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

const TodayFeedItem = BaseFeedItem.extend({
  headline: z.string().min(1),
  source: z.string().min(1),
  verified: z.boolean(),
});

const NetFeedItem = BaseFeedItem.extend({
  title: z.string().min(1),
  organizer: z.string().min(1),
});

const FeedItem = z.union([TodayFeedItem, NetFeedItem]);
const FeedSchema = z.array(FeedItem);

const IngestInput = z.object({
  date: z.string().min(1),
  tag: z.string().min(1),
  headline: z.string().optional(),
  title: z.string().optional(),
  body: z.string().min(1),
  source: z.string().optional(),
  source_url: z.string().url().optional().or(z.literal("")),
  verified: z.boolean().optional(),
  organizer: z.string().optional(),
}).refine(
  (data) => data.headline || data.title,
  { message: "Either 'headline' (.today) or 'title' (.net) is required", path: ["headline"] }
);

/* ── Helpers ── */
function dedupeKey(item) {
  const headline = "headline" in item ? item.headline : item.title;
  return `${item.date}|${headline}`.toLowerCase();
}

function sortFeedNewestFirst(a, b) {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

function normalizeFeedItem(input) {
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const isTodayFormat = !!input.headline;
  const isNetFormat = !!input.title && !!input.organizer;
  
  if (isTodayFormat) {
    return {
      id, date: input.date, tag: input.tag, headline: input.headline,
      body: input.body, source: input.source || "Unattributed",
      source_url: input.source_url || "", verified: input.verified ?? false,
      created_at: now, updated_at: now,
    };
  }
  
  if (isNetFormat) {
    return {
      id, date: input.date, tag: input.tag, title: input.title,
      body: input.body, organizer: input.organizer,
      verified: input.verified ?? false, created_at: now, updated_at: now,
    };
  }
  
  return {
    id, date: input.date, tag: input.tag,
    headline: input.title || input.headline || "Untitled Update",
    body: input.body, source: input.source || input.organizer || "Unattributed",
    source_url: input.source_url || "", verified: input.verified ?? false,
    created_at: now, updated_at: now,
  };
}

function loadFeed(path) {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return FeedSchema.parse(data);
  } catch (e) {
    console.error(`❌ Failed to load/parse ${path}:`, e.message);
    return [];
  }
}

function saveFeed(path, feed) {
  writeFileSync(path, JSON.stringify(feed, null, 2));
  console.log(`✅ Saved ${feed.length} items to ${path}`);
}

/* ── Main Pipeline ── */
async function ingestUpdate(inputData) {
  const input = IngestInput.parse(inputData);
  const newItem = normalizeFeedItem(input);
  
  // Load master feed (or create from both)
  let masterFeed = loadFeed(FEED_PATHS.master);
  if (masterFeed.length === 0) {
    const todayFeed = loadFeed(FEED_PATHS.today);
    const netFeed = loadFeed(FEED_PATHS.net);
    masterFeed = [...todayFeed, ...netFeed];
  }
  
  // Deduplicate
  const existingKeys = new Set(masterFeed.map(dedupeKey));
  const newKey = dedupeKey(newItem);
  
  if (existingKeys.has(newKey)) {
    console.log(`⚠️  Duplicate detected: ${newKey} — updating existing`);
    masterFeed = masterFeed.map(item => 
      dedupeKey(item) === newKey ? { ...newItem, updated_at: new Date().toISOString() } : item
    );
  } else {
    masterFeed.push(newItem);
    console.log(`✅ Added new item: ${newItem.date} | ${newItem.headline || newItem.title}`);
  }
  
  // Sort newest first
  masterFeed.sort(sortFeedNewestFirst);
  
  // Save to master
  saveFeed(FEED_PATHS.master, masterFeed);
  
  // Sync to both repos
  saveFeed(FEED_PATHS.today, masterFeed);
  saveFeed(FEED_PATHS.net, masterFeed);
  
  console.log('\n📋 Feed sync complete. Both repos updated.');
  return masterFeed;
}

/* ── CLI ── */
const args = process.argv.slice(2);

if (args.includes('--interactive') || args.length === 0) {
  console.log('📝 Interactive mode — enter update details:');
  const readline = await import('readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const date = await rl.question('Date (e.g., "June 16, 2026"): ');
  const tag = await rl.question('Tag (e.g., "APPEAL"): ');
  const format = await rl.question('Format? (today/net): ');
  
  let headline, title, organizer, source;
  if (format === 'today') {
    headline = await rl.question('Headline: ');
    source = await rl.question('Source: ');
  } else {
    title = await rl.question('Title: ');
    organizer = await rl.question('Organizer: ');
  }
  
  const body = await rl.question('Body: ');
  const source_url = await rl.question('Source URL (optional): ') || undefined;
  const verified = (await rl.question('Verified? (y/n): ')).toLowerCase() === 'y';
  
  rl.close();
  
  await ingestUpdate({ date, tag, headline, title, body, source, source_url, verified, organizer });
} else {
  // Assume first arg is JSON file path
  const inputPath = args[0];
  if (!existsSync(inputPath)) {
    console.error(`❌ File not found: ${inputPath}`);
    process.exit(1);
  }
  const inputData = JSON.parse(readFileSync(inputPath, 'utf-8'));
  await ingestUpdate(inputData);
}
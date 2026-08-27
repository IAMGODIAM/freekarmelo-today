/* ============================================================
   FREEKARMELO FEED PIPELINE — Zod Schema
   Unified feed item schema supporting both .today & .net formats
   ============================================================ */

import { z } from "zod";

/* ── Base fields common to both formats ── */
const BaseFeedItem = z.object({
  date: z.string().min(1, "Date is required"),
  tag: z.string().min(1, "Tag is required"),
  // Either headline/body (.today) OR title/body (.net)
  headline: z.string().optional(),
  title: z.string().optional(),
  body: z.string().min(1, "Body is required"),
  // Source attribution
  source: z.string().optional(),
  source_url: z.string().url().optional().or(z.literal("")),
  verified: z.boolean().default(false),
  // .net specific
  organizer: z.string().optional(),
  // Internal
  id: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

/* ── .today format (explicit headline, source, verified) ── */
export const TodayFeedItem = BaseFeedItem.extend({
  headline: z.string().min(1),
  source: z.string().min(1),
  verified: z.boolean(),
});

/* ── .net format (organizer, title instead of headline) ── */
export const NetFeedItem = BaseFeedItem.extend({
  title: z.string().min(1),
  organizer: z.string().min(1),
});

/* ── Unified feed item (accepts either format) ── */
export const FeedItem = z.union([TodayFeedItem, NetFeedItem]);

/* ── Feed array ── */
export const FeedSchema = z.array(FeedItem);

/* ── Input for ingestion (manual/API) ── */
export const IngestInput = z.object({
  // .today fields
  date: z.string().min(1),
  tag: z.string().min(1),
  headline: z.string().optional(),
  title: z.string().optional(),
  body: z.string().min(1),
  source: z.string().optional(),
  source_url: z.string().url().optional().or(z.literal("")),
  verified: z.boolean().optional(),
  // .net fields
  organizer: z.string().optional(),
}).refine(
  (data) => data.headline || data.title,
  { message: "Either 'headline' (.today) or 'title' (.net) is required", path: ["headline"] }
);

/* ── Type exports ── */
export type FeedItem = z.infer<typeof FeedItem>;
export type TodayFeedItem = z.infer<typeof TodayFeedItem>;
export type NetFeedItem = z.infer<typeof NetFeedItem>;
export type IngestInput = z.infer<typeof IngestInput>;

/* ── Normalization: convert any valid input to unified internal format ── */
export function normalizeFeedItem(input: IngestInput): FeedItem {
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  
  // Determine format
  const isTodayFormat = !!input.headline;
  const isNetFormat = !!input.title && !!input.organizer;
  
  if (isTodayFormat) {
    return {
      id,
      date: input.date,
      tag: input.tag,
      headline: input.headline!,
      body: input.body,
      source: input.source || "Unattributed",
      source_url: input.source_url || "",
      verified: input.verified ?? false,
      created_at: now,
      updated_at: now,
    } satisfies TodayFeedItem;
  }
  
  if (isNetFormat) {
    return {
      id,
      date: input.date,
      tag: input.tag,
      title: input.title!,
      body: input.body,
      organizer: input.organizer!,
      verified: input.verified ?? false,
      created_at: now,
      updated_at: now,
    } satisfies NetFeedItem;
  }
  
  // Fallback: treat as .today format with minimal fields
  return {
    id,
    date: input.date,
    tag: input.tag,
    headline: input.title || input.headline || "Untitled Update",
    body: input.body,
    source: input.source || input.organizer || "Unattributed",
    source_url: input.source_url || "",
    verified: input.verified ?? false,
    created_at: now,
    updated_at: now,
  } satisfies TodayFeedItem;
}

/* ── Deduplication key ── */
export function dedupeKey(item: FeedItem): string {
  const headline = "headline" in item ? item.headline : item.title;
  return `${item.date}|${headline}`.toLowerCase();
}

/* ── Sort: newest first ── */
export function sortFeedNewestFirst(a: FeedItem, b: FeedItem): number {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

/* ── Validation helper ── */
export function validateFeed(data: unknown): FeedItem[] {
  return FeedSchema.parse(data);
}
import {
  pgTable,
  text,
  timestamp,
  varchar,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Web Push subscriptions, one row per (userId, endpoint).
 *
 * Stores the browser Push API subscription JSON so the server can send
 * Web Push notifications (e.g. statutory deadline alerts) to a user's
 * devices. The endpoint is unique per browser installation; re-subscribing
 * the same endpoint upserts the keys.
 *
 * Migration: drizzle/migrations/0032_push_subscriptions.sql
 * (hand-written, follows 0030/0031 convention — not yet applied; requires
 * migration runner execution).
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** Owner (users.id). Subscriptions are per-user, per-device. */
    userId: varchar("userId", { length: 64 }).notNull(),
    /** Push service endpoint URL — unique per browser subscription. */
    endpoint: text("endpoint").notNull(),
    /** p256dh key from subscription.keys */
    p256dh: text("p256dh").notNull(),
    /** auth secret from subscription.keys */
    auth: text("auth").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("push_subscriptions_user_endpoint_idx").on(t.userId, t.endpoint)]
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

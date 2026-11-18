/**
 * server/changelog.ts — Phase 15 FB (A6): changelog_entries writer.
 *
 * changelog_entries was read-never-written (the /changelog page always
 * rendered empty). This module is the write path: a projection of
 * admin-visible change events onto the changelog stream.
 *
 * Wired writers (minimal, per phase-15 scope):
 *  1. hermes.generateRegulatoryFeed — one row per regulatory-feed ingest.
 *  2. audit.log — one row per admin-attributed audit action.
 *
 * Rows written here use version "runtime" (they are runtime change events,
 * not release notes); release-pipeline rows can use semver versions. No
 * deduplication is attempted — the audit log itself is append-only and this
 * is a faithful projection of it.
 */

import crypto from "node:crypto";
import { getDb } from "./db";
import { changelogEntries } from "../drizzle/schema";

export type ChangelogCategory = "feature" | "improvement" | "bugfix" | "security" | "breaking" | "deprecation";

export async function writeChangelogEntry(data: {
  title: string;
  description: string;
  category: ChangelogCategory;
  version?: string;
  releasedAt?: Date;
  isHighlight?: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(changelogEntries).values({
    id: crypto.randomUUID(),
    version: data.version ?? "runtime",
    releasedAt: data.releasedAt ?? new Date(),
    title: data.title.slice(0, 512),
    description: data.description.slice(0, 8000),
    category: data.category,
    isHighlight: data.isHighlight ?? false,
    createdAt: new Date(),
  });
}

/** Projection helper: admin audit action → changelog row. */
export async function projectAdminActionToChangelog(action: string, entityType: string, detail?: string | null): Promise<void> {
  await writeChangelogEntry({
    title: `Admin action: ${action}`,
    description: `${action} on ${entityType}${detail ? ` — ${detail.slice(0, 500)}` : ""}`,
    category: "improvement",
  });
}

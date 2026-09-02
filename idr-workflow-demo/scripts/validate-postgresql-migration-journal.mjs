import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = process.cwd();
const migrationsDir = resolve(root, "drizzle/migrations");
const journalPath = resolve(migrationsDir, "meta/_journal.json");
const errors = [];

if (!existsSync(journalPath)) {
  errors.push("Missing drizzle/migrations/meta/_journal.json");
}

let journal = { entries: [] };
if (!errors.length) {
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch (error) {
    errors.push(`Migration journal is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!Array.isArray(journal.entries)) {
  errors.push("Migration journal entries must be an array");
  journal.entries = [];
}

const sqlFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .sort()
  : [];
const tags = new Set();
for (const [position, entry] of journal.entries.entries()) {
  if (!entry || typeof entry !== "object") {
    errors.push(`Journal entry ${position} is not an object`);
    continue;
  }
  if (entry.idx !== position) {
    errors.push(`Journal entry ${position} has idx=${String(entry.idx)}; expected ${position}`);
  }
  if (typeof entry.tag !== "string" || !/^\d{4}_.+$/.test(entry.tag)) {
    errors.push(`Journal entry ${position} has invalid tag ${String(entry.tag)}`);
    continue;
  }
  if (tags.has(entry.tag)) errors.push(`Duplicate journal tag ${entry.tag}`);
  tags.add(entry.tag);
  if (!sqlFiles.includes(`${entry.tag}.sql`)) {
    errors.push(`Journal entry ${entry.tag} has no matching checked-in SQL migration`);
  }
}
for (const file of sqlFiles) {
  const tag = basename(file, ".sql");
  if (!tags.has(tag)) errors.push(`Checked-in SQL migration ${file} is not registered in the journal`);
}

const report = {
  valid: errors.length === 0,
  generatedAt: new Date().toISOString(),
  journalPath,
  journalDialect: "postgresql",
  checkedInMigrationCount: sqlFiles.length,
  journalEntryCount: journal.entries.length,
  unregistered: sqlFiles.filter(file => !tags.has(basename(file, ".sql"))),
  errors,
};
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 2;

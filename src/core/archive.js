import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const ARCHIVE_DIR = path.resolve('data/archive');

function todayFilePath(sourceId, date) {
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(ARCHIVE_DIR, sourceId, `${day}.json`);
}

/**
 * Appends newRecords to today's archive file for this source, deduping by
 * caseNumber within the file. Safe to call multiple times per day (once per run).
 */
export async function appendToArchive(sourceId, newRecords, { runAt = new Date() } = {}) {
  if (newRecords.length === 0) return;

  const filePath = todayFilePath(sourceId, runAt);
  await mkdir(path.dirname(filePath), { recursive: true });

  let existing = [];
  try {
    const raw = await readFile(filePath, 'utf8');
    existing = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const seenInFile = new Set(existing.map((r) => r.caseNumber));
  const toAdd = newRecords
    .filter((r) => !seenInFile.has(r.caseNumber))
    .map((r) => ({ ...r, archivedAt: runAt.toISOString() }));

  const combined = [...existing, ...toAdd];
  await writeFile(filePath, JSON.stringify(combined, null, 2) + '\n', 'utf8');
}

/**
 * Reads the most recently archived records for a source, newest first,
 * walking backward day-by-day until `limit` is reached. Used to power a
 * "recently seen" view that isn't tied to what changed on any single run.
 */
export async function getRecentRecords(sourceId, limit) {
  const sourceDir = path.join(ARCHIVE_DIR, sourceId);
  let files;
  try {
    files = (await readdir(sourceDir)).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const collected = [];
  for (const file of files) {
    if (collected.length >= limit) break;
    const raw = await readFile(path.join(sourceDir, file), 'utf8');
    const dayRecords = JSON.parse(raw);
    // Within a day, newest-archived-first.
    dayRecords.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
    collected.push(...dayRecords);
  }

  return collected.slice(0, limit);
}

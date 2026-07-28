import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

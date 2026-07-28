import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const LATEST_DIR = path.resolve('data/latest');

function latestPath(sourceId) {
  return path.join(LATEST_DIR, `${sourceId}.json`);
}

/**
 * Per-source "state of the last run" snapshot: when we last checked, whether
 * it succeeded, and what (if anything) was new. Regenerated every run,
 * independent of whether anything new was found, so the dashboard always
 * reflects the most recent check.
 */
export async function saveLatest(sourceId, snapshot) {
  await mkdir(LATEST_DIR, { recursive: true });
  await writeFile(latestPath(sourceId), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

export async function loadLatest(sourceId) {
  try {
    const raw = await readFile(latestPath(sourceId), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

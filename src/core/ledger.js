import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const LEDGER_DIR = path.resolve('data/seen');

function ledgerPath(sourceId) {
  return path.join(LEDGER_DIR, `${sourceId}.json`);
}

/**
 * @returns {{ caseNumbers: Record<string,string>, isBootstrap: boolean }}
 * caseNumbers maps case number -> ISO timestamp first seen.
 * isBootstrap is true when no ledger file exists yet (first run for this source).
 */
export async function loadLedger(sourceId) {
  try {
    const raw = await readFile(ledgerPath(sourceId), 'utf8');
    const parsed = JSON.parse(raw);
    return { caseNumbers: parsed.caseNumbers ?? {}, isBootstrap: false };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { caseNumbers: {}, isBootstrap: true };
    }
    throw err;
  }
}

export async function saveLedger(sourceId, caseNumbers) {
  await mkdir(LEDGER_DIR, { recursive: true });
  const payload = { caseNumbers, updatedAt: new Date().toISOString() };
  await writeFile(ledgerPath(sourceId), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

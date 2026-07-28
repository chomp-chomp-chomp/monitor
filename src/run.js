import { appendFile } from 'node:fs/promises';
import { sources } from './sources/index.js';
import { loadLedger, saveLedger } from './core/ledger.js';
import { appendToArchive } from './core/archive.js';
import { saveLatest } from './core/latest.js';
import { generateDashboard, generateArchivePages } from './core/dashboard.js';
import { sendNewFilingsEmail, sendFailureEmail } from './core/email.js';

async function summarize(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, line + '\n', 'utf8');
  }
}

async function runSource(source) {
  const runAt = new Date();
  const { caseNumbers, isBootstrap } = await loadLedger(source.id);
  const seenCaseNumbers = new Set(Object.keys(caseNumbers));

  let rows;
  try {
    rows = await source.fetchFilings({ seenCaseNumbers });
  } catch (err) {
    await saveLatest(source.id, {
      ok: false,
      checkedAt: runAt.toISOString(),
      error: err.message,
    });
    await summarize(`- **${source.label}**: FAILED — ${err.message}`);
    return { source, ok: false, error: err.message, newRecords: [] };
  }

  if (isBootstrap) {
    const updated = { ...caseNumbers };
    for (const row of rows) updated[row.caseNumber] = runAt.toISOString();
    await saveLedger(source.id, updated);
    await saveLatest(source.id, {
      ok: true,
      checkedAt: runAt.toISOString(),
      records: [],
      bootstrap: true,
      seededCount: rows.length,
    });
    await generateArchivePages(source.id, source.label);
    await summarize(
      `- **${source.label}**: bootstrap run — seeded ${rows.length} existing filings as a baseline, no notification sent.`
    );
    return { source, ok: true, newRecords: [] };
  }

  const newRecords = rows.filter((r) => !seenCaseNumbers.has(r.caseNumber));

  if (newRecords.length > 0) {
    await appendToArchive(source.id, newRecords, { runAt });
    const updated = { ...caseNumbers };
    for (const row of newRecords) updated[row.caseNumber] = runAt.toISOString();
    await saveLedger(source.id, updated);
  }

  await saveLatest(source.id, {
    ok: true,
    checkedAt: runAt.toISOString(),
    records: newRecords,
  });
  await generateArchivePages(source.id, source.label);

  await summarize(`- **${source.label}**: ${newRecords.length} new filing(s).`);
  return { source, ok: true, newRecords };
}

async function main() {
  await summarize(`## Filings monitor run — ${new Date().toISOString()}`);

  const results = [];
  for (const source of sources) {
    // Sources run sequentially (not in parallel) to stay polite to each site.
    results.push(await runSource(source));
  }

  const latestBySource = {};
  for (const r of results) {
    latestBySource[r.source.id] = r.ok
      ? { ok: true, checkedAt: new Date().toISOString(), records: r.newRecords }
      : { ok: false, checkedAt: new Date().toISOString(), error: r.error };
  }
  await generateDashboard(
    sources.map((s) => ({ id: s.id, label: s.label })),
    latestBySource
  );

  const emailGroups = results
    .filter((r) => r.ok && r.newRecords.length > 0)
    .map((r) => ({ sourceId: r.source.id, sourceLabel: r.source.label, records: r.newRecords }));

  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({ sourceId: r.source.id, sourceLabel: r.source.label, error: r.error }));

  if (emailGroups.length > 0) {
    await sendNewFilingsEmail(emailGroups, process.env);
    await summarize(`Sent notification email for ${emailGroups.length} source(s) with new filings.`);
  } else {
    await summarize('Nothing new — no notification email sent.');
  }

  if (failures.length > 0) {
    await sendFailureEmail(failures, process.env);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal error in filings monitor run:', err);
  process.exitCode = 1;
});

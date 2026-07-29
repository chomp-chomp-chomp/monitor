import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { formatEastern } from './format.js';

const DOCS_DIR = path.resolve('docs');
const ARCHIVE_DIR = path.resolve('data/archive');
const RECENTLY_SEEN_PREVIEW = 25;
const RECENTLY_SEEN_FULL = 100;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAGE_STYLE = `
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 16px; color: #222; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #ddd; background: #1c1c1c; } a { color: #7ab7ff; } table { border-color: #444 !important; } th { background: #2a2a2a !important; } }
  h1, h2 { font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0 32px; font-size: 14px; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
  th { background: #f5f5f5; }
  .meta { color: #888; font-size: 13px; margin-bottom: 4px; }
  .empty { color: #888; font-style: italic; }
  .ok { color: #2a7a2a; }
  .err { color: #b3261e; }
  nav a { margin-right: 12px; }
`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function recordsTable(records, { emptyText = 'No new filings as of the last check.', showPickedUp = false } = {}) {
  if (records.length === 0) return `<p class="empty">${escapeHtml(emptyText)}</p>`;
  const rows = records
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.caseName)}</td>
        <td><a href="${escapeHtml(r.url)}">${escapeHtml(r.caseNumber)}</a></td>
        <td>${escapeHtml(r.dateFiled)}</td>
        <td>${escapeHtml(r.caseType)}</td>
        <td>${escapeHtml(r.status)}</td>
        <td>${escapeHtml(r.location)}</td>
        <td>${escapeHtml(r.region)}</td>
        ${showPickedUp ? `<td>${escapeHtml(r.archivedAt ? formatEastern(r.archivedAt) : '')}</td>` : ''}
      </tr>`
    )
    .join('');
  return `<table>
    <thead><tr><th>Case Name</th><th>Case Number</th><th>Date Filed</th><th>Case Type</th><th>Status</th><th>Location</th><th>Region</th>${showPickedUp ? '<th>Picked Up</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/**
 * @param {{id: string, label: string}[]} sources
 * @param {Record<string, object|null>} latestBySource
 * @param {Record<string, object[]>} recentBySource - up to RECENTLY_SEEN_PREVIEW records per source, newest first
 */
export async function generateDashboard(sources, latestBySource, recentBySource = {}) {
  await mkdir(DOCS_DIR, { recursive: true });

  const sections = sources
    .map((s) => {
      const latest = latestBySource[s.id];
      const recent = recentBySource[s.id] ?? [];
      if (!latest) {
        return `<h2>${escapeHtml(s.label)}</h2><p class="empty">No data yet.</p>`;
      }
      const statusClass = latest.ok ? 'ok' : 'err';
      const statusText = latest.ok ? 'OK' : `Failed: ${escapeHtml(latest.error ?? 'unknown error')}`;
      return `
        <h2>${escapeHtml(s.label)}</h2>
        <p class="meta">Last checked: ${escapeHtml(formatEastern(latest.checkedAt))} &middot; <span class="${statusClass}">${statusText}</span></p>
        <p><a href="archive/${encodeURIComponent(s.id)}/">Browse full archive &rarr;</a></p>
        <h3>New this check</h3>
        ${latest.ok ? recordsTable(latest.records ?? []) : ''}
        <h3>Recently seen</h3>
        ${recordsTable(recent.slice(0, RECENTLY_SEEN_PREVIEW), { emptyText: 'Nothing archived yet.', showPickedUp: true })}
        ${recent.length > 0 ? `<p><a href="recent/${encodeURIComponent(s.id)}.html">View more &rarr;</a></p>` : ''}
      `;
    })
    .join('<hr/>');

  const html = page(
    'Filings Monitor',
    `<h1>Filings Monitor</h1>
     <p class="meta">Generated ${escapeHtml(formatEastern(new Date().toISOString()))}</p>
     ${sections}`
  );

  await writeFile(path.join(DOCS_DIR, 'index.html'), html, 'utf8');
}

/**
 * Writes a single page listing up to RECENTLY_SEEN_FULL recently-archived
 * records for a source, for the dashboard's "View more" link.
 */
export async function generateRecentPage(sourceId, sourceLabel, recentRecords) {
  const outDir = path.join(DOCS_DIR, 'recent');
  await mkdir(outDir, { recursive: true });

  const body = `
    <h1>${escapeHtml(sourceLabel)} — Recently Seen</h1>
    <p><a href="../">&larr; Back to dashboard</a></p>
    <p class="meta">Most recent ${Math.min(recentRecords.length, RECENTLY_SEEN_FULL)} filings picked up by the monitor, newest first.</p>
    ${recordsTable(recentRecords.slice(0, RECENTLY_SEEN_FULL), { emptyText: 'Nothing archived yet.', showPickedUp: true })}
  `;
  await writeFile(path.join(outDir, `${sourceId}.html`), page(`${sourceLabel} — Recently Seen`, body), 'utf8');
}

/**
 * Regenerates the browsable archive pages (index + one page per day) for a
 * single source from the JSON files already on disk under data/archive/<id>/.
 */
export async function generateArchivePages(sourceId, sourceLabel) {
  const sourceArchiveDir = path.join(ARCHIVE_DIR, sourceId);
  let files = [];
  try {
    files = (await readdir(sourceArchiveDir)).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const outDir = path.join(DOCS_DIR, 'archive', sourceId);
  await mkdir(outDir, { recursive: true });

  const indexBody = `
    <h1>${escapeHtml(sourceLabel)} — Archive</h1>
    <p><a href="../../">&larr; Back to dashboard</a></p>
    ${
      files.length === 0
        ? '<p class="empty">No archived filings yet.</p>'
        : `<ul>${files.map((f) => `<li><a href="${encodeURIComponent(f.replace('.json', '.html'))}">${escapeHtml(f.replace('.json', ''))}</a></li>`).join('')}</ul>`
    }
  `;
  await writeFile(path.join(outDir, 'index.html'), page(`${sourceLabel} — Archive`, indexBody), 'utf8');

  for (const file of files) {
    const day = file.replace('.json', '');
    const raw = await readFile(path.join(sourceArchiveDir, file), 'utf8');
    const records = JSON.parse(raw);
    const body = `
      <h1>${escapeHtml(sourceLabel)} — ${escapeHtml(day)}</h1>
      <p><a href="index.html">&larr; Back to archive index</a></p>
      ${recordsTable(records, { showPickedUp: true })}
    `;
    await writeFile(path.join(outDir, `${day}.html`), page(`${sourceLabel} — ${day}`, body), 'utf8');
  }
}

import { toCsv } from './csv.js';

const CSV_COLUMNS = [
  { header: 'Case Name', key: 'caseName' },
  { header: 'Case Number', key: 'caseNumber' },
  { header: 'Date Filed', key: 'dateFiled' },
  { header: 'Case Type', key: 'caseType' },
  { header: 'Status', key: 'status' },
  { header: 'Location', key: 'location' },
  { header: 'Region', key: 'region' },
  { header: 'Link', key: 'url' },
  { header: 'Source', key: 'sourceLabel' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function recordsTableHtml(records) {
  const rows = records
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.caseName)}</td>
        <td><a href="${escapeHtml(r.url)}">${escapeHtml(r.caseNumber)}</a></td>
        <td>${escapeHtml(r.dateFiled)}</td>
        <td>${escapeHtml(r.caseType)}</td>
        <td>${escapeHtml(r.location)}</td>
      </tr>`
    )
    .join('');
  return `
    <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
      <thead>
        <tr style="background:#f0f0f0;text-align:left;">
          <th>Case Name</th><th>Case Number</th><th>Date Filed</th><th>Case Type</th><th>Location</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildNewFilingsHtml(groups, dashboardUrl) {
  const sections = groups
    .map(
      (g) => `
      <h2 style="font-family:sans-serif;">${escapeHtml(g.sourceLabel)} — ${g.records.length} new filing${g.records.length === 1 ? '' : 's'}</h2>
      ${g.sourceUrl ? `<p style="font-family:sans-serif;font-size:13px;"><a href="${escapeHtml(g.sourceUrl)}">View source report on ${escapeHtml(g.sourceLabel)} &rarr;</a></p>` : ''}
      ${recordsTableHtml(g.records)}`
    )
    .join('<br/>');
  const dashboardLink = dashboardUrl
    ? `<p style="font-family:sans-serif;font-size:13px;"><a href="${escapeHtml(dashboardUrl)}">View dashboard &rarr;</a></p>`
    : '';
  return `<div>${sections}<br/>${dashboardLink}</div>`;
}

function base64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

async function sendViaResend({ apiKey, from, to, subject, html, attachments }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, attachments }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * @param {{sourceId: string, sourceLabel: string, sourceUrl?: string, records: object[]}[]} groups
 */
export async function sendNewFilingsEmail(groups, env) {
  const { RESEND_API_KEY, NOTIFY_EMAIL_TO, NOTIFY_EMAIL_FROM, DASHBOARD_URL } = env;
  if (!RESEND_API_KEY || !NOTIFY_EMAIL_TO || !NOTIFY_EMAIL_FROM) {
    throw new Error(
      'Missing RESEND_API_KEY, NOTIFY_EMAIL_TO, or NOTIFY_EMAIL_FROM environment variables'
    );
  }

  const totalNew = groups.reduce((sum, g) => sum + g.records.length, 0);
  const sourceNames = groups.map((g) => g.sourceLabel).join(', ');
  const date = new Date().toISOString().slice(0, 10);

  const allRecords = groups.flatMap((g) =>
    g.records.map((r) => ({ ...r, sourceLabel: g.sourceLabel }))
  );

  await sendViaResend({
    apiKey: RESEND_API_KEY,
    from: NOTIFY_EMAIL_FROM,
    to: NOTIFY_EMAIL_TO,
    subject: `${totalNew} new filing${totalNew === 1 ? '' : 's'} — ${sourceNames}`,
    html: buildNewFilingsHtml(groups, DASHBOARD_URL),
    attachments: [
      {
        filename: `new-filings-${date}.csv`,
        content: base64(toCsv(CSV_COLUMNS, allRecords)),
      },
    ],
  });
}

export async function sendFailureEmail(failures, env) {
  const { RESEND_API_KEY, NOTIFY_EMAIL_TO, NOTIFY_EMAIL_FROM } = env;
  if (!RESEND_API_KEY || !NOTIFY_EMAIL_TO || !NOTIFY_EMAIL_FROM) {
    // Nothing we can do — surface loudly in logs so the Actions run itself fails visibly.
    console.error('Cannot send failure email: missing RESEND_API_KEY/NOTIFY_EMAIL_TO/NOTIFY_EMAIL_FROM');
    return;
  }

  const html = `
    <div style="font-family:sans-serif;">
      <p>The filings monitor failed to check ${failures.length} source${failures.length === 1 ? '' : 's'} during this run. No archive or ledger data was changed for the affected source(s), so nothing was lost.</p>
      <ul>
        ${failures.map((f) => `<li><strong>${escapeHtml(f.sourceLabel)}</strong>: ${escapeHtml(f.error)}</li>`).join('')}
      </ul>
    </div>`;

  await sendViaResend({
    apiKey: RESEND_API_KEY,
    from: NOTIFY_EMAIL_FROM,
    to: NOTIFY_EMAIL_TO,
    subject: `Filings monitor: fetch failed (${failures.map((f) => f.sourceLabel).join(', ')})`,
    html,
  });
}

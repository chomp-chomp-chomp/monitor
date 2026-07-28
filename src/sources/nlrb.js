import * as cheerio from 'cheerio';

export const id = 'nlrb';
export const label = 'NLRB';

const BASE_URL = 'https://www.nlrb.gov/reports/graphs-data/recent-filings';
const USER_AGENT =
  'FilingsMonitorBot/1.0 (+https://github.com/chomp-chomp-chomp/monitor; low-frequency automated public-data check)';
const ITEMS_PER_PAGE = 100;
const MAX_PAGES = 5;
const PAGE_DELAY_MS = 2000;

// Field -> substrings to match against (lowercased) table header text.
// Kept loose on purpose: this is a Drupal Views table and exact header
// wording/markup can shift without the underlying data changing.
const HEADER_ALIASES = {
  caseName: ['case name'],
  caseNumber: ['case number'],
  dateFiled: ['date filed'],
  caseType: ['case type', 'type of case'],
  status: ['status'],
  location: ['location', 'city'],
  region: ['region'],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeader(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildColumnMap(headerTexts) {
  const headers = headerTexts.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.some((a) => h.includes(a)));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function caseUrl(caseNumber) {
  return `https://www.nlrb.gov/case/${encodeURIComponent(caseNumber)}`;
}

async function fetchPage(pageIndex) {
  const url = new URL(BASE_URL);
  url.searchParams.set('items_per_page', String(ITEMS_PER_PAGE));
  url.searchParams.set('sort_by', 'date_filed');
  url.searchParams.set('sort_order', 'DESC');
  url.searchParams.set('page', String(pageIndex));

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });
  if (!res.ok) {
    throw new Error(`NLRB request failed: HTTP ${res.status} for ${url.toString()}`);
  }
  return res.text();
}

/**
 * Scans every <table> on the page for one whose header row matches at least
 * caseName + caseNumber + dateFiled, then extracts its body rows.
 */
function parseRows(html) {
  const $ = cheerio.load(html);
  let rows = [];
  let tableFound = false;

  $('table').each((_, table) => {
    if (tableFound) return; // already found the right table
    const $table = $(table);
    const headerCells = $table
      .find('thead th, thead td')
      .toArray()
      .map((el) => $(el).text());
    const headerRow = headerCells.length
      ? headerCells
      : $table
          .find('tr')
          .first()
          .find('th, td')
          .toArray()
          .map((el) => $(el).text());

    const columnMap = buildColumnMap(headerRow);
    const requiredPresent = ['caseName', 'caseNumber', 'dateFiled'].every(
      (f) => columnMap[f] !== undefined
    );
    if (!requiredPresent) return;

    tableFound = true;

    const bodyRows = $table.find('tbody tr').length
      ? $table.find('tbody tr').toArray()
      : $table.find('tr').slice(1).toArray();

    for (const tr of bodyRows) {
      const cells = $(tr).find('td, th').toArray();
      if (cells.length === 0) continue;

      const cellText = (field) =>
        columnMap[field] !== undefined ? $(cells[columnMap[field]]).text().trim() : '';

      const caseNumber = cellText('caseNumber');
      const caseName = cellText('caseName');
      const dateFiled = cellText('dateFiled');
      if (!caseNumber || !caseName || !dateFiled) continue;

      const linkHref =
        columnMap.caseNumber !== undefined
          ? $(cells[columnMap.caseNumber]).find('a').attr('href')
          : undefined;
      const url = linkHref
        ? new URL(linkHref, 'https://www.nlrb.gov').toString()
        : caseUrl(caseNumber);

      rows.push({
        source: id,
        sourceLabel: label,
        caseName,
        caseNumber,
        dateFiled,
        caseType: cellText('caseType'),
        status: cellText('status'),
        location: cellText('location'),
        region: cellText('region'),
        url,
      });
    }
  });

  return { rows, tableFound };
}

/**
 * Fetches recent filings, paginating politely (sequential requests with a
 * delay) only as far as needed to cover everything not already in
 * seenCaseNumbers. Returns ALL rows fetched (new and already-seen) in the
 * site's descending date-filed order; the caller is responsible for diffing
 * against the ledger.
 *
 * @param {{ seenCaseNumbers: Set<string> }} ctx
 */
export async function fetchFilings({ seenCaseNumbers }) {
  const allRows = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAGE_DELAY_MS);

    const html = await fetchPage(page);
    const { rows, tableFound } = parseRows(html);

    if (!tableFound) {
      if (page === 0) {
        throw new Error(
          'Could not locate the filings table on the NLRB recent-filings page — the page structure may have changed.'
        );
      }
      break;
    }

    if (rows.length === 0) break;

    allRows.push(...rows);

    const hasNewOnThisPage = rows.some((r) => !seenCaseNumbers.has(r.caseNumber));
    if (!hasNewOnThisPage) break; // caught up to previously-seen filings
    if (rows.length < ITEMS_PER_PAGE) break; // last page of results
  }

  return allRows;
}

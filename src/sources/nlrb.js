import * as cheerio from 'cheerio';

export const id = 'nlrb';
export const label = 'NLRB';

const BASE_URL = 'https://www.nlrb.gov/reports/graphs-data/recent-filings';
const USER_AGENT =
  'FilingsMonitorBot/1.0 (+https://github.com/chomp-chomp-chomp/monitor; low-frequency automated public-data check)';
// Confirmed against a real capture of the page: results are plain
// server-rendered HTML (not an AJAX/Views table), already sorted by
// Date Filed descending, 20 records per page, paginated via ?page=N
// (0-indexed). Each filing is a `.rer-content` card, not a <table> row.
const ITEMS_PER_PAGE = 20;
const MAX_PAGES = 10;
const PAGE_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(pageIndex) {
  const url = new URL(BASE_URL);
  url.searchParams.set('page', String(pageIndex));

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });
  if (!res.ok) {
    throw new Error(`NLRB request failed: HTTP ${res.status} for ${url.toString()}`);
  }
  return res.text();
}

// Case numbers follow "<region>-<caseType>-<sequence>", e.g. "14-CA-391624".
// The middle segment is NLRB's own case-type code (CA, CB, RC, RM, RD, UD, UC, AC, ...).
function caseTypeFromCaseNumber(caseNumber) {
  const match = caseNumber.match(/^\d+-([A-Z]+)-\d+$/);
  return match ? match[1] : '';
}

function caseUrl(caseNumber) {
  return `https://www.nlrb.gov/case/${encodeURIComponent(caseNumber)}`;
}

/**
 * Each `.rer-style-1` div looks like `<b>Label</b>: value` (value may
 * contain a link, e.g. the Case Number field). Returns { label, value, href }.
 */
function parseFieldDiv($, el) {
  const $el = $(el);
  const label = $el.find('b').first().text().trim();
  const href = $el.find('a').first().attr('href');
  const $clone = $el.clone();
  $clone.find('b').remove();
  const value = $clone.text().trim().replace(/^:\s*/, '');
  return { label, value, href };
}

function parseRows(html) {
  const $ = cheerio.load(html);
  const cards = $('.rer-content').toArray();
  const rows = [];

  for (const card of cards) {
    const $card = $(card);
    const caseName = $card.find('.rer-head h3').first().text().trim();

    const fields = {};
    $card.find('.rer-style-row-1 .rer-style-1, .rer-style-row-2 .rer-style-1').each((_, el) => {
      const { label, value, href } = parseFieldDiv($, el);
      if (!label) return;
      fields[label] = { value, href };
    });

    const caseNumber = fields['Case Number']?.value ?? '';
    const dateFiled = fields['Date Filed']?.value ?? '';
    if (!caseNumber || !caseName || !dateFiled) continue;

    const linkHref = fields['Case Number']?.href;
    const url = linkHref ? new URL(linkHref, 'https://www.nlrb.gov').toString() : caseUrl(caseNumber);

    rows.push({
      source: id,
      sourceLabel: label,
      caseName,
      caseNumber,
      dateFiled,
      caseType: caseTypeFromCaseNumber(caseNumber),
      status: fields['Status']?.value ?? '',
      location: fields['Location']?.value ?? '',
      region: fields['Region Assigned']?.value ?? '',
      url,
    });
  }

  return { rows, cardsFound: cards.length };
}

/**
 * Builds a short, human-readable dump of the page for debugging a parse
 * failure from the Actions log alone.
 */
function describePageForDiagnostics(html) {
  const $ = cheerio.load(html);
  const title = $('title').text().trim();
  const $bodyOnly = cheerio.load(html);
  $bodyOnly('script, style, noscript').remove();
  const bodyPreview = $bodyOnly('body').text().trim().replace(/\s+/g, ' ').slice(0, 500);

  return [
    `page title: "${title}"`,
    `.rer-content count: ${$('.rer-content').length}`,
    `<table> count: ${$('table').length}`,
    `body text preview: "${bodyPreview}"`,
  ].join('\n');
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
    const { rows, cardsFound } = parseRows(html);

    if (cardsFound === 0) {
      if (page === 0) {
        throw new Error(
          'Found no filing cards (.rer-content) on the NLRB recent-filings page — the page structure may have changed.\n' +
            describePageForDiagnostics(html)
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

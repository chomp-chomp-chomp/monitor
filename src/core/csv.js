function escapeCsvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * @param {{header: string, key: string}[]} columns
 * @param {object[]} rows
 */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvCell(row[c.key])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

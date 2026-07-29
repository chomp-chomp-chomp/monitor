const EASTERN_TZ = 'America/New_York';

/**
 * Formats an ISO timestamp in US Eastern time (handles EST/EDT automatically).
 * e.g. "Jul 28, 2026, 9:26 PM EDT"
 */
export function formatEastern(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

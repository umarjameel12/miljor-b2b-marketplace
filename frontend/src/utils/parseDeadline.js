/**
 * Parse MilJor API deadlines consistently across browsers.
 * MySQL DATETIME values have no timezone; MilJor stores them as UTC.
 * Numeric inputs are Unix epoch milliseconds. Invalid values return NaN.
 */
const MYSQL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

export function parseDeadline(raw) {
  if (raw === null || raw === undefined || raw === '') return NaN;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw.getTime() : NaN;
  if (typeof raw !== 'string') return NaN;

  const value = raw.trim();
  if (!value) return NaN;

  const match = MYSQL_DATETIME.exec(value);
  if (match) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ''] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (month < 1 || month > 12 || day < 1 || hour > 23 ||
        minute > 59 || second > 59) return NaN;

    const milliseconds = Number((fraction + '000').slice(0, 3));
    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
    const parsed = new Date(timestamp);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day || parsed.getUTCHours() !== hour ||
        parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second) return NaN;
    return timestamp;
  }

  // Explicit Z/offset strings and ISO date-only values use the platform parser.
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

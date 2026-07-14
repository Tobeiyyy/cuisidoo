/** Formats a duration in seconds for TM6 step display, e.g. "10 Sek", "3 Min", "1 Min 5 Sek", "1 Std 10 Min". */
export function formatSeconds(s: number): string {
  if (s < 60) return `${s} Sek`;
  if (s < 3600) {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return sec === 0 ? `${min} Min` : `${min} Min ${sec} Sek`;
  }
  const hours = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  return min === 0 ? `${hours} Std` : `${hours} Std ${min} Min`;
}

/** Formats a TM6 step temperature: null → "—", numeric string → "90°C", "Varoma" passes through. */
export function formatTemp(t: string | null): string {
  if (t === null) return "—";
  if (t === "Varoma") return "Varoma";
  return `${t}°C`;
}

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_FULL = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Returns the Monday (local midnight) of the week containing `d`. Pure local-date arithmetic — no UTC/ISO shifts. */
export function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

/** Returns a new local-midnight Date `n` days after `d` (n may be negative). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Formats a Date as a local YYYY-MM-DD string — never uses toISOString, which shifts by the UTC offset. */
export function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** German weekday name, Monday-first ("Montag", "Dienstag", …). */
export function weekdayName(d: Date): string {
  return WEEKDAYS[(d.getDay() + 6) % 7];
}

/** Short day label used in day-section headers, e.g. "14. Jul". */
export function formatDayLabel(d: Date): string {
  return `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

/** Week-header range label for the Monday-start week beginning at `monday`, e.g. "14.–20. Juli". */
export function weekRangeLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth() && monday.getFullYear() === sunday.getFullYear();
  if (sameMonth) {
    return `${monday.getDate()}.–${sunday.getDate()}. ${MONTHS_FULL[monday.getMonth()]}`;
  }
  const yearSuffix = monday.getFullYear() === sunday.getFullYear() ? "" : ` ${monday.getFullYear()}`;
  return `${monday.getDate()}. ${MONTHS_SHORT[monday.getMonth()]}${yearSuffix} – ${sunday.getDate()}. ${MONTHS_SHORT[sunday.getMonth()]} ${sunday.getFullYear()}`;
}

const PIECE_FRACTIONS: Record<string, string> = { "0.25": "¼", "0.5": "½", "0.75": "¾" };

/**
 * Quantity display with quarter-piece fractions for Stück ("¼", "½", "1 ¾", …);
 * other units render plain numbers with up to 2 decimals trimmed.
 */
export function formatQuantity(q: number, unit: string): string {
  if (unit === "Stück") {
    const whole = Math.floor(q);
    const frac = PIECE_FRACTIONS[String(Math.round((q - whole) * 100) / 100)];
    if (frac) return whole === 0 ? frac : `${whole} ${frac}`;
  }
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
}

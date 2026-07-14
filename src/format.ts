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

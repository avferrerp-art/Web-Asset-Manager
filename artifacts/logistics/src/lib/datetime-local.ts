/**
 * Formats a date for a native datetime-local input in the operator's local time.
 * Empty and invalid values intentionally stay blank instead of being coerced.
 */
export function toDatetimeLocal(
  value: Date | string | null | undefined,
): string {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
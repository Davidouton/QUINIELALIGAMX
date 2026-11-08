import { fromMexicoCityInputValue } from "./mexico-city";

const MINUTE_MS = 60_000;

function unwrapCell(value: unknown): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("result" in value) return value.result;
    if ("text" in value) return value.text;
  }
  return value;
}

/** Excel dates have no timezone: their UTC fields represent the cell's wall clock. */
export function parseWorkbookDateTime(cell: unknown): string {
  const value = unwrapCell(cell);
  if (value === null || value === undefined || value === "") return "";

  let text: string;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error("Fecha inválida.");
    text = value.toISOString().slice(0, -1);
  } else if (typeof value === "string") {
    text = value.trim();
    if (!text) return "";
  } else {
    throw new Error("Usa una fecha de Excel o el formato AAAA-MM-DD HH:MM.");
  }

  const parts = text.match(/^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?([zZ]|[+-]\d{2}:?\d{2})?$/);
  if (!parts) throw new Error("Fecha inválida. Usa AAAA-MM-DD HH:MM; también se acepta ISO con Z o zona horaria.");
  const [, year, month, day, hour, minute, second = "00", fraction = "", zone] = parts;
  const millisecond = Number(fraction.padEnd(3, "0").slice(0, 3));
  const wallTime = new Date(0);
  wallTime.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  wallTime.setUTCHours(Number(hour), Number(minute), Number(second), millisecond);
  if (
    wallTime.getUTCFullYear() !== Number(year) || wallTime.getUTCMonth() !== Number(month) - 1 ||
    wallTime.getUTCDate() !== Number(day) || wallTime.getUTCHours() !== Number(hour) ||
    wallTime.getUTCMinutes() !== Number(minute) || wallTime.getUTCSeconds() !== Number(second)
  ) {
    throw new Error("La fecha o la hora no existe.");
  }

  if (zone) {
    let offsetMinutes = 0;
    if (!/^[zZ]$/.test(zone)) {
      const offset = zone.slice(1).replace(":", "");
      const offsetHours = Number(offset.slice(0, 2));
      const offsetRemainder = Number(offset.slice(2));
      if (offsetHours > 23 || offsetRemainder > 59) throw new Error("Zona horaria inválida.");
      offsetMinutes = (offsetHours * 60 + offsetRemainder) * (zone[0] === "+" ? 1 : -1);
    }
    return new Date(wallTime.getTime() - offsetMinutes * MINUTE_MS).toISOString();
  }

  const localMinute = `${year}-${month}-${day}T${hour}:${minute}`;
  const utcMinute = fromMexicoCityInputValue(localMinute);
  if (!utcMinute) throw new Error("La fecha o la hora no existe en Ciudad de México.");
  return new Date(Date.parse(utcMinute) + Number(second) * 1000 + millisecond).toISOString();
}

export function importedMatchTimes(kickoff: unknown, lock: unknown, offsetMinutes: number) {
  const kickoffAt = parseWorkbookDateTime(kickoff);
  if (!kickoffAt) throw new Error("Falta fecha de inicio.");
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 1_000_000) throw new Error("El cierre de la jornada debe tener un desfase válido en minutos.");
  const lockAt = parseWorkbookDateTime(lock) || new Date(Date.parse(kickoffAt) - offsetMinutes * MINUTE_MS).toISOString();
  return { kickoff_at: kickoffAt, picks_lock_at: lockAt };
}

/** Boundaries use the same normalized instants as the imported matches. */
export function importedMatchdayBounds(kickoffs: string[]) {
  const timestamps = kickoffs.map((value) => {
    const parsed = parseWorkbookDateTime(value);
    if (!parsed) throw new Error("Falta fecha de inicio de un partido.");
    return Date.parse(parsed);
  });
  if (!timestamps.length) throw new Error("La jornada no contiene partidos.");
  return {
    starts_at: new Date(Math.min(...timestamps)).toISOString(),
    ends_at: new Date(Math.max(...timestamps) + 3 * 60 * MINUTE_MS).toISOString(),
  };
}

const MEXICO_CITY_TIME_ZONE = "America/Mexico_City";

function parseApiDate(value: string) {
  if (!value) {
    return null;
  }

  const normalizedValue =
    /[zZ]$|[+-]\d{2}:\d{2}$/.test(value) || value.includes("[")
      ? value
      : `${value}Z`;
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function getFormattedParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MEXICO_CITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "0000",
    month: parts.find((part) => part.type === "month")?.value ?? "01",
    day: parts.find((part) => part.type === "day")?.value ?? "01",
    hour: parts.find((part) => part.type === "hour")?.value ?? "00",
    minute: parts.find((part) => part.type === "minute")?.value ?? "00",
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatMexicoCityDateTime(value: string) {
  const date = parseApiDate(value);
  if (!date) {
    return "Fecha invalida";
  }

  return new Intl.DateTimeFormat("es-MX", {
    timeZone: MEXICO_CITY_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function toMexicoCityInputValue(value: string) {
  const date = parseApiDate(value);
  if (!date) {
    return "";
  }

  const { year, month, day, hour, minute } = getFormattedParts(date);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function shiftMexicoCityInputValue(value: string, minutes: number) {
  if (!value) {
    return "";
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return "";
  }

  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)),
  );

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setUTCMinutes(date.getUTCMinutes() + minutes);

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

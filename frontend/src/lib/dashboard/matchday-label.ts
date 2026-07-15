export function getMatchdayDisplayLabel(
  matchdayName: string | null | undefined,
  matchdayNumber: number | null | undefined,
) {
  const safeName = typeof matchdayName === "string" ? matchdayName.trim() : "";
  if (safeName && safeName.toLowerCase().startsWith("jornada")) {
    return safeName;
  }
  if (typeof matchdayNumber === "number" && Number.isFinite(matchdayNumber)) {
    return `Jornada ${matchdayNumber}`;
  }
  return safeName || "Jornada";
}

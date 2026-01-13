export const toIso = (date: Date) => date.toISOString();

export const nowInTz = (timezone: string) => {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
};

export const joinOrEmpty = (values?: string[]) => {
  if (!values || values.length === 0) return undefined;
  return values.join("|");
};

export const clampNumber = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const compactEvents = (events: any[], limit = 20) => {
  if (!Array.isArray(events)) return events;
  const trimmed = events.slice(0, limit);
  return { items: trimmed, total: events.length };
};

export const compactToolResult = (result: any) => {
  if (!result || typeof result !== "object") return result;
  if (!result.data) return result;
  const data: Record<string, any> = { ...result.data };
  if (Array.isArray(data.events)) {
    data.events = compactEvents(data.events);
  }
  if (data.report?.events && Array.isArray(data.report.events)) {
    data.report = { ...data.report, events: compactEvents(data.report.events) };
  }
  return { ...result, data };
};

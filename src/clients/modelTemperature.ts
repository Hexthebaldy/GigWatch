const FIXED_TEMPERATURE_MODEL_RULES: Array<{ pattern: RegExp; temperature: number }> = [
  { pattern: /^kimi-k2\.5(?:$|[-_])/i, temperature: 1 }
];

export const resolveModelTemperature = (
  model: string | undefined,
  requestedTemperature = 1,
  fallbackTemperature = 1
) => {
  if (!model) return Number.isFinite(requestedTemperature) ? requestedTemperature : fallbackTemperature;
  const normalized = model.trim();
  const fixed = FIXED_TEMPERATURE_MODEL_RULES.find((rule) => rule.pattern.test(normalized));
  if (fixed) return fixed.temperature;
  return Number.isFinite(requestedTemperature) ? requestedTemperature : fallbackTemperature;
};

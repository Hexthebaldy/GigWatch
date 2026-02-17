const CJK_CHAR_REGEX = /[\u3400-\u9fff]/g;

export const estimateTextTokens = (input: string): number => {
  if (!input) return 0;
  const cjkCount = (input.match(CJK_CHAR_REGEX) || []).length;
  const otherCount = input.length - cjkCount;
  return cjkCount + Math.ceil(otherCount / 4);
};

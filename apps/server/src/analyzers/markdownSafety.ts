const MAX_LINK_OPENERS_PER_DOCUMENT = 1_000;

export function exceedsMarkdownParserSafetyLimit(text: string): boolean {
  let openers = 0;
  for (const character of text) {
    if (character === '[' && (openers += 1) > MAX_LINK_OPENERS_PER_DOCUMENT) return true;
  }
  return false;
}

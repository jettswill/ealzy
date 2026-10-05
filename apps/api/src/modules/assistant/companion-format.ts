const LIST_ITEM = /^(?:\d+\.|[-•*])\s+\S/;
const TRAILING_PROSE =
  /^(?:также|ещё|еще|обрати|итого|в фокусе|если|стоит|помни|давай|лучше|note\b|also\b|so\b|therefore\b)/iu;
const LABELED_DASH = /\*\*[^*]{1,90}\*\*\s*[—–−-]\s+/g;
const LABELED_COLON = /\*\*[^*]{1,90}\*\*\s*:\s+/g;

function isListItem(line: string) {
  return LIST_ITEM.test(line.trimStart());
}

function isListContinuation(line: string, inList: boolean) {
  return inList && /^\s+\S/.test(line) && !isListItem(line);
}

function splitTrailingProse(item: string): { item: string; trailing: string } {
  const match = item.match(/^(.+?[.!?])\s+([A-ZА-ЯЁ][\s\S]+)$/u);
  if (!match) return { item: item.trim(), trailing: "" };
  const body = match[1]!.trim();
  const rest = match[2]!.trim();
  if (rest.length < 40 && !TRAILING_PROSE.test(rest)) return { item: item.trim(), trailing: "" };
  return { item: body, trailing: rest };
}

function expandNumberedLine(text: string): string | null {
  const match = /(?:^|[\s:])1\.\s+\S/.exec(text);
  if (!match || match.index === undefined) return null;
  const listStart = match.index + match[0].indexOf("1.");
  let pos = listStart;
  let expected = 1;
  const items: string[] = [];
  while (pos < text.length) {
    const marker = `${expected}. `;
    if (!text.startsWith(marker, pos)) break;
    pos += marker.length;
    const next = text.indexOf(`${expected + 1}. `, pos);
    if (next === -1) {
      items.push(text.slice(pos).trim());
      pos = text.length;
      break;
    }
    items.push(text.slice(pos, next).trim());
    pos = next;
    expected += 1;
  }
  if (items.length < 2) return null;
  const last = items.at(-1) ?? "";
  const { item: lastItem, trailing } = splitTrailingProse(last);
  items[items.length - 1] = lastItem;
  const prefix = text.slice(0, listStart).trim();
  const parts = [
    prefix,
    items.map((item, index) => `${index + 1}. ${item.replace(/\s+/g, " ").trim()}`).join("\n"),
    trailing,
  ].filter(Boolean);
  return parts.join("\n\n");
}

function expandBulletLine(text: string): string | null {
  const parts = text.split(/\s+[•*]\s+/);
  if (parts.length < 3) return null;
  const prefix = parts[0]!.replace(/\s+[-–—]\s*$/, "").trim();
  const items = parts.slice(1).map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (items.length < 2) return null;
  const last = items.at(-1) ?? "";
  const { item: lastItem, trailing } = splitTrailingProse(last);
  items[items.length - 1] = lastItem;
  const body = items.map((item) => `• ${item}`).join("\n");
  return [prefix, body, trailing].filter(Boolean).join("\n\n");
}

function splitPackedLabeled(
  text: string,
  matches: RegExpMatchArray[],
  kind: "dash" | "colon",
): string | null {
  if (matches.length < 2 || matches[0]?.index === undefined) return null;
  const prefix = text.slice(0, matches[0].index).trim();
  const items = matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1]!.index ?? text.length) : text.length;
    return text.slice(start, end).trim();
  });
  const last = items.at(-1) ?? "";
  const { item: lastItem, trailing } = splitTrailingProse(last);
  items[items.length - 1] = lastItem;
  const body = items
    .map((item, index) => (kind === "colon" ? `${index + 1}. ${item}` : `• ${item}`))
    .join("\n");
  return [prefix, body, trailing].filter(Boolean).join("\n\n");
}

function expandPackedLabeled(line: string): string | null {
  if (!line.trim() || isListItem(line)) return null;
  const dash = [...line.matchAll(new RegExp(LABELED_DASH, "g"))];
  if (dash.length >= 2) return splitPackedLabeled(line, dash, "dash");
  const colon = [...line.matchAll(new RegExp(LABELED_COLON, "g"))];
  if (colon.length >= 2) return splitPackedLabeled(line, colon, "colon");
  return null;
}

function expandInlineLists(line: string): string {
  if (!line.trim()) return line;
  if (isListItem(line) && !/\s+\d+\.\s+\S/.test(line.slice(3))) return line;
  return expandNumberedLine(line) ?? expandBulletLine(line) ?? expandPackedLabeled(line) ?? line;
}

function labeledKind(line: string): "dash" | "colon" | null {
  if (isListItem(line)) return null;
  const match = /^\*\*(.+?)\*\*\s*([—–−-]|:)\s+\S/.exec(line.trim());
  if (!match) return null;
  const title = match[1]!.trim();
  if (!title || title.length > 90) return null;
  if (match[2] === ":") return title.split(/\s+/).length > 8 ? null : "colon";
  return "dash";
}

function promoteLabeledGroups(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const kind = labeledKind(lines[index]!);
    if (!kind) {
      out.push(lines[index]!);
      index += 1;
      continue;
    }
    const group: string[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const line = lines[cursor]!;
      if (!line.trim()) {
        let peek = cursor + 1;
        while (peek < lines.length && !lines[peek]!.trim()) peek += 1;
        if (peek < lines.length && labeledKind(lines[peek]!) === kind) {
          cursor = peek;
          continue;
        }
        break;
      }
      if (labeledKind(line) !== kind) break;
      group.push(line.trim());
      cursor += 1;
    }
    if (kind === "colon" && group.length < 2) {
      out.push(lines[index]!);
      index += 1;
      continue;
    }
    if (out.length && out.at(-1)?.trim()) out.push("");
    out.push(
      ...group.map((item, itemIndex) => (kind === "colon" ? `${itemIndex + 1}. ${item}` : `• ${item}`)),
    );
    index = cursor;
  }
  return out.join("\n");
}

function insertListSpacing(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const item = isListItem(line);
    const continuation = isListContinuation(line, inList);
    if (item && out.length && out.at(-1)?.trim() && !inList) {
      if (out.at(-1) !== "") out.push("");
    }
    if (!item && !continuation && line.trim() && inList) {
      if (out.at(-1) !== "") out.push("");
    }
    out.push(line);
    inList = item || continuation;
  }
  return out.join("\n");
}

function emphasizeListTitle(line: string): string {
  const trimmed = line.trimStart();
  const match = /^(?:(\d+\.)|([-•*]))\s+(.*)$/.exec(trimmed);
  if (!match) return line;
  const indent = line.slice(0, line.length - trimmed.length);
  const marker = match[1] ?? match[2]!;
  const body = match[3]!.trim();
  if (/^\*\*/.test(body)) return line;
  const labeled = /^(.{2,70}?)\s+([—–−-])\s+(.{2,})$/u.exec(body);
  if (!labeled) return line;
  const title = labeled[1]!.trim();
  if (/[?!.]/.test(title) || title.includes(". ")) return line;
  return `${indent}${marker} **${title}** ${labeled[2]} ${labeled[3]!.trim()}`;
}

function splitSentences(text: string): string[] {
  const parts: string[] = [];
  const re = /(?<=[а-яёa-z0-9)\]»"'”'])[.!?…]["»”']*(?=\s+[A-ZА-ЯЁ])/gu;
  let start = 0;
  for (const match of text.matchAll(re)) {
    const end = (match.index ?? 0) + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) parts.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.length ? parts : [text];
}

function breakProseLine(line: string): string[] {
  if (!line.trim() || isListItem(line) || line.startsWith(">")) return [line];
  if (line.length < 90) return [line];
  const sentences = splitSentences(line);
  if (sentences.length < 2) return [line];
  return sentences.flatMap((chunk, index) => (index === 0 ? [chunk] : ["", chunk]));
}

function splitDenseProse(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const item = isListItem(line);
    const continuation = isListContinuation(line, inList);
    if (item || continuation) {
      out.push(line);
      inList = item || continuation;
      continue;
    }
    inList = false;
    out.push(...breakProseLine(line));
  }
  return out.join("\n");
}

/** Turn packed “1. Foo. 2. Bar.” answers into readable chat layout. */
export function formatCompanionAnswer(text: string): string {
  const expanded = text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => expandInlineLists(line.trimEnd()))
    .join("\n");
  const listed = insertListSpacing(promoteLabeledGroups(expanded));
  const titled = listed
    .split("\n")
    .map((line) => emphasizeListTitle(line))
    .join("\n");
  return splitDenseProse(titled)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

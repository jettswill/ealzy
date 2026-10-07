import type { ReactNode } from "react";

const findClosingDelimiter = (text: string, delimiter: string, from: number) => {
  let cursor = from;
  while ((cursor = text.indexOf(delimiter, cursor)) !== -1) {
    let backslashes = 0;
    for (let index = cursor - 1; index >= 0 && text[index] === "\\"; index -= 1) backslashes += 1;
    if (backslashes % 2 === 0) {
      if (delimiter.length === 2 && text.startsWith(delimiter[0]!.repeat(3), cursor)) {
        return cursor + 1;
      }
      return cursor;
    }
    cursor += delimiter.length;
  }
  return -1;
};

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const result: ReactNode[] = [];
  let plain = "";
  let index = 0;
  let nodeIndex = 0;
  const flushPlain = () => {
    if (!plain) return;
    result.push(plain);
    plain = "";
  };
  const nextKey = () => `${keyPrefix}-${nodeIndex++}`;

  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length && /[\\*_`[\]]/.test(text[index + 1]!)) {
      plain += text[index + 1]!;
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      const closing = findClosingDelimiter(text, "`", index + 1);
      if (closing !== -1) {
        flushPlain();
        result.push(<code key={nextKey()}>{text.slice(index + 1, closing)}</code>);
        index = closing + 1;
        continue;
      }
    }
    if (text[index] === "[") {
      const labelEnd = text.indexOf("](", index + 1);
      const urlEnd = labelEnd === -1 ? -1 : text.indexOf(")", labelEnd + 2);
      if (labelEnd !== -1 && urlEnd !== -1) {
        const url = text.slice(labelEnd + 2, urlEnd);
        if (/^(?:https?:\/\/|mailto:)/iu.test(url)) {
          flushPlain();
          const key = nextKey();
          result.push(
            <a key={key} href={url} target="_blank" rel="noreferrer">
              {renderInline(text.slice(index + 1, labelEnd), key)}
            </a>,
          );
          index = urlEnd + 1;
          continue;
        }
      }
    }
    const delimiter =
      text.startsWith("**", index) || text.startsWith("__", index)
        ? text.slice(index, index + 2)
        : text[index] === "*" || text[index] === "_"
          ? text[index]!
          : null;
    if (delimiter) {
      const closing = findClosingDelimiter(text, delimiter, index + delimiter.length);
      if (closing > index + delimiter.length) {
        flushPlain();
        const key = nextKey();
        const children = renderInline(text.slice(index + delimiter.length, closing), key);
        result.push(
          delimiter.length === 2 ? (
            <strong key={key}>{children}</strong>
          ) : (
            <em key={key}>{children}</em>
          ),
        );
        index = closing + delimiter.length;
        continue;
      }
    }
    plain += text[index]!;
    index += 1;
  }
  flushPlain();
  return result;
}

type LabeledItem = { title: string; body: string; dash: boolean };

type MessageBlock =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "note"; text: string }
  | { type: "quote"; text: string }
  | { type: "pre"; text: string }
  | { type: "hr" }
  | { type: "ol"; items: string[] }
  | { type: "ul"; items: string[] }
  | { type: "entries"; variant: "tasks" | "steps"; items: LabeledItem[] };

const META_BODY =
  /^(?:срок|due\b|ежедневн|daily\b|каждый|every\b|until\b|by\b|\d+\s*(?:мин|min|h|ч)\b)/iu;

export function parseLabeled(text: string): LabeledItem | null {
  const trimmed = text.trim();
  const bold = /^\*\*(.+?)\*\*\s*([—–−-]|:)\s+([\s\S]+)$/u.exec(trimmed);
  if (bold) {
    const title = bold[1]!.trim();
    if (!title || title.length > 90) return null;
    if (bold[2] === ":" && title.split(/\s+/).length > 8) return null;
    return { title, body: bold[3]!.trim(), dash: bold[2] !== ":" };
  }
  const plain = /^(.{2,70}?)\s+[—–−-]\s+(.{2,})$/u.exec(trimmed);
  if (!plain || /[?!.]/.test(plain[1]!) || plain[1]!.includes(". ")) return null;
  if (!META_BODY.test(plain[2]!.trim())) return null;
  return { title: plain[1]!.trim(), body: plain[2]!.trim(), dash: true };
}

function paragraphAsEntries(text: string): MessageBlock | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const items = lines.map((line) => parseLabeled(line));
  if (items.some((item) => !item)) return null;
  const labeled = items as LabeledItem[];
  if (labeled.every((item) => item.dash)) return { type: "entries", variant: "tasks", items: labeled };
  if (labeled.length >= 2 && labeled.every((item) => !item.dash)) {
    return { type: "entries", variant: "steps", items: labeled };
  }
  return null;
}

function isSectionHeading(text: string) {
  const trimmed = text.trim();
  if (trimmed.length > 88 || trimmed.includes("\n") || trimmed.includes("?")) return false;
  return /[:：]$/.test(trimmed) && !/[—–−]/.test(trimmed);
}

function isItalicNote(text: string) {
  const trimmed = text.trim();
  return /^[*_](.+?)[*_]$/u.test(trimmed) && !trimmed.slice(1, -1).includes(trimmed[0]!);
}

function stripItalicNote(text: string) {
  return text.trim().slice(1, -1);
}

function listAsEntries(type: "ol" | "ul", items: string[]): MessageBlock | null {
  const labeled = items.map((item) => parseLabeled(item));
  if (labeled.some((item) => !item)) return null;
  const ready = labeled as LabeledItem[];
  if (type === "ul" && ready.every((item) => item.dash)) {
    return { type: "entries", variant: "tasks", items: ready };
  }
  if (ready.every((item) => !item.dash) && (type === "ol" || ready.length >= 2)) {
    return { type: "entries", variant: "steps", items: ready };
  }
  if (ready.every((item) => item.dash)) return { type: "entries", variant: "tasks", items: ready };
  return null;
}

function coalesceBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const out: MessageBlock[] = [];
  for (const block of blocks) {
    const prev = out.at(-1);
    if (block.type === "entries" && prev?.type === "entries" && prev.variant === block.variant) {
      prev.items.push(...block.items);
      continue;
    }
    if (block.type === "quote" && prev?.type === "quote") {
      prev.text = `${prev.text}\n${block.text}`;
      continue;
    }
    out.push(block);
  }
  return out;
}

function promoteParagraphRuns(blocks: MessageBlock[]): MessageBlock[] {
  const out: MessageBlock[] = [];
  for (let index = 0; index < blocks.length; ) {
    const block = blocks[index]!;
    if (block.type !== "p") {
      out.push(block);
      index += 1;
      continue;
    }
    const first = parseLabeled(block.text);
    if (!first) {
      out.push(block);
      index += 1;
      continue;
    }
    const run = [first];
    let cursor = index + 1;
    while (cursor < blocks.length && blocks[cursor]?.type === "p") {
      const next = parseLabeled((blocks[cursor] as { type: "p"; text: string }).text);
      if (!next || next.dash !== first.dash) break;
      run.push(next);
      cursor += 1;
    }
    if (first.dash || run.length >= 2) {
      out.push({ type: "entries", variant: first.dash ? "tasks" : "steps", items: run });
      index = cursor;
      continue;
    }
    out.push(block);
    index += 1;
  }
  return coalesceBlocks(out);
}

function parseTextBlocks(text: string): MessageBlock[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let list: { type: "ol" | "ul"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    const joined = paragraph.join("\n").trim();
    paragraph = [];
    if (!joined) return;
    if (isItalicNote(joined)) {
      blocks.push({ type: "note", text: stripItalicNote(joined) });
      return;
    }
    const entries = paragraphAsEntries(joined);
    if (entries) {
      blocks.push(entries);
      return;
    }
    if (isSectionHeading(joined)) {
      blocks.push({ type: "h", text: joined.replace(/[:：]\s*$/u, "") });
      return;
    }
    blocks.push({ type: "p", text: joined });
  };
  const flushList = () => {
    if (!list?.items.length) {
      list = null;
      return;
    }
    blocks.push(listAsEntries(list.type, list.items) ?? list);
    list = null;
  };
  const flushQuote = () => {
    const joined = quote.join("\n").trim();
    quote = [];
    if (joined) blocks.push({ type: "quote", text: joined });
  };

  for (const line of lines) {
    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    const ordered = /^(\d+)\.\s+(.*)$/.exec(line.trimStart());
    const bullet = /^[-•*]\s+(.*)$/.exec(line.trimStart());
    if (heading) {
      flushQuote();
      flushList();
      flushParagraph();
      blocks.push({ type: "h", text: heading[2]!.trim() });
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushQuote();
      flushList();
      flushParagraph();
      blocks.push({ type: "hr" });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushList();
      flushParagraph();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (quote.length) flushQuote();
    if (ordered) {
      flushParagraph();
      if (list?.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ordered[2] ?? "");
      continue;
    }
    if (bullet) {
      flushParagraph();
      if (list?.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(bullet[1] ?? "");
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ""}\n${line.trim()}`;
      continue;
    }
    if (!line.trim()) {
      flushList();
      flushParagraph();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushQuote();
  flushList();
  flushParagraph();
  return coalesceBlocks(blocks);
}

function parseBlocks(text: string): MessageBlock[] {
  const source = text.replaceAll("\r\n", "\n");
  const fence = /```(?:[a-z0-9_+-]+)?[ \t]*\n?([\s\S]*?)```/giu;
  const blocks: MessageBlock[] = [];
  let cursor = 0;
  for (const match of source.matchAll(fence)) {
    const start = match.index;
    if (start > cursor) blocks.push(...parseTextBlocks(source.slice(cursor, start)));
    blocks.push({ type: "pre", text: (match[1] ?? "").replace(/\n$/, "") });
    cursor = start + match[0].length;
  }
  if (cursor < source.length) blocks.push(...parseTextBlocks(source.slice(cursor)));
  return promoteParagraphRuns(coalesceBlocks(blocks));
}

function LabeledCopy({
  item,
  keyPrefix,
}: {
  item: LabeledItem;
  keyPrefix: string;
}) {
  return (
    <>
      <span className="message-item-title">{renderInline(item.title, `${keyPrefix}-t`)}</span>
      {item.body ? (
        <span className="message-item-meta">{renderInline(item.body, `${keyPrefix}-m`)}</span>
      ) : null}
    </>
  );
}

function renderListItem(item: string, keyPrefix: string) {
  const labeled = parseLabeled(item);
  if (!labeled) return renderInline(item, keyPrefix);
  return <LabeledCopy item={labeled} keyPrefix={keyPrefix} />;
}

export function FormattedMessage({ children }: { children: string }) {
  const blocks = parseBlocks(children);
  if (!blocks.length) return null;
  return (
    <div className="message-rich">
      {blocks.map((block, index) => {
        if (block.type === "hr") return <hr key={index} className="message-rule" />;
        if (block.type === "h") {
          return (
            <h3 key={index} className="message-h">
              {renderInline(block.text, `h-${index}`)}
            </h3>
          );
        }
        if (block.type === "note") {
          return (
            <p key={index} className="message-note">
              {renderInline(block.text, `n-${index}`)}
            </p>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={index} className="message-quote">
              {renderInline(block.text, `q-${index}`)}
            </blockquote>
          );
        }
        if (block.type === "pre") {
          return (
            <pre key={index} className="message-pre">
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "entries") {
          const Tag = block.variant === "steps" ? "ol" : "ul";
          return (
            <Tag
              key={index}
              className={block.variant === "steps" ? "message-steps" : "message-entries"}
            >
              {block.items.map((item, itemIndex) => (
                <li
                  key={itemIndex}
                  className={block.variant === "steps" ? "message-step" : "message-entry"}
                >
                  {block.variant === "steps" ? (
                    <span className="message-step-n" aria-hidden="true">
                      {itemIndex + 1}
                    </span>
                  ) : null}
                  <div className="message-entry-body">
                    <LabeledCopy item={item} keyPrefix={`${index}-${itemIndex}`} />
                  </div>
                </li>
              ))}
            </Tag>
          );
        }
        if (block.type === "ol" || block.type === "ul") {
          const Tag = block.type;
          return (
            <Tag key={index} className="message-list">
              {block.items.map((item, itemIndex) => (
                <li
                  key={itemIndex}
                  className={parseLabeled(item) ? "message-item" : undefined}
                >
                  {renderListItem(item, `${index}-${itemIndex}`)}
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={index} className="message-copy-p whitespace-pre-wrap">
            {renderInline(block.text, String(index))}
          </p>
        );
      })}
    </div>
  );
}

/**
 * The small slice of Markdown the assistant actually emits.
 *
 * The model answers with bold labels, inline code for identifiers, and dash
 * lists. Printed as plain text those asterisks and backticks are noise sitting
 * between the operator and a situation code they may have to read aloud.
 *
 * This builds React elements rather than HTML, so there is no markup string to
 * sanitize and no injection surface to get wrong: anything the parser does not
 * recognise stays text. It is deliberately not a full Markdown implementation
 * — tables and nested lists are not in the answers, and supporting them would
 * cost more than it returns.
 */

import type { ReactNode } from "react";

/** Bold, inline code, links, and emphasis — in that order, longest marker first. */
const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^\s)]+\)|\*[^*\n]+\*)/g;

const LIST_ITEM = /^\s*[-*•]\s+(.*)$/u;
const ORDERED_ITEM = /^\s*(\d+)[.)]\s+(.*)$/u;
const HEADING = /^(#{1,6})\s+(.*)$/u;

/**
 * Only schemes that navigate. A citation the model invented is a wrong link;
 * a `javascript:` one is a script running in the console.
 */
function safeHref(url: string): string | null {
  return /^(https?:|mailto:)/iu.test(url) ? url : null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while (true) {
    match = INLINE_PATTERN.exec(text);
    if (!match) break;
    const token = match[0];
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    cursor = match.index + token.length;
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function Markdown({ text }: { readonly text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  /** Paragraph lines waiting for the blank line that ends them. */
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `p-${blocks.length}`;
    // Joined with a space, not a break: the model wraps prose mid-sentence,
    // and honouring those wraps ragged the panel at every width.
    blocks.push(<p key={key}>{renderInline(paragraph.join(" "), key)}</p>);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      const body: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !lines[index]?.trimStart().startsWith("```")
      ) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(
        <pre key={`pre-${blocks.length}`}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const key = `h-${blocks.length}`;
      // One visual weight for every level. The panel is 288px wide by
      // default; a six-step type scale inside it is a scale nobody can read.
      blocks.push(
        <p className="assistant-md-heading" key={key}>
          {renderInline(heading[2] ?? "", key)}
        </p>,
      );
      continue;
    }

    if (LIST_ITEM.test(line) || ORDERED_ITEM.test(line)) {
      flushParagraph();
      const ordered = !LIST_ITEM.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const item = ordered
          ? ORDERED_ITEM.exec(current)?.[2]
          : LIST_ITEM.exec(current)?.[1];
        if (item === undefined) break;
        items.push(item);
        index += 1;
      }
      index -= 1;
      const key = `l-${blocks.length}`;
      const children = items.map((item, itemIndex) => (
        // The list is rebuilt from the text on every render, so there is no
        // identity to key on beyond position.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
        <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`)}</li>
      ));
      blocks.push(
        ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>,
      );
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();

  return <div className="assistant-markdown">{blocks}</div>;
}

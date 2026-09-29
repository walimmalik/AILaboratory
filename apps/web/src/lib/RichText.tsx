import { Fragment, type ReactNode } from 'react';

/**
 * The small part of Markdown models actually write: paragraphs, "-" or "1." lists, **bold** and
 * `code`. Rendered as React elements, never as HTML, so a reply can't inject markup.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{lines(paragraph)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    // biome-ignore lint/suspicious/noArrayIndexKey: rendered once from fixed text, never reordered
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(
      list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>,
    );
    list = undefined;
  };

  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flushParagraph();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item[1] ?? '');
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.replace(/^#{1,6}\s+/, ''));
    }
  }
  flushParagraph();
  flushList();
  return <div className={className}>{blocks}</div>;
}

function lines(paragraph: string[]): ReactNode {
  return paragraph.map((line, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: rendered once from fixed text, never reordered
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      // biome-ignore lint/suspicious/noArrayIndexKey: rendered once from fixed text, never reordered
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      // biome-ignore lint/suspicious/noArrayIndexKey: rendered once from fixed text, never reordered
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

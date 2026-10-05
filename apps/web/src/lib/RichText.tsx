import { Fragment, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './RichText.css';

/**
 * The small part of Markdown models actually write: paragraphs, "-" or "1." lists, **bold** and
 * `code`, and pipe tables. Rendered as React elements, never as HTML, so a reply can't inject markup.
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

  const source = text.split('\n');
  for (let i = 0; i < source.length; i++) {
    const line = source[i] ?? '';
    if (
      line.includes('|') &&
      !/^\s*(?:[-*•]\s|\d+[.)]\s|#{1,6}\s)/.test(line) &&
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(source[i + 1] ?? '')
    ) {
      flushParagraph();
      flushList();
      const tableLines = [line, source[i + 1] ?? ''];
      i += 1;
      while (
        source[i + 1]?.includes('|') &&
        !/^\s*(?:[-*•]\s|\d+[.)]\s|#{1,6}\s)/.test(source[i + 1] ?? '')
      ) {
        tableLines.push(source[i + 1] ?? '');
        i += 1;
      }
      blocks.push(
        <Markdown
          key={blocks.length}
          remarkPlugins={[remarkGfm, literalHtml]}
          allowedElements={['p', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'code']}
          unwrapDisallowed
          components={{
            // A candidate with mismatched header/separator columns remains ordinary pipe text.
            p: () => <p>{lines(tableLines)}</p>,
            table: ({ children }) => (
              // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll wide tables
              <section className="rich-text-table-scroll" aria-label="Table" tabIndex={0}>
                <table className="rich-text-table">{children}</table>
              </section>
            ),
            th: ({ children, style }) => (
              <th scope="col" style={style}>
                {children}
              </th>
            ),
          }}
        >
          {tableLines.join('\n')}
        </Markdown>,
      );
      continue;
    }
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

/** Keep raw HTML visible as text, including inside a Markdown table. */
function literalHtml() {
  return function visit(node: { type: string; children?: { type: string }[] }) {
    if (node.type === 'html') node.type = 'text';
    node.children?.forEach(visit);
  };
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

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RichText } from './RichText.tsx';

const html = (text: string) => renderToStaticMarkup(<RichText text={text} />);

describe('RichText', () => {
  it('renders paragraphs, lists, bold and code', () => {
    expect(html('Drafted **WDG-0003**.\n\n- Volume: `200 uL`\n- Color: clear\n\n1. Confirm')).toBe(
      '<div><p>Drafted <strong>WDG-0003</strong>.</p><ul><li>Volume: <code>200 uL</code></li><li>Color: clear</li></ul><ol><li>Confirm</li></ol></div>',
    );
  });

  it('keeps line breaks inside a paragraph and never renders HTML', () => {
    expect(html('one\n<b>two</b>')).toBe('<div><p>one<br/>&lt;b&gt;two&lt;/b&gt;</p></div>');
  });
});

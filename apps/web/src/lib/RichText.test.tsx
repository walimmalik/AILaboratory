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

  it('renders pipe tables with semantic headers, cells and a keyboard-accessible scroll region', () => {
    const result = html('| Reagent | Amount |\n| --- | --- |\n| Buffer | 200 uL |');
    expect(result).toContain(
      '<section class="rich-text-table-scroll" aria-label="Table" tabindex="0">',
    );
    expect(result).toContain('<table class="rich-text-table"><thead><tr>');
    expect(result).toContain('<th scope="col">Reagent</th><th scope="col">Amount</th>');
    expect(result).toContain('<tbody><tr><td>Buffer</td><td>200 uL</td></tr></tbody>');
    expect(result).not.toContain('---');
  });

  it('supports optional outer pipes and column alignment', () => {
    const result = html('Name | Value | Note\n:--- | ---: | :---:\nBuffer | 200 uL | Ready');
    expect(result).toContain('<th scope="col" style="text-align:left">Name</th>');
    expect(result).toContain('<th scope="col" style="text-align:right">Value</th>');
    expect(result).toContain('<th scope="col" style="text-align:center">Note</th>');
    expect(result).toContain('<td style="text-align:right">200 uL</td>');
  });

  it('formats inline content, handles escaped pipes and displays HTML as safe text', () => {
    const result = html(
      '| **Reagent** | Detail |\n| --- | --- |\n| `A\\|B` | **Ready** <img src=x onerror=alert(1)> |',
    );
    expect(result).toContain('<th scope="col"><strong>Reagent</strong></th>');
    expect(result).toContain('<td><code>A|B</code></td>');
    expect(result).toContain('<strong>Ready</strong> &lt;img src=x onerror=alert(1)&gt;');
    expect(result).not.toContain('<img');
  });

  it('keeps prose and lists before and after a table', () => {
    const result = html(
      '- First\n\nAbout the plate\n| Name | Amount |\n| --- | --- |\n| Buffer | 200 uL |\nFinished\n\n1. Confirm',
    );
    expect(result).toContain('<ul><li>First</li></ul><p>About the plate</p>');
    expect(result).toContain('</table></section><p>Finished</p><ol><li>Confirm</li></ol>');
  });

  it('keeps non-table pipes and malformed separators as ordinary text', () => {
    for (const text of ['A | B\nC | D', 'A | B\n-- | ---', 'A | B\n--- | invalid']) {
      expect(html(text)).toBe(`<div><p>${text.replace('\n', '<br/>')}</p></div>`);
    }
  });

  it('rejects header/separator column mismatch without losing text or line breaks', () => {
    expect(html('| A | B |\n| --- |\n| one | two |')).toBe(
      '<div><p>| A | B |<br/>| --- |<br/>| one | two |</p></div>',
    );
  });

  it('pads short rows and ignores extra cells using standard GFM rules', () => {
    const result = html('| A | B |\n| --- | --- |\n| one |\n| two | three | extra |');
    expect(result).toContain('<tr><td>one</td><td></td></tr>');
    expect(result).toContain('<tr><td>two</td><td>three</td></tr>');
    expect(result).not.toContain('extra');
  });

  it('supports header-only and one-column tables with Windows line endings', () => {
    const result = html('| Name |\r\n| --- |\r\n\r\nAfter');
    expect(result).toContain('<th scope="col">Name</th>');
    expect(result).toContain('</table></section><p>After</p>');
  });

  it('does not absorb list items containing pipes after a table', () => {
    const result = html('| A | B |\n| --- | --- |\n| one | two |\n- choose A | B\n1. Confirm');
    expect(result).toContain(
      '</table></section><ul><li>choose A | B</li></ul><ol><li>Confirm</li></ol>',
    );
  });

  it('keeps a following pipe-containing quote as literal prose without repeating the table', () => {
    const result = html(
      '| A | B |\n| --- | --- |\n| one | two |\n> Note: choose **A** | `B`\nContinue with <b>care</b>',
    );
    expect(result).toContain(
      '</table></section><p>&gt; Note: choose <strong>A</strong> | <code>B</code><br/>Continue with &lt;b&gt;care&lt;/b&gt;</p>',
    );
    expect(result).not.toContain('| --- | --- |');
    expect(result.match(/<table /g)).toHaveLength(1);
  });

  it('keeps trailing pipe-containing prose, headings and numbered lists intact', () => {
    const result = html(
      '| A | B |\n| --- | --- |\n| one | two |\n\nChoose A | B\n# Note A | B\n1. Choose A | B',
    );
    expect(result).toContain(
      '</table></section><p>Choose A | B<br/>Note A | B</p><ol><li>Choose A | B</li></ol>',
    );
    expect(result).not.toContain('| --- | --- |');
  });

  it('renders only the trailing paragraph when GFM ends a candidate table at an HTML comment', () => {
    const result = html('| A | B |\n| --- | --- |\n| one | two |\n<!-- A | B -->\nChoose A | B');
    expect(result).toContain('<p>Choose A | B</p>');
    expect(result).toContain('&lt;!-- A | B --&gt;');
    expect(result).not.toContain('<p>| A | B |');
    expect(result).not.toContain('| --- | --- |');
  });
});

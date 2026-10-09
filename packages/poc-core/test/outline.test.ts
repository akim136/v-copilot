import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractOutline, imageDimensions, PREVIEW_CHARS, stableId } from '../src/outline';
import { OutlineSchema } from '../src/schemas';

const FIXTURES = ['landing', 'docs', 'catalog', 'blog'] as const;
const html = (name: string) => readFileSync(new URL(`../../../fixtures/prospects/${name}/index.html`, import.meta.url), 'utf8');
const baseUrl = (name: string) => `https://akim136.github.io/v-copilot/prospect-${name}/`;
const ids = (o: ReturnType<typeof extractOutline>) => [...o.headings, ...o.textBlocks, ...o.images].map((x) => x.id);
const page = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const BASE = 'https://example.com/a/';

describe('extractOutline on the prospect fixtures', () => {
  it.each(FIXTURES)('%s: two runs on the same HTML give identical outlines and IDs', (name) => {
    const a = extractOutline(html(name), { baseUrl: baseUrl(name) });
    const b = extractOutline(html(name), { baseUrl: baseUrl(name) });
    expect(b).toEqual(a);
    expect(ids(a).length).toBeGreaterThan(10);
  });

  it.each(FIXTURES)('%s: validates, IDs are unique and well formed, order lists every item once', (name) => {
    const o = OutlineSchema.parse(extractOutline(html(name), { baseUrl: baseUrl(name) }));
    const all = ids(o);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^[hti]-\d+-[0-9a-f]{8}$/);
    expect([...o.order].sort()).toEqual([...all].sort());
    for (const l of o.landmarks) for (const id of l.childIds) expect(all).toContain(id);
  });

  it.each(FIXTURES)('%s: IDs are pinned (eval labels and specs key on them)', (name) => {
    expect(ids(extractOutline(html(name), { baseUrl: baseUrl(name) }))).toMatchSnapshot();
  });

  it('reads the landing page structure', () => {
    const o = extractOutline(html('landing'), { baseUrl: baseUrl('landing') });
    expect(o.headings[0]).toEqual({ id: stableId('heading', 0, o.headings[0]!.text), level: 1, text: 'Forecast every store, every week, without the spreadsheet' });
    expect(o.headings.map((h) => h.level)).toContain(4);
    expect(o.images.map((i) => i.src)).toContain(`${baseUrl('landing')}assets/hero-dashboard.jpg`);
    expect(o.images.find((i) => i.src.endsWith('cta-team.jpg'))?.alt).toBe('');
    expect(o.scripts).toEqual([{ host: 'akim136.github.io', bytes: 0, blocking: true }]);
    expect(o.landmarks.map((l) => l.kind)).toEqual(['header', 'nav', 'main', 'section', 'section', 'section', 'section', 'section', 'section', 'footer']);
    // The blockquote's <footer> is not a page footer, and nothing from <head> becomes content.
    expect(o.landmarks.filter((l) => l.kind === 'footer')).toHaveLength(1);
    expect(o.textBlocks.some((t) => t.text.includes('Larkspur Labs — Forecasting'))).toBe(false);
    expect(o.order[0]).toBe(o.images[0]!.id);
  });
});

describe('extractOutline rules', () => {
  it('keeps earlier IDs when content is appended at the end', () => {
    const body = '<h1>Title</h1><p>First paragraph of the page.</p><img src="a.png">';
    const a = extractOutline(page(body), { baseUrl: BASE });
    const b = extractOutline(page(`${body}<h2>More</h2><p>Another one.</p><img src="b.png">`), { baseUrl: BASE });
    for (const id of ids(a)) expect(ids(b)).toContain(id);
  });

  it('gives identical paragraphs distinct IDs', () => {
    const o = extractOutline(page('<p>Same text.</p><p>Same text.</p>'), { baseUrl: BASE });
    expect(o.textBlocks.map((t) => t.id)).toEqual([stableId('text', 0, 'Same text.'), stableId('text', 1, 'Same text.')]);
  });

  it('splits text at block boundaries and joins inline text', () => {
    const o = extractOutline(page('<li>Item A <em>bold</em><ul><li>Sub</li></ul></li><div>Loose <a href="#">link</a><br>text</div>'), { baseUrl: BASE });
    expect(o.textBlocks.map((t) => t.text)).toEqual(['Item A bold', 'Sub', 'Loose link text']);
  });

  it('treats an inline element wrapping blocks as transparent', () => {
    const o = extractOutline(page('<a href="/x"><div><h3>Card</h3><p>Card body</p></div></a>'), { baseUrl: BASE });
    expect(o.headings.map((h) => h.text)).toEqual(['Card']);
    expect(o.textBlocks.map((t) => t.text)).toEqual(['Card body']);
  });

  it('never takes text from scripts, styles, hidden or embedded content', () => {
    const o = extractOutline(page(
      '<p>Visible</p><script>var secret = 1</script><style>p{}</style><noscript>ns</noscript><div hidden>gone</div>'
      + '<template><p>tpl</p></template><svg><text>svg</text></svg><textarea>ta</textarea>',
      '<title>Page title</title>',
    ), { baseUrl: BASE });
    expect(o.textBlocks.map((t) => t.text)).toEqual(['Visible']);
  });

  it('clamps h5 and h6 to level 4 and keeps heading images', () => {
    const o = extractOutline(page('<h5>Five</h5><h6><img src="logo.png" alt="Logo"> Six</h6>'), { baseUrl: BASE });
    expect(o.headings.map((h) => [h.level, h.text])).toEqual([[4, 'Five'], [4, 'Six']]);
    expect(o.images.map((i) => i.alt)).toEqual(['Logo']);
  });

  it('truncates previews but keeps the full text', () => {
    const long = 'word '.repeat(200).trim();
    const [t] = extractOutline(page(`<p>${long}</p>`), { baseUrl: BASE }).textBlocks;
    expect(t!.text).toBe(long);
    expect(Array.from(t!.preview)).toHaveLength(PREVIEW_CHARS + 1);
    expect(t!.preview.endsWith('…')).toBe(true);
  });

  it('resolves image sources and skips data URIs and missing sources', () => {
    const o = extractOutline(page(
      '<img src="data:image/gif;base64,R0lGOD" data-src="lazy.jpg"><img srcset="s.jpg 1x, s2.jpg 2x"><img alt="no src"><img src="/abs.png">',
    ), { baseUrl: BASE });
    expect(o.images.map((i) => i.src)).toEqual(['https://example.com/a/lazy.jpg', 'https://example.com/a/s.jpg', 'https://example.com/abs.png']);
  });

  it('flags content images by size, preferring tag dimensions over intrinsic ones', () => {
    const imageSizes = new Map([
      ['https://example.com/a/big.png', { width: 800, height: 600 }],
      ['https://example.com/a/icon.png', { width: 512, height: 512 }],
      ['https://example.com/a/strip.png', { width: 1200, height: 40 }],
      ['https://example.com/a/tiny.png', { width: 32, height: 32 }],
    ]);
    const o = extractOutline(page(
      '<img src="big.png"><img src="icon.png" width="24" height="24"><img src="strip.png"><img src="tiny.png"><img src="unknown.png">',
    ), { baseUrl: BASE, imageSizes });
    expect(o.images.map((i) => [i.width, i.height, i.content])).toEqual([
      [800, 600, true], [24, 24, false], [1200, 40, true], [32, 32, false], [0, 0, true],
    ]);
  });

  it('groups scripts by host with sizes and render-blocking status', () => {
    const scriptBytes = new Map([['https://cdn.example.net/lib.js', 5000], ['https://example.com/a/app.js', 700]]);
    const o = extractOutline(page(
      '<script src="app.js" defer></script><script>console.log(1)</script><script type="application/ld+json">{}</script>',
      '<script src="https://cdn.example.net/lib.js"></script><script src="app.js" async></script><script type="module" src="m.js"></script>',
    ), { baseUrl: BASE, scriptBytes });
    expect(o.scripts).toEqual([
      { host: 'cdn.example.net', bytes: 5000, blocking: true },
      { host: 'example.com', bytes: 1400, blocking: false },
      { host: 'inline', bytes: 14, blocking: false },
    ]);
  });

  it('assigns items to their nearest landmark and maps ARIA roles', () => {
    const o = extractOutline(page(
      '<div role="banner"><h1>Brand</h1></div><main><section><h2>S</h2><article><header><p>Byline</p></header></article></section></main>'
      + '<div role="contentinfo"><p>Legal</p></div>',
    ), { baseUrl: BASE });
    expect(o.landmarks.map((l) => [l.kind, l.childIds.length])).toEqual([['header', 1], ['main', 0], ['section', 2], ['footer', 1]]);
  });
});

describe('imageDimensions', () => {
  it('reads PNG header dimensions and rejects unknown bytes', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d494844520000012c000000c80806000000', 'hex');
    expect(imageDimensions(png)).toEqual({ width: 300, height: 200 });
    expect(imageDimensions(Buffer.from('not an image'))).toBeUndefined();
  });
});

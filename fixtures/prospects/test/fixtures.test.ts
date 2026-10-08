import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error untyped build script
import { assetKind, build, FIXTURES } from '../build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// The h2 sections each fixture must keep. Milestone 3 labels anchor on these.
const EXPECTED_SECTIONS: Record<string, string[]> = {
  landing: [
    'Trusted by independent retailers in 14 countries',
    'Everything a buying team needs in one place',
    'What our customers say',
    'Frequently asked questions',
    'Start forecasting in an afternoon',
  ],
  docs: ['Install the SDK', 'Create an API key', 'Send your first document', 'Listen for review events', 'Troubleshooting'],
  catalog: ['Featured gear', 'Why hikers choose Fernhollow', 'From the trail', 'Free shipping on orders over $100'],
  blog: ['Reading a sediment core', 'The mill years', 'What comes next', 'Get the next essay in your inbox'],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function hashTree(dir: string): Record<string, string> {
  return Object.fromEntries(
    walk(dir).map((p) => [relative(dir, p), createHash('sha256').update(readFileSync(p)).digest('hex')]),
  );
}

describe.each(FIXTURES as string[])('fixture %s', (name) => {
  const html = readFileSync(join(root, name, 'index.html'), 'utf8');
  const $ = load(html);

  it('has the page landmarks and exactly one h1', () => {
    for (const sel of ['body > header nav', 'body > main', 'body > footer']) expect($(sel), sel).toHaveLength(1);
    expect($('h1')).toHaveLength(1);
    expect($('html').attr('lang')).toBe('en');
  });

  it('keeps its labeled sections in order', () => {
    const h2 = $('h2').map((_, el) => $(el).text().trim()).get();
    expect(h2).toEqual(EXPECTED_SECTIONS[name]);
  });

  it('has enough content text blocks for fidelity scoring', () => {
    const blocks = $('main p').map((_, el) => $(el).text().trim()).get().filter((t) => t.length >= 40);
    expect(blocks.length).toBeGreaterThanOrEqual(6);
  });

  it('is deliberately slow: render-blocking script and stylesheet in head', () => {
    const blocking = $('head script[src]').filter((_, el) => !('async' in el.attribs) && !('defer' in el.attribs));
    expect(blocking.length).toBeGreaterThan(0);
    expect($('head link[rel=stylesheet][href="assets/bloat.css"]')).toHaveLength(1);
  });

  it('is deliberately slow: images have no dimensions or lazy loading', () => {
    const imgs = $('img');
    expect(imgs.length).toBeGreaterThan(1);
    imgs.each((_, el) => {
      expect(el.attribs.width, el.attribs.src).toBeUndefined();
      expect(el.attribs.height, el.attribs.src).toBeUndefined();
      expect(el.attribs.loading, el.attribs.src).toBeUndefined();
    });
  });

  it('has at least one image missing alt text, for the accessibility baseline', () => {
    expect($('img:not([alt])').length).toBeGreaterThanOrEqual(1);
  });

  it('marks itself as fictional', () => {
    expect($('.legal').text()).toMatch(/fictional/i);
  });
});

describe('fixture build', () => {
  let outA: string;
  let outB: string;

  beforeAll(async () => {
    outA = await build(mkdtempSync(join(tmpdir(), 'fixtures-a-')));
    outB = await build(mkdtempSync(join(tmpdir(), 'fixtures-b-')));
  }, 120_000);

  it('produces every file the page references', () => {
    for (const name of FIXTURES as string[]) {
      const dir = join(outA, `prospect-${name}`);
      const $ = load(readFileSync(join(dir, 'index.html'), 'utf8'));
      const refs = [
        ...$('img[src], script[src]').map((_, el) => el.attribs.src).get(),
        ...$('link[href]').map((_, el) => el.attribs.href).get(),
      ];
      expect(refs.length).toBeGreaterThan(4);
      for (const ref of refs) expect(existsSync(join(dir, ref)), `${name}: ${ref}`).toBe(true);
    }
  });

  it('refuses asset types it cannot generate', () => {
    expect(() => assetKind('diagram.svg')).toThrow(/unsupported/);
    expect(assetKind('hero.jpg')).toBe('image');
  });

  it('ships an oversized hero image and heavy vendor script', () => {
    for (const name of FIXTURES as string[]) {
      const html = readFileSync(join(outA, `prospect-${name}`, 'index.html'), 'utf8');
      const hero = load(html)('img.hero-image').attr('src')!;
      expect(statSync(join(outA, `prospect-${name}`, hero)).size, hero).toBeGreaterThan(300_000);
      expect(statSync(join(outA, `prospect-${name}`, 'assets/vendor.js')).size).toBeGreaterThan(200_000);
    }
  });

  it('refuses to clear a directory it did not produce', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixtures-foreign-'));
    writeFileSync(join(dir, 'keep.txt'), 'not ours');
    await expect(build(dir)).rejects.toThrow(/refusing to clear/);
    expect(existsSync(join(dir, 'keep.txt'))).toBe(true);
  });

  it('does not treat a generic Pages directory as its own output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixtures-pages-'));
    writeFileSync(join(dir, '.nojekyll'), '');
    writeFileSync(join(dir, 'keep.txt'), 'not ours');
    await expect(build(dir)).rejects.toThrow(/refusing to clear/);
  });

  it('can rebuild after a build that failed partway', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixtures-partial-'));
    await expect(build(dir, ['landing', 'does-not-exist'])).rejects.toThrow(/ENOENT/);
    expect(existsSync(join(dir, 'prospect-landing', 'index.html'))).toBe(true);
    await expect(build(dir, ['landing'])).resolves.toBe(dir);
  }, 60_000);

  it('rebuilds over its own previous output', async () => {
    await expect(build(outA)).resolves.toBe(outA);
  }, 60_000);

  it('is deterministic', () => {
    expect(hashTree(outA)).toEqual(hashTree(outB));
  });
});

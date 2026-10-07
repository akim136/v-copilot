// Builds the prospect fixtures into dist/prospect-<name>/ for GitHub Pages.
// The pages are deliberately slow: oversized images with no dimensions, a large
// render-blocking script and stylesheet, and a late banner that shifts layout.
// Output is deterministic for a given commit and platform (Pages always builds on ubuntu).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const FIXTURES = ['landing', 'docs', 'catalog', 'blog'];
const here = dirname(fileURLToPath(import.meta.url));

export function referencedAssets(html) {
  return [...new Set([...html.matchAll(/(?:src|href)="assets\/([^"]+)"/g)].map((m) => m[1]))];
}

const SHARED_ASSETS = new Set(['vendor.js', 'widgets.js', 'bloat.css']);

export function assetKind(name) {
  if (SHARED_ASSETS.has(name)) return 'shared';
  if (/^[a-z0-9-]+\.(png|jpg)$/.test(name)) return 'image';
  throw new Error(`unsupported fixture asset: ${name}`);
}

function rng(seedText) {
  let s = createHash('sha256').update(seedText).digest().readUInt32LE(0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

function imageSize(name) {
  if (name.endsWith('-logo.png')) return { width: 960, height: 240 };
  if (name.startsWith('logo-')) return { width: 800, height: 260 };
  if (/hero|diagram|estuary/.test(name)) return { width: 2000, height: 1250 };
  return { width: 1400, height: 1000 };
}

async function renderImage(name) {
  const { width, height } = imageSize(name);
  const rand = rng(name);
  const base = [rand() * 255, rand() * 255, rand() * 255];
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const g = (x / width + y / height) * 60;
      for (let c = 0; c < 3; c++) {
        raw[i + c] = Math.max(0, Math.min(255, base[c] + g - 30 + (rand() - 0.5) * 48));
      }
    }
  }
  const img = sharp(raw, { raw: { width, height, channels: 3 } });
  return name.endsWith('.png') ? img.png({ compressionLevel: 6 }).toBuffer() : img.jpeg({ quality: 92 }).toBuffer();
}

function vendorJs() {
  // ~300 KB of inert data plus a synchronous busy loop to add main-thread blocking time.
  const rand = rng('vendor');
  const rows = Array.from({ length: 6000 }, (_, i) => `"k${i}":"${Math.floor(rand() * 1e12).toString(36).repeat(4)}"`);
  return `/* fixture vendor bundle: intentionally heavy */\nwindow.__vendorData={${rows.join(',')}};\n` +
    `(function(){var t=0;for(var i=0;i<60000000;i++){t=(t+i*7)%1000003;}window.__vendorChecksum=t;})();\n`;
}

function widgetsJs() {
  // Inserts a promo banner at the top of the page after load, shifting content down.
  return `/* fixture widgets: late layout shift */\n` +
    `(function(){var t=0;for(var i=0;i<30000000;i++){t=(t+i*3)%999983;}\n` +
    `setTimeout(function(){var b=document.createElement('div');b.className='promo-banner';` +
    `b.textContent='Autumn offer: 20% off annual plans this week only.';document.body.insertBefore(b,document.body.firstChild);},1200);})();\n`;
}

function bloatCss() {
  const rand = rng('bloat');
  const rules = Array.from({ length: 4000 }, (_, i) =>
    `.u-${i}-${Math.floor(rand() * 1e6).toString(36)}{margin:${i % 17}px;padding:${i % 13}px;color:#${Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0')}}`);
  return rules.join('\n') + '\n';
}

export async function build(outDir = join(here, 'dist')) {
  rmSync(outDir, { recursive: true, force: true });
  const shared = { 'vendor.js': vendorJs(), 'widgets.js': widgetsJs(), 'bloat.css': bloatCss() };
  const links = [];
  for (const name of FIXTURES) {
    const dir = join(outDir, `prospect-${name}`);
    mkdirSync(join(dir, 'assets'), { recursive: true });
    const html = readFileSync(join(here, name, 'index.html'), 'utf8');
    writeFileSync(join(dir, 'index.html'), html);
    copyFileSync(join(here, 'shared', 'styles.css'), join(dir, 'styles.css'));
    for (const asset of referencedAssets(html)) {
      const target = join(dir, 'assets', asset);
      if (assetKind(asset) === 'shared') writeFileSync(target, shared[asset]);
      else writeFileSync(target, await renderImage(asset));
    }
    links.push(`<li><a href="prospect-${name}/">prospect-${name}</a></li>`);
  }
  writeFileSync(join(outDir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>v-copilot fixtures</title><meta name="robots" content="noindex"></head>` +
    `<body><h1>v-copilot prospect fixtures</h1><p>Fictional test pages for v-copilot. Not real companies.</p><ul>${links.join('')}</ul></body></html>\n`);
  writeFileSync(join(outDir, '.nojekyll'), '');
  return outDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await build(process.argv[2]);
  console.log(`built fixtures into ${out}`);
}

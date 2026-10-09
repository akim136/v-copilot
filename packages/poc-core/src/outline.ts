import { createHash } from 'node:crypto';
import { imageSize } from 'image-size';
import { parse, type DefaultTreeAdapterTypes as T } from 'parse5';
import type { Outline } from './schemas';

export const PREVIEW_CHARS = 280;
export const CONTENT_IMAGE_MIN_PX = 100;

type Kind = 'heading' | 'text' | 'image';
type Landmark = Outline['landmarks'][number];
type Size = { width: number; height: number };

export interface ExtractOptions {
  // The page URL; image and script sources resolve against it.
  baseUrl: string;
  // Intrinsic image sizes read by intake, keyed by absolute URL. Used when the tag has no width/height.
  imageSizes?: ReadonlyMap<string, Size>;
  // Script transfer sizes, keyed by absolute URL (Lighthouse network requests).
  scriptBytes?: ReadonlyMap<string, number>;
}

// `${kind[0]}-${indexWithinKind}-${sha1(text|src).slice(0, 8)}`: the spec, fidelity and eval labels key on it.
export function stableId(kind: Kind, index: number, key: string): string {
  return `${kind[0]}-${index}-${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}

// Width and height from an image file's header bytes, or undefined if the format is not recognized.
export function imageDimensions(bytes: Uint8Array): Size | undefined {
  try {
    const { width, height } = imageSize(bytes);
    return width && height ? { width, height } : undefined;
  } catch {
    return undefined;
  }
}

const SKIP = new Set([
  'title', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'embed', 'canvas', 'video',
  'audio', 'map', 'select', 'textarea', 'option', 'datalist',
]);
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'button', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'ins', 'kbd',
  'label', 'mark', 'picture', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
]);
const SECTIONING = new Set(['article', 'aside', 'main', 'nav', 'section']);
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);

const isElement = (n: T.ChildNode): n is T.Element => 'tagName' in n;
const attr = (el: T.Element, name: string) => el.attrs.find((a) => a.name === name)?.value;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function preview(text: string): string {
  const chars = Array.from(text);
  return chars.length <= PREVIEW_CHARS ? text : `${chars.slice(0, PREVIEW_CHARS).join('')}…`;
}

function resolve(src: string | undefined, base: string): string | undefined {
  if (!src || src.startsWith('data:')) return undefined;
  try {
    return new URL(src, base).href;
  } catch {
    return undefined;
  }
}

function dimension(value: string | undefined): number | undefined {
  const n = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function landmarkKind(el: T.Element, inSectioning: boolean): Landmark['kind'] | undefined {
  const role = attr(el, 'role');
  if (el.tagName === 'nav' || role === 'navigation') return 'nav';
  if (el.tagName === 'main' || role === 'main') return 'main';
  if (el.tagName === 'section' || role === 'region') return 'section';
  // header and footer are page landmarks only outside sectioning content (ARIA banner / contentinfo).
  if ((el.tagName === 'header' && !inSectioning) || role === 'banner') return 'header';
  if ((el.tagName === 'footer' && !inSectioning) || role === 'contentinfo') return 'footer';
  return undefined;
}

interface Ctx { landmark?: Landmark; inSectioning: boolean; inHead: boolean }

// Extracts the structural outline of a page in code. Pure: the same HTML and options always give the
// same outline and the same IDs.
export function extractOutline(html: string, opts: ExtractOptions): Outline {
  const out: Outline = { headings: [], textBlocks: [], images: [], landmarks: [], scripts: [], order: [] };
  const seqOf = new Map<string, number>();
  const scripts = new Map<string, { bytes: number; blocking: boolean }>();
  let seq = 0;
  let run: { parts: string[]; seq: number; ctx: Ctx } | undefined;

  const place = (id: string, at: number, ctx: Ctx) => {
    seqOf.set(id, at);
    ctx.landmark?.childIds.push(id);
  };

  const flush = () => {
    const text = run ? clean(run.parts.join('')) : '';
    if (run && text) {
      const id = stableId('text', out.textBlocks.length, text);
      out.textBlocks.push({ id, text, preview: preview(text) });
      place(id, run.seq, run.ctx);
    }
    run = undefined;
  };

  const image = (el: T.Element, ctx: Ctx) => {
    const srcset = attr(el, 'srcset')?.trim().split(/\s+/)[0];
    const src = resolve(attr(el, 'src'), opts.baseUrl) ?? resolve(attr(el, 'data-src'), opts.baseUrl) ?? resolve(srcset, opts.baseUrl);
    if (!src) return;
    const intrinsic = opts.imageSizes?.get(src);
    const width = dimension(attr(el, 'width')) ?? intrinsic?.width ?? 0;
    const height = dimension(attr(el, 'height')) ?? intrinsic?.height ?? 0;
    // Unknown dimensions count as content, so fidelity never gets easier because a size was missing.
    const content = (width === 0 && height === 0) || width >= CONTENT_IMAGE_MIN_PX || height >= CONTENT_IMAGE_MIN_PX;
    const id = stableId('image', out.images.length, src);
    out.images.push({ id, src, alt: clean(attr(el, 'alt') ?? ''), width, height, content });
    place(id, seq++, ctx);
  };

  const script = (el: T.Element, ctx: Ctx) => {
    const type = (attr(el, 'type') ?? '').trim().toLowerCase();
    if (!JS_TYPES.has(type)) return;
    const raw = attr(el, 'src');
    const src = raw === undefined ? undefined : resolve(raw, opts.baseUrl);
    if (raw !== undefined && !src) return;
    const host = src ? new URL(src).host : 'inline';
    const bytes = src
      ? (opts.scriptBytes?.get(src) ?? 0)
      : Buffer.byteLength(el.childNodes.map((c) => ('value' in c ? c.value : '')).join(''), 'utf8');
    // Render-blocking as Lighthouse counts it: an external classic script in <head> without async/defer.
    const blocking = Boolean(src) && ctx.inHead && type !== 'module' && attr(el, 'async') === undefined && attr(el, 'defer') === undefined;
    const prev = scripts.get(host) ?? { bytes: 0, blocking: false };
    scripts.set(host, { bytes: prev.bytes + bytes, blocking: prev.blocking || blocking });
  };

  // Text and images inside a heading belong to the heading; nothing inside starts a text block.
  const headingText = (node: T.ChildNode, parts: string[], ctx: Ctx) => {
    if (node.nodeName === '#text') parts.push((node as T.TextNode).value);
    if (!isElement(node) || SKIP.has(node.tagName) || node.tagName === 'script' || attr(node, 'hidden') !== undefined) return;
    if (node.tagName === 'img') return image(node, ctx);
    if (node.tagName === 'br') parts.push(' ');
    for (const c of node.childNodes) headingText(c, parts, ctx);
  };

  const visit = (node: T.ChildNode, ctx: Ctx) => {
    if (node.nodeName === '#text') {
      const value = (node as T.TextNode).value;
      if (!run && value.trim()) run = { parts: [], seq: seq++, ctx };
      run?.parts.push(value);
      return;
    }
    if (!isElement(node) || attr(node, 'hidden') !== undefined) return;
    const tag = node.tagName;
    if (tag === 'script') return script(node, ctx);
    if (tag === 'head') {
      for (const c of node.childNodes) if (isElement(c) && c.tagName === 'script') script(c, { ...ctx, inHead: true });
      return;
    }
    if (SKIP.has(tag)) return;
    if (tag === 'br') return void run?.parts.push(' ');
    if (tag === 'img') return image(node, ctx);
    const level = /^h([1-6])$/.exec(tag)?.[1];
    if (level) {
      flush();
      const at = seq++;
      const parts: string[] = [];
      for (const c of node.childNodes) headingText(c, parts, ctx);
      const text = clean(parts.join(''));
      if (!text) return;
      const id = stableId('heading', out.headings.length, text);
      out.headings.push({ id, level: Math.min(Number(level), 4) as 1 | 2 | 3 | 4, text });
      place(id, at, ctx);
      return;
    }
    if (INLINE.has(tag)) {
      for (const c of node.childNodes) visit(c, ctx);
      return;
    }
    // Any other element is a block: it ends the current run of inline text and starts its own.
    flush();
    const kind = landmarkKind(node, ctx.inSectioning);
    const landmark = kind ? { kind, childIds: [] } : undefined;
    if (landmark) out.landmarks.push(landmark);
    const inner: Ctx = { landmark: landmark ?? ctx.landmark, inSectioning: ctx.inSectioning || SECTIONING.has(tag), inHead: false };
    for (const c of node.childNodes) visit(c, inner);
    flush();
  };

  for (const c of parse(html).childNodes) visit(c, { inSectioning: false, inHead: false });
  flush();

  out.scripts = [...scripts].map(([host, s]) => ({ host, ...s }));
  out.order = [...seqOf].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  return out;
}

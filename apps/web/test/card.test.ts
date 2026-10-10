import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CriteriaCard } from '@/lib/poc/types';

// A fake Telegram chat that keeps each message's latest card.
const tg = vi.hoisted(() => ({ messages: new Map<string, unknown>(), posts: [] as unknown[], nextId: 1 }));
const fakeTelegram = {
  postMessage: async (_thread: string, message: unknown) => {
    const id = String(tg.nextId++);
    tg.messages.set(id, message);
    return { id, threadId: 'telegram:1', raw: {} };
  },
  editMessage: async (_thread: string, id: string, message: unknown) => {
    if (!tg.messages.has(id)) throw new Error('Bad Request: message to edit not found');
    if (JSON.stringify(tg.messages.get(id)) === JSON.stringify(message)) throw new Error('Bad Request: message is not modified');
    tg.messages.set(id, message);
    return { id, threadId: 'telegram:1', raw: {} };
  },
};
vi.mock('@/lib/telegram', () => ({
  alexChatThread: () => 'telegram:1',
  getReadyBot: async () => ({ getAdapter: () => fakeTelegram, thread: () => ({ post: async (m: unknown) => void tg.posts.push(m) }) }),
}));

const { armCriteriaCard, closeCriteriaCard, criteriaCardLines, postCriteriaCard, sendAlert } = await import('@/lib/poc/card');

const RUN = 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA';
const median = { performance: 61, lcp: 18329.984, cls: 0.1267, tbt: 229, fcp: 2245.984, ttfb: 47, jsBytes: 59676, accessibility: 85, seo: 82 };
const hostile = '[click](https://evil.example) ![x](https://evil.example/p.png) <b>bold</b> *a* _b_ `c` | www.evil.example';
const card = (o: Partial<CriteriaCard> = {}): CriteriaCard => ({
  runId: RUN, targetName: 'prospect-landing', brief: 'Make it fast', median, runs: 3,
  criteria: [{ id: 'c1', metric: 'lcp', baseline: median.lcp, target: 2500, rationale: 'Hero image is the LCP element.' }],
  dropped: [], opportunities: ['Size the hero image'], costUsd: 0.0123, ...o,
});

type Node = { type: string; id?: string; value?: string; content?: string; children?: Node[] };
const walk = (n: Node, out: Node[] = []): Node[] => {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
};
const buttons = (m: unknown) => walk(m as Node).filter((n) => n.type === 'button');
const texts = (m: unknown) => walk(m as Node).filter((n) => n.type === 'text').map((n) => n.content ?? '');

describe('criteria card', () => {
  beforeEach(() => {
    tg.messages.clear();
    tg.posts = [];
    tg.nextId = 1;
  });

  it('ends as one message with exactly Approve and Reject, each fitting Telegram\'s 64-byte callback data', async () => {
    const id = await postCriteriaCard(card());
    expect(buttons(tg.messages.get(id))).toEqual([]);
    await armCriteriaCard(card(), id);
    await armCriteriaCard(card(), id); // a retried edit that already landed
    expect(tg.messages.size).toBe(1);
    const b = buttons(tg.messages.get(id));
    expect(b.map((x) => [x.id, x.value])).toEqual([['ca', RUN], ['cr', RUN]]);
    for (const x of b) expect(Buffer.byteLength(`chat:${JSON.stringify({ a: x.id, v: x.value })}`)).toBeLessThanOrEqual(64);
  });

  it('removes the buttons once decided', async () => {
    const id = await postCriteriaCard(card());
    await armCriteriaCard(card(), id);
    await closeCriteriaCard(card(), id, { decision: 'approve', via: 'telegram' });
    expect(buttons(tg.messages.get(id))).toEqual([]);
    expect(texts(tg.messages.get(id)).join('\n')).toMatch(/Approved via telegram/);
  });

  it('shows the baseline, criteria and spend', () => {
    // What Telegram displays once the escapes are read.
    const shown = criteriaCardLines(card()).join('\n').replace(/\\(.)/g, '$1');
    expect(shown).toContain('Baseline, median of 3 mobile runs: Performance 61, LCP 18,330 ms, CLS 0.127, TBT 229 ms');
    expect(shown).toContain('c1 LCP: 18,330 ms to 2,500 ms. Hero image is the LCP element.');
    expect(shown).toContain('Model spend so far: $0.0123');
  });

  it('escapes model, page and brief text so it cannot add links, images, formatting or HTML', () => {
    const lines = criteriaCardLines(card({
      brief: hostile, opportunities: [hostile, hostile],
      criteria: [{ id: 'c1', metric: 'lcp', baseline: median.lcp, target: 2500, rationale: hostile }],
      dropped: [{ metric: hostile, reason: hostile }],
    }));
    for (const l of lines) {
      expect(l).not.toMatch(/(^|[^\\])[[\]()<>*_`|]/);
      expect(l).not.toMatch(/www\.evil/);
    }
  });

  it('stays under Telegram\'s 4,096 characters even if every character were escaped', () => {
    const long = '!'.repeat(1000);
    const criteria = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => ({ id, metric: 'lcp' as const, baseline: median.lcp, target: 2500, rationale: long.slice(0, 200) }));
    const lines = criteriaCardLines(card({ brief: long, opportunities: [long, long, long], criteria, dropped: criteria.map(() => ({ metric: 'tbt', reason: 'no improvement on baseline' })) }));
    expect(lines.join('\n').length).toBeLessThan(4096);
  });

  it('caps the dropped list, however many criteria the model proposed', () => {
    const dropped = Array.from({ length: 200 }, () => ({ metric: 'lcp', reason: 'duplicate metric' }));
    const shown = criteriaCardLines(card({ dropped })).join('\n');
    expect(shown.length).toBeLessThan(4096);
    expect(shown.replace(/\\(.)/g, '$1')).toContain('and 197 more');
  });

  it('escapes and redacts alerts', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    await sendAlert(`run failed: [x](https://evil.example) token ${process.env.TELEGRAM_BOT_TOKEN}`);
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(tg.posts).toHaveLength(1);
    const text = String(tg.posts[0]);
    expect(text).not.toContain('AAAAAAAAAA');
    expect(text).toContain('\\[x\\]');
  });
});

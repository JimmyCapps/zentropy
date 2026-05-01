import { describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { Analyzer, AnalyzerResult, SecurityVerdict } from '../types.js';
import { HoneyLLMBlockedError } from '../types.js';
import { screenToolMessages } from '../middleware.js';

function makeVerdict(status: SecurityVerdict['status']): SecurityVerdict {
  return {
    status,
    confidence: 100,
    totalScore: status === 'COMPROMISED' ? 80 : status === 'SUSPICIOUS' ? 20 : 0,
    url: 'https://example.com/',
    timestamp: 1_700_000_000_000,
    analysisError: null,
  };
}

function clean(content: string): AnalyzerResult {
  return {
    content,
    verdict: makeVerdict('CLEAN'),
    mitigationsApplied: [],
  };
}

function compromised(content: string): AnalyzerResult {
  return {
    content,
    verdict: makeVerdict('COMPROMISED'),
    mitigationsApplied: [],
  };
}

function makeAnalyzer(...results: AnalyzerResult[]): Analyzer {
  if (results.length === 0) throw new Error('makeAnalyzer requires at least one result');
  let i = 0;
  return {
    analyzeHtml: vi.fn(async () => {
      const r = results[i] ?? results[results.length - 1];
      i += 1;
      return r as AnalyzerResult;
    }),
  };
}

describe('screenToolMessages', () => {
  it('returns the input untouched when there are no messages', async () => {
    const out = await screenToolMessages([], { analyzer: makeAnalyzer(clean('x')) });
    expect(out).toEqual([]);
  });

  it('returns the input untouched when there are no ToolMessages at the tail', async () => {
    const msgs: BaseMessage[] = [new HumanMessage('hi'), new AIMessage('hello')];
    const analyzer = makeAnalyzer(clean('x'));
    const out = await screenToolMessages(msgs, { analyzer });
    expect(out).toEqual(msgs);
    expect(analyzer.analyzeHtml).not.toHaveBeenCalled();
  });

  it('replaces a tail ToolMessage content with the screened (sanitised) string on CLEAN', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://example.com/' }, id: 't1' }],
    });
    const tm = new ToolMessage({
      content: '<html>raw</html>',
      tool_call_id: 't1',
      name: 'web_fetch',
    });
    const out = await screenToolMessages([ai, tm], {
      analyzer: makeAnalyzer(clean('sanitised')),
    });
    expect(out).toHaveLength(2);
    const replaced = out[1] as ToolMessage;
    expect(replaced).toBeInstanceOf(ToolMessage);
    expect(replaced.content).toBe('sanitised');
    expect(replaced.tool_call_id).toBe('t1');
    expect(replaced.name).toBe('web_fetch');
  });

  it('throws HoneyLLMBlockedError on COMPROMISED under default policy', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://example.com/' }, id: 't1' }],
    });
    const tm = new ToolMessage({
      content: '<html>tainted</html>',
      tool_call_id: 't1',
      name: 'web_fetch',
    });
    await expect(
      screenToolMessages([ai, tm], { analyzer: makeAnalyzer(compromised('tainted')) }),
    ).rejects.toBeInstanceOf(HoneyLLMBlockedError);
  });

  it('does not throw on COMPROMISED under flag-only policy and passes content through', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://example.com/' }, id: 't1' }],
    });
    const tm = new ToolMessage({
      content: '<html>tainted</html>',
      tool_call_id: 't1',
      name: 'web_fetch',
    });
    const out = await screenToolMessages([ai, tm], {
      analyzer: makeAnalyzer(compromised('tainted')),
      policy: 'flag-only',
    });
    expect((out[1] as ToolMessage).content).toBe('tainted');
  });

  it('screens every ToolMessage in the tail batch (parallel tool calls)', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [
        { name: 'web_fetch', args: { url: 'https://a.example/' }, id: 't1' },
        { name: 'web_fetch', args: { url: 'https://b.example/' }, id: 't2' },
      ],
    });
    const tm1 = new ToolMessage({ content: '<a/>', tool_call_id: 't1', name: 'web_fetch' });
    const tm2 = new ToolMessage({ content: '<b/>', tool_call_id: 't2', name: 'web_fetch' });
    const analyzer = makeAnalyzer(clean('A'), clean('B'));
    const out = await screenToolMessages([ai, tm1, tm2], { analyzer });
    expect((out[1] as ToolMessage).content).toBe('A');
    expect((out[2] as ToolMessage).content).toBe('B');
    expect(analyzer.analyzeHtml).toHaveBeenCalledTimes(2);
  });

  it('passes the URL hint by correlating ToolMessage.tool_call_id with the prior AIMessage tool_calls', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://target.example/x' }, id: 't1' }],
    });
    const tm = new ToolMessage({ content: '<h/>', tool_call_id: 't1', name: 'web_fetch' });
    const analyzer = makeAnalyzer(clean('ok'));
    await screenToolMessages([ai, tm], { analyzer });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<h/>',
      url: 'https://target.example/x',
    });
  });

  it('omits url when no AIMessage tool_call matches and no extractor finds one', async () => {
    const tm = new ToolMessage({ content: '<h/>', tool_call_id: 'orphan', name: 'web_fetch' });
    const analyzer = makeAnalyzer(clean('ok'));
    await screenToolMessages([tm], { analyzer });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({ html: '<h/>' });
  });

  it('skips ToolMessages whose name is not in toolNames filter', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [
        { name: 'web_fetch', args: { url: 'https://a.example/' }, id: 't1' },
        { name: 'calculator', args: { x: 2 }, id: 't2' },
      ],
    });
    const tm1 = new ToolMessage({ content: '<a/>', tool_call_id: 't1', name: 'web_fetch' });
    const tm2 = new ToolMessage({ content: '4', tool_call_id: 't2', name: 'calculator' });
    const analyzer = makeAnalyzer(clean('A'));
    const out = await screenToolMessages([ai, tm1, tm2], {
      analyzer,
      toolNames: ['web_fetch'],
    });
    expect((out[1] as ToolMessage).content).toBe('A');
    expect((out[2] as ToolMessage).content).toBe('4');
    expect(analyzer.analyzeHtml).toHaveBeenCalledTimes(1);
  });

  it('honours a custom extractUrl over the default precedence walk', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ name: 'fetch', args: { target: 'https://other.example/' }, id: 't1' }],
    });
    const tm = new ToolMessage({ content: '<h/>', tool_call_id: 't1', name: 'fetch' });
    const analyzer = makeAnalyzer(clean('ok'));
    await screenToolMessages([ai, tm], {
      analyzer,
      extractUrl: (args) => (args as { target: string }).target,
    });
    expect(analyzer.analyzeHtml).toHaveBeenCalledWith({
      html: '<h/>',
      url: 'https://other.example/',
    });
  });

  it('passes through ToolMessages with status=error without screening', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://example.com/' }, id: 't1' }],
    });
    const tm = new ToolMessage({
      content: 'fetch failed: ECONNREFUSED',
      tool_call_id: 't1',
      name: 'web_fetch',
      status: 'error',
    });
    const analyzer = makeAnalyzer(clean('x'));
    const out = await screenToolMessages([ai, tm], { analyzer });
    expect(out[1]).toBe(tm);
    expect(analyzer.analyzeHtml).not.toHaveBeenCalled();
  });

  it('passes through ToolMessages with non-string (multimodal array) content unchanged', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://example.com/' }, id: 't1' }],
    });
    const tm = new ToolMessage({
      content: [{ type: 'text', text: 'hello' }],
      tool_call_id: 't1',
      name: 'web_fetch',
    });
    const analyzer = makeAnalyzer(clean('x'));
    const out = await screenToolMessages([ai, tm], { analyzer });
    expect(out[1]).toBe(tm);
    expect(analyzer.analyzeHtml).not.toHaveBeenCalled();
  });

  it('only screens the tail batch — earlier ToolMessages from prior turns are left alone', async () => {
    const ai1 = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://old.example/' }, id: 't0' }],
    });
    const oldTm = new ToolMessage({ content: '<old/>', tool_call_id: 't0', name: 'web_fetch' });
    const aiText = new AIMessage('intermediate');
    const ai2 = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://new.example/' }, id: 't1' }],
    });
    const newTm = new ToolMessage({ content: '<new/>', tool_call_id: 't1', name: 'web_fetch' });
    const analyzer = makeAnalyzer(clean('NEW'));
    const out = await screenToolMessages([ai1, oldTm, aiText, ai2, newTm], { analyzer });
    expect(out[1]).toBe(oldTm);
    expect((out[4] as ToolMessage).content).toBe('NEW');
    expect(analyzer.analyzeHtml).toHaveBeenCalledTimes(1);
  });

  it('preserves ToolMessage tool_call_id, name, status, and additional_kwargs on replacement', async () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ name: 'web_fetch', args: { url: 'https://example.com/' }, id: 't1' }],
    });
    const tm = new ToolMessage({
      content: '<h/>',
      tool_call_id: 't1',
      name: 'web_fetch',
      status: 'success',
      additional_kwargs: { custom: 'meta' },
    });
    const analyzer = makeAnalyzer(clean('san'));
    const out = await screenToolMessages([ai, tm], { analyzer });
    const replaced = out[1] as ToolMessage;
    expect(replaced.tool_call_id).toBe('t1');
    expect(replaced.name).toBe('web_fetch');
    expect(replaced.status).toBe('success');
    expect(replaced.additional_kwargs).toEqual({ custom: 'meta' });
  });
});

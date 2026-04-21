import * as cp from 'node:child_process';
import type { GhNode, IssueState, PrState } from './types.js';

export type RunFn = (cmd: string, args: string[]) => Promise<string>;

export const defaultRun: RunFn = (cmd, args) =>
  new Promise<string>((resolve, reject) => {
    const child = cp.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
    });
  });

interface RawNode {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: ReadonlyArray<{ name: string; description?: string; color?: string }>;
  updatedAt: string;
}

const ISSUE_FIELDS = 'number,title,body,state,labels,updatedAt';
const PR_FIELDS = 'number,title,body,state,labels,updatedAt';

function normaliseIssueState(s: string): IssueState {
  return s.toLowerCase() === 'closed' ? 'closed' : 'open';
}
function normalisePrState(s: string): PrState {
  const lower = s.toLowerCase();
  if (lower === 'merged') return 'merged';
  if (lower === 'closed') return 'closed';
  if (lower === 'draft') return 'draft';
  return 'open';
}

export async function fetchGhNodes(opts: { run?: RunFn } = {}): Promise<GhNode[]> {
  const run = opts.run ?? defaultRun;
  try {
    const [issuesJson, prsJson] = await Promise.all([
      run('gh', ['issue', 'list', '--state', 'all', '--limit', '200', '--json', ISSUE_FIELDS]),
      run('gh', ['pr', 'list', '--state', 'all', '--limit', '200', '--json', PR_FIELDS]),
    ]);
    const issues: RawNode[] = JSON.parse(issuesJson);
    const prs: RawNode[] = JSON.parse(prsJson);

    const issueNodes: GhNode[] = issues.map((r) => ({
      kind: 'issue', number: r.number, title: r.title, body: r.body ?? '',
      state: normaliseIssueState(r.state), labels: r.labels,
      updatedAt: r.updatedAt,
    }));
    const prNodes: GhNode[] = prs.map((r) => ({
      kind: 'pr', number: r.number, title: r.title, body: r.body ?? '',
      state: normalisePrState(r.state), labels: r.labels,
      updatedAt: r.updatedAt,
    }));
    return [...issueNodes, ...prNodes];
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ENOENT') {
      throw new Error('gh CLI not found. Install from https://cli.github.com/ and run `gh auth login`.');
    }
    throw err;
  }
}

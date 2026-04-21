import type { GhNode, Edge } from './types.js';

const REF_RE = /(?<![\w#])#(\d+)\b/g;

function stripCodeBlocks(body: string): string {
  return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
}

export function extractReferenceEdges(nodes: ReadonlyArray<GhNode>): Edge[] {
  const out: Edge[] = [];
  for (const node of nodes) {
    const stripped = stripCodeBlocks(node.body ?? '');
    const seen = new Set<number>();
    REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REF_RE.exec(stripped)) !== null) {
      const target = Number(match[1]);
      if (target === node.number) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      out.push({ type: 'references', from: node.number, to: target });
    }
  }
  return out;
}

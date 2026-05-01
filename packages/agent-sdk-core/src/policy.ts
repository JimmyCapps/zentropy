import type { SecurityVerdict, WrapPolicy } from './types.js';

export function shouldBlock(verdict: SecurityVerdict, policy: WrapPolicy): boolean {
  switch (policy) {
    case 'flag-only':
      return false;
    case 'block-on-compromised':
      return verdict.status === 'COMPROMISED';
    case 'block-on-suspicious':
      return verdict.status === 'COMPROMISED' || verdict.status === 'SUSPICIOUS';
  }
}

export function blockedReason(verdict: SecurityVerdict): string {
  return (
    `HoneyLLM blocked tool output: status=${verdict.status} ` +
    `score=${String(verdict.totalScore)} url=${verdict.url || '<unknown>'}`
  );
}

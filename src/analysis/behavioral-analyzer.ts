import type { ProbeResult, BehavioralFlags } from '@/types/verdict.js';
import { detectRoleDrift } from './role-drift.js';
import { detectExfiltration } from './exfiltration.js';
import { detectInstructionFollowing } from './instruction-following.js';

export function analyzeBehavior(probeResults: readonly ProbeResult[]): BehavioralFlags {
  const roleDrift = detectRoleDrift(probeResults);
  const exfiltrationIntent = detectExfiltration(probeResults);
  const instructionFollowing = detectInstructionFollowing(probeResults);

  const instructionProbe = probeResults.find((r) => r.probeName === 'instruction_detection');
  const hiddenContentAwareness = instructionProbe !== undefined && !instructionProbe.passed;

  return {
    roleDrift,
    exfiltrationIntent,
    instructionFollowing,
    hiddenContentAwareness,
  };
}

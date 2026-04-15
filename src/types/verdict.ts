export type SecurityStatus = 'CLEAN' | 'SUSPICIOUS' | 'COMPROMISED';

export interface ProbeResult {
  readonly probeName: string;
  readonly passed: boolean;
  readonly flags: readonly string[];
  readonly rawOutput: string;
  readonly score: number;
}

export interface BehavioralFlags {
  readonly roleDrift: boolean;
  readonly exfiltrationIntent: boolean;
  readonly instructionFollowing: boolean;
  readonly hiddenContentAwareness: boolean;
}

export interface SecurityVerdict {
  readonly status: SecurityStatus;
  readonly confidence: number;
  readonly totalScore: number;
  readonly probeResults: readonly ProbeResult[];
  readonly behavioralFlags: BehavioralFlags;
  readonly mitigationsApplied: readonly string[];
  readonly timestamp: number;
  readonly url: string;
}

export interface AISecurityReport {
  readonly status: SecurityStatus;
  readonly confidence: number;
  readonly timestamp: number;
  readonly url: string;
  readonly probes: {
    readonly summarization: { readonly passed: boolean; readonly flags: readonly string[] };
    readonly instructionDetection: { readonly passed: boolean; readonly found: readonly string[] };
    readonly adversarialCompliance: { readonly passed: boolean; readonly flags: readonly string[] };
  };
  readonly analysis: {
    readonly roleDrift: boolean;
    readonly exfiltrationIntent: boolean;
    readonly instructionFollowing: boolean;
  };
  readonly mitigationsApplied: readonly string[];
}

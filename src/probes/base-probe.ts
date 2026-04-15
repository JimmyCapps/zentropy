export interface ProbeAnalysis {
  readonly passed: boolean;
  readonly flags: readonly string[];
  readonly score: number;
}

export interface Probe {
  readonly name: string;
  readonly systemPrompt: string;
  buildUserMessage(chunk: string): string;
  analyzeResponse(output: string, originalChunk: string): ProbeAnalysis;
}

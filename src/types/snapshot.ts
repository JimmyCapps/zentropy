export interface ScriptFingerprint {
  readonly src: string | null;
  readonly preview: string;
  readonly hash: string;
  readonly length: number;
}

export interface PageMetadata {
  readonly title: string;
  readonly url: string;
  readonly origin: string;
  readonly description: string;
  readonly ogTags: ReadonlyMap<string, string>;
  readonly cspMeta: string | null;
  readonly lang: string;
}

export interface PageSnapshot {
  readonly visibleText: string;
  readonly hiddenText: string;
  readonly scriptFingerprints: readonly ScriptFingerprint[];
  readonly metadata: PageMetadata;
  readonly extractedAt: number;
  readonly charCount: number;
}

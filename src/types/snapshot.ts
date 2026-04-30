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
  // SR-F (registry-#51) — raw `document.documentElement.outerHTML` from the
  // page context, captured by the content-script extractor so the SW
  // registry-lookup can run `extractZones` + `fingerprintZone` against the
  // committed RegistryEntry.zones for the snapshot's origin. Optional:
  // pre-SR-F snapshots (and synthetic test fixtures) may omit it; the
  // registry lookup misses on absent / empty HTML by design (RFC §Q5
  // fail-safe — no HTML means full analysis runs).
  readonly pageHtml?: string;
}

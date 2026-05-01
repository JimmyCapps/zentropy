export interface ScriptFingerprint {
  readonly src: string | null;
  readonly preview: string;
  readonly hash: string;
  readonly length: number;
}

// Phase 4 Stage 4G.2 (issue #9) — page image reference. Captured by the
// content-script extractor for Stage 4G.3's multimodal image-injection probe.
// `sizeClass` is bucketed off `max(width, height)` (`small` < 200 px, `medium`
// < 500 px, `large` ≥ 500 px) so probe scheduling can prioritise hero images
// over thumbnails. `visibleInViewport` reflects extractor-time visibility, not
// scroll state. `src` is the resolved absolute URL (`HTMLImageElement.src`),
// not the raw attribute, so srcset / data: / blob: URLs survive serialisation.
export interface ImageRef {
  readonly src: string;
  readonly altText: string;
  readonly width: number;
  readonly height: number;
  readonly visibleInViewport: boolean;
  readonly sizeClass: 'small' | 'medium' | 'large';
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
  // Phase 4 Stage 4G.2 (issue #9) — top-N images surfaced by the content-script
  // extractor for the future image-injection probe (4G.3). Throttled at
  // ≥50×50 px, tracking-beacon URLs filtered, capped at 5/page ranked by
  // size×visibility. Optional: pre-4G.2 snapshots and synthetic test fixtures
  // omit it; downstream consumers (the 4G.3 probe + 4G.6 popup column) treat
  // absent / empty arrays identically as "no images to scan".
  readonly images?: readonly ImageRef[];
}

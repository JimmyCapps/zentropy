export interface ZoneFingerprint {
  readonly structural: string;
  readonly tokens: string;
  readonly version?: string;
}

export interface RegistryZone {
  readonly zoneId: string;
  readonly selector: string;
  readonly fingerprint: ZoneFingerprint;
}

export interface RegistryEntry {
  readonly origin: string;
  readonly capturedAt: number;
  readonly schemaVersion: 1;
  readonly zones: readonly RegistryZone[];
  readonly excludedSelectors: readonly string[];
}

export interface ZoneText {
  readonly zoneId: string;
  readonly htmlSnippet: string;
  readonly normalisedText: string;
  readonly structureSkeleton: string;
}

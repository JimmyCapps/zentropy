export type EntityType =
  | 'url'
  | 'email'
  | 'credit_card'
  | 'api_key'
  | 'credential'
  | 'exfil_domain'
  // Issue #156 — freeform NER entity classes from CoNLL-2003 trained
  // transformers (DistilBERT-NER). Surfaced from the offscreen NER engine
  // and merged into EvidencePacket.entities alongside regex extractors.
  | 'person'
  | 'organization'
  | 'location'
  | 'misc';

export type EntityMetadataValue = string | number | boolean;

export interface Entity {
  readonly type: EntityType;
  readonly value: string;
  readonly span: readonly [number, number];
  readonly confidence: number;
  readonly metadata?: Readonly<Record<string, EntityMetadataValue>>;
}

export interface EntityExtractor {
  readonly type: EntityType;
  extract(text: string, offset?: number): readonly Entity[];
}

/**
 * Issue #122 (N14d) — rolled-up entity counts + capped sample list,
 * attached to SecurityVerdict.entitySummary. Computed from all evidence
 * packets across a page's chunks, deduplicated by type+value.
 */
export interface EntitySummary {
  readonly counts: Readonly<Partial<Record<EntityType, number>>>;
  readonly samples: readonly Entity[];
}

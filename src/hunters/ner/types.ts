export type EntityType =
  | 'url'
  | 'email'
  | 'credit_card'
  | 'api_key'
  | 'credential'
  | 'exfil_domain';

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

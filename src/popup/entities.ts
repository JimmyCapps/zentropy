import type { Entity, EntityType, EntitySummary } from '@/hunters/ner/types.js';

export type { EntitySummary };
export { rollupEntities } from '@/hunters/ner/rollup.js';

const PLACEHOLDER_LEGACY = 'No entity data yet.';
const PLACEHOLDER_EMPTY = 'No entities extracted.';

const ENTITY_TYPE_ORDER: readonly EntityType[] = [
  'exfil_domain',
  'credential',
  'credit_card',
  'api_key',
  'url',
  'email',
];

const ENTITY_TYPE_LABEL: Readonly<Record<EntityType, string>> = Object.freeze({
  url: 'URL',
  email: 'Email',
  credit_card: 'Credit card',
  api_key: 'API key',
  credential: 'Credential',
  exfil_domain: 'Exfil domain',
});

function maskValue(entity: Entity): string {
  if (entity.type === 'credit_card' && entity.value.length > 4) {
    const digits = entity.value.replace(/[\s-]/g, '');
    return `**** **** **** ${digits.slice(-4)}`;
  }
  if (entity.type === 'api_key' && entity.value.length > 8) {
    return `${entity.value.slice(0, 4)}…${entity.value.slice(-4)}`;
  }
  if (entity.type === 'credential') {
    const eq = entity.value.indexOf('=');
    if (eq !== -1) return `${entity.value.slice(0, eq + 1)}***`;
    const colon = entity.value.indexOf(':');
    if (colon !== -1) return `${entity.value.slice(0, colon + 1)} ***`;
  }
  return entity.value;
}

export function renderEntitySummary(
  body: HTMLElement,
  summary: EntitySummary | null | undefined,
): void {
  if (summary === undefined) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_LEGACY;
    return;
  }
  if (summary === null) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_EMPTY;
    return;
  }
  const totalCount = Object.values(summary.counts).reduce(
    (acc, n) => acc + (n ?? 0),
    0,
  );
  if (totalCount === 0) {
    body.replaceChildren();
    body.className = 'placeholder';
    body.textContent = PLACEHOLDER_EMPTY;
    return;
  }

  const countsRow = document.createElement('div');
  countsRow.className = 'entity-counts';
  for (const type of ENTITY_TYPE_ORDER) {
    const n = summary.counts[type];
    if (n === undefined || n === 0) continue;
    const span = document.createElement('span');
    span.className = `entity-count entity-count-${type}`;
    span.textContent = `${ENTITY_TYPE_LABEL[type]}: ${n}`;
    countsRow.appendChild(span);
  }

  const list = document.createElement('ul');
  list.className = 'entity-sample-list';
  for (const sample of summary.samples) {
    const li = document.createElement('li');
    li.className = `entity-sample entity-sample-${sample.type}`;
    const label = document.createElement('span');
    label.className = 'entity-sample-label';
    label.textContent = `${ENTITY_TYPE_LABEL[sample.type]}:`;
    const value = document.createElement('span');
    value.className = 'entity-sample-value';
    value.textContent = maskValue(sample);
    li.append(label, ' ', value);
    list.appendChild(li);
  }

  body.replaceChildren(countsRow, list);
  body.className = '';
}

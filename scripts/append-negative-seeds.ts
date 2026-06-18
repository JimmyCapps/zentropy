#!/usr/bin/env tsx
/**
 * Issue #232 — append negative-kind anti-anchor seeds to
 * `data/injection-corpus.json` WITHOUT re-embedding the existing 270
 * positive entries. Embedding values are stored at 6dp but the underlying
 * q8 model isn't fully byte-deterministic across machines/OS/CPU
 * microarchitecture, so a blanket re-embed via `npm run embed:corpus`
 * would churn the diff for reasons unrelated to this fix.
 *
 * Strategy:
 *   1. Read current corpus (270 entries).
 *   2. Embed only the new negative seeds defined here.
 *   3. Append them with `kind: 'negative'`.
 *   4. Write back; bump `count`; refresh `generated_at`.
 *
 * Usage:  npx tsx scripts/append-negative-seeds.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EMBEDDING_DIM = 384;
const EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';
const PRECISION = 6;

interface CorpusEntry {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly lang: string;
  readonly techniques: readonly string[];
  readonly kind?: 'positive' | 'negative';
  readonly embedding: readonly number[];
}

interface Corpus {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly schema?: unknown;
  readonly notes?: readonly string[];
  count: number;
  entries: CorpusEntry[];
}

interface SeedDraft {
  readonly id: string;
  readonly text: string;
  readonly lang: 'en' | 'es' | 'zh-CN';
  readonly techniques: readonly string[];
}

const NEGATIVE_SEEDS: readonly SeedDraft[] = [
  // English retail / e-commerce promotional copy — the BrickLink shape that
  // false-positives at 0.86-0.89 cosine to imperative-verb injection text.
  {
    id: 'benign/retail/short-imperatives',
    text: 'Buy now! Click here! Limited offer!',
    lang: 'en',
    techniques: ['retail-promotional'],
  },
  {
    id: 'benign/retail/marketplace-cta',
    text: 'Welcome to our marketplace, the world\'s largest online store. Featured Offers: Limited Time Offer Save 20%. Shop our latest arrivals and get exclusive discounts. Click here to browse now. Best Sellers: See what other customers are buying. Click to view bestsellers.',
    lang: 'en',
    techniques: ['retail-promotional'],
  },
  {
    id: 'benign/retail/promotional-list',
    text: 'Buy now and save on selected items. Limited time offer Act fast! Free shipping on orders over $75. Click the Add to Cart button to purchase. Order today and receive exclusive benefits. Limited stock available Order now. Shop now for the best prices. Click here to see our new releases.',
    lang: 'en',
    techniques: ['retail-promotional'],
  },
  {
    id: 'benign/retail/cta-shop-now',
    text: 'Ready to Shop? Browse thousands of items from verified sellers worldwide. Start shopping now. Click here to view all products.',
    lang: 'en',
    techniques: ['retail-promotional'],
  },
  {
    id: 'benign/retail/newsletter-signup',
    text: 'Sign up for our newsletter to receive exclusive offers and early access to new products. Click here to subscribe and get 10% off your first order. Don\'t miss out on the latest deals delivered straight to your inbox.',
    lang: 'en',
    techniques: ['retail-promotional', 'newsletter'],
  },
  {
    id: 'benign/retail/flash-sale',
    text: 'Flash Sale Today Only! Save up to 50% on selected categories. Click here to shop the sale. Hurry, offer ends at midnight. Free returns within 30 days. Order now and your items will ship within 24 hours.',
    lang: 'en',
    techniques: ['retail-promotional', 'urgency'],
  },
  {
    id: 'benign/retail/membership-cta',
    text: 'Join our rewards program today and earn points on every purchase. Click here to sign up. Members get free shipping, exclusive previews, and birthday rewards. Start earning rewards today.',
    lang: 'en',
    techniques: ['retail-promotional', 'loyalty'],
  },
  {
    id: 'benign/retail/cart-checkout',
    text: 'Your cart is empty. Continue shopping to add items. Already a member? Sign in to view your saved items and continue checkout. Click here to apply a promo code at checkout. Estimated delivery: 3-5 business days.',
    lang: 'en',
    techniques: ['retail-promotional'],
  },
  {
    id: 'benign/retail/product-detail',
    text: 'Add to Cart. Add to Wishlist. Buy it Now. View Product Details. Customer Reviews 4.5 stars. In Stock - Order today and ships tomorrow. Limited quantities available. Click here to see similar items.',
    lang: 'en',
    techniques: ['retail-promotional', 'product-page'],
  },
  {
    id: 'benign/retail/banner-ad',
    text: 'Don\'t miss our biggest sale of the year! Up to 70% off everything. Click here to start shopping. Enter code SAVE20 for an extra 20% off. Limited time only. Shop the sale now.',
    lang: 'en',
    techniques: ['retail-promotional', 'urgency'],
  },
  // News / media navigation calls-to-action.
  {
    id: 'benign/news/read-more',
    text: 'Read more about this story. Click here to subscribe. Sign up for breaking news alerts delivered to your inbox. Follow us on social media for the latest updates. Visit our newsletter archive for past stories.',
    lang: 'en',
    techniques: ['news-cta'],
  },
  {
    id: 'benign/news/article-list',
    text: 'Latest stories: Click here for politics. Click here for business. Click here for sports. View all sections. Trending now. Editor\'s picks. Click to read the full article.',
    lang: 'en',
    techniques: ['news-cta'],
  },
  // Recipe / how-to imperative shapes.
  {
    id: 'benign/recipe/instructions',
    text: 'Click here to print this recipe. Save to your recipe box. Add to grocery list. Buy these ingredients online. Try this recipe tonight. Limited time: get 20% off cookware.',
    lang: 'en',
    techniques: ['lifestyle-cta'],
  },
  {
    id: 'benign/recipe/follow-steps',
    text: 'Follow these simple steps to bake the perfect bread. First, mix the flour and water. Next, add the starter and salt. Then fold the dough. Finally, bake until golden brown. Click here to watch the video tutorial.',
    lang: 'en',
    techniques: ['lifestyle-cta', 'instructional'],
  },
  // Spanish promotional copy — symmetry with es DM-4 entries.
  {
    id: 'benign/retail/es/comprar-ahora',
    text: '¡Compra ahora! ¡Haz clic aquí! ¡Oferta por tiempo limitado! Envío gratis en pedidos superiores a $75. Haz clic aquí para ver las novedades. Aprovecha los descuentos exclusivos.',
    lang: 'es',
    techniques: ['retail-promotional'],
  },
  {
    id: 'benign/retail/es/marketplace',
    text: 'Bienvenido a nuestro mercado, la tienda en línea más grande del mundo. Ofertas destacadas: Tiempo limitado, ahorra un 20%. Compra nuestros últimos productos y obtén descuentos exclusivos. Haz clic aquí para navegar ahora.',
    lang: 'es',
    techniques: ['retail-promotional'],
  },
  {
    id: 'benign/retail/es/newsletter',
    text: 'Suscríbete a nuestro boletín para recibir ofertas exclusivas y acceso anticipado a nuevos productos. Haz clic aquí para suscribirte y obtén un 10% de descuento en tu primera compra.',
    lang: 'es',
    techniques: ['retail-promotional', 'newsletter'],
  },
  // Chinese (Simplified) promotional copy — symmetry with zh-CN DM-4 entries.
  {
    id: 'benign/retail/zh-CN/buy-now',
    text: '立即购买！点击这里！限时优惠！订单超过75美元免运费。点击这里查看新品。享受独家折扣。',
    lang: 'zh-CN',
    techniques: ['retail-promotional'],
  },
  {
    id: 'benign/retail/zh-CN/marketplace',
    text: '欢迎来到我们的市场，世界上最大的在线商店。精选优惠：限时优惠，节省20%。购买我们最新的商品，享受独家折扣。点击这里立即浏览。',
    lang: 'zh-CN',
    techniques: ['retail-promotional'],
  },
  // Generic landing-page navigation.
  {
    id: 'benign/landing/contact-cta',
    text: 'Get in touch with our team today. Click here to start a conversation. Schedule a free consultation. Sign up for a free trial. No credit card required. See how it works.',
    lang: 'en',
    techniques: ['saas-cta'],
  },
  {
    id: 'benign/landing/feature-list',
    text: 'Click here to see all features. Start your free trial today. View pricing. See customer success stories. Read the documentation. Browse integrations. Get started in minutes.',
    lang: 'en',
    techniques: ['saas-cta'],
  },
];

function passagePrefix(text: string): string {
  return `passage: ${text}`;
}

function roundVector(vec: Float32Array, precision: number): number[] {
  const factor = 10 ** precision;
  const out: number[] = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = Math.round((vec[i] as number) * factor) / factor;
  return out;
}

async function embedTexts(texts: readonly string[]): Promise<readonly Float32Array[]> {
  const tf = await import('@huggingface/transformers');
  const pipe = await tf.pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: 'q8' });
  const tensor = await pipe(texts.map(passagePrefix), { pooling: 'mean', normalize: true });
  const flat = tensor.data as Float32Array;
  const dim = (tensor.dims as readonly number[])[1] ?? EMBEDDING_DIM;
  const rows = (tensor.dims as readonly number[])[0] ?? texts.length;
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) out.push(flat.slice(i * dim, (i + 1) * dim));
  return out;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
  const corpusPath = resolve(repoRoot, 'data/injection-corpus.json');

  console.log(`[append-negative-seeds] reading ${corpusPath}`);
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf-8')) as Corpus;
  const existingIds = new Set(corpus.entries.map((e) => e.id));
  const seedsToAdd = NEGATIVE_SEEDS.filter((s) => !existingIds.has(s.id));
  if (seedsToAdd.length === 0) {
    console.log('[append-negative-seeds] all negative seeds already present; nothing to do.');
    return;
  }
  console.log(`[append-negative-seeds] embedding ${seedsToAdd.length} new negative seeds`);
  const vectors = await embedTexts(seedsToAdd.map((s) => s.text));

  const newEntries: CorpusEntry[] = seedsToAdd.map((s, i) => ({
    id: s.id,
    source: 'issue-#232 anti-anchor seeds (retail/promotional/news shapes that cosine-collide with imperative-verb injection text)',
    text: s.text,
    lang: s.lang,
    techniques: s.techniques,
    kind: 'negative',
    embedding: roundVector(vectors[i]!, PRECISION),
  }));

  corpus.entries.push(...newEntries);
  corpus.count = corpus.entries.length;
  // Keep generated_at stable so diff stays focused on the additions.
  // (If a future regen needs a new timestamp, embed:corpus.ts will update it.)

  console.log(`[append-negative-seeds] writing ${corpus.entries.length} entries (${newEntries.length} new) to ${corpusPath}`);
  writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);

  console.log('[append-negative-seeds] sanity: top-3 of each new seed by id ↓');
  for (const e of newEntries) {
    const e0 = (e.embedding as number[])[0];
    const e1 = (e.embedding as number[])[1];
    const e2 = (e.embedding as number[])[2];
    console.log(`  ${e.lang.padEnd(5)} ${e.id}  e[0..3]=${e0?.toFixed(4)},${e1?.toFixed(4)},${e2?.toFixed(4)}`);
  }
  console.log('[append-negative-seeds] done.');
}

main().catch((err) => {
  console.error('[append-negative-seeds] failed:', err);
  process.exit(1);
});

import { defaultExtractUrl } from './extract-url.js';
import { screenContentOrThrow } from './screen.js';
import type { Analyzer, WrapPolicy } from './types.js';

export interface DocumentLike {
  readonly pageContent: string;
  readonly metadata?: Record<string, unknown>;
}

export interface DocumentLoaderLike {
  readonly load: () => Promise<readonly DocumentLike[]>;
}

export interface WrappedDocumentLoader {
  readonly load: () => Promise<DocumentLike[]>;
}

export interface WrapDocumentLoaderOptions<L extends DocumentLoaderLike = DocumentLoaderLike> {
  readonly analyzer: Analyzer;
  readonly policy?: WrapPolicy;
  readonly getUrl?: (loader: L, doc: DocumentLike, index: number) => string | undefined;
}

interface MaybeUrlBearingLoader {
  readonly webPath?: unknown;
  readonly urls?: unknown;
}

function loaderUrl(loader: MaybeUrlBearingLoader, index: number): string | undefined {
  if (typeof loader.webPath === 'string') {
    return defaultExtractUrl(loader.webPath);
  }
  if (Array.isArray(loader.urls)) {
    const candidate = loader.urls[index];
    if (typeof candidate === 'string') return defaultExtractUrl(candidate);
  }
  return undefined;
}

function defaultUrlForDoc(loader: DocumentLoaderLike, doc: DocumentLike, index: number): string | undefined {
  const sourceFromMeta =
    doc.metadata && typeof doc.metadata['source'] === 'string'
      ? defaultExtractUrl(doc.metadata['source'])
      : undefined;
  if (sourceFromMeta !== undefined) return sourceFromMeta;
  return loaderUrl(loader as MaybeUrlBearingLoader, index);
}

export function wrapDocumentLoader<L extends DocumentLoaderLike>(
  loader: L,
  opts: WrapDocumentLoaderOptions<L>,
): WrappedDocumentLoader {
  return {
    async load(): Promise<DocumentLike[]> {
      const docs = await loader.load();
      const screened: DocumentLike[] = [];
      for (let i = 0; i < docs.length; i += 1) {
        const doc = docs[i] as DocumentLike;
        const url = opts.getUrl?.(loader, doc, i) ?? defaultUrlForDoc(loader, doc, i);
        const result = await screenContentOrThrow({
          html: doc.pageContent,
          analyzer: opts.analyzer,
          ...(url !== undefined ? { url } : {}),
          ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
        });
        screened.push({
          pageContent: result.content,
          ...(doc.metadata !== undefined ? { metadata: doc.metadata } : {}),
        });
      }
      return screened;
    },
  };
}

export function wrapWebBaseLoader<L extends DocumentLoaderLike>(
  loader: L,
  opts: WrapDocumentLoaderOptions<L>,
): WrappedDocumentLoader {
  return wrapDocumentLoader(loader, opts);
}

export function wrapPlaywrightURLLoader<L extends DocumentLoaderLike>(
  loader: L,
  opts: WrapDocumentLoaderOptions<L>,
): WrappedDocumentLoader {
  return wrapDocumentLoader(loader, opts);
}

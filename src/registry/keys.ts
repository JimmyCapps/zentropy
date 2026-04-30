/**
 * v1 registry signing public key (Ed25519, 32 bytes hex-encoded).
 *
 * Rotated 2026-04-30 (SR-H pre-release): the matching private key was
 * generated alongside this public key for the v1.0-pre signed-registry.json
 * commit. The maintainer SHOULD rotate to a hardware-token-backed key
 * before tagging v1.0 final — same procedure below, replace this constant,
 * resign with `npm run build:release`. Rotation cadence per RFC §Q6: one
 * signing key per annual release with a 30-day public-key overlap window.
 *
 * To rotate, run offline (Node ≥20):
 *   node --input-type=module -e "
 *     import * as ed from '@noble/ed25519';
 *     const priv = ed.utils.randomPrivateKey();
 *     const pub = await ed.getPublicKeyAsync(priv);
 *     const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2,'0')).join('');
 *     console.log('PRIVATE (store offline):', hex(priv));
 *     console.log('PUBLIC (commit to keys.ts):', hex(pub));
 *   "
 * Store the printed PRIVATE in a password manager / hardware token; export it
 * to scripts/sign-registry.ts via the HONEYLLM_REGISTRY_SIGNING_KEY env var
 * at maintainer-signing time only.
 */
export const REGISTRY_PUBLIC_KEY_HEX =
  'e2fbe502cd8508283fd5369279d5bd04d89171b859a24fbf990c9268a38d0de3';

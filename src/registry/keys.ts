/**
 * v1 registry signing public key (Ed25519, 32 bytes hex-encoded).
 *
 * Generated 2026-04-30 offline; the matching private key is held by the
 * project maintainer and never enters the repo. Rotation cadence per RFC §Q6:
 * one signing key per annual release with a 30-day public-key overlap window.
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
  'ecd5ba4b879102591636fbe427c82ea044c95459f3e8b274e5a22172940896d9';

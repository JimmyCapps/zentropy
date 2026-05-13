# Install-Secret Rotation Invariant Checks

Periodic (2-week) verification that `ensureInstallSecret()` remains read-before-write idempotent and the `onInstalled`/`onStartup` handlers never rotate the secret.

| Date | Result | Notes | HEAD commit |
|---|---|---|---|
| 2026-05-13 | PASS | no drift detected | 88edf930e0eca2a9828b6c3041b895a8c772fbf3 |

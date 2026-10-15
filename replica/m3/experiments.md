# CloudKit experiments (M3.1)

Date: 2026-10-15 · Status: **not run: waiting for the owner's OK** to register the iCloud container
`iCloud.com.harrisonfischberg.keepsake` and create a CloudKit Web Services API token on team
`KTV2G3Z883` (first-time registration on the account, which `PROMPT.md` reserves for the owner).
Nothing here ships in M3. The design they test is in `sync-bridge.md`.

What is ready without the account:
- `Sealer` (CryptoKit X25519 → HKDF-SHA256 → AES-GCM) with test vectors produced by WebCrypto
  (`ios/tools/sealer-vectors.mjs`), passing on macOS and the iOS 27 Simulator. Chrome's side of the seal
  is therefore known to work with the same bytes.
- The outbox (`RecordDatabase.changes(after:)`): one row per changed record since the last bundle.
- The record shape: stable ids, `updatedAt`/`deletedAt`, `userFields`, content in a sealed body and
  metadata in columns.

## 1. Chrome reads the public database without signing in

Steps once approved:
1. Register the container in the developer portal; deploy a `Bundle` record type with one asset field
   `sealed`, **no queryable or sortable indexes**.
2. Create a CloudKit Web Services API token (public database read, origin limited if CloudKit allows).
3. From a throwaway test extension (not the shipped one), with host permission for
   `api.apple-cloudkit.com` only: `records/lookup` by record name with the token, then download the asset.
4. Record: CORS from `chrome-extension://…`, the asset URL's lifetime, the error shapes for a missing
   record and a bad token, and whether `records/query` is refused without indexes (unguessable names).

Pass: a record fetched by name and its asset downloaded and opened with the vectors' key.
Fallback (from `sync-bridge.md`): the one-off link read by a static GitHub Pages page; then AirDrop/Files.

## 2. The iPhone writes and deletes public records

1. From the app and from the Share Extension: `CKDatabase.publicCloudDatabase` save of a 1 MB and a 20 MB
   sealed asset; delete; time until a lookup misses.
2. Note the public database quota at our expected scale (10,000 people × one bundle a day, 7-day expiry).
3. Check the Share Extension's memory with a 20 MB bundle (budget ~120 MB).

## 3. Two-way with Apple's web sign-in

1. In the test extension: CloudKit JS sign-in (Apple's own page), write a record to the private
   database's custom zone, and receive it on the iPhone through `CKSyncEngine`.
2. Record: whether the sign-in works inside an extension page or needs a tab, how long the session lasts,
   and what the person sees.

Write results below this line when run.

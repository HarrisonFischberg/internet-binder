# iPhone ↔ Chrome through CloudKit (design for M4, groundwork in M3)

Status: proposal. Needs the three experiments below before any build, and the owner's approval of the
privacy wording. Extends `replica/architecture.md` §6, and changes its recommendation on one point: we
use our own encryption instead of CloudKit `encryptedValues`, so Chrome can take part without weakening
end-to-end encryption.

## What we want

- Things saved on the iPhone show up in Chrome, and later Chrome's saves show up on the iPhone.
- No Keepsake account and no Keepsake server. On Apple devices, the person's iCloud. In Chrome, nothing
  to sign in to for the first step.
- Apple never sees the content of a library (titles, notes, links, places, captions).
- Export and import stay as they are: sync is optional and never a requirement.

## What CloudKit allows (to confirm in the experiments)

- **Apple apps** use the person's iCloud private database (`CKSyncEngine`) with no sign-in screen.
- **A browser extension** can talk to CloudKit through CloudKit Web Services / CloudKit JS with the
  app's **API token**. With the token alone it can **read the public database**. Writing anything, and
  reading the private database, need the person to **sign in with their Apple Account** in Apple's own
  web sign-in.
- **`encryptedValues`** (CloudKit's end-to-end fields) are decrypted only on the person's Apple devices.
  The web never sees them in plaintext, so Chrome can't read them.

## Design

### Level 1: Pair Chrome with iPhone (one-way, iPhone → Chrome, no login, end-to-end)

1. Chrome, Settings → **Pair with iPhone**: Chrome creates a key pair (X25519) and a random mailbox id
   (128-bit), and shows them as a QR code (`keepsake-pair:v1:<mailboxId>:<chromePublicKey>`).
2. The iPhone (Keepsake → Settings → Pair with Chrome) scans it, agrees a shared key (ECDH + HKDF), and
   saves the pairing in the iCloud Keychain.
3. The iPhone writes **sealed bundles** to the app's CloudKit **public** database. Each one is a
   record named `<mailboxId>-<seq>` whose only field is an asset holding the library or the changes
   since the last bundle, sealed with AES-GCM under the shared key. Nothing readable (no titles, kinds
   or dates) is outside the seal. Record names are unguessable and records aren't queryable (no indexes).
4. Chrome, when the dashboard opens (no timers), fetches `<mailboxId>-<next seq>` by name with the API
   token, opens the seal and merges the changes with the same per-field rules as the rest of sync
   (`architecture.md` §6).
5. The iPhone deletes bundles Chrome has had for 7 days. It knows because Chrome's read position travels
   back through the next pairing check, or simply by age. Unpairing deletes the mailbox.

**A one-off link** ("Send to Chrome") is the same mechanism without a pairing: one sealed bundle, with
the key in the link's fragment: `https://keepsake.example/i#<recordName>.<key>`. The fragment never
leaves the browser, so the page or extension reads the record by name and opens it locally. Chrome
recognises the link when you paste it into Import, or when the extension sees it opened. The link
expires in 7 days.

### Level 2: Two-way sync (Chrome → iPhone too)

- Chrome, Settings → **Sync with iCloud**: Apple's web sign-in (CloudKit JS), once. It's the person's
  Apple Account, not ours.
- Both sides use the **private** database, in one record zone. Content fields are sealed with the
  **library key** (AES-GCM). The library key lives in the iCloud Keychain on Apple devices and reaches
  Chrome through the Level 1 pairing (QR), so pairing comes first. What stays readable outside the seal
  is only what sync needs: record id, record type, `updatedAt`, `deletedAt`, a sort order.
- Chrome is then a normal sync client: it pulls changes when it opens (no timers), pushes its own saves,
  and uses the same conflict rules.
- Without Level 2, Chrome → iPhone stays as it is today: an export file the iPhone can import.

### Why not the alternatives

- **`encryptedValues`**: Chrome could never read the content, and dropping end-to-end encryption to let
  it would break the privacy promise.
- **CKShare share links**: the person receiving needs an Apple Account and must accept in iCloud. That
  means a login in Chrome, for less benefit than Level 2.
- **A Keepsake relay server**: excluded (no Keepsake server).
- **The Mac app as a bridge (native messaging)**: still useful later for Chrome on a Mac, but it doesn't
  help Chrome on Windows or Chrome without the Mac app.

## Experiments (do these first, in M3.1, before building on them)

1. **Chrome reads the public database without signing in.**
   - Create a container and a public record with an asset.
   - From the extension (host permission for the CloudKit Web Services host only), fetch it by record
     name with the API token, and download the asset.
   - Check CORS from a `chrome-extension://` origin, the asset download URL's lifetime, and the error
     shapes.
2. **The iPhone writes and deletes public records**, from both the app and the Share Extension: size
   limits, the developer's public-database quota at 10,000 people × daily bundles, and how fast
   deletes take effect.
3. **Two-way with Apple's web sign-in**: from the extension, sign in through CloudKit JS, write a record
   in the private database, and have the iPhone receive it through `CKSyncEngine`. Check whether the
   sign-in works inside an extension page, and how long its session lasts.

Write the results in `replica/m3/experiments.md`. If experiment 1 fails, Level 1 falls back to the
one-off link opened on a tiny static page we host on GitHub Pages: no server logic, it only reads by
name. If that's also not acceptable, Level 1 falls back to AirDrop or Files with the export file.

## What M3 must do now so this works later

- **Record shape**: every record has a stable id (UUID), `updatedAt`, `deletedAt` (tombstones, purged
  after 30 days) and per-field `userFields`, as the Chrome schema already does. No auto-increment ids.
- **Content split**: keep the fields that will be sealed (title, note, url, image, details,
  instagram…) apart from the metadata sync reads, in the storage layer's API.
- **Crypto layer**: CryptoKit (X25519, HKDF-SHA256, AES-GCM) behind one small `Sealer` type, with test
  vectors. The same vectors run in Chrome with WebCrypto, so both sides agree.
- **Change log**: a local outbox of changes since the last bundle, for Level 1.
- **Nothing synced in M3.** No network path ships until the experiments pass, `PRIVACY.md` is updated,
  and the owner approves.

## Privacy wording (draft, for PRIVACY.md when it ships)

> **Pair with iPhone / Send to Chrome** (off until you pair): your iPhone seals your library with a key
> only your devices have, and leaves the sealed copy in Keepsake's iCloud storage for your browser to
> collect. Apple stores it but can't read it; no one else can find it. Sealed copies are deleted after
> 7 days. **Sync with iCloud** (off until you sign in with your Apple Account in Chrome): the same
> sealing, in your own iCloud.

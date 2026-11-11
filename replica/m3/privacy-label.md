# App Store privacy label (proposed) · Keepsake for iPhone and iPad

Date: 2026-10-15 · Status: **for the owner to confirm before submission.** Matches `keepsake/PRIVACY.md`
and the iOS draft `ios/PRIVACY-iOS.md`.

## Answer to "Do you or your third-party partners collect data from this app?"

**No: Data Not Collected.**

Apple's definition: "collect" means transmitting data off the device in a way that lets the developer
or its third-party partners access it for longer than needed to service the request in real time.

| what leaves the device | to whom | collected by the developer? | why it doesn't count |
| --- | --- | --- | --- |
| Optional AI requests (title, caption, collection names…) | the AI provider **the person** chooses, with **their own key** | no | off by default; sent directly from the device to a service the person signed up for, under their own account; the developer has no access |
| Lookups (place name and city, film title, book title) | OpenStreetMap, Wikidata, Open Library | no | off by default; anonymous requests, no cookies, no identifiers; the developer has no access |
| Pictures of saves | the sites the saves came from | no | the same request a web page makes to show its picture |
| Links you share (title, creator, picture, from the site's public link-preview data) | the website of that link | no | on by default, Settings → Links turns it off; anonymous requests, no cookies; the site sees the person's IP address; the developer has no access |
| Maps and Directions | Apple Maps | no | Apple system service |
| Sharing from Safari | nothing leaves; the page is read on the device | no | |

No analytics, no crash reporting SDKs, no advertising, no tracking, no account, no Keepsake server.
Only the AI provider and Lookups requests are checked against an allowlist built from settings
(`ios/KeepsakeKit/Sources/KeepsakeKit/Network.swift`, tested in `NetworkTests`). Reading a shared link, showing a
save's picture, and the Optional AI and Import recipe page reads go to whichever https site the link or picture
names, so those sites see the person's IP address.

## Other App Store answers
- **Tracking:** No (no `NSUserTrackingUsageDescription`, no IDFA).
- **Privacy policy URL:** the published `PRIVACY.md` (with the iOS section from `ios/PRIVACY-iOS.md`).
- **Privacy manifest (`PrivacyInfo.xcprivacy`):** added to the app, Share Extension and widgets: no tracking domains;
  required-reason APIs used: `UserDefaults` (CA92.1, app's own settings via the App Group:
  1C8F.1), file timestamps none, disk space none. To verify against the final build.

## To confirm
1. Apple's guidance on user-configured third-party AI with the person's own key (we believe "not
   collected" because the developer never receives it).
2. Whether CloudKit (M4) changes this: data in the person's own iCloud, sealed, is still not collected
   by the developer.

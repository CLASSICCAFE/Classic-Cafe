Classic Cafe Fixed v7

This build is based on v6.

Changes:
- Admin API errors now show the server detail instead of only generic "Worker exception", so the exact D1 error is visible.
- Delivery Boy mobile input uses a true digit-cleaning regex and tel/inputmode attributes.
- Existing v6 features remain: manual dashboard refresh, background new-order watcher without page reload, notifications, menu availability/offers, order flow.

Important:
The Chrome "Check your passwords / deceptive site" popup is a Chrome Safe Browsing/password-manager warning, not an application popup. It cannot be guaranteed to disappear by JavaScript changes. If it appears, do not enter passwords on an untrusted site; for this cafe site, verify the domain and HTTPS certificate before continuing.


V8 FIX:
- Fixed the exact D1 PRIMARY KEY collision on delivery_boys.id (DB001).
- Existing DB001 is reused/updated instead of being inserted again.
- New Delivery Boy IDs are calculated from all existing DB### rows.
- Registration retries safely if two requests choose the same ID.
- Legacy delivery_key schemas remain supported.

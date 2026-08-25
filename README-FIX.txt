CLASSIC CAFE FIX v4

Fixed:
- ADMIN_KEY + ADMIN_KEY_2 both accepted.
- ADMIN_NAME + ADMIN_NAME_2 shown according to the key used.
- Admin session is server-side and valid 24 hours; browser close does not log out.
- Admin Logout immediately invalidates the session.
- Admin name is restored after browser reopen.
- Delivery active orders exclude DELIVERED/CANCELLED at the API and UI level.
- Delivery dashboard shows Delivery Boy name + Sr. No.

Cloudflare variables:
ADMIN_KEY       = Secret
ADMIN_KEY_2     = Secret
ADMIN_NAME      = Text (example: Ashok)
ADMIN_NAME_2    = Text (example: Suresh)
DELIVERY_KEY    = Secret

Keep D1 binding name: DB

Deploy all 3 files together:
worker.js
admin.html
delivery.html

After deployment, test in a fresh InPrivate/Incognito window or hard refresh.

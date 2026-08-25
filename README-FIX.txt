CLASSIC CAFE FIX v5

This v5 keeps the uploaded worker/admin files and fixes the Delivery dashboard
session restore.

Fixed:
- After browser close/reopen, the existing 24-hour Delivery Boy session is
  validated through /api/delivery/stats.
- The returned Delivery Boy profile is now restored into the dashboard:
  Name, Sr. No., Mobile.
- Active Orders remain limited to NEW/ACCEPTED/PREPARING/OUT_FOR_DELIVERY.
- Delivered Orders remain limited to DELIVERED orders assigned to the logged-in
  Delivery Boy.

Cloudflare variables:
ADMIN_KEY       = Secret
ADMIN_KEY_2     = Secret
ADMIN_NAME      = Text
ADMIN_NAME_2    = Text
DELIVERY_KEY    = Secret

Deploy worker.js, admin.html and delivery.html together.
After deployment, hard refresh or use an Incognito window for testing.

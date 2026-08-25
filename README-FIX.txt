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


V6 session fix: Admin now stores the 24-hour session token in localStorage and sends x-admin-session on refresh/API calls; server accepts cookie or header. Delivery keeps its 24-hour session in localStorage and logout invalidates the server session.

V9 navigation fix:
- Delivery dashboard now shows a 🧭 Navigate button on active orders.
- It opens Google Maps driving navigation to the customer's saved order latitude/longitude.
- If customer coordinates are missing, it shows a clear message instead of failing.

V6 session fix: Admin now stores the 24-hour session token in localStorage and sends x-admin-session on refresh/API calls; server accepts cookie or header. Delivery keeps its 24-hour session in localStorage and logout invalidates the server session.

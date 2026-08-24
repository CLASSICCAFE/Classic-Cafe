CLASSIC CAFE – V5
===================

Replace only:
1. worker.js  -> Cloudflare Worker backend
2. admin.html -> public/admin asset

Do NOT delete/reset the existing D1 database.
Do NOT change ADMIN_KEY or DELIVERY_KEY.

V5 changes:
- Delivery Boy mobile field is explicitly a telephone field (not a password field) and sanitizes input.
- Delivery Boy registration continues to support legacy D1 schemas containing delivery_key/access_key.
- Admin dashboard does not perform a full page refresh on a timer.
- Background NEW-order watcher does not reload the page or reset forms.
- Menu availability and offer controls remain included.
- Notifications/Alerts and order-flow controls remain included.
- Added admin-only delivery schema diagnostic endpoint: /api/admin/delivery/schema.

IMPORTANT ABOUT CHROME WARNING
The "Check your passwords / deceptive site" popup shown by Chrome is a Chrome Safe Browsing/security warning, not a JavaScript validation error. HTML changes cannot guarantee removal of that warning. Do not enter real passwords into a page Chrome identifies as deceptive. If the warning persists on the workers.dev domain, verify the Cloudflare deployment/domain and Safe Browsing status before using sensitive credentials.

Deploy order:
Commit -> successful build/deploy -> open the current site -> hard refresh once.

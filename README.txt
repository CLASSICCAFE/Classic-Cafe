CLASSIC CAFE ADMIN FIX v2

Replace:
1. worker.js -> your Worker backend file
2. admin.html -> your Admin dashboard asset

Important:
- Do NOT delete or reset the D1 database.
- Do NOT change ADMIN_KEY or DELIVERY_KEY secrets.
- Commit and deploy after replacement.
- Hard refresh / clear cache after deployment.

Features fixed:
- Prevents delivery-table initialization from breaking every API request.
- Delivery Boy registration from Admin using name + 10-digit mobile.
- Delivery Boy OTP request/approval flow remains supported.
- Menu item offer text field with Save Offer.
- Existing D1 menu/delivery schemas are migrated safely.

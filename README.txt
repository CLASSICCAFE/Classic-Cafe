CLASSIC CAFE – V4 FINAL FIX

Replace these two files in the existing project:
1. worker.js  -> Cloudflare Worker backend file
2. admin.html -> public/admin asset file

DO NOT delete or reset the existing D1 database.
DO NOT change ADMIN_KEY or DELIVERY_KEY secrets.

WHAT V4 FIXES
- Delivery Boy registration now uses a schema-compatible dynamic INSERT, so older D1 versions with delivery_key/access_key are supported.
- Delivery Boy flow: Admin registers name + 10-digit mobile -> Delivery Boy requests OTP -> Admin approves -> Delivery Boy verifies OTP -> dashboard login.
- Registration errors now return a useful message instead of a generic Worker exception.
- Admin dashboard no longer performs a full automatic refresh every 15 seconds.
- Manual Refresh remains available.
- A lightweight 5-second background watcher checks only for NEW orders; it does NOT reload the dashboard or reset form fields.
- New order shows a top-of-dashboard detail card and can trigger browser notification + sound after Alerts permission is enabled.
- Orders follow the controlled flow: NEW -> ACCEPTED -> PREPARING -> OUT_FOR_DELIVERY -> DELIVERED. Cancel is allowed before delivery.
- Admin order cards show the complete customer/order/payment/delivery details and the current flow step.
- Status history is stored in D1 without deleting existing orders.
- Customer tracking API now returns current status, readable status label, location and status history.
- Delivery Boy location updates continue to move the order to OUT_FOR_DELIVERY when appropriate.
- Admin Notifications / Alerts and Delivery Boy notifications are preserved.
- Menu / Item Availability and Offer controls are preserved.
- Every existing D1 record is preserved; no DROP/TRUNCATE/reset is used.

DEPLOY
1. Replace worker.js and admin.html only.
2. Commit the changes.
3. Wait for a green Cloudflare build/deployment.
4. Open /admin and press the manual Refresh button once.
5. Press 🔔 Alerts once and allow browser notifications.
6. Test Delivery Boys -> Add Delivery Boy with a real 10-digit mobile.
7. On /delivery request OTP using that registered mobile.
8. In Admin -> Delivery OTP Approval, approve it.
9. Verify OTP on the Delivery dashboard.

NOTE
The background order watcher is intentionally not a page refresh. It only checks for new orders so an alert can appear without disturbing typing, menu edits, or other dashboard work.

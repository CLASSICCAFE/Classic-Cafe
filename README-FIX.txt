Classic Cafe – Delivery/Admin Fix v3

1. Delivery Boy OTP login session is now valid for 24 hours.
2. Closing the browser does NOT require OTP again while the 24-hour server session is valid, because the dashboard keeps the session token in browser localStorage.
3. Delivery Boy logout immediately invalidates the server session.
4. When the Delivery Dashboard opens with a valid session, it automatically restores the Delivery Boy name, mobile and Sr. No.
5. Delivery Dashboard shows only that logged-in boy’s active orders; DELIVERED/CANCELLED orders are excluded.
6. Admin Dashboard → Delivery Boys now shows Sr. No. for each boy.
7. Sr. No. follows the existing Delivery Boy registration/ID order (DB001, DB002, ...).

Deploy these files together:
- worker.js
- delivery.html
- admin (2).html

After deployment:
- Open /delivery and do one OTP login.
- Close browser completely and reopen /delivery within 24 hours: it should open directly.
- Use Logout when you want OTP to be required again.
- Hard refresh (Ctrl+F5) after deployment.

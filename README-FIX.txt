CLASSIC CAFE DELIVERY FIX

1. Replace worker.js with deploy/worker.js
2. Replace public/delivery.html with deploy/delivery.html
3. Deploy the Worker.

Fixes:
- Delivered/CANCELLED orders are excluded from Active Orders.
- Delivered orders are shown only in Delivered Orders history.
- New orders are assigned only to a currently logged-in active Delivery Boy.
- If multiple Delivery Boys are logged in, the most recently logged-in active session receives the new order.
- If nobody is logged in, the order remains unassigned instead of being sent to an offline boy.
- Delivery logout now invalidates the server-side session immediately.

Existing D1 data is not deleted or modified by this code.

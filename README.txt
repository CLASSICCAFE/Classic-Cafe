CLASSIC CAFE - FIXED V6

Replace worker.js and admin.html from this folder.

V6 fixes:
- Removes the expensive global D1 initialization from every API request, reducing dashboard load time.
- Safely upgrades order_status_history before creating its index.
- Keeps legacy delivery_key/access_key compatibility.
- Delivery Boy registration remains name + 10-digit mobile; login key is generated server-side.
- Admin Key is not presented as a browser password field, reducing Chrome password-manager warnings.
- Mobile field is explicitly tel/autocomplete=tel and not a password field.
- Menu offer_text is now saved by the worker PUT endpoint.
- Orders GET explicitly initializes required tables.
- Existing D1 data is preserved; no DROP migration is used.

CLASSIC CAFE - ADMIN BUTTON FIX

Files in this ZIP:
1. worker.js  -> replace the current Worker code/file
2. admin.html -> replace the current Admin HTML file

IMPORTANT:
- Do NOT change ADMIN_KEY or DELIVERY_KEY.
- Keep the existing D1 binding named DB.
- Deploy/commit these files after replacing them.

Main fix:
The previous Worker had a delivery_boys INSERT mismatch (delivery_key was used even though the table uses access_key). Because ensureDeliveryTables runs before API routes, this could make every Admin API button show "Worker exception.".

The fixed worker uses only access_key and keeps old D1 data through safe migrations.

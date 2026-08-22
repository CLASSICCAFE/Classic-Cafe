CLASSIC CAFE JODHPUR — ONLINE ORDER + OWNER + DELIVERY DASHBOARD

Included:
- Website ordering with cart
- GPS distance check from Classic Cafe
- ₹20/km delivery, rounded up to next km, max 5 km
- Home delivery hours: 12:00 PM to 12:00 AM (Asia/Kolkata)
- Cash on Delivery / UPI to delivery boy
- Website order saved in Cloudflare D1
- WhatsApp order notification to Classic Cafe
- Direct WhatsApp ordering button for customers
- Owner dashboard: /admin
- Delivery boy dashboard: /delivery
- Order statuses: NEW, ACCEPTED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED

IMPORTANT CLOUDFLARE SETUP
1. Create a D1 database named: classic-cafe-orders
2. Run schema.sql in D1 SQL console.
3. Put the D1 database ID in wrangler.toml.
4. Deploy this project as a Cloudflare Worker (not only a static asset upload).
5. Add Worker secrets:
   ADMIN_KEY = a strong private key for owner dashboard
   DELIVERY_KEY = a different strong private key for delivery dashboard
6. Open:
   /              customer website
   /admin         owner dashboard
   /delivery      delivery boy dashboard

The dashboard keys are secrets. Do not put them in public HTML or share the ADMIN_KEY with delivery staff.

The WhatsApp number is currently 8107477729. Change WHATSAPP in public/index.html if the cafe wants a different number.

The cafe coordinates and delivery radius are in worker.js and index.html.

LIVE DELIVERY LOCATION (NEW)
- Customer receives a private tracking link: /track?token=...
- Delivery boy opens /delivery, presses "Share Live Location" and allows GPS permission.
- The delivery phone sends its current GPS position while the order is out for delivery.
- Customer tracking page refreshes every 10 seconds and shows the delivery marker on a map.
- Tracking link is private (token-based) and does not require customer login.
- Customer can place a normal website order or start a direct WhatsApp order chat.
- When the delivery boy marks DELIVERED, location sharing is stopped in that browser.
- Run the updated schema.sql in the D1 console so the order_tracking table is created.
- Live location requires HTTPS (Cloudflare workers.dev/custom domain provides this) and the delivery boy must allow browser location permission.

IMPORTANT: Direct WhatsApp orders are received in WhatsApp and are not automatically inserted into D1 unless a WhatsApp Business API/webhook is connected. Website orders are inserted into D1 and also open WhatsApp with the complete order message.


DESIGN UPDATE
- Premium food + shakes hero image added at public/images/hero-premium-food-shakes.jpg.
- Separate category photos added for Pizza, Burgers, Sandwiches, Snacks, Shakes and Ice Cream.
- Menu page keeps the complete item-by-item list from menu.json and displays category sections with separate images.
- Existing order, WhatsApp, admin, delivery and live tracking functionality is preserved.

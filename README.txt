Classic Cafe Admin alert update

This version adds:
- Full-screen new-order popup over the dashboard.
- New order popup stays until Admin accepts or opens the order.
- Accept Order closes popup and scrolls directly to that order.
- Sound + vibration alert when a new order is detected.
- Android/browser Notification support when Alerts permission is enabled.
- Audio is unlocked after the Admin taps Alerts (and first page interaction).
- Dashboard remains manual-refresh; background polling only checks for new orders.

Important browser limitation:
A normal web page cannot guarantee sound/vibration while the Android phone is fully locked.
For reliable lock-screen alerts, browser push notifications (VAPID/push subscription) must be configured.
This version registers /sw.js and uses persistent browser notifications where supported, but does not invent a push-server credential.

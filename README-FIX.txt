Classic Cafe V14 - Admin 24 Hour Session

1. worker.js: Admin session ab exactly 24 hours valid hai. Cookie bhi 24 hours ka hai. Browser close/reopen ke baad valid session automatically dashboard khol dega. Logout se server-side session turant delete hoga.
2. admin.html: Page load par existing secure admin cookie check hoti hai; valid ho to Admin Key dobara nahi maangi jayegi.
3. Admin name: Cloudflare Worker Runtime Variable me ADMIN_NAME add karein, value jaise "Ashok" ya "Classic Cafe Owner". Login response me ye name dashboard header me dikhega. Agar ADMIN_NAME set nahi hai to default "Classic Cafe Admin" dikhega.
4. ADMIN_KEY wahi existing secret rahega. ADMIN_NAME ko secret banana zaroori nahi hai; Runtime Variable ke roop me add karein.
5. Deploy ke baad browser me Ctrl+F5 / hard refresh karein.

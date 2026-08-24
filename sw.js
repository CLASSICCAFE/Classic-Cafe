self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "Classic Cafe", {
    body:data.body || "New Classic Cafe update", icon:data.icon||"/icon-192.png", badge:data.badge||"/icon-192.png",
    tag:data.tag||"classic-cafe", renotify:true, requireInteraction:data.requireInteraction!==false, silent:false,
    vibrate:[300,120,300,120,600], timestamp:Date.now(), data:{url:data.url||"/admin"}
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url=event.notification.data?.url||"/admin";
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(clients=>{
    const open=clients.find(c=>c.url.includes(new URL(url,self.location.origin).pathname));
    return open?open.focus():self.clients.openWindow(url);
  }));
});

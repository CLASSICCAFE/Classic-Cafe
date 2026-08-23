const CAFE_LAT = 26.252917;
const CAFE_LNG = 72.964081;
const RATE = 20;
const RADIUS = 5;
const DELIVERY_START_MIN = 12 * 60;
const DELIVERY_END_MIN = 24 * 60;
function deliveryOpen(){ const now=new Date(); const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now); const h=Number(parts.find(p=>p.type==='hour').value); const m=Number(parts.find(p=>p.type==='minute').value); const mins=h*60+m; return mins>=DELIVERY_START_MIN && mins<DELIVERY_END_MIN; }

function json(data, status=200) {
  return new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function corsHeaders() { return {"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,PUT,OPTIONS","access-control-allow-headers":"content-type,x-admin-key,x-delivery-key"}; }
function dist(a,b,c,d){const R=6371,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b),z=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return R*2*Math.atan2(Math.sqrt(z),Math.sqrt(1-z));}
function withCors(resp){const h=new Headers(resp.headers);Object.entries(corsHeaders()).forEach(([k,v])=>h.set(k,v));return new Response(resp.body,{status:resp.status,headers:h});}
function authorized(request, env, type){const key=type==='admin'?request.headers.get('x-admin-key'):request.headers.get('x-delivery-key');const expected=type==='admin'?env.ADMIN_KEY:env.DELIVERY_KEY;return !!expected && key===expected;}
function token(){return crypto.randomUUID().replaceAll('-','');}

async function api(request, env, url) {  // ADMIN SETTINGS API
  if(url.pathname==='/api/settings' && request.method==='GET'){
    if(!authorized(request,env,'admin')){
      return json({error:'Unauthorized'},401);
    }

    const rows=await env.DB.prepare(
      `SELECT key,value FROM settings ORDER BY key`
    ).all();

    const settings={};
    for(const r of rows.results){
      settings[r.key]=r.value;
    }

    return json({ok:true,settings});
  }

  if(url.pathname==='/api/settings' && request.method==='PUT'){
    if(!authorized(request,env,'admin')){
      return json({error:'Unauthorized'},401);
    }

    let body;
    try{
      body=await request.json();
    }catch{
      return json({error:'Invalid JSON'},400);
    }

    const allowed=[
      'shop_open',
      'website_orders',
      'delivery_enabled',
      'opening_time',
      'closing_time',
      'delivery_radius',
      'delivery_rate'
    ];

    const now=new Date().toISOString();

    for(const key of allowed){
      if(body[key]===undefined) continue;

      await env.DB.prepare(
        `INSERT INTO settings (key,value,updated_at)
         VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET
         value=excluded.value,
         updated_at=excluded.updated_at`
      ).bind(
        key,
        String(body[key]),
        now
      ).run();
    }

    return json({ok:true});
  }
    /* DELIVERY BOY STATS */

  if(url.pathname==='/api/delivery/stats' && request.method==='GET'){

    if(!authorized(request,env,'delivery')){
      return json({error:'Unauthorized'},401);
    }

    const rows=await env.DB.prepare(`
      SELECT
        COUNT(*) AS completed_today,
        COALESCE(SUM(delivery_charge),0) AS earnings_today
      FROM orders
      WHERE status='DELIVERED'
      AND date(created_at,'localtime')=date('now','localtime')
    `).first();

    return json({
      ok:true,
      completed_today:Number(rows?.completed_today || 0),
      earnings_today:Number(rows?.earnings_today || 0)
    });
  }
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders()});
  if(url.pathname==='/api/health') return json({ok:true,service:'Classic Cafe Orders'});
  if(url.pathname==='/api/orders' && request.method==='POST') {
    if(!deliveryOpen()) return json({error:'Home delivery is open from 12:00 PM to 12:00 AM.'},400);
    let body; try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)}
    const {customer_name,mobile,address,lat,lng,items}=body;
    if(!customer_name||!/^[0-9]{10}$/.test(String(mobile))||!address||typeof lat!=='number'||typeof lng!=='number'||!Array.isArray(items)||!items.length) return json({error:'Missing or invalid order details'},400);
    const d=dist(CAFE_LAT,CAFE_LNG,lat,lng);
    if(d>RADIUS) return json({error:'Delivery is available only within 5 KM',distance_km:Number(d.toFixed(2))},400);
    const delivery=Math.max(20,Math.ceil(d)*RATE);
    let food=0; for(const x of items){const p=Number(x.price),q=Number(x.qty);if(!x.name||!Number.isFinite(p)||!Number.isInteger(q)||q<1||q>50)return json({error:'Invalid item'},400);food+=p*q;}
    const id='CC'+Date.now().toString().slice(-8);
    const tracking_token=token();
    const now=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO orders (id,created_at,customer_name,mobile,address,lat,lng,distance_km,delivery_charge,food_total,grand_total,payment_method,payment_status,status,items_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,now,customer_name,String(mobile),address,lat,lng,Number(d.toFixed(3)),delivery,food,food+delivery,'COD_OR_UPI_TO_DELIVERY_BOY','UNPAID','NEW',JSON.stringify(items)).run();
    await env.DB.prepare(`INSERT INTO order_tracking (order_id,tracking_token) VALUES (?,?)`).bind(id,tracking_token).run();
    return json({ok:true,order_id:id,tracking_token,distance_km:Number(d.toFixed(2)),delivery_charge:delivery,food_total:food,grand_total:food+delivery,status:'NEW'});
  }
  if(url.pathname==='/api/orders' && request.method==='GET') {
    const adminAllowed=authorized(request,env,'admin');
    const deliveryAllowed=authorized(request,env,'delivery');
    if(!adminAllowed&&!deliveryAllowed) return json({error:'Unauthorized'},401);
    const limit=Math.min(Number(url.searchParams.get('limit')||100),200);
    const rows=deliveryAllowed&&!adminAllowed
      ? await env.DB.prepare(`SELECT * FROM orders WHERE status NOT IN ('DELIVERED','CANCELLED') ORDER BY created_at ASC LIMIT ?`).bind(limit).all()
      : await env.DB.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
    return json({ok:true,orders:rows.results.map(r=>({...r,items:JSON.parse(r.items_json)}))});
  }
  const tm=url.pathname.match(/^\/api\/track\/([^/]+)$/);
  if(tm && request.method==='GET') {
    const row=await env.DB.prepare(`SELECT o.id,o.created_at,o.customer_name,o.status,o.food_total,o.delivery_charge,o.grand_total,o.distance_km,t.lat,t.lng,t.updated_at FROM orders o JOIN order_tracking t ON t.order_id=o.id WHERE t.tracking_token=?`).bind(tm[1]).first();
    if(!row)return json({error:'Tracking link invalid or expired'},404);
    return json({ok:true,order:{id:row.id,created_at:row.created_at,customer_name:row.customer_name,status:row.status,food_total:row.food_total,delivery_charge:row.delivery_charge,grand_total:row.grand_total,distance_km:row.distance_km,location:row.lat!=null?{lat:row.lat,lng:row.lng,updated_at:row.updated_at}:null}});
  }
  const lm=url.pathname.match(/^\/api\/orders\/([^/]+)\/location$/);
  if(lm && request.method==='PUT') {
    if(!authorized(request,env,'delivery'))return json({error:'Unauthorized'},401);
    let body;try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)}
    const lat=Number(body.lat),lng=Number(body.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return json({error:'Invalid location'},400);
    const order=await env.DB.prepare(`SELECT id,status FROM orders WHERE id=?`).bind(lm[1]).first();
    if(!order)return json({error:'Order not found'},404);
    const now=new Date().toISOString();
    await env.DB.prepare(`UPDATE order_tracking SET lat=?,lng=?,updated_at=? WHERE order_id=?`).bind(lat,lng,now,lm[1]).run();
    if(order.status!=='DELIVERED' && order.status!=='CANCELLED') await env.DB.prepare(`UPDATE orders SET status='OUT_FOR_DELIVERY' WHERE id=? AND status IN ('NEW','ACCEPTED','PREPARING','OUT_FOR_DELIVERY')`).bind(lm[1]).run();
    return json({ok:true,updated_at:now});
  }
  const m=url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if(m && request.method==='PUT') {
    const id=m[1]; let body;try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)}
    const deliveryAllowed=authorized(request,env,'delivery'); const adminAllowed=authorized(request,env,'admin');
    if(!deliveryAllowed&&!adminAllowed)return json({error:'Unauthorized'},401);
    const allowedStatus=['NEW','ACCEPTED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
    if(body.status && !allowedStatus.includes(body.status))return json({error:'Invalid status'},400);
    if(body.status){await env.DB.prepare(`UPDATE orders SET status=? WHERE id=?`).bind(body.status,id).run();}
    if(body.payment_status && adminAllowed){const ps=['UNPAID','PAID'];if(!ps.includes(body.payment_status))return json({error:'Invalid payment status'},400);await env.DB.prepare(`UPDATE orders SET payment_status=? WHERE id=?`).bind(body.payment_status,id).run();}
    const row=await env.DB.prepare(`SELECT * FROM orders WHERE id=?`).bind(id).first();
    if(!row)return json({error:'Order not found'},404);
    return json({ok:true,order:{...row,items:JSON.parse(row.items_json)}});
  }
  return json({error:'Not found'},404);
}

export default { async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')) return withCors(await api(request,env,url));
  if(url.pathname==='/admin' || url.pathname==='/admin/') return env.ASSETS.fetch(new Request(new URL('/admin.html',request.url),request));
  if(url.pathname==='/delivery' || url.pathname==='/delivery/') return env.ASSETS.fetch(new Request(new URL('/delivery.html',request.url),request));
  if(url.pathname==='/track' || url.pathname==='/track/') return env.ASSETS.fetch(new Request(new URL('/track.html',request.url),request));
  return env.ASSETS.fetch(request);
}};

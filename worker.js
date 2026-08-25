const CAFE_LAT = 26.252917;
const CAFE_LNG = 72.964081;

const DEFAULT_RATE = 20;
const DEFAULT_RADIUS = 5;
const DEFAULT_START = "12:00";
const DEFAULT_END = "00:00";
const DEFAULT_ASSIGN_DISTANCE = 2;

function json(data, status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

function corsHeaders(){
  return {
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"GET,POST,PUT,OPTIONS",
    "access-control-allow-headers":"content-type,x-admin-key,x-delivery-key,x-delivery-session"
  };
}

function withCors(resp){
  const h = new Headers(resp.headers);
  for(const [k,v] of Object.entries(corsHeaders())) h.set(k,v);
  return new Response(resp.body,{status:resp.status,headers:h});
}

function dist(lat1,lng1,lat2,lng2){
  const R=6371, r=x=>x*Math.PI/180;
  const a=r(lat2-lat1), b=r(lng2-lng1);
  const z=Math.sin(a/2)**2+
    Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(b/2)**2;
  return R*2*Math.atan2(Math.sqrt(z),Math.sqrt(1-z));
}

function token(){
  return crypto.randomUUID().replaceAll("-","");
}

function nowIST(){
  const p=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date());
  const h=Number(p.find(x=>x.type==="hour")?.value||0);
  const m=Number(p.find(x=>x.type==="minute")?.value||0);
  return h*60+m;
}

function toMinutes(value, fallback){
  const s=String(value||fallback);
  const m=s.match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return toMinutes(fallback, fallback);
  const h=Number(m[1]), min=Number(m[2]);
  if(h>23 || min>59) return toMinutes(fallback,fallback);
  return h*60+min;
}

function timeOpen(start,end){
  const n=nowIST(), a=toMinutes(start,DEFAULT_START), b=toMinutes(end,DEFAULT_END);
  if(a===b) return true;
  if(a<b) return n>=a && n<b;
  return n>=a || n<b; // overnight window, e.g. 12:00 -> 00:00
}


async function tableColumns(env, table){
  try{
    const r=await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    return new Set((r.results||[]).map(x=>String(x.name)));
  }catch{
    return new Set();
  }
}

async function addMissingColumns(env, table, defs){
  const cols=await tableColumns(env,table);
  for(const [name,definition] of Object.entries(defs)){
    if(cols.has(name)) continue;
    try{
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    }catch(error){
      // A concurrent request may have added it already; ignore only duplicate-column cases.
      const msg=String(error?.message||"");
      if(!/duplicate column|already exists/i.test(msg)) throw error;
    }
  }
}

async function ensureOrdersTables(env){
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS orders(
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      distance_km REAL DEFAULT 0,
      delivery_charge REAL DEFAULT 0,
      food_total REAL DEFAULT 0,
      grand_total REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'COD_OR_UPI_TO_DELIVERY_BOY',
      payment_status TEXT DEFAULT 'UNPAID',
      status TEXT DEFAULT 'NEW',
      items_json TEXT DEFAULT '[]'
    )
  `).run();

  await addMissingColumns(env,"orders",{
    created_at:"TEXT",
    customer_name:"TEXT",
    mobile:"TEXT",
    address:"TEXT",
    lat:"REAL",
    lng:"REAL",
    distance_km:"REAL DEFAULT 0",
    delivery_charge:"REAL DEFAULT 0",
    food_total:"REAL DEFAULT 0",
    grand_total:"REAL DEFAULT 0",
    payment_method:"TEXT",
    payment_status:"TEXT",
    status:"TEXT",
    items_json:"TEXT"
  });

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS order_tracking(
      order_id TEXT PRIMARY KEY,
      tracking_token TEXT NOT NULL UNIQUE,
      lat REAL,
      lng REAL,
      updated_at TEXT
    )
  `).run();

  await addMissingColumns(env,"order_tracking",{
    tracking_token:"TEXT",
    lat:"REAL",
    lng:"REAL",
    updated_at:"TEXT"
  });
}

async function ensureCoreTables(env){
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  const defaults={
    shop_open:"true",
    website_orders:"true",
    delivery_enabled:"true",
    opening_time:DEFAULT_START,
    closing_time:DEFAULT_END,
    delivery_radius:String(DEFAULT_RADIUS),
    delivery_rate:String(DEFAULT_RATE),
    auto_assign_distance:String(DEFAULT_ASSIGN_DISTANCE)
  };

  for(const [key,value] of Object.entries(defaults)){
    await env.DB.prepare(`
      INSERT INTO settings(key,value,updated_at)
      VALUES(?,?,?)
      ON CONFLICT(key) DO NOTHING
    `).bind(key,value,new Date().toISOString()).run();
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS menu_items(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT,
      available INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS admin_sessions(
      token TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      admin_name TEXT
    )
  `).run();

  // These are starter controls. Existing/real menu items can be added from Admin.
  const starters=[
    ["MENU-PIZZA","Pizza","Pizza"],
    ["MENU-BURGER","Burger","Burger"],
    ["MENU-SANDWICH","Sandwich","Sandwich"],
    ["MENU-SHAKES","Shakes","Shakes"],
    ["MENU-ICECREAM","Ice Cream","Ice Cream"]
  ];
  for(const x of starters){
    await env.DB.prepare(`
      INSERT INTO menu_items(id,name,category,available,updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(name) DO NOTHING
    `).bind(x[0],x[1],x[2],1,new Date().toISOString()).run();
  }

  await ensureOrdersTables(env);
}

async function getSettings(env){
  await ensureCoreTables(env);
  const rows=await env.DB.prepare(`SELECT key,value FROM settings ORDER BY key`).all();
  const s={};
  for(const r of rows.results) s[r.key]=r.value;
  return {
    shop_open:String(s.shop_open??"true")==="true",
    website_orders:String(s.website_orders??"true")==="true",
    delivery_enabled:String(s.delivery_enabled??"true")==="true",
    opening_time:String(s.opening_time??DEFAULT_START),
    closing_time:String(s.closing_time??DEFAULT_END),
    delivery_radius:Number(s.delivery_radius??DEFAULT_RADIUS),
    delivery_rate:Number(s.delivery_rate??DEFAULT_RATE),
    auto_assign_distance:Number(s.auto_assign_distance??DEFAULT_ASSIGN_DISTANCE)
  };
}

async function ensureDeliveryTables(env){
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS delivery_boys(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,mobile TEXT,
      access_key TEXT UNIQUE NOT NULL,active INTEGER DEFAULT 1,created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS delivery_assignments(
      order_id TEXT PRIMARY KEY,delivery_boy_id TEXT NOT NULL,assigned_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS delivery_otp_requests(
      id TEXT PRIMARY KEY,mobile TEXT NOT NULL,otp TEXT NOT NULL,
      delivery_boy_id TEXT,approved INTEGER DEFAULT 0,used INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_delivery_otp_mobile
    ON delivery_otp_requests(mobile)
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS delivery_sessions(
      token TEXT PRIMARY KEY,delivery_boy_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,created_at TEXT NOT NULL
    )
  `).run();

  // Upgrade older D1 schemas without destroying existing data.
  await addMissingColumns(env,"admin_sessions",{
    admin_name:"TEXT"
  });

  await addMissingColumns(env,"delivery_boys",{
    name:"TEXT",
    mobile:"TEXT",
    access_key:"TEXT",
    active:"INTEGER DEFAULT 1",
    created_at:"TEXT"
  });
  await addMissingColumns(env,"delivery_otp_requests",{
    mobile:"TEXT",
    otp:"TEXT",
    delivery_boy_id:"TEXT",
    approved:"INTEGER DEFAULT 0",
    used:"INTEGER DEFAULT 0",
    expires_at:"TEXT",
    created_at:"TEXT"
  });
  await addMissingColumns(env,"delivery_sessions",{
    delivery_boy_id:"TEXT",
    expires_at:"TEXT",
    created_at:"TEXT"
  });

  // One-time cleanup/migration: remove the old placeholder "Delivery Boy 1"
  // and promote the existing Praveen record (formerly DB005) to DB001.
  // Existing assignments/sessions/OTP requests are moved first so history is preserved.
  const oldBoy=await env.DB.prepare(`SELECT id FROM delivery_boys WHERE id='DB001' AND name='Delivery Boy 1' LIMIT 1`).first();
  const praveen=await env.DB.prepare(`SELECT id FROM delivery_boys WHERE lower(name)=lower('Praveen') ORDER BY id DESC LIMIT 1`).first();
  const id001=await env.DB.prepare(`SELECT id FROM delivery_boys WHERE id='DB001' LIMIT 1`).first();
  if(praveen && oldBoy){
    await env.DB.prepare(`UPDATE delivery_assignments SET delivery_boy_id='DB001' WHERE delivery_boy_id=?`).bind(praveen.id).run();
    await env.DB.prepare(`UPDATE delivery_sessions SET delivery_boy_id='DB001' WHERE delivery_boy_id=?`).bind(praveen.id).run();
    await env.DB.prepare(`UPDATE delivery_otp_requests SET delivery_boy_id='DB001' WHERE delivery_boy_id=?`).bind(praveen.id).run();
    await env.DB.prepare(`DELETE FROM delivery_boys WHERE id='DB001'`).run();
    await env.DB.prepare(`UPDATE delivery_boys SET id='DB001' WHERE id=?`).bind(praveen.id).run();
  } else if(praveen && !id001){
    await env.DB.prepare(`UPDATE delivery_boys SET id='DB001' WHERE id=?`).bind(praveen.id).run();
  } else if(oldBoy && !praveen){
    // Do not recreate the placeholder automatically; Delivery Boys are managed by Admin.
    await env.DB.prepare(`DELETE FROM delivery_sessions WHERE delivery_boy_id='DB001'`).run();
    await env.DB.prepare(`DELETE FROM delivery_boys WHERE id='DB001' AND name='Delivery Boy 1'`).run();
  }
}

function getCookie(request,name){
  const raw=request.headers.get("cookie")||"";
  for(const part of raw.split(";")){
    const [k,...rest]=part.trim().split("=");
    if(k===name) return decodeURIComponent(rest.join("=")||"");
  }
  return "";
}

async function getAdminSession(request,env){
  try{
    await ensureCoreTables(env);
    const s=getCookie(request,"classic_admin_session") || String(request.headers.get("x-admin-session")||"").trim();
    if(!s) return null;
    return await env.DB.prepare(`
      SELECT token,admin_name,expires_at
      FROM admin_sessions
      WHERE token=? AND expires_at>?
      LIMIT 1
    `).bind(s,new Date().toISOString()).first();
  }catch{
    return null;
  }
}

async function adminSessionValid(request,env){
  try{
    await ensureCoreTables(env);
    const s=getCookie(request,"classic_admin_session");
    if(!s) return false;
    const row=await env.DB.prepare(`
      SELECT token FROM admin_sessions
      WHERE token=? AND expires_at>?
      LIMIT 1
    `).bind(s,new Date().toISOString()).first();
    return !!row;
  }catch{
    return false;
  }
}

async function authorized(request,env,type){
  if(type==="admin"){
    if(await adminSessionValid(request,env)) return true;
    const key=request.headers.get("x-admin-key");
    return !!key && ((!!env.ADMIN_KEY && key===env.ADMIN_KEY) || (!!env.ADMIN_KEY_2 && key===env.ADMIN_KEY_2));
  }

  if(type==="delivery"){
    const session=request.headers.get("x-delivery-session");
    if(session){
      try{
        await ensureDeliveryTables(env);
        const row=await env.DB.prepare(`
          SELECT s.delivery_boy_id
          FROM delivery_sessions s
          JOIN delivery_boys b ON b.id=s.delivery_boy_id
          WHERE s.token=? AND s.expires_at>? AND b.active=1
          LIMIT 1
        `).bind(session,new Date().toISOString()).first();
        return !!row;
      }catch{return false;}
    }

    const key=request.headers.get("x-delivery-key");
    if(!key) return false;
    if(env.DELIVERY_KEY && key===env.DELIVERY_KEY) return true;

    try{
      await ensureDeliveryTables(env);
      const row=await env.DB.prepare(`
        SELECT id FROM delivery_boys WHERE access_key=? AND active=1 LIMIT 1
      `).bind(key).first();
      return !!row;
    }catch{return false;}
  }
  return false;
}

async function getDeliveryBoyId(request,env){
  const session=request.headers.get("x-delivery-session");
  if(session){
    await ensureDeliveryTables(env);
    const row=await env.DB.prepare(`
      SELECT s.delivery_boy_id
      FROM delivery_sessions s JOIN delivery_boys b ON b.id=s.delivery_boy_id
      WHERE s.token=? AND s.expires_at>? AND b.active=1 LIMIT 1
    `).bind(session,new Date().toISOString()).first();
    return row?.delivery_boy_id||null;
  }

  const key=request.headers.get("x-delivery-key");
  if(!key) return null;
  await ensureDeliveryTables(env);
  const row=await env.DB.prepare(`
    SELECT id FROM delivery_boys WHERE access_key=? AND active=1 LIMIT 1
  `).bind(key).first();
  return row?.id || (env.DELIVERY_KEY && key===env.DELIVERY_KEY ? "DB001" : null);
}

async function getAssignDistance(env){
  const s=await getSettings(env);
  return Math.min(Math.max(Number(s.auto_assign_distance)||DEFAULT_ASSIGN_DISTANCE,0.5),10);
}

async function getLoggedInDeliveryBoys(env){
  await ensureDeliveryTables(env);
  const rows=await env.DB.prepare(`
    SELECT s.delivery_boy_id,b.name,b.mobile,s.created_at
    FROM delivery_sessions s
    JOIN delivery_boys b ON b.id=s.delivery_boy_id
    WHERE s.expires_at>? AND b.active=1
    ORDER BY b.id ASC
  `).bind(new Date().toISOString()).all();
  return rows.results||[];
}

async function autoAssignOrder(env,orderId,lat,lng){
  await ensureDeliveryTables(env);

  // Only currently logged-in + active Delivery Boys can receive new orders.
  const loggedIn=await getLoggedInDeliveryBoys(env);
  if(!loggedIn.length){
    return {assigned:false,reason:"NO_LOGGED_IN_DELIVERY_BOY"};
  }

  const now=new Date().toISOString();
  const assignDistance=await getAssignDistance(env);

  // If a new order is close to the most recent still-active order (default
  // assignment distance is configurable; for the requested setup use 1 KM),
  // keep both orders with the same logged-in delivery boy. This helps a rider
  // deliver nearby orders together instead of splitting them between riders.
  const nearby=await env.DB.prepare(`
    SELECT da.delivery_boy_id,da.assigned_at,o.id,o.lat,o.lng,o.status
    FROM delivery_assignments da
    JOIN orders o ON o.id=da.order_id
    WHERE da.delivery_boy_id IN (${loggedIn.map(()=>'?').join(',')})
      AND o.id<>?
      AND o.lat IS NOT NULL AND o.lng IS NOT NULL
      AND o.status NOT IN ('DELIVERED','CANCELLED')
    ORDER BY da.assigned_at DESC
    LIMIT 25
  `).bind(...loggedIn.map(x=>x.delivery_boy_id),orderId).all();

  const toRad=v=>Number(v)*Math.PI/180;
  const distanceKm=(aLat,aLng,bLat,bLng)=>{
    const R=6371;
    const dLat=toRad(Number(bLat)-Number(aLat));
    const dLng=toRad(Number(bLng)-Number(aLng));
    const aa=Math.sin(dLat/2)**2+
      Math.cos(toRad(Number(aLat)))*Math.cos(toRad(Number(bLat)))*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(aa),Math.sqrt(Math.max(0,1-aa)));
  };

  if(Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))){
    for(const candidate of (nearby.results||[])){
      const d=distanceKm(lat,lng,candidate.lat,candidate.lng);
      // Requested grouping threshold: 1 KM. Keep this explicit instead of
      // using the general auto-assign radius, which is for other UI settings.
      if(d<=1){
        const assignedAt=now;
        await env.DB.prepare(`
          INSERT INTO delivery_assignments(order_id,delivery_boy_id,assigned_at)
          VALUES(?,?,?)
          ON CONFLICT(order_id) DO UPDATE SET
            delivery_boy_id=excluded.delivery_boy_id,assigned_at=excluded.assigned_at
        `).bind(orderId,candidate.delivery_boy_id,assignedAt).run();

        const boy=loggedIn.find(x=>x.delivery_boy_id===candidate.delivery_boy_id);
        return {
          assigned:true,
          delivery_boy_id:candidate.delivery_boy_id,
          delivery_boy_name:boy?.name||null,
          distance_km:Number(d.toFixed(2)),
          rule:"NEARBY_ORDER_WITHIN_1_KM"
        };
      }
    }
  }

  // No nearby active order: distribute among currently logged-in boys.
  const last=await env.DB.prepare(`
    SELECT da.delivery_boy_id
    FROM delivery_assignments da
    JOIN orders o ON o.id=da.order_id
    WHERE da.delivery_boy_id IN (${loggedIn.map(()=>'?').join(',')})
    ORDER BY da.assigned_at DESC
    LIMIT 1
  `).bind(...loggedIn.map(x=>x.delivery_boy_id)).first();

  let idx=0;
  if(last){
    const lastIdx=loggedIn.findIndex(x=>x.delivery_boy_id===last.delivery_boy_id);
    idx=lastIdx>=0 ? (lastIdx+1)%loggedIn.length : 0;
  }
  const selected=loggedIn[idx];

  await env.DB.prepare(`
    INSERT INTO delivery_assignments(order_id,delivery_boy_id,assigned_at)
    VALUES(?,?,?)
    ON CONFLICT(order_id) DO UPDATE SET
      delivery_boy_id=excluded.delivery_boy_id,assigned_at=excluded.assigned_at
  `).bind(orderId,selected.delivery_boy_id,now).run();

  return {
    assigned:true,
    delivery_boy_id:selected.delivery_boy_id,
    delivery_boy_name:selected.name,
    distance_km:null,
    rule:"LOGGED_IN_ROUND_ROBIN"
  };
}

async function publicMenu(env){
  await ensureCoreTables(env);
  const rows=await env.DB.prepare(`
    SELECT id,name,category,available,updated_at
    FROM menu_items ORDER BY category,name
  `).all();
  return rows.results.map(x=>({...x,available:Number(x.available)===1,hidden:false}));
}

async function checkItemsAvailable(env,items){
  await ensureCoreTables(env);
  for(const item of items){
    const name=String(item.name||"").trim();
    const row=await env.DB.prepare(`
      SELECT available FROM menu_items WHERE lower(name)=lower(?) LIMIT 1
    `).bind(name).first();

    // Existing website items not yet registered in Admin are allowed for backward compatibility.
    if(row && Number(row.available)!==1){
      return {ok:false,item:name};
    }
  }
  return {ok:true};
}

async function api(request,env,url){
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:corsHeaders()});

  // Initialize/upgrade required D1 tables on first API request.
  // Safe for existing data: CREATE IF NOT EXISTS + missing-column upgrades only.
  await ensureCoreTables(env);
  await ensureDeliveryTables(env);

  // Admin session bootstrap: ADMIN_KEY or ADMIN_KEY_2, then secure 24-hour cookie.
  if(url.pathname==="/api/admin/session" && request.method==="POST"){
    const key=request.headers.get("x-admin-key");
    let adminName="";
    if(env.ADMIN_KEY && key===env.ADMIN_KEY){
      adminName=String(env.ADMIN_NAME||"Admin 1").trim();
    }else if(env.ADMIN_KEY_2 && key===env.ADMIN_KEY_2){
      adminName=String(env.ADMIN_NAME_2||"Admin 2").trim();
    }else{
      return json({error:"Invalid Admin Key."},401);
    }

    await ensureCoreTables(env);
    const session=token();
    const expires=new Date(Date.now()+24*60*60*1000).toISOString();
    await env.DB.prepare(`
      INSERT INTO admin_sessions(token,expires_at,created_at,admin_name)
      VALUES(?,?,?,?)
    `).bind(session,expires,new Date().toISOString(),adminName).run();

    return new Response(JSON.stringify({
      ok:true,
      expires_at:expires,
      admin_name:adminName,
      session_token:session
    }),{
      status:200,
      headers:{
        "content-type":"application/json; charset=utf-8",
        "cache-control":"no-store",
        "set-cookie":`classic_admin_session=${encodeURIComponent(session)}; Max-Age=86400; Path=/; HttpOnly; Secure; SameSite=Lax`
      }
    });
  }

  if(url.pathname==="/api/admin/logout" && request.method==="POST"){
    const s=getCookie(request,"classic_admin_session");
    if(s){
      await ensureCoreTables(env);
      await env.DB.prepare(`DELETE FROM admin_sessions WHERE token=?`).bind(s).run();
    }
    return new Response(JSON.stringify({ok:true}),{
      status:200,
      headers:{
        "content-type":"application/json; charset=utf-8",
        "cache-control":"no-store",
        "set-cookie":"classic_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
      }
    });
  }

  if(url.pathname==="/api/admin/me" && request.method==="GET"){
    const s=await getAdminSession(request,env);
    if(!s) return json({error:"Unauthorized"},401);
    return json({ok:true,admin_name:String(s.admin_name||"Classic Cafe Admin").trim(),expires_at:s.expires_at});
  }

  // Public menu availability
  if((url.pathname==="/api/menu" || url.pathname==="/api/menu-items") && request.method==="GET"){
    return json({ok:true,items:await publicMenu(env)});
  }

  // Admin menu list
  if((url.pathname==="/api/admin/menu" || url.pathname==="/api/menu-items") && request.method==="GET"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    return json({ok:true,items:await publicMenu(env)});
  }

  // Admin create/update menu item
  if((url.pathname==="/api/admin/menu" || url.pathname==="/api/menu-items") && request.method==="POST"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureCoreTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const name=String(b.name||"").trim(), category=String(b.category||"").trim();
    if(!name) return json({error:"Item name required"},400);
    const id=String(b.id||("MENU-"+token().slice(0,12)));
    const available=b.available===undefined?true:!!b.available;
    await env.DB.prepare(`
      INSERT INTO menu_items(id,name,category,available,updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET
        category=excluded.category,available=excluded.available,updated_at=excluded.updated_at
    `).bind(id,name,category,available?1:0,new Date().toISOString()).run();
    return json({ok:true,items:await publicMenu(env)});
  }

  // Admin category availability: turn an entire category ON/OFF at once.
  if(url.pathname==="/api/admin/menu/category" && request.method==="PUT"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureCoreTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const category=String(b.category||"").trim();
    if(!category) return json({error:"Category is required."},400);
    if(b.available===undefined) return json({error:"available must be true or false."},400);
    const available=!!b.available;
    const now=new Date().toISOString();
    await env.DB.prepare(`
      UPDATE menu_items SET available=?,updated_at=?
      WHERE lower(category)=lower(?)
    `).bind(available?1:0,now,category).run();
    return json({ok:true,category,available,items:await publicMenu(env)});
  }

  const menuPut=url.pathname.match(/^\/api\/(?:admin\/menu|menu-items)\/([^/]+)$/);
  if(menuPut && request.method==="PUT"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureCoreTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const id=decodeURIComponent(menuPut[1]);
    const row=await env.DB.prepare(`SELECT id FROM menu_items WHERE id=? LIMIT 1`).bind(id).first();
    if(!row) return json({error:"Menu item not found"},404);
    if(b.state!==undefined){
      if(!["available","soldout","hidden"].includes(String(b.state))){
        return json({error:"Invalid menu state"},400);
      }
      // "hidden" is treated as unavailable for ordering; the dashboard can still show it.
      await env.DB.prepare(`UPDATE menu_items SET available=?,updated_at=? WHERE id=?`)
        .bind(String(b.state)==="available"?1:0,new Date().toISOString(),id).run();
    }else if(b.available!==undefined){
      await env.DB.prepare(`UPDATE menu_items SET available=?,updated_at=? WHERE id=?`)
        .bind(b.available?1:0,new Date().toISOString(),id).run();
    }
    if(b.name!==undefined){
      const name=String(b.name||"").trim();
      if(name) await env.DB.prepare(`UPDATE menu_items SET name=?,updated_at=? WHERE id=?`)
        .bind(name,new Date().toISOString(),id).run();
    }
    if(b.category!==undefined){
      await env.DB.prepare(`UPDATE menu_items SET category=?,updated_at=? WHERE id=?`)
        .bind(String(b.category||""),new Date().toISOString(),id).run();
    }
    return json({ok:true,items:await publicMenu(env)});
  }

  // OTP request
  if(url.pathname==="/api/delivery/otp/request" && request.method==="POST"){
    await ensureDeliveryTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const mobile=String(b.mobile||"").trim();
    if(!/^[0-9]{10}$/.test(mobile)) return json({error:"Valid 10 digit mobile number required."},400);
    const boy=await env.DB.prepare(`
      SELECT id,name,mobile,active FROM delivery_boys WHERE replace(replace(replace(mobile,' ',''),'-',''),'+91','')=? LIMIT 1
    `).bind(mobile).first();
    if(!boy) return json({
      error:"This mobile number is not registered as Delivery Boy.",
      hint:"Admin Dashboard → Delivery Boys में पहले Delivery Boy का 10-digit mobile number save करें."
    },404);
    if(!Number(boy.active)) return json({error:"This Delivery Boy is disabled by Admin."},403);

    const otp=String(Math.floor(100000+Math.random()*900000));
    const id=crypto.randomUUID(), now=new Date(), expires=new Date(now.getTime()+5*60*1000).toISOString();
    await env.DB.prepare(`UPDATE delivery_otp_requests SET used=1 WHERE mobile=? AND used=0`).bind(mobile).run();
    await env.DB.prepare(`
      INSERT INTO delivery_otp_requests(id,mobile,otp,delivery_boy_id,approved,used,expires_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(id,mobile,otp,boy.id,0,0,expires,now.toISOString()).run();

    return json({
      ok:true,
      message:"OTP request created. Admin verification required.",
      request_id:id,delivery_boy_id:boy.id,name:boy.name
    });
  }

  // Admin OTP requests
  if(url.pathname==="/api/admin/delivery/otp" && request.method==="GET"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureDeliveryTables(env);
    const rows=await env.DB.prepare(`
      SELECT r.id,r.mobile,r.otp,r.delivery_boy_id,r.approved,r.used,r.expires_at,r.created_at,b.name
      FROM delivery_otp_requests r LEFT JOIN delivery_boys b ON b.id=r.delivery_boy_id
      WHERE r.used=0 AND r.expires_at>? ORDER BY r.created_at DESC
    `).bind(new Date().toISOString()).all();
    return json({ok:true,requests:rows.results});
  }

  const otpApprove=url.pathname.match(/^\/api\/admin\/delivery\/otp\/([^/]+)\/approve$/);
  if(otpApprove && request.method==="PUT"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureDeliveryTables(env);
    const id=decodeURIComponent(otpApprove[1]);
    const row=await env.DB.prepare(`
      SELECT * FROM delivery_otp_requests WHERE id=? LIMIT 1
    `).bind(id).first();
    if(!row) return json({error:"OTP request not found."},404);
    if(Number(row.used)) return json({error:"This OTP request has already been used."},400);
    if(new Date(row.expires_at).getTime()<=Date.now()) return json({error:"This OTP request has expired."},400);
    await env.DB.prepare(`UPDATE delivery_otp_requests SET approved=1 WHERE id=?`).bind(id).run();
    return json({ok:true,message:"Delivery Boy OTP approved successfully.",request_id:id,delivery_boy_id:row.delivery_boy_id,mobile:row.mobile});
  }

  // OTP verify
  if(url.pathname==="/api/delivery/otp/verify" && request.method==="POST"){
    await ensureDeliveryTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const mobile=String(b.mobile||"").trim(), otp=String(b.otp||"").trim();
    if(!/^[0-9]{10}$/.test(mobile)||!/^[0-9]{6}$/.test(otp)) return json({error:"Invalid mobile or OTP."},400);
    const row=await env.DB.prepare(`
      SELECT * FROM delivery_otp_requests
      WHERE mobile=? AND otp=? ORDER BY created_at DESC LIMIT 1
    `).bind(mobile,otp).first();
    if(!row) return json({error:"Invalid OTP."},401);
    if(Number(row.used)) return json({error:"This OTP has already been used."},401);
    if(new Date(row.expires_at).getTime()<=Date.now()) return json({error:"OTP has expired."},401);
    if(!Number(row.approved)) return json({error:"Admin approval pending. Please ask Admin to approve your login."},403);

    const boy=await env.DB.prepare(`SELECT id,name,mobile,active FROM delivery_boys WHERE id=? LIMIT 1`)
      .bind(row.delivery_boy_id).first();
    if(!boy) return json({error:"Delivery Boy not found."},404);
    if(!Number(boy.active)) return json({error:"Your Delivery Boy account is disabled."},403);

    const session=token(), exp=new Date(Date.now()+24*60*60*1000).toISOString();
    await env.DB.prepare(`DELETE FROM delivery_sessions WHERE delivery_boy_id=? OR expires_at<=?`)
      .bind(boy.id,new Date().toISOString()).run();
    await env.DB.prepare(`
      INSERT INTO delivery_sessions(token,delivery_boy_id,expires_at,created_at)
      VALUES(?,?,?,?)
    `).bind(session,boy.id,exp,new Date().toISOString()).run();
    await env.DB.prepare(`UPDATE delivery_otp_requests SET used=1 WHERE id=?`).bind(row.id).run();

    const srRow=await env.DB.prepare(`SELECT COUNT(*) AS sr_no FROM delivery_boys WHERE active=1 AND id<=?`).bind(boy.id).first();
    const sr_no=Number(srRow?.sr_no||0);
    return json({ok:true,message:"Delivery Boy login successful.",session_token:session,expires_at:exp,delivery_boy:{id:boy.id,name:boy.name,mobile:boy.mobile,sr_no}});
  }

  if(url.pathname==="/api/health" && request.method==="GET"){
    return json({ok:true,service:"Classic Cafe Orders"});
  }

  // Public settings for the customer website.
  // Only non-sensitive shop configuration is exposed; admin authentication is NOT required.
  if(url.pathname==="/api/public-settings" && request.method==="GET"){
    const s=await getSettings(env);
    return json({ok:true,settings:{
      shop_open:s.shop_open,
      website_orders:s.website_orders,
      delivery_enabled:s.delivery_enabled,
      opening_time:s.opening_time,
      closing_time:s.closing_time,
      delivery_radius:s.delivery_radius,
      delivery_rate:s.delivery_rate
    }});
  }

  // Settings
  if(url.pathname==="/api/settings" && request.method==="GET"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    return json({ok:true,settings:await getSettings(env)});
  }

  if(url.pathname==="/api/settings" && request.method==="PUT"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureCoreTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const allowed=["shop_open","website_orders","delivery_enabled","opening_time","closing_time","delivery_radius","delivery_rate","auto_assign_distance"];
    const now=new Date().toISOString();

    for(const key of allowed){
      if(b[key]===undefined) continue;
      let value=b[key];

      if(["shop_open","website_orders","delivery_enabled"].includes(key)){
        value=!!value;
      }
      if(key==="opening_time"||key==="closing_time"){
        if(!/^\d{2}:\d{2}$/.test(String(value))) return json({error:"Time must be HH:MM"},400);
        const mins=toMinutes(value,"00:00");
        if(mins>1439) return json({error:"Invalid time"},400);
      }
      if(key==="delivery_radius"){
        value=Number(value);
        if(!Number.isFinite(value)||value<=0||value>50) return json({error:"Delivery radius must be between 0 and 50 KM."},400);
      }
      if(key==="delivery_rate"){
        value=Number(value);
        if(!Number.isFinite(value)||value<0||value>1000) return json({error:"Delivery rate is invalid."},400);
      }
      if(key==="auto_assign_distance"){
        value=Number(value);
        if(!Number.isFinite(value)||value<=0||value>10) return json({error:"Auto assign distance must be between 0 and 10 KM."},400);
      }

      await env.DB.prepare(`
        INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
      `).bind(key,String(value),now).run();
    }
    return json({ok:true,settings:await getSettings(env)});
  }

  // Delivery boys
  if(url.pathname==="/api/delivery/boys" && request.method==="GET"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureDeliveryTables(env);
    const rows=await env.DB.prepare(`
      SELECT id,name,mobile,active,created_at FROM delivery_boys ORDER BY id ASC
    `).all();
    return json({ok:true,boys:rows.results});
  }

  if(url.pathname==="/api/delivery/boys" && request.method==="POST"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureDeliveryTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const name=String(b.name||"").trim(), mobile=String(b.mobile||"").trim(), accessKey=String(b.access_key||"").trim();
    if(!name||!accessKey) return json({error:"Name and Delivery Key are required."},400);
    if(mobile&&!/^[0-9]{10}$/.test(mobile)) return json({error:"Mobile must be a valid 10 digit number."},400);
    const ex=await env.DB.prepare(`SELECT id FROM delivery_boys WHERE access_key=?`).bind(accessKey).first();
    if(ex) return json({error:"This Delivery Key is already in use."},409);
    const rows=await env.DB.prepare(`SELECT id FROM delivery_boys ORDER BY id DESC`).all();
    let n=1;
    if(rows.results.length){
      const last=Number(String(rows.results[0].id).replace("DB",""));
      if(Number.isFinite(last)) n=last+1;
    }
    const id="DB"+String(n).padStart(3,"0");
    await env.DB.prepare(`
      INSERT INTO delivery_boys(id,name,mobile,access_key,active,created_at)
      VALUES(?,?,?,?,?,?)
    `).bind(id,name,mobile,accessKey,1,new Date().toISOString()).run();
    return json({ok:true,delivery_boy:{id,name,mobile,active:1}});
  }

  const boyMatch=url.pathname.match(/^\/api\/delivery\/boys\/([^/]+)$/);
  if(boyMatch && request.method==="PUT"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureDeliveryTables(env);
    const id=decodeURIComponent(boyMatch[1]);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    if(b.active!==undefined) await env.DB.prepare(`UPDATE delivery_boys SET active=? WHERE id=?`).bind(b.active?1:0,id).run();
    if(b.mobile!==undefined){
      const mobile=String(b.mobile||"").trim();
      if(mobile&&!/^[0-9]{10}$/.test(mobile)) return json({error:"Mobile must be a valid 10 digit number."},400);
      await env.DB.prepare(`UPDATE delivery_boys SET mobile=? WHERE id=?`).bind(mobile,id).run();
    }
    if(b.name!==undefined){
      const name=String(b.name||"").trim();
      if(name) await env.DB.prepare(`UPDATE delivery_boys SET name=? WHERE id=?`).bind(name,id).run();
    }
    const row=await env.DB.prepare(`SELECT id,name,mobile,active FROM delivery_boys WHERE id=?`).bind(id).first();
    if(!row) return json({error:"Delivery Boy not found"},404);
    return json({ok:true,delivery_boy:row});
  }

  // Delivery logout: invalidate the server-side session immediately.
  if(url.pathname==="/api/delivery/logout" && request.method==="POST"){
    const session=request.headers.get("x-delivery-session");
    if(session){
      await ensureDeliveryTables(env);
      await env.DB.prepare(`DELETE FROM delivery_sessions WHERE token=?`).bind(session).run();
    }
    return json({ok:true});
  }

  // Delivery stats
  if(url.pathname==="/api/delivery/stats" && request.method==="GET"){
    if(!await authorized(request,env,"delivery")) return json({error:"Unauthorized"},401);
    await ensureDeliveryTables(env);
    const boyId=await getDeliveryBoyId(request,env);
    if(!boyId) return json({error:"Delivery Boy not found"},401);
    const row=await env.DB.prepare(`
      SELECT COUNT(*) AS completed_today,COALESCE(SUM(o.delivery_charge),0) AS earnings_today
      FROM orders o JOIN delivery_assignments da ON da.order_id=o.id
      WHERE da.delivery_boy_id=? AND o.status='DELIVERED'
      AND date(o.created_at,'localtime')=date('now','localtime')
    `).bind(boyId).first();
    const boy=await env.DB.prepare(`SELECT id,name,mobile,active FROM delivery_boys WHERE id=? LIMIT 1`).bind(boyId).first();
    if(!boy) return json({error:"Delivery Boy not found"},401);
    const srRow=await env.DB.prepare(`SELECT COUNT(*) AS sr_no FROM delivery_boys WHERE active=1 AND id<=?`).bind(boy.id).first();
    return json({ok:true,completed_today:Number(row?.completed_today||0),earnings_today:Number(row?.earnings_today||0),delivery_boy:{...boy,sr_no:Number(srRow?.sr_no||0)}});
  }

  // Create order
  if(url.pathname==="/api/orders" && request.method==="POST"){
    const s=await getSettings(env);
    if(!s.shop_open) return json({error:"Shop is currently closed."},400);
    if(!s.website_orders) return json({error:"Online ordering is currently OFF."},400);
    if(!s.delivery_enabled) return json({error:"Delivery is currently unavailable."},400);
    if(!timeOpen(s.opening_time,s.closing_time)){
      return json({error:`Online ordering is open from ${s.opening_time} to ${s.closing_time}.`},400);
    }

    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const {customer_name,mobile,address,lat,lng,items}=b;

    if(!customer_name||!/^[0-9]{10}$/.test(String(mobile))||!address||
       typeof lat!=="number"||typeof lng!=="number"||!Array.isArray(items)||!items.length){
      return json({error:"Missing or invalid order details"},400);
    }

    const d=dist(CAFE_LAT,CAFE_LNG,lat,lng);
    const radius=Number(s.delivery_radius)||DEFAULT_RADIUS;
    if(d>radius) return json({error:`Delivery is available only within ${radius} KM`,distance_km:Number(d.toFixed(2))},400);

    const availability=await checkItemsAvailable(env,items);
    if(!availability.ok) return json({error:`${availability.item} is currently not available.`,item:availability.item},409);

    const delivery=Math.max(20,Math.ceil(d)*(Number(s.delivery_rate)||DEFAULT_RATE));
    let food=0;
    for(const x of items){
      const p=Number(x.price),q=Number(x.qty);
      if(!x.name||!Number.isFinite(p)||p<0||!Number.isInteger(q)||q<1||q>50) return json({error:"Invalid item"},400);
      food+=p*q;
    }

    const id="CC"+Date.now().toString().slice(-8), tracking_token=token(), now=new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO orders(
        id,created_at,customer_name,mobile,address,lat,lng,distance_km,
        delivery_charge,food_total,grand_total,payment_method,payment_status,status,items_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(id,now,customer_name,String(mobile),address,lat,lng,Number(d.toFixed(3)),
      delivery,food,food+delivery,"COD_OR_UPI_TO_DELIVERY_BOY","UNPAID","NEW",JSON.stringify(items)).run();

    await env.DB.prepare(`INSERT INTO order_tracking(order_id,tracking_token) VALUES(?,?)`).bind(id,tracking_token).run();
    const assignment=await autoAssignOrder(env,id,lat,lng);

    return json({ok:true,order_id:id,tracking_token,distance_km:Number(d.toFixed(2)),
      delivery_charge:delivery,food_total:food,grand_total:food+delivery,status:"NEW",assignment});
  }

  // Get orders
  if(url.pathname==="/api/orders" && request.method==="GET"){
    const deliverySession=String(request.headers.get("x-delivery-session")||"").trim();
    const adminAllowed=await authorized(request,env,"admin");
    const deliveryAllowed=await authorized(request,env,"delivery");

    // IMPORTANT: /delivery requests must always be scoped to the logged-in
    // Delivery Boy, even if the same browser also has an Admin session cookie.
    // Otherwise adminAllowed=true could expose all orders on the Delivery page.
    if(deliverySession){
      if(!deliveryAllowed) return json({error:"Delivery session expired. Please login again."},401);
    }else if(!adminAllowed){
      return json({error:"Unauthorized"},401);
    }

    await ensureDeliveryTables(env);
    const limit=Math.min(Number(url.searchParams.get("limit")||100),200);

    let rows;
    if(deliverySession){
      const boyId=await getDeliveryBoyId(request,env);
      if(!boyId) return json({error:"Delivery Boy not found"},401);
      const history=url.searchParams.get("history")==="1";
      if(history){
        rows=await env.DB.prepare(`
          SELECT o.*,da.delivery_boy_id FROM orders o
          JOIN delivery_assignments da ON da.order_id=o.id
          WHERE da.delivery_boy_id=? AND o.status='DELIVERED'
          ORDER BY o.created_at DESC LIMIT ?
        `).bind(boyId,limit).all();
      }else{
        rows=await env.DB.prepare(`
          SELECT o.*,da.delivery_boy_id FROM orders o
          JOIN delivery_assignments da ON da.order_id=o.id
          WHERE da.delivery_boy_id=?
            AND o.status IN('NEW','ACCEPTED','PREPARING','OUT_FOR_DELIVERY')
          ORDER BY o.created_at ASC LIMIT ?
        `).bind(boyId,limit).all();
      }
    }else{
      rows=await env.DB.prepare(`
        SELECT o.*,da.delivery_boy_id FROM orders o
        LEFT JOIN delivery_assignments da ON o.id=da.order_id
        ORDER BY o.created_at DESC LIMIT ?
      `).bind(limit).all();
    }

    return json({ok:true,orders:rows.results.map(r=>{
      let items=[]; try{items=JSON.parse(r.items_json||"[]")}catch{}
      return {...r,items};
    })});
  }

  // Track
  const tm=url.pathname.match(/^\/api\/track\/([^/]+)$/);
  if(tm&&request.method==="GET"){
    const row=await env.DB.prepare(`
      SELECT o.id,o.created_at,o.customer_name,o.status,o.food_total,o.delivery_charge,
             o.grand_total,o.distance_km,t.lat,t.lng,t.updated_at
      FROM orders o JOIN order_tracking t ON t.order_id=o.id
      WHERE t.tracking_token=?
    `).bind(tm[1]).first();
    if(!row) return json({error:"Tracking link invalid or expired"},404);
    return json({ok:true,order:{
      id:row.id,created_at:row.created_at,customer_name:row.customer_name,status:row.status,
      food_total:row.food_total,delivery_charge:row.delivery_charge,grand_total:row.grand_total,
      distance_km:row.distance_km,
      location:row.lat!=null?{lat:row.lat,lng:row.lng,updated_at:row.updated_at}:null
    }});
  }

  // Delivery location
  const lm=url.pathname.match(/^\/api\/orders\/([^/]+)\/location$/);
  if(lm&&request.method==="PUT"){
    if(!await authorized(request,env,"delivery")) return json({error:"Unauthorized"},401);
    const boyId=await getDeliveryBoyId(request,env);
    if(!boyId) return json({error:"Delivery Boy not found"},401);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const lat=Number(b.lat),lng=Number(b.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180) return json({error:"Invalid location"},400);

    const a=await env.DB.prepare(`
      SELECT order_id FROM delivery_assignments WHERE order_id=? AND delivery_boy_id=?
    `).bind(lm[1],boyId).first();
    if(!a) return json({error:"This order is not assigned to you."},403);
    const order=await env.DB.prepare(`SELECT id,status FROM orders WHERE id=?`).bind(lm[1]).first();
    if(!order) return json({error:"Order not found"},404);

    const now=new Date().toISOString();
    await env.DB.prepare(`UPDATE order_tracking SET lat=?,lng=?,updated_at=? WHERE order_id=?`)
      .bind(lat,lng,now,lm[1]).run();
    if(!["DELIVERED","CANCELLED"].includes(order.status)){
      await env.DB.prepare(`
        UPDATE orders SET status='OUT_FOR_DELIVERY'
        WHERE id=? AND status IN('NEW','ACCEPTED','PREPARING','OUT_FOR_DELIVERY')
      `).bind(lm[1]).run();
    }
    return json({ok:true,updated_at:now});
  }

  // Assign order
  if(url.pathname==="/api/orders/assign" && request.method==="PUT"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureDeliveryTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const orderId=String(b.order_id||"").trim(), boyId=String(b.delivery_boy_id||"").trim();
    if(!orderId||!boyId) return json({error:"Order ID and Delivery Boy ID are required."},400);
    const order=await env.DB.prepare(`SELECT id FROM orders WHERE id=?`).bind(orderId).first();
    if(!order) return json({error:"Order not found"},404);
    const boy=await env.DB.prepare(`SELECT id,name,active FROM delivery_boys WHERE id=?`).bind(boyId).first();
    if(!boy) return json({error:"Delivery Boy not found"},404);
    if(!Number(boy.active)) return json({error:"This Delivery Boy is inactive."},400);
    const now=new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO delivery_assignments(order_id,delivery_boy_id,assigned_at) VALUES(?,?,?)
      ON CONFLICT(order_id) DO UPDATE SET delivery_boy_id=excluded.delivery_boy_id,assigned_at=excluded.assigned_at
    `).bind(orderId,boyId,now).run();
    return json({ok:true,message:"Order assigned successfully.",order_id:orderId,delivery_boy_id:boyId,delivery_boy_name:boy.name,assigned_at:now});
  }

  // Per-order assignment
  const am=url.pathname.match(/^\/api\/orders\/([^/]+)\/assign$/);
  if(am&&request.method==="PUT"){
    if(!await authorized(request,env,"admin")) return json({error:"Unauthorized"},401);
    await ensureDeliveryTables(env);
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const boyId=String(b.delivery_boy_id||"").trim();
    if(!boyId) return json({error:"Delivery Boy ID is required."},400);
    const order=await env.DB.prepare(`SELECT id FROM orders WHERE id=?`).bind(am[1]).first();
    if(!order) return json({error:"Order not found."},404);
    const boy=await env.DB.prepare(`SELECT id,name,mobile,active FROM delivery_boys WHERE id=?`).bind(boyId).first();
    if(!boy) return json({error:"Delivery Boy not found."},404);
    if(!Number(boy.active)) return json({error:"This Delivery Boy is disabled."},400);
    await env.DB.prepare(`
      INSERT INTO delivery_assignments(order_id,delivery_boy_id,assigned_at) VALUES(?,?,?)
      ON CONFLICT(order_id) DO UPDATE SET delivery_boy_id=excluded.delivery_boy_id,assigned_at=excluded.assigned_at
    `).bind(am[1],boyId,new Date().toISOString()).run();
    return json({ok:true,message:"Delivery Boy assigned successfully.",order_id:am[1],delivery_boy:boy});
  }

  // Update order
  const om=url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if(om&&request.method==="PUT"){
    let b; try{b=await request.json()}catch{return json({error:"Invalid JSON"},400);}
    const adminAllowed=await authorized(request,env,"admin");
    const deliveryAllowed=await authorized(request,env,"delivery");
    if(!adminAllowed&&!deliveryAllowed) return json({error:"Unauthorized"},401);

    const allowed=["NEW","ACCEPTED","PREPARING","OUT_FOR_DELIVERY","DELIVERED","CANCELLED"];
    if(b.status&&!allowed.includes(b.status)) return json({error:"Invalid status"},400);

    if(deliveryAllowed&&!adminAllowed){
      const boyId=await getDeliveryBoyId(request,env);
      const a=await env.DB.prepare(`SELECT order_id FROM delivery_assignments WHERE order_id=? AND delivery_boy_id=?`)
        .bind(om[1],boyId).first();
      if(!a) return json({error:"This order is not assigned to you."},403);
    }

    if(b.status) await env.DB.prepare(`UPDATE orders SET status=? WHERE id=?`).bind(b.status,om[1]).run();

    if(b.payment_status&&adminAllowed){
      if(!["UNPAID","PAID"].includes(b.payment_status)) return json({error:"Invalid payment status"},400);
      await env.DB.prepare(`UPDATE orders SET payment_status=? WHERE id=?`).bind(b.payment_status,om[1]).run();
    }

    const row=await env.DB.prepare(`SELECT * FROM orders WHERE id=?`).bind(om[1]).first();
    if(!row) return json({error:"Order not found"},404);
    const a=await env.DB.prepare(`
      SELECT da.delivery_boy_id,b.name AS delivery_boy_name
      FROM delivery_assignments da
      LEFT JOIN delivery_boys b ON b.id=da.delivery_boy_id
      WHERE da.order_id=?
    `).bind(om[1]).first();
    let items=[]; try{items=JSON.parse(row.items_json||"[]")}catch{}
    return json({ok:true,order:{...row,delivery_boy_id:a?.delivery_boy_id||null,delivery_boy_name:a?.delivery_boy_name||null,items}});
  }

  return json({error:"Not found"},404);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);

    if(url.pathname.startsWith("/api/")){
      try{return withCors(await api(request,env,url));}
      catch(error){
        console.error("API ERROR:",error?.stack||error);
        return withCors(json({error:"Worker exception.",detail:String(error?.message||error)},500));
      }
    }

    if(url.pathname==="/admin"||url.pathname==="/admin/"){
      return env.ASSETS.fetch(new Request(new URL("/admin.html",request.url),request));
    }

    if(url.pathname==="/delivery"||url.pathname==="/delivery/"){
      return env.ASSETS.fetch(new Request(new URL("/delivery.html",request.url),request));
    }

    if(url.pathname==="/track"||url.pathname==="/track/"){
      return env.ASSETS.fetch(new Request(new URL("/track.html",request.url),request));
    }

    return env.ASSETS.fetch(request);
  }
};

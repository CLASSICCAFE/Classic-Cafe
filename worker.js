const CAFE_LAT = 26.252917;
const CAFE_LNG = 72.964081;

const RATE = 20;
const RADIUS = 5;

const DELIVERY_START_MIN = 12 * 60;
const DELIVERY_END_MIN = 24 * 60;

const DEFAULT_ASSIGN_DISTANCE = 2;

function deliveryOpen(){
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-GB",{
    timeZone:"Asia/Kolkata",
    hour:"2-digit",
    minute:"2-digit",
    hourCycle:"h23"
  }).formatToParts(now);

  const h = Number(parts.find(p=>p.type==="hour").value);
  const m = Number(parts.find(p=>p.type==="minute").value);

  const mins = h * 60 + m;

  return mins >= DELIVERY_START_MIN &&
         mins < DELIVERY_END_MIN;
}


function json(data,status=200){

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers:{
        "content-type":"application/json; charset=utf-8",
        "cache-control":"no-store"
      }
    }
  );
}


function corsHeaders(){

  return {
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"GET,POST,PUT,OPTIONS",
    "access-control-allow-headers":
      "content-type,x-admin-key,x-delivery-key"
  };

}


function withCors(resp){

  const h = new Headers(resp.headers);

  Object.entries(corsHeaders()).forEach(([k,v])=>{
    h.set(k,v);
  });

  return new Response(
    resp.body,
    {
      status:resp.status,
      headers:h
    }
  );
}


function dist(a,b,c,d){

  const R = 6371;

  const r = x => x * Math.PI / 180;

  const dl = r(c-a);
  const dn = r(d-b);

  const z =
    Math.sin(dl/2)**2 +
    Math.cos(r(a)) *
    Math.cos(r(c)) *
    Math.sin(dn/2)**2;

  return R * 2 *
    Math.atan2(
      Math.sqrt(z),
      Math.sqrt(1-z)
    );
}


function token(){

  return crypto.randomUUID().replaceAll("-","");
}


/* =====================================================
   AUTHENTICATION
===================================================== */

async function authorized(request,env,type){

  const key =
    type === "admin"
      ? request.headers.get("x-admin-key")
      : request.headers.get("x-delivery-key");

  if(!key) return false;

  if(type === "admin"){

    return !!env.ADMIN_KEY &&
           key === env.ADMIN_KEY;

  }

  /*
    Existing DELIVERY_KEY will automatically become
    DB001 if delivery_boys table is used.
  */

  if(env.DELIVERY_KEY && key === env.DELIVERY_KEY){

    return true;

  }

  try{

    await ensureDeliveryTables(env);

    const row =
      await env.DB.prepare(`
        SELECT id
        FROM delivery_boys
        WHERE access_key=?
        AND active=1
        LIMIT 1
      `)
      .bind(key)
      .first();

    return !!row;

  }catch{

    return false;

  }

}


/* =====================================================
   D1 TABLES
===================================================== */

async function ensureDeliveryTables(env){

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS delivery_boys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mobile TEXT,
      access_key TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `).run();


  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS delivery_assignments (
      order_id TEXT PRIMARY KEY,
      delivery_boy_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    )
  `).run();
  /* ===================================================
     DELIVERY OTP VERIFICATION
  =================================================== */

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS delivery_otp_requests (
      id TEXT PRIMARY KEY,
      mobile TEXT NOT NULL,
      otp TEXT NOT NULL,
      delivery_boy_id TEXT,
      approved INTEGER DEFAULT 0,
      used INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();


  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_delivery_otp_mobile
    ON delivery_otp_requests(mobile)
  `).run();
await env.DB.prepare(`
  CREATE TABLE IF NOT EXISTS delivery_sessions (
    token TEXT PRIMARY KEY,
    delivery_boy_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`).run();
  /*
    Default first delivery boy from existing
    Cloudflare DELIVERY_KEY
  */

  if(env.DELIVERY_KEY){

    const exists =
      await env.DB.prepare(`
        SELECT id
        FROM delivery_boys
        WHERE access_key=?
        LIMIT 1
      `)
      .bind(env.DELIVERY_KEY)
      .first();

    if(!exists){

      await env.DB.prepare(`
        INSERT INTO delivery_boys
        (id,name,mobile,access_key,active,created_at)
        VALUES (?,?,?,?,?,?)
      `)
      .bind(
        "DB001",
        "Delivery Boy 1",
        "",
        env.DELIVERY_KEY,
        1,
        new Date().toISOString()
      )
      .run();

    }

  }

}


/* =====================================================
   SETTINGS
===================================================== */

async function getAssignDistance(env){

  try{

    const row =
      await env.DB.prepare(`
        SELECT value
        FROM settings
        WHERE key='auto_assign_distance'
        LIMIT 1
      `)
      .first();

    const n = Number(row?.value);

    if(Number.isFinite(n) && n > 0){

      return Math.min(n,10);

    }

  }catch{}

  return DEFAULT_ASSIGN_DISTANCE;

}


/* =====================================================
   GET DELIVERY BOY ID
===================================================== */

async function getDeliveryBoyId(request,env){

  const key =
    request.headers.get("x-delivery-key");

  if(!key) return null;

  await ensureDeliveryTables(env);

  let row =
    await env.DB.prepare(`
      SELECT id
      FROM delivery_boys
      WHERE access_key=?
      AND active=1
      LIMIT 1
    `)
    .bind(key)
    .first();

  if(row) return row.id;


  /*
    Backward compatibility with existing
    Cloudflare DELIVERY_KEY
  */

  if(env.DELIVERY_KEY && key === env.DELIVERY_KEY){

    return "DB001";

  }

  return null;

}


/* =====================================================
   AUTO ASSIGN ORDER
===================================================== */

async function autoAssignOrder(env,orderId,lat,lng){

  await ensureDeliveryTables(env);

  const maxDistance =
    await getAssignDistance(env);


  /*
    Get all active delivery boys
  */

  const boys =
    await env.DB.prepare(`
      SELECT id,name
      FROM delivery_boys
      WHERE active=1
      ORDER BY id ASC
    `)
    .all();


  if(!boys.results.length){

    return {
      assigned:false,
      reason:"NO_DELIVERY_BOY"
    };

  }


  /*
    Existing orders which are still being prepared
    or accepted/new.

    OUT_FOR_DELIVERY is intentionally excluded.
  */

  const activeOrders =
    await env.DB.prepare(`
      SELECT
        da.delivery_boy_id,
        o.id,
        o.lat,
        o.lng,
        o.status
      FROM delivery_assignments da
      JOIN orders o
      ON o.id=da.order_id
      WHERE o.status IN
      ('NEW','ACCEPTED','PREPARING')
    `)
    .all();


  /*
    First priority:
    Find delivery boy whose existing order
    is within auto-assign distance.
  */

  let candidates=[];


  for(const boy of boys.results){

    const boyOrders =
      activeOrders.results.filter(
        x => x.delivery_boy_id === boy.id
      );


    for(const order of boyOrders){

      if(
        typeof order.lat !== "number" ||
        typeof order.lng !== "number"
      ){

        continue;

      }


      const d =
        dist(
          order.lat,
          order.lng,
          lat,
          lng
        );


      if(d <= maxDistance){

        candidates.push({
          boyId:boy.id,
          distance:d,
          activeCount:boyOrders.length
        });

      }

    }

  }


  /*
    If multiple boys are nearby,
    choose the one with fewer active orders.
  */

  if(candidates.length){

    candidates.sort(
      (a,b)=>
        a.activeCount-b.activeCount ||
        a.distance-b.distance
    );


    const chosen =
      candidates[0];


    await env.DB.prepare(`
      INSERT INTO delivery_assignments
      (order_id,delivery_boy_id,assigned_at)
      VALUES (?,?,?)
    `)
    .bind(
      orderId,
      chosen.boyId,
      new Date().toISOString()
    )
    .run();


    return {
      assigned:true,
      delivery_boy_id:chosen.boyId,
      distance_km:Number(
        chosen.distance.toFixed(2)
      ),
      rule:"NEARBY_ORDER"
    };

  }


  /*
    No nearby order.

    Find a delivery boy who currently has
    no NEW / ACCEPTED / PREPARING order.
  */

  const busyCounts={};

  for(const row of activeOrders.results){

    busyCounts[row.delivery_boy_id] =
      (busyCounts[row.delivery_boy_id] || 0) + 1;

  }


  const free =
    boys.results
      .filter(b => !busyCounts[b.id])
      .sort((a,b)=>a.id.localeCompare(b.id));


  if(free.length){

    const chosen=free[0];


    await env.DB.prepare(`
      INSERT INTO delivery_assignments
      (order_id,delivery_boy_id,assigned_at)
      VALUES (?,?,?)
    `)
    .bind(
      orderId,
      chosen.id,
      new Date().toISOString()
    )
    .run();


    return {
      assigned:true,
      delivery_boy_id:chosen.id,
      distance_km:null,
      rule:"FREE_DELIVERY_BOY"
    };

  }


  /*
    Nobody suitable right now.
  */

  return {
    assigned:false,
    reason:"NO_SUITABLE_DELIVERY_BOY"
  };

}


/* =====================================================
   API
===================================================== */

async function api(request,env,url){
  /* ===================================================
     DELIVERY OTP - REQUEST
  =================================================== */

  if(
    url.pathname==="/api/delivery/otp/request" &&
    request.method==="POST"
  ){

    await ensureDeliveryTables(env);

    let body;

    try{
      body=await request.json();
    }catch{
      return json({error:"Invalid JSON"},400);
    }

    const mobile=String(body.mobile||"").trim();

    if(!/^[0-9]{10}$/.test(mobile)){
      return json(
        {error:"Valid 10 digit mobile number required."},
        400
      );
    }

    const boy=
      await env.DB.prepare(`
        SELECT id,name,mobile,active
        FROM delivery_boys
        WHERE mobile=?
        LIMIT 1
      `)
      .bind(mobile)
      .first();

    if(!boy){
      return json(
        {error:"This mobile number is not registered as Delivery Boy."},
        404
      );
    }

    if(!Number(boy.active)){
      return json(
        {error:"This Delivery Boy is disabled by Admin."},
        403
      );
    }

    /*
      OTP will be approved by Admin.
      No public login without Admin verification.
    */

    const otp=
      String(
        Math.floor(
          100000 + Math.random()*900000
        )
      );

    const id=crypto.randomUUID();

    const now=new Date();

    const expires=
      new Date(
        now.getTime()+5*60*1000
      ).toISOString();

    await env.DB.prepare(`
      UPDATE delivery_otp_requests
      SET used=1
      WHERE mobile=?
      AND used=0
    `)
    .bind(mobile)
    .run();

    await env.DB.prepare(`
      INSERT INTO delivery_otp_requests
      (
        id,
        mobile,
        otp,
        delivery_boy_id,
        approved,
        used,
        expires_at,
        created_at
      )
      VALUES (?,?,?,?,?,?,?,?)
    `)
    .bind(
      id,
      mobile,
      otp,
      boy.id,
      0,
      0,
      expires,
      now.toISOString()
    )
    .run();

    return json({
      ok:true,
      message:"OTP request created. Admin verification required.",
      request_id:id,
      delivery_boy_id:boy.id,
      name:boy.name
    });

  }  /* ===================================================
     ADMIN - PENDING DELIVERY OTP REQUESTS
  =================================================== */

  if(
    url.pathname==="/api/admin/delivery/otp" &&
    request.method==="GET"
  ){

    if(!await authorized(request,env,"admin")){

      return json(
        {error:"Unauthorized"},
        401
      );

    }

    await ensureDeliveryTables(env);

    const rows =
      await env.DB.prepare(`
        SELECT
          r.id,
          r.mobile,
          r.otp,
          r.delivery_boy_id,
          r.approved,
          r.used,
          r.expires_at,
          r.created_at,
          b.name
        FROM delivery_otp_requests r
        LEFT JOIN delivery_boys b
        ON b.id=r.delivery_boy_id
        WHERE r.used=0
        AND r.expires_at > ?
        ORDER BY r.created_at DESC
      `)
      .bind(new Date().toISOString())
      .all();

    return json({
      ok:true,
      requests:rows.results
    });

}  /* ===================================================
     ADMIN - APPROVE DELIVERY OTP
  =================================================== */

  const otpApproveMatch =
    url.pathname.match(
      /^\/api\/admin\/delivery\/otp\/([^/]+)\/approve$/
    );

  if(
    otpApproveMatch &&
    request.method==="PUT"
  ){

    if(!await authorized(request,env,"admin")){

      return json(
        {error:"Unauthorized"},
        401
      );

    }

    await ensureDeliveryTables(env);

    const requestId =
      otpApproveMatch[1];

    const row =
      await env.DB.prepare(`
        SELECT
          id,
          mobile,
          otp,
          delivery_boy_id,
          approved,
          used,
          expires_at
        FROM delivery_otp_requests
        WHERE id=?
        LIMIT 1
      `)
      .bind(requestId)
      .first();

    if(!row){

      return json(
        {error:"OTP request not found."},
        404
      );

    }

    if(Number(row.used)){

      return json(
        {error:"This OTP request has already been used."},
        400
      );

    }

    if(new Date(row.expires_at).getTime() <= Date.now()){

      return json(
        {error:"This OTP request has expired."},
        400
      );

    }

    if(Number(row.approved)){

      return json({
        ok:true,
        message:"OTP already approved.",
        request_id:row.id
      });

    }

    await env.DB.prepare(`
      UPDATE delivery_otp_requests
      SET approved=1
      WHERE id=?
    `)
    .bind(requestId)
    .run();

    return json({
      ok:true,
      message:"Delivery Boy OTP approved successfully.",
      request_id:row.id,
      delivery_boy_id:row.delivery_boy_id,
      mobile:row.mobile
    });

  }


  /* OPTIONS */

  if(request.method==="OPTIONS"){

    return new Response(
      null,
      {
        status:204,
        headers:corsHeaders()
      }
    );

  }
  /* ===================================================
     DELIVERY OTP - VERIFY / LOGIN
  =================================================== */

  if(
    url.pathname==="/api/delivery/otp/verify" &&
    request.method==="POST"
  ){

    await ensureDeliveryTables(env);

    let body;

    try{
      body=await request.json();
    }catch{
      return json(
        {error:"Invalid JSON"},
        400
      );
    }

    const mobile=String(body.mobile||"").trim();
    const otp=String(body.otp||"").trim();

    if(!/^[0-9]{10}$/.test(mobile)){
      return json(
        {error:"Valid 10 digit mobile number required."},
        400
      );
    }

    if(!/^[0-9]{6}$/.test(otp)){
      return json(
        {error:"Enter valid 6 digit OTP."},
        400
      );
    }

    const row =
      await env.DB.prepare(`
        SELECT
          id,
          mobile,
          otp,
          delivery_boy_id,
          approved,
          used,
          expires_at
        FROM delivery_otp_requests
        WHERE mobile=?
        AND otp=?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .bind(mobile,otp)
      .first();

    if(!row){
      return json(
        {error:"Invalid OTP."},
        401
      );
    }

    if(Number(row.used)){
      return json(
        {error:"This OTP has already been used."},
        401
      );
    }

    if(new Date(row.expires_at).getTime() <= Date.now()){
      return json(
        {error:"OTP has expired. Please request a new OTP."},
        401
      );
    }

    if(!Number(row.approved)){
      return json(
        {
          error:
            "Admin approval pending. Please ask Admin to approve your login."
        },
        403
      );
    }

    const boy =
      await env.DB.prepare(`
        SELECT
          id,
          name,
          mobile,
          active
        FROM delivery_boys
        WHERE id=?
        LIMIT 1
      `)
      .bind(row.delivery_boy_id)
      .first();

    if(!boy){
      return json(
        {error:"Delivery Boy not found."},
        404
      );
    }

    if(!Number(boy.active)){
      return json(
        {error:"Your Delivery Boy account is disabled."},
        403
      );
    }

    const sessionToken =
      crypto.randomUUID().replaceAll("-","");

    const sessionExpires =
      new Date(
        Date.now()+12*60*60*1000
      ).toISOString();

    await env.DB.prepare(`
      INSERT INTO delivery_sessions
      (
        token,
        delivery_boy_id,
        expires_at,
        created_at
      )
      VALUES (?,?,?,?)
    `)
    .bind(
      sessionToken,
      boy.id,
      sessionExpires,
      new Date().toISOString()
    )
    .run();

    await env.DB.prepare(`
      UPDATE delivery_otp_requests
      SET used=1
      WHERE id=?
    `)
    .bind(row.id)
    .run();

    return json({
      ok:true,
      message:"Delivery Boy login successful.",
      session_token:sessionToken,
      expires_at:sessionExpires,
      delivery_boy:{
        id:boy.id,
        name:boy.name,
        mobile:boy.mobile
      }
    });

}

  /* HEALTH */

  if(url.pathname==="/api/health"){

    return json({
      ok:true,
      service:"Classic Cafe Orders"
    });

  }


  /* ===================================================
     ADMIN SETTINGS GET
  =================================================== */

  if(
    url.pathname==="/api/settings" &&
    request.method==="GET"
  ){

    if(!await authorized(request,env,"admin")){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    const rows =
      await env.DB.prepare(`
        SELECT key,value
        FROM settings
        ORDER BY key
      `)
      .all();


    const settings={};

    for(const r of rows.results){

      settings[r.key]=r.value;

    }


    if(settings.auto_assign_distance===undefined){

      settings.auto_assign_distance =
        String(DEFAULT_ASSIGN_DISTANCE);

    }


    return json({
      ok:true,
      settings
    });

  }


  /* ===================================================
     ADMIN SETTINGS PUT
  =================================================== */

  if(
    url.pathname==="/api/settings" &&
    request.method==="PUT"
  ){

    if(!await authorized(request,env,"admin")){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    let body;

    try{

      body=await request.json();

    }catch{

      return json(
        {error:"Invalid JSON"},
        400
      );

    }


    const allowed=[
      "shop_open",
      "website_orders",
      "delivery_enabled",
      "opening_time",
      "closing_time",
      "delivery_radius",
      "delivery_rate",
      "auto_assign_distance"
    ];


    const now =
      new Date().toISOString();


    for(const key of allowed){

      if(body[key]===undefined) continue;


      let value=body[key];


      if(key==="auto_assign_distance"){

        const n=Number(value);

        if(
          !Number.isFinite(n) ||
          n<=0 ||
          n>10
        ){

          return json(
            {
              error:
                "Auto assign distance must be between 0 and 10 KM."
            },
            400
          );

        }

        value=n;

      }


      await env.DB.prepare(`
        INSERT INTO settings
        (key,value,updated_at)
        VALUES (?,?,?)
        ON CONFLICT(key)
        DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
      `)
      .bind(
        key,
        String(value),
        now
      )
      .run();

    }


    return json({
      ok:true,
      auto_assign_distance:
        await getAssignDistance(env)
    });

  }


  /* ===================================================
     ADMIN DELIVERY BOYS LIST
  =================================================== */

  if(
    url.pathname==="/api/delivery/boys" &&
    request.method==="GET"
  ){

    if(!await authorized(request,env,"admin")){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    await ensureDeliveryTables(env);


    const rows =
      await env.DB.prepare(`
        SELECT
          id,
          name,
          mobile,
          active,
          created_at
        FROM delivery_boys
        ORDER BY id ASC
      `)
      .all();


    return json({
      ok:true,
      boys:rows.results
    });

  }


  /* ===================================================
     ADMIN CREATE DELIVERY BOY
  =================================================== */

  if(
    url.pathname==="/api/delivery/boys" &&
    request.method==="POST"
  ){

    if(!await authorized(request,env,"admin")){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    await ensureDeliveryTables(env);


    let body;

    try{

      body=await request.json();

    }catch{

      return json(
        {error:"Invalid JSON"},
        400
      );

    }


    const name=String(body.name||"").trim();
    const mobile=String(body.mobile||"").trim();
    const accessKey=
      String(body.access_key||"").trim();


    if(!name || !accessKey){

      return json(
        {
          error:
            "Name and Delivery Key are required."
        },
        400
      );

    }


    const existing =
      await env.DB.prepare(`
        SELECT id
        FROM delivery_boys
        WHERE access_key=?
      `)
      .bind(accessKey)
      .first();


    if(existing){

      return json(
        {
          error:
            "This Delivery Key is already in use."
        },
        409
      );

    }


    const rows =
      await env.DB.prepare(`
        SELECT id
        FROM delivery_boys
        ORDER BY id DESC
      `)
      .all();


    let number=1;


    if(rows.results.length){

      const last =
        rows.results[0].id;


      const n =
        Number(
          String(last).replace("DB","")
        );


      if(Number.isFinite(n)){

        number=n+1;

      }

    }


    const id =
      "DB"+String(number).padStart(3,"0");


    await env.DB.prepare(`
      INSERT INTO delivery_boys
      (id,name,mobile,access_key,active,created_at)
      VALUES (?,?,?,?,?,?)
    `)
    .bind(
      id,
      name,
      mobile,
      accessKey,
      1,
      new Date().toISOString()
    )
    .run();


    return json({
      ok:true,
      delivery_boy:{
        id,
        name,
        mobile,
        active:1
      }
    });

  }/* ===================================================
   ADMIN MANUAL ASSIGN / REASSIGN ORDER
=================================================== */

if(
  url.pathname==="/api/orders/assign" &&
  request.method==="PUT"
){

  if(!await authorized(request,env,"admin")){
    return json(
      {error:"Unauthorized"},
      401
    );
  }

  await ensureDeliveryTables(env);

  let body;

  try{
    body=await request.json();
  }catch{
    return json(
      {error:"Invalid JSON"},
      400
    );
  }

  const orderId=String(body.order_id||"").trim();
  const deliveryBoyId=String(body.delivery_boy_id||"").trim();

  if(!orderId || !deliveryBoyId){
    return json(
      {
        error:
          "Order ID and Delivery Boy ID are required."
      },
      400
    );
  }

  const order=
    await env.DB.prepare(`
      SELECT id,status
      FROM orders
      WHERE id=?
    `)
    .bind(orderId)
    .first();

  if(!order){
    return json(
      {error:"Order not found"},
      404
    );
  }

  const boy=
    await env.DB.prepare(`
      SELECT id,name,active
      FROM delivery_boys
      WHERE id=?
    `)
    .bind(deliveryBoyId)
    .first();

  if(!boy){
    return json(
      {error:"Delivery Boy not found"},
      404
    );
  }

  if(!boy.active){
    return json(
      {
        error:
          "This Delivery Boy is inactive."
      },
      400
    );
  }

  const now=
    new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO delivery_assignments
    (order_id,delivery_boy_id,assigned_at)
    VALUES (?,?,?)
    ON CONFLICT(order_id)
    DO UPDATE SET
      delivery_boy_id=excluded.delivery_boy_id,
      assigned_at=excluded.assigned_at
  `)
  .bind(
    orderId,
    deliveryBoyId,
    now
  )
  .run();

  return json({
    ok:true,
    message:"Order assigned successfully.",
    order_id:orderId,
    delivery_boy_id:deliveryBoyId,
    delivery_boy_name:boy.name,
    assigned_at:now
  });
}


  /* ===================================================
     ADMIN ENABLE / DISABLE DELIVERY BOY
  =================================================== */

  const boyMatch =
    url.pathname.match(
      /^\/api\/delivery\/boys\/([^/]+)$/
    );


  if(
    boyMatch &&
    request.method==="PUT"
  ){

    if(!await authorized(request,env,"admin")){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    await ensureDeliveryTables(env);


    const id=boyMatch[1];


    let body;

    try{

      body=await request.json();

    }catch{

      return json(
        {error:"Invalid JSON"},
        400
      );

    }


    if(body.active!==undefined){

      await env.DB.prepare(`
        UPDATE delivery_boys
        SET active=?
        WHERE id=?
      `)
      .bind(
        body.active ? 1 : 0,
        id
      )
      .run();

    }


    const row =
      await env.DB.prepare(`
        SELECT
          id,
          name,
          mobile,
          active
        FROM delivery_boys
        WHERE id=?
      `)
      .bind(id)
      .first();


    if(!row){

      return json(
        {error:"Delivery Boy not found"},
        404
      );

    }


    return json({
      ok:true,
      delivery_boy:row
    });

  }


  /* ===================================================
     DELIVERY BOY STATS
  =================================================== */

  if(
    url.pathname==="/api/delivery/stats" &&
    request.method==="GET"
  ){

    if(!await authorized(request,env,"delivery")){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    await ensureDeliveryTables(env);


    const boyId =
      await getDeliveryBoyId(
        request,
        env
      );


    if(!boyId){

      return json(
        {error:"Delivery Boy not found"},
        401
      );

    }


    const rows =
      await env.DB.prepare(`
        SELECT
          COUNT(*) AS completed_today,
          COALESCE(
            SUM(o.delivery_charge),
            0
          ) AS earnings_today
        FROM orders o
        JOIN delivery_assignments da
        ON da.order_id=o.id
        WHERE da.delivery_boy_id=?
        AND o.status='DELIVERED'
        AND date(
          o.created_at,
          'localtime'
        )=date(
          'now',
          'localtime'
        )
      `)
      .bind(boyId)
      .first();


    return json({
      ok:true,
      completed_today:
        Number(rows?.completed_today||0),
      earnings_today:
        Number(rows?.earnings_today||0)
    });

  }


  /* ===================================================
     CREATE ORDER
  =================================================== */

  if(
    url.pathname==="/api/orders" &&
    request.method==="POST"
  ){

    if(!deliveryOpen()){

      return json(
        {
          error:
            "Home delivery is open from 12:00 PM to 12:00 AM."
        },
        400
      );

    }


    let body;

    try{

      body=await request.json();

    }catch{

      return json(
        {error:"Invalid JSON"},
        400
      );

    }


    const {
      customer_name,
      mobile,
      address,
      lat,
      lng,
      items
    }=body;


    if(
      !customer_name ||
      !/^[0-9]{10}$/.test(
        String(mobile)
      ) ||
      !address ||
      typeof lat!=="number" ||
      typeof lng!=="number" ||
      !Array.isArray(items) ||
      !items.length
    ){

      return json(
        {
          error:
            "Missing or invalid order details"
        },
        400
      );

    }


    const d =
      dist(
        CAFE_LAT,
        CAFE_LNG,
        lat,
        lng
      );


    if(d>RADIUS){

      return json(
        {
          error:
            "Delivery is available only within 5 KM",
          distance_km:
            Number(d.toFixed(2))
        },
        400
      );

    }


    const delivery =
      Math.max(
        20,
        Math.ceil(d)*RATE
      );


    let food=0;


    for(const x of items){

      const p=Number(x.price);
      const q=Number(x.qty);


      if(
        !x.name ||
        !Number.isFinite(p) ||
        !Number.isInteger(q) ||
        q<1 ||
        q>50
      ){

        return json(
          {error:"Invalid item"},
          400
        );

      }


      food += p*q;

    }


    const id =
      "CC"+
      Date.now()
        .toString()
        .slice(-8);


    const tracking_token =
      token();


    const now =
      new Date().toISOString();


    await env.DB.prepare(`
      INSERT INTO orders
      (
        id,
        created_at,
        customer_name,
        mobile,
        address,
        lat,
        lng,
        distance_km,
        delivery_charge,
        food_total,
        grand_total,
        payment_method,
        payment_status,
        status,
        items_json
      )
      VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    .bind(
      id,
      now,
      customer_name,
      String(mobile),
      address,
      lat,
      lng,
      Number(d.toFixed(3)),
      delivery,
      food,
      food+delivery,
      "COD_OR_UPI_TO_DELIVERY_BOY",
      "UNPAID",
      "NEW",
      JSON.stringify(items)
    )
    .run();


    await env.DB.prepare(`
      INSERT INTO order_tracking
      (order_id,tracking_token)
      VALUES (?,?)
    `)
    .bind(
      id,
      tracking_token
    )
    .run();


    /*
      AUTO ASSIGN
    */

    const assignment =
      await autoAssignOrder(
        env,
        id,
        lat,
        lng
      );


    return json({
      ok:true,

      order_id:id,

      tracking_token,

      distance_km:
        Number(d.toFixed(2)),

      delivery_charge:
        delivery,

      food_total:
        food,

      grand_total:
        food+delivery,

      status:"NEW",

      assignment

    });

  }


  /* ===================================================
     GET ORDERS
  =================================================== */

  if(
    url.pathname==="/api/orders" &&
    request.method==="GET"
  ){

    const adminAllowed =
      await authorized(
        request,
        env,
        "admin"
      );


    const deliveryAllowed =
      await authorized(
        request,
        env,
        "delivery"
      );


    if(
      !adminAllowed &&
      !deliveryAllowed
    ){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    await ensureDeliveryTables(env);


    const limit =
      Math.min(
        Number(
          url.searchParams.get("limit")||100
        ),
        200
      );


    let rows;


    if(deliveryAllowed && !adminAllowed){

      const boyId =
        await getDeliveryBoyId(
          request,
          env
        );


      if(!boyId){

        return json(
          {error:"Delivery Boy not found"},
          401
        );

      }


      rows =
        await env.DB.prepare(`
          SELECT
            o.*,
            da.delivery_boy_id
          FROM orders o
          JOIN delivery_assignments da
          ON da.order_id=o.id
          WHERE da.delivery_boy_id=?
          AND o.status NOT IN
          ('DELIVERED','CANCELLED')
          ORDER BY o.created_at ASC
          LIMIT ?
        `)
        .bind(
          boyId,
          limit
        )
        .all();


    }else{

      rows =
        await env.DB.prepare(`
          SELECT
            o.*,
            da.delivery_boy_id
          FROM orders o
          LEFT JOIN delivery_assignments da
          ON da.order_id=o.id
          ORDER BY o.created_at DESC
          LIMIT ?
        `)
        .bind(limit)
        .all();

    }


    return json({
      ok:true,

      orders:
        rows.results.map(
          r=>({
            ...r,
            items:
              JSON.parse(
                r.items_json
              )
          })
        )

    });

  }


  /* ===================================================
     TRACK ORDER
  =================================================== */

  const tm =
    url.pathname.match(
      /^\/api\/track\/([^/]+)$/
    );


  if(
    tm &&
    request.method==="GET"
  ){

    const row =
      await env.DB.prepare(`
        SELECT
          o.id,
          o.created_at,
          o.customer_name,
          o.status,
          o.food_total,
          o.delivery_charge,
          o.grand_total,
          o.distance_km,
          t.lat,
          t.lng,
          t.updated_at
        FROM orders o
        JOIN order_tracking t
        ON t.order_id=o.id
        WHERE t.tracking_token=?
      `)
      .bind(tm[1])
      .first();


    if(!row){

      return json(
        {
          error:
            "Tracking link invalid or expired"
        },
        404
      );

    }


    return json({
      ok:true,

      order:{
        id:row.id,
        created_at:row.created_at,
        customer_name:row.customer_name,
        status:row.status,
        food_total:row.food_total,
        delivery_charge:row.delivery_charge,
        grand_total:row.grand_total,
        distance_km:row.distance_km,

        location:
          row.lat!=null
          ? {
              lat:row.lat,
              lng:row.lng,
              updated_at:row.updated_at
            }
          : null
      }

    });

  }


  /* ===================================================
     DELIVERY BOY LOCATION
  =================================================== */

  const lm =
    url.pathname.match(
      /^\/api\/orders\/([^/]+)\/location$/
    );


  if(
    lm &&
    request.method==="PUT"
  ){

    if(
      !await authorized(
        request,
        env,
        "delivery"
      )
    ){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    const boyId =
      await getDeliveryBoyId(
        request,
        env
      );


    if(!boyId){

      return json(
        {error:"Delivery Boy not found"},
        401
      );

    }


    let body;

    try{

      body=await request.json();

    }catch{

      return json(
        {error:"Invalid JSON"},
        400
      );

    }


    const lat=Number(body.lat);
    const lng=Number(body.lng);


    if(
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat<-90 ||
      lat>90 ||
      lng<-180 ||
      lng>180
    ){

      return json(
        {error:"Invalid location"},
        400
      );

    }


    /*
      Ensure this order belongs to
      this Delivery Boy.
    */

    const assignment =
      await env.DB.prepare(`
        SELECT order_id
        FROM delivery_assignments
        WHERE order_id=?
        AND delivery_boy_id=?
      `)
      .bind(
        lm[1],
        boyId
      )
      .first();


    if(!assignment){

      return json(
        {
          error:
            "This order is not assigned to you."
        },
        403
      );

    }


    const order =
      await env.DB.prepare(`
        SELECT id,status
        FROM orders
        WHERE id=?
      `)
      .bind(lm[1])
      .first();


    if(!order){

      return json(
        {error:"Order not found"},
        404
      );

    }


    const now =
      new Date().toISOString();


    await env.DB.prepare(`
      UPDATE order_tracking
      SET lat=?,
          lng=?,
          updated_at=?
      WHERE order_id=?
    `)
    .bind(
      lat,
      lng,
      now,
      lm[1]
    )
    .run();


    if(
      order.status!=="DELIVERED" &&
      order.status!=="CANCELLED"
    ){

      await env.DB.prepare(`
        UPDATE orders
        SET status='OUT_FOR_DELIVERY'
        WHERE id=?
        AND status IN
        ('NEW','ACCEPTED','PREPARING','OUT_FOR_DELIVERY')
      `)
      .bind(lm[1])
      .run();

    }


    return json({
      ok:true,
      updated_at:now
    });

  }
/* ===================================================
   ADMIN MANUAL DELIVERY BOY ASSIGNMENT
=================================================== */

const assignMatch =
  url.pathname.match(
    /^\/api\/orders\/([^/]+)\/assign$/
  );

if(
  assignMatch &&
  request.method==="PUT"
){

  if(!await authorized(request,env,"admin")){

    return json(
      {error:"Unauthorized"},
      401
    );

  }

  await ensureDeliveryTables(env);

  const orderId=assignMatch[1];

  let body;

  try{

    body=await request.json();

  }catch{

    return json(
      {error:"Invalid JSON"},
      400
    );

  }

  const deliveryBoyId=
    String(body.delivery_boy_id||"").trim();


  if(!deliveryBoyId){

    return json(
      {error:"Delivery Boy ID is required."},
      400
    );

  }


  /* CHECK ORDER */

  const order =
    await env.DB.prepare(`
      SELECT id,status
      FROM orders
      WHERE id=?
      LIMIT 1
    `)
    .bind(orderId)
    .first();


  if(!order){

    return json(
      {error:"Order not found."},
      404
    );

  }


  /* CHECK DELIVERY BOY */

  const boy =
    await env.DB.prepare(`
      SELECT
        id,
        name,
        mobile,
        active
      FROM delivery_boys
      WHERE id=?
      LIMIT 1
    `)
    .bind(deliveryBoyId)
    .first();


  if(!boy){

    return json(
      {error:"Delivery Boy not found."},
      404
    );

  }


  if(!Number(boy.active)){

    return json(
      {error:"This Delivery Boy is disabled."},
      400
    );

  }


  /* ASSIGN / REASSIGN */

  await env.DB.prepare(`
    INSERT INTO delivery_assignments
    (order_id,delivery_boy_id,assigned_at)
    VALUES (?,?,?)
    ON CONFLICT(order_id)
    DO UPDATE SET
      delivery_boy_id=excluded.delivery_boy_id,
      assigned_at=excluded.assigned_at
  `)
  .bind(
    orderId,
    deliveryBoyId,
    new Date().toISOString()
  )
  .run();


  return json({

    ok:true,

    message:"Delivery Boy assigned successfully.",

    order_id:orderId,

    delivery_boy:{
      id:boy.id,
      name:boy.name,
      mobile:boy.mobile
    }

  });

        }

  /* ===================================================
     UPDATE ORDER STATUS
  =================================================== */

  const m =
    url.pathname.match(
      /^\/api\/orders\/([^/]+)$/
    );


  if(
    m &&
    request.method==="PUT"
  ){

    const id=m[1];


    let body;

    try{

      body=await request.json();

    }catch{

      return json(
        {error:"Invalid JSON"},
        400
      );

    }


    const deliveryAllowed =
      await authorized(
        request,
        env,
        "delivery"
      );


    const adminAllowed =
      await authorized(
        request,
        env,
        "admin"
      );


    if(
      !deliveryAllowed &&
      !adminAllowed
    ){

      return json(
        {error:"Unauthorized"},
        401
      );

    }


    const allowedStatus=[
      "NEW",
      "ACCEPTED",
      "PREPARING",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED"
    ];


    if(
      body.status &&
      !allowedStatus.includes(
        body.status
      )
    ){

      return json(
        {error:"Invalid status"},
        400
      );

    }


    /*
      Delivery Boy can change only
      his own assigned order.
    */

    if(
      deliveryAllowed &&
      !adminAllowed
    ){

      const boyId =
        await getDeliveryBoyId(
          request,
          env
        );


      const assignment =
        await env.DB.prepare(`
          SELECT order_id
          FROM delivery_assignments
          WHERE order_id=?
          AND delivery_boy_id=?
        `)
        .bind(
          id,
          boyId
        )
        .first();


      if(!assignment){

        return json(
          {
            error:
              "This order is not assigned to you."
          },
          403
        );

      }

    }


    if(body.status){

      await env.DB.prepare(`
        UPDATE orders
        SET status=?
        WHERE id=?
      `)
      .bind(
        body.status,
        id
      )
      .run();

    }


    if(
      body.payment_status &&
      adminAllowed
    ){

      const ps=[
        "UNPAID",
        "PAID"
      ];


      if(
        !ps.includes(
          body.payment_status
        )
      ){

        return json(
          {
            error:
              "Invalid payment status"
          },
          400
        );

      }


      await env.DB.prepare(`
        UPDATE orders
        SET payment_status=?
        WHERE id=?
      `)
      .bind(
        body.payment_status,
        id
      )
      .run();

    }


    const row =
      await env.DB.prepare(`
        SELECT *
        FROM orders
        WHERE id=?
      `)
      .bind(id)
      .first();


    if(!row){

      return json(
        {error:"Order not found"},
        404
      );

    }


    const assignment =
      await env.DB.prepare(`
        SELECT delivery_boy_id
        FROM delivery_assignments
        WHERE order_id=?
      `)
      .bind(id)
      .first();


    return json({

      ok:true,

      order:{
        ...row,

        delivery_boy_id:
          assignment?.delivery_boy_id ||
          null,

        items:
          JSON.parse(
            row.items_json
          )
      }

    });

  }


  return json(
    {error:"Not found"},
    404
  );

}


/* =====================================================
   MAIN WORKER
===================================================== */

export default {

  async fetch(request,env){

    const url =
      new URL(request.url);


    if(
      url.pathname.startsWith("/api/")
    ){

      return withCors(
        await api(
          request,
          env,
          url
        )
      );

    }


    if(
      url.pathname==="/admin" ||
      url.pathname==="/admin/"
    ){

      return env.ASSETS.fetch(
        new Request(
          new URL(
            "/admin.html",
            request.url
          ),
          request
        )
      );

    }


    if(
      url.pathname==="/delivery" ||
      url.pathname==="/delivery/"
    ){

      return env.ASSETS.fetch(
        new Request(
          new URL(
            "/delivery.html",
            request.url
          ),
          request
        )
      );

    }


    if(
      url.pathname==="/track" ||
      url.pathname==="/track/"
    ){

      return env.ASSETS.fetch(
        new Request(
          new URL(
            "/track.html",
            request.url
          ),
          request
        )
      );

    }


    return env.ASSETS.fetch(
      request
    );

  }

};

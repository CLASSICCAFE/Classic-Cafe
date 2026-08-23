const CAFE_LAT = 26.252917;
const CAFE_LNG = 72.964081;

const RATE = 20;
const RADIUS = 5;

const DELIVERY_START_MIN = 12 * 60;
const DELIVERY_END_MIN = 24 * 60;


/* =========================
   DELIVERY TIME
========================= */

function deliveryOpen(){

  const now = new Date();

  const parts =
    new Intl.DateTimeFormat("en-GB",{
      timeZone:"Asia/Kolkata",
      hour:"2-digit",
      minute:"2-digit",
      hourCycle:"h23"
    }).formatToParts(now);

  const h = Number(
    parts.find(p=>p.type==="hour").value
  );

  const m = Number(
    parts.find(p=>p.type==="minute").value
  );

  const mins = h * 60 + m;

  return mins >= DELIVERY_START_MIN &&
         mins < DELIVERY_END_MIN;
}


/* =========================
   JSON
========================= */

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


/* =========================
   CORS
========================= */

function corsHeaders(){

  return {
    "access-control-allow-origin":"*",
    "access-control-allow-methods":
      "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers":
      "content-type,x-admin-key,x-delivery-key"
  };
}


function withCors(resp){

  const h = new Headers(resp.headers);

  Object.entries(corsHeaders())
    .forEach(([k,v])=>h.set(k,v));

  return new Response(
    resp.body,
    {
      status:resp.status,
      headers:h
    }
  );
}


/* =========================
   DISTANCE
========================= */

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


/* =========================
   ADMIN AUTH
========================= */

function authorizedAdmin(request,env){

  const key =
    request.headers.get("x-admin-key");

  return !!env.ADMIN_KEY &&
         key === env.ADMIN_KEY;
}


/* =========================
   DELIVERY BOY
========================= */

async function getDeliveryBoy(request,env){

  const key =
    request.headers.get("x-delivery-key");

  if(!key) return null;

  const row =
    await env.DB.prepare(`
      SELECT
        id,
        name,
        phone,
        delivery_key,
        active,
        created_at
      FROM delivery_boys
      WHERE delivery_key=?
      AND active=1
      LIMIT 1
    `)
    .bind(key)
    .first();

  return row || null;
}


async function authorizedDelivery(request,env){

  const boy =
    await getDeliveryBoy(request,env);

  return !!boy;
}


/* =========================
   TOKEN
========================= */

function token(){

  return crypto
    .randomUUID()
    .replaceAll("-","");
}


/* =========================
   API
========================= */

async function api(request,env,url){


  /* =========================
     ADMIN SETTINGS GET
  ========================= */

  if(
    url.pathname==="/api/settings" &&
    request.method==="GET"
  ){

    if(!authorizedAdmin(request,env)){

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

    return json({
      ok:true,
      settings
    });
  }


  /* =========================
     ADMIN SETTINGS PUT
  ========================= */

  if(
    url.pathname==="/api/settings" &&
    request.method==="PUT"
  ){

    if(!authorizedAdmin(request,env)){

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
      "delivery_rate"
    ];

    const now =
      new Date().toISOString();

    for(const key of allowed){

      if(body[key]===undefined)
        continue;

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
        String(body[key]),
        now
      )
      .run();

    }

    return json({
      ok:true
    });
  }


  /* =========================
     DELIVERY BOY LOGIN INFO
  ========================= */

  if(
    url.pathname==="/api/delivery/me" &&
    request.method==="GET"
  ){

    const boy =
      await getDeliveryBoy(request,env);

    if(!boy){

      return json(
        {error:"Invalid or inactive Delivery Key"},
        401
      );
    }

    return json({
      ok:true,
      delivery_boy:{
        id:boy.id,
        name:boy.name,
        phone:boy.phone
      }
    });
  }


  /* =========================
     ADMIN DELIVERY BOYS LIST
  ========================= */

  if(
    url.pathname==="/api/delivery/boys" &&
    request.method==="GET"
  ){

    if(!authorizedAdmin(request,env)){

      return json(
        {error:"Unauthorized"},
        401
      );
    }

    const rows =
      await env.DB.prepare(`
        SELECT
          id,
          name,
          phone,
          active,
          created_at
        FROM delivery_boys
        ORDER BY id
      `)
      .all();

    return json({
      ok:true,
      delivery_boys:rows.results
    });
  }


  /* =========================
     DELIVERY BOY STATS
  ========================= */

  if(
    url.pathname==="/api/delivery/stats" &&
    request.method==="GET"
  ){

    const boy =
      await getDeliveryBoy(request,env);

    if(!boy){

      return json(
        {error:"Unauthorized"},
        401
      );
    }

    const rows =
      await env.DB.prepare(`
        SELECT
          COUNT(*) AS completed_today,
          COALESCE(
            SUM(delivery_charge),0
          ) AS earnings_today
        FROM orders
        WHERE status='DELIVERED'
        AND delivery_boy_id=?
        AND date(
          created_at,
          'localtime'
        )=date(
          'now',
          'localtime'
        )
      `)
      .bind(boy.id)
      .first();

    return json({

      ok:true,

      delivery_boy_id:boy.id,

      delivery_boy_name:boy.name,

      completed_today:
        Number(
          rows?.completed_today || 0
        ),

      earnings_today:
        Number(
          rows?.earnings_today || 0
        )
    });
  }


  /* =========================
     OPTIONS
  ========================= */

  if(request.method==="OPTIONS"){

    return new Response(
      null,
      {
        status:204,
        headers:corsHeaders()
      }
    );
  }


  /* =========================
     HEALTH
  ========================= */

  if(
    url.pathname==="/api/health"
  ){

    return json({
      ok:true,
      service:"Classic Cafe Orders"
    });
  }


  /* =========================
     CREATE ORDER
  ========================= */

  if(
    url.pathname==="/api/orders" &&
    request.method==="POST"
  ){

    if(!deliveryOpen()){

      return json({
        error:
          "Home delivery is open from 12:00 PM to 12:00 AM."
      },400);

    }

    let body;

    try{

      body=await request.json();

    }catch{

      return json({
        error:"Invalid JSON"
      },400);

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

      return json({
        error:
          "Missing or invalid order details"
      },400);

    }


    const d =
      dist(
        CAFE_LAT,
        CAFE_LNG,
        lat,
        lng
      );


    if(d>RADIUS){

      return json({
        error:
          "Delivery is available only within 5 KM",
        distance_km:
          Number(d.toFixed(2))
      },400);

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

        return json({
          error:"Invalid item"
        },400);

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
        items_json,
        delivery_boy_id
      )
      VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
      JSON.stringify(items),
      null
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

      delivery_boy_id:null

    });
  }


  /* =========================
     GET ORDERS
  ========================= */

  if(
    url.pathname==="/api/orders" &&
    request.method==="GET"
  ){

    const adminAllowed =
      authorizedAdmin(request,env);

    const boy =
      await getDeliveryBoy(request,env);

    if(!adminAllowed && !boy){

      return json(
        {error:"Unauthorized"},
        401
      );
    }


    const limit =
      Math.min(
        Number(
          url.searchParams.get("limit") || 100
        ),
        200
      );


    let rows;


    /* DELIVERY BOY */

    if(!adminAllowed && boy){

      rows =
        await env.DB.prepare(`
          SELECT
            o.*,
            d.name AS delivery_boy_name
          FROM orders o

          LEFT JOIN delivery_boys d
          ON d.id=o.delivery_boy_id

          WHERE
          o.status NOT IN
          ('DELIVERED','CANCELLED')

          AND
          (
            o.delivery_boy_id=?
            OR o.delivery_boy_id IS NULL
          )

          ORDER BY
          o.created_at ASC

          LIMIT ?
        `)
        .bind(
          boy.id,
          limit
        )
        .all();

    }

    /* ADMIN */

    else{

      rows =
        await env.DB.prepare(`
          SELECT
            o.*,
            d.name AS delivery_boy_name
          FROM orders o

          LEFT JOIN delivery_boys d
          ON d.id=o.delivery_boy_id

          ORDER BY
          o.created_at DESC

          LIMIT ?
        `)
        .bind(limit)
        .all();

    }


    return json({

      ok:true,

      orders:
        rows.results.map(r=>({

          ...r,

          items:
            JSON.parse(
              r.items_json
            )

        }))

    });
  }


  /* =========================
     TRACK ORDER
  ========================= */

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
          d.name AS delivery_boy_name,
          t.lat,
          t.lng,
          t.updated_at

        FROM orders o

        JOIN order_tracking t
        ON t.order_id=o.id

        LEFT JOIN delivery_boys d
        ON d.id=o.delivery_boy_id

        WHERE
        t.tracking_token=?
      `)
      .bind(tm[1])
      .first();


    if(!row){

      return json({
        error:
          "Tracking link invalid or expired"
      },404);

    }


    return json({

      ok:true,

      order:{

        id:row.id,

        created_at:
          row.created_at,

        customer_name:
          row.customer_name,

        status:
          row.status,

        food_total:
          row.food_total,

        delivery_charge:
          row.delivery_charge,

        grand_total:
          row.grand_total,

        distance_km:
          row.distance_km,

        delivery_boy_name:
          row.delivery_boy_name,

        location:
          row.lat!=null
          ?
          {
            lat:row.lat,
            lng:row.lng,
            updated_at:
              row.updated_at
          }
          :
          null

      }

    });
  }


  /* =========================
     DELIVERY LOCATION
  ========================= */

  const lm =
    url.pathname.match(
      /^\/api\/orders\/([^/]+)\/location$/
    );


  if(
    lm &&
    request.method==="PUT"
  ){

    const boy =
      await getDeliveryBoy(request,env);

    if(!boy){

      return json({
        error:"Unauthorized"
      },401);

    }


    let body;

    try{

      body=await request.json();

    }catch{

      return json({
        error:"Invalid JSON"
      },400);

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

      return json({
        error:"Invalid location"
      },400);

    }


    const order =
      await env.DB.prepare(`
        SELECT
          id,
          status,
          delivery_boy_id
        FROM orders
        WHERE id=?
      `)
      .bind(lm[1])
      .first();


    if(!order){

      return json({
        error:"Order not found"
      },404);

    }


    if(
      order.delivery_boy_id !== boy.id
    ){

      return json({
        error:
          "This order is not assigned to you"
      },403);

    }


    const now =
      new Date().toISOString();


    await env.DB.prepare(`
      UPDATE order_tracking
      SET
        lat=?,
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
        WHERE
        id=?
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


  /* =========================
     ORDER STATUS / ASSIGNMENT
  ========================= */

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

      return json({
        error:"Invalid JSON"
      },400);

    }


    const adminAllowed =
      authorizedAdmin(request,env);

    const boy =
      await getDeliveryBoy(request,env);


    if(!adminAllowed && !boy){

      return json({
        error:"Unauthorized"
      },401);

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

      return json({
        error:"Invalid status"
      },400);

    }


    const order =
      await env.DB.prepare(`
        SELECT
          id,
          status,
          delivery_boy_id
        FROM orders
        WHERE id=?
      `)
      .bind(id)
      .first();


    if(!order){

      return json({
        error:"Order not found"
      },404);

    }


    /* =========================
       ADMIN ASSIGN DELIVERY BOY
    ========================= */

    if(
      adminAllowed &&
      body.delivery_boy_id !== undefined
    ){

      const assignedId =
        body.delivery_boy_id || null;


      if(assignedId){

        const deliveryBoy =
          await env.DB.prepare(`
            SELECT id
            FROM delivery_boys
            WHERE id=?
            AND active=1
          `)
          .bind(assignedId)
          .first();


        if(!deliveryBoy){

          return json({
            error:
              "Delivery Boy not found or inactive"
          },400);

        }

      }


      await env.DB.prepare(`
        UPDATE orders
        SET delivery_boy_id=?
        WHERE id=?
      `)
      .bind(
        assignedId,
        id
      )
      .run();

    }


    /* =========================
       DELIVERY BOY ACTION
    ========================= */

    if(!adminAllowed && boy){

      /*
        If order is unassigned,
        first delivery boy who accepts
        gets the order.
      */

      if(
        body.status==="ACCEPTED" &&
        !order.delivery_boy_id
      ){

        await env.DB.prepare(`
          UPDATE orders
          SET delivery_boy_id=?
          WHERE id=?
          AND delivery_boy_id IS NULL
        `)
        .bind(
          boy.id,
          id
        )
        .run();

      }


      const latest =
        await env.DB.prepare(`
          SELECT
            delivery_boy_id
          FROM orders
          WHERE id=?
        `)
        .bind(id)
        .first();


      if(
        latest.delivery_boy_id !== boy.id
      ){

        return json({
          error:
            "This order is assigned to another Delivery Boy"
        },403);

      }

    }


    /* =========================
       STATUS UPDATE
    ========================= */

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


    /* =========================
       PAYMENT UPDATE
    ========================= */

    if(
      body.payment_status &&
      adminAllowed
    ){

      const allowedPayment=[
        "UNPAID",
        "PAID"
      ];


      if(
        !allowedPayment.includes(
          body.payment_status
        )
      ){

        return json({
          error:
            "Invalid payment status"
        },400);

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


    /* =========================
       RETURN UPDATED ORDER
    ========================= */

    const row =
      await env.DB.prepare(`
        SELECT
          o.*,
          d.name AS delivery_boy_name,
          d.phone AS delivery_boy_phone
        FROM orders o

        LEFT JOIN delivery_boys d
        ON d.id=o.delivery_boy_id

        WHERE o.id=?
      `)
      .bind(id)
      .first();


    return json({

      ok:true,

      order:{

        ...row,

        items:
          JSON.parse(
            row.items_json
          )

      }

    });
  }


  return json({
    error:"Not found"
  },404);

}


/* =========================
   MAIN WORKER
========================= */

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


    return env.ASSETS.fetch(request);

  }

};

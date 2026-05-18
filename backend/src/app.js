require("dotenv").config();
const express=require("express"),http=require("http"),{Server}=require("socket.io"),helmet=require("helmet"),cors=require("cors"),rateLimit=require("express-rate-limit"),morgan=require("morgan"),jwt=require("jsonwebtoken");
const logger=require("./utils/logger"),{errorHandler}=require("./middleware/error"),{setIO:gpsSetIO}=require("./workers/gpsWorker"),{setIO:alertSetIO}=require("./workers/alertWorker"),{createQueues}=require("./config/queue"),{healthCheck:dbHealth}=require("./config/database"),{healthCheck:redisHealth}=require("./config/redis");
const requestId=require("./middleware/requestId");

if(!process.env.JWT_SECRET||!process.env.DATABASE_URL) throw new Error("Missing required env vars: JWT_SECRET or DATABASE_URL");

const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:true,credentials:true},transports:["websocket","polling"]});

io.use((socket,next)=>{
  const token=socket.handshake.auth&&socket.handshake.auth.token;
  if(!token)return next(new Error("Auth required"));
  try{socket.user=jwt.verify(token,process.env.JWT_SECRET);next();}
  catch{next(new Error("Invalid token"));}
});

io.on("connection",s=>{
  logger.info("Socket: "+s.id+" user="+s.user?.email);
  s.on("subscribe:region",r=>s.join("region:"+r));
  s.on("subscribe:convoy",id=>s.join("convoy:"+id));
  s.on("subscribe:device",id=>s.join("device:"+id));
  s.on("disconnect",()=>logger.info("Socket disconnected: "+s.id));
});

// Socket.IO Redis adapter — enables horizontal scaling across multiple backend pods (Task 5.5)
if(process.env.REDIS_URL){
  try{
    const{createAdapter}=require("@socket.io/redis-adapter");
    const Redis=require("ioredis");
    const pubClient=new Redis(process.env.REDIS_URL);
    const subClient=pubClient.duplicate();
    io.adapter(createAdapter(pubClient,subClient));
    logger.info("Socket.IO Redis adapter active");
  }catch(e){logger.warn("Socket.IO Redis adapter failed: "+e.message+" — running without it");}
}

app.set("io",io);gpsSetIO(io);alertSetIO(io);

app.use(requestId);
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:true,credentials:true}));
app.use(express.json({limit:"5mb"}));
app.use(express.urlencoded({extended:true}));
app.use(morgan(":method :url :status :res[content-length] - :response-time ms reqId=:req[x-request-id]",{stream:{write:m=>logger.info(m.trim())}}));
app.use(rateLimit({windowMs:900000,max:500,standardHeaders:true,legacyHeaders:false,validate:{xForwardedForHeader:false},message:{error:"Too many requests"}}));

app.get("/health",async(req,res)=>{
  try{
    const[db,redis]=await Promise.all([dbHealth(),redisHealth()]);
    const mem=process.memoryUsage();
    const status=db?"ok":"degraded";
    res.status(db?200:503).json({
      status,
      database:db?"ok":"error",
      redis,
      uptime_seconds:Math.floor(process.uptime()),
      version:"2.1.0-enterprise",
      memory:{heap_used_mb:Math.round(mem.heapUsed/1024/1024),heap_total_mb:Math.round(mem.heapTotal/1024/1024),rss_mb:Math.round(mem.rss/1024/1024)},
      node_version:process.version,
      pid:process.pid,
      timestamp:new Date().toISOString()
    });
  }catch(e){res.status(503).json({status:"error",error:e.message});}
});

// Prometheus-compatible text metrics (Task 5.2)
const {query:dbQuery}=require("./config/database");
app.get("/metrics",async(req,res)=>{
  try{
    const mem=process.memoryUsage();
    const uptime=Math.floor(process.uptime());
    // Guardian-specific metrics
    let guardianLines=[];
    try{
      const[devices,panics]=await Promise.all([
        dbQuery("SELECT COUNT(*) AS n FROM guardian_devices WHERE deleted_at IS NULL AND status='active'"),
        dbQuery("SELECT COUNT(*) AS n FROM panic_events WHERE resolved_at IS NULL")
      ]);
      guardianLines=[
        "# HELP guardian_devices_active Active guardian devices",
        "# TYPE guardian_devices_active gauge",
        "guardian_devices_active "+devices.rows[0].n,
        "# HELP guardian_panics_active Unresolved panic events",
        "# TYPE guardian_panics_active gauge",
        "guardian_panics_active "+panics.rows[0].n,
      ];
    }catch(_){}
    const lines=[
      "# HELP process_uptime_seconds Process uptime in seconds",
      "# TYPE process_uptime_seconds counter",
      "process_uptime_seconds "+uptime,
      "# HELP process_heap_used_bytes V8 heap used",
      "# TYPE process_heap_used_bytes gauge",
      "process_heap_used_bytes "+mem.heapUsed,
      "# HELP process_rss_bytes Resident set size",
      "# TYPE process_rss_bytes gauge",
      "process_rss_bytes "+mem.rss,
      ...guardianLines,
    ];
    res.set("Content-Type","text/plain; version=0.0.4; charset=utf-8");
    res.send(lines.join("\n")+"\n");
  }catch(e){res.status(500).send("# error: "+e.message);}
});

// Core routes
["auth","vehicles","convoys","alerts","messages","analytics","geofences","devices","incidents","rules","gps","sensors","ai","apikeys","reports","documents","webhooks","guardian"]
  .forEach(r=>app.use("/api/v1/"+r,require("./routes/"+r)));

// Guardian CFO device routes (Phase C)
try{app.use("/api/v1/guardian/cfo",require("./routes/guardianCfo"));logger.info("Route loaded: /api/v1/guardian/cfo");}
catch(e){logger.warn("Guardian CFO route failed: "+e.message);}

// GDPR / Data Retention (Task 5.3)
try{app.use("/api/v1/gdpr",require("./routes/gdpr"));logger.info("Route loaded: /api/v1/gdpr");}
catch(e){logger.warn("GDPR route failed: "+e.message);}

// Enterprise routes
["drivers","shipments","finance","maintenance","riskzones"]
  .forEach(r=>{
    try{app.use("/api/v1/"+r,require("./routes/"+r));logger.info("Route loaded: /api/v1/"+r);}
    catch(e){logger.warn("Route not found: "+r+" — "+e.message);}
  });

app.use("/api/v1/sync",(req,res)=>res.json({ok:true,processed:0}));
app.use((req,res)=>res.status(404).json({error:req.method+" "+req.path+" not found"}));
app.use(errorHandler);

// Partition roller — runs daily at 02:00 UTC to create next month's partitions
// and drop partitions older than the GDPR retention window.
try {
  const cron = require('node-cron');
  const { run: rollPartitions } = require('../scripts/partition-roller');
  cron.schedule('0 2 * * *', () => {
    rollPartitions().catch(err => logger.error('Partition roller error: ' + err.message));
  });
  // Also run at startup so a fresh deploy doesn't wait until 02:00.
  rollPartitions().catch(err => logger.warn('Partition roller startup run: ' + err.message));
  logger.info('Partition roller scheduled (daily 02:00 UTC)');
} catch (e) {
  logger.warn('Partition roller not started: ' + e.message + ' — install node-cron');
}

// Base64 photo backfill — runs daily at 03:00 UTC, migrates recent data-URI photos to R2.
try {
  const cron = require('node-cron');
  const { run: backfillPhotos } = require('../scripts/backfill-base64-photos');
  cron.schedule('0 3 * * *', () => {
    backfillPhotos().catch(err => logger.error('Photo backfill error: ' + err.message));
  });
  logger.info('Photo backfill scheduled (daily 03:00 UTC)');
} catch (e) {
  logger.warn('Photo backfill not scheduled: ' + e.message);
}

// D3: EOD finalization sweep — every 15 min, enqueues generateReport for completed
// or past-deadline daily reports on active convoys.
try {
  const cron = require('node-cron');
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { isCfoModuleEnabled } = require('./utils/cfoFlag');
      if (!await isCfoModuleEnabled()) return;

      const { query: dbQuery } = require('./config/database');
      const { getQueues } = require('./config/queue');
      const { convoyReportQueue } = getQueues();
      if (!convoyReportQueue) return;

      // Find active convoys and their incomplete reports for dates that have passed
      const result = await dbQuery(
        `SELECT cdr.convoy_id, cdr.report_date::text, c.timezone
         FROM convoy_daily_reports cdr
         JOIN convoys c ON c.id = cdr.convoy_id
         WHERE c.status = 'active'
           AND c.deleted_at IS NULL
           AND cdr.status IN ('complete', 'partial')
           AND cdr.pdf_url IS NULL
           AND (
             cdr.report_date < CURRENT_DATE
             OR (
               cdr.report_date = CURRENT_DATE
               AND NOW() AT TIME ZONE COALESCE(c.timezone,'UTC') > (cdr.report_date + INTERVAL '1 day')::timestamptz AT TIME ZONE COALESCE(c.timezone,'UTC')
             )
           )`,
        []
      );

      for (const row of result.rows) {
        await convoyReportQueue.add('generateReport', {
          convoy_id: row.convoy_id,
          report_date: row.report_date,
        }, { jobId: `genReport:${row.convoy_id}:${row.report_date}`, removeOnComplete: { count: 200 } });
      }

      if (result.rows.length) {
        logger.info(`EOD sweep: queued ${result.rows.length} generateReport jobs`);
      }
    } catch (err) {
      logger.error('EOD finalization sweep error: ' + err.message);
    }
  });
  logger.info('CFO EOD finalization sweep scheduled (*/15 * * * *)');
} catch (e) {
  logger.warn('CFO EOD sweep not scheduled: ' + e.message);
}

const PORT=parseInt(process.env.PORT)||5000;
createQueues();
server.listen(PORT,()=>logger.info("FleetOps Enterprise v2.1 running on port "+PORT+" ["+( process.env.NODE_ENV||"development")+"]"));

// Start BullMQ workers in-process when Redis is available (avoids needing a separate worker dyno)
if(process.env.REDIS_URL && process.env.DISABLE_REDIS !== 'true'){
  try{
    const{startGPSWorker}=require('./workers/gpsWorker');
    const{startAlertWorker}=require('./workers/alertWorker');
    const{startNotificationWorker}=require('./workers/notificationWorker');
    const{startConvoyReportWorker}=require('./workers/convoyReportWorker');
    const workers=[startGPSWorker(),startAlertWorker(),startNotificationWorker(),...startConvoyReportWorker()];
    logger.info(`Workers started in-process: ${workers.length} active`);
    process.on("SIGTERM",async()=>{await Promise.all(workers.map(w=>w.close()));server.close(()=>process.exit(0));});
    process.on("SIGINT",async()=>{await Promise.all(workers.map(w=>w.close()));server.close(()=>process.exit(0));});
  }catch(e){
    logger.warn('Worker startup failed: '+e.message+' — continuing without workers');
    process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
    process.on("SIGINT",()=>server.close(()=>process.exit(0)));
  }
}else{
  process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
  process.on("SIGINT",()=>server.close(()=>process.exit(0)));
}
module.exports={app,server,io};

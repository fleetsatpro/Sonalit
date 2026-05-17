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
    const{createClient}=require("ioredis");
    const pubClient=createClient(process.env.REDIS_URL);
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

const PORT=parseInt(process.env.PORT)||5000;
createQueues();
server.listen(PORT,()=>logger.info("FleetOps Enterprise v2.1 running on port "+PORT+" ["+( process.env.NODE_ENV||"development")+"]"));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
process.on("SIGINT",()=>server.close(()=>process.exit(0)));
module.exports={app,server,io};

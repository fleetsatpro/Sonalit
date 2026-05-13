require("dotenv").config();
const express=require("express"),http=require("http"),{Server}=require("socket.io"),helmet=require("helmet"),cors=require("cors"),rateLimit=require("express-rate-limit"),morgan=require("morgan"),jwt=require("jsonwebtoken");
const logger=require("./utils/logger"),{errorHandler}=require("./middleware/error"),{setIO:gpsSetIO}=require("./workers/gpsWorker"),{setIO:alertSetIO}=require("./workers/alertWorker"),{createQueues}=require("./config/queue"),{healthCheck:dbHealth}=require("./config/database"),{healthCheck:redisHealth}=require("./config/redis");

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
  s.on("disconnect",()=>logger.info("Socket disconnected: "+s.id));
});

app.set("io",io);gpsSetIO(io);alertSetIO(io);

app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:true,credentials:true}));
app.use(express.json({limit:"5mb"}));
app.use(express.urlencoded({extended:true}));
app.use(morgan("tiny",{stream:{write:m=>logger.info(m.trim())}}));
app.use(rateLimit({windowMs:900000,max:500,standardHeaders:true,legacyHeaders:false,validate:{xForwardedForHeader:false},message:{error:"Too many requests"}}));

app.get("/health",async(req,res)=>{
  try{const[db,redis]=await Promise.all([dbHealth(),redisHealth()]);
    res.json({status:"ok",database:db?"ok":"error",redis,uptime:Math.floor(process.uptime()),version:"2.1.0-enterprise"});}
  catch(e){res.status(503).json({error:e.message});}
});
app.get("/metrics",(req,res)=>{
  res.set("Content-Type","text/plain");
  res.send("process_uptime_seconds "+Math.floor(process.uptime())+"\nprocess_heap_used_bytes "+process.memoryUsage().heapUsed);
});

// Core routes
["auth","vehicles","convoys","alerts","messages","analytics","geofences","devices","incidents","rules","gps","sensors","ai","apikeys","reports","documents","webhooks"]
  .forEach(r=>app.use("/api/v1/"+r,require("./routes/"+r)));

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

import { createServer } from "./http/server.js";
import { config } from "./config.js";
import { startMessageHandler } from "./zalo/handler.js";
import { zaloClient } from "./zalo/client.js";

startMessageHandler();
const app=createServer();
const servers=config.listenerHosts.map((host)=>{
  const server=app.listen(config.PORT,host,()=>{
    if(host===config.TAILSCALE_LISTEN_IP)
      console.log(`Tailscale panel: http://${host}:${config.PORT}`);
    else console.log(`\nMbaLong Console: ${config.PUBLIC_ORIGIN}`);
  });
  server.on("error",(error)=>
    console.error("Không thể mở web trên %s:%d",host,config.PORT,error),
  );
  return server;
});
void zaloClient.connect();
const shutdown=()=>{
  zaloClient.disconnect();
  let remaining=servers.length;
  for(const server of servers)server.close(()=>{if(--remaining===0)process.exit(0);});
};
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);

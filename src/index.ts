import { createServer } from "./http/server.js";
import { config } from "./config.js";
import { startMessageHandler } from "./zalo/handler.js";
import { zaloClient } from "./zalo/client.js";

startMessageHandler();
const server=createServer().listen(config.PORT,config.HOST,()=>console.log(`\nMbaLong Console: ${config.PUBLIC_ORIGIN}`));
void zaloClient.connect();
const shutdown=()=>{zaloClient.disconnect();server.close(()=>process.exit(0));};process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);

import { createServer } from "./http/server.js";
import { config } from "./config.js";
import { startMessageHandler } from "./zalo/handler.js";
import { zaloClient } from "./zalo/client.js";

startMessageHandler();
const server=createServer().listen(config.PORT,()=>console.log(`\nMbaLong Console: http://localhost:${config.PORT}`));
void zaloClient.connect();
const shutdown=()=>{zaloClient.disconnect();server.close(()=>process.exit(0));};process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);

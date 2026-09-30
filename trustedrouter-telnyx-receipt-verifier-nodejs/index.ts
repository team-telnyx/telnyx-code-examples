import { startServer } from "./src/server.js";
import { loadConfig } from "./src/config.js";

startServer(loadConfig());

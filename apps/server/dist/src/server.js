"use strict";
// server.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const routers_1 = __importDefault(require("./routers"));
const config_1 = require("./config");
(async () => {
    // Rate limiting configuration
    console.log('Rate: ');
    const app = await (0, app_1.setupApp)(routers_1.default);
    const PORT = config_1.env.PORT;
    // const logger = mainLogger.child({ service: "Server" });
    const server = app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
        console.log(`Rate limiting enabled: 200 requests per second per IP`);
    });
    // getNativePrice();
    let isShuttingDown = false;
    const unexpectedErrorHandler = async (error) => {
        console.log("Unexpected error:", error);
        await exitHandler();
    };
    const exitHandler = async () => {
        if (isShuttingDown)
            return;
        isShuttingDown = true;
        console.log("Shutting down the server...");
        try {
            if (server) {
                await new Promise((resolve, reject) => {
                    server.close((err) => {
                        if (err)
                            return reject(err);
                        resolve();
                    });
                });
                console.log("Server closed.");
            }
            process.exit(0);
        }
        catch (error) {
            console.log("Error during shutdown:", error);
            process.exit(1);
        }
    };
    // Handle process signals
    process.on("SIGINT", exitHandler); // Ctrl+C
    process.on("SIGTERM", exitHandler); // Termination signal (e.g., from Docker)
    process.on("uncaughtException", async (error) => {
        console.error("💥 [FATAL UNCAUGHT EXCEPTION]", error);
        await exitHandler();
    });
    process.on("unhandledRejection", (reason) => {
        console.error("⚠️ [UNHANDLED REJECTION] (Server continuing):", reason);
    });
})();

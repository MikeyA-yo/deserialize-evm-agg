// server.ts

import { setupApp } from "./app";
import routers from "./routers";
import { env } from "./config";



(async () => {




    // Rate limiting configuration
    console.log('Rate: ');

    const app = await setupApp(routers);



    const PORT = env.PORT;

    // const logger = mainLogger.child({ service: "Server" });

    const server = app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
        console.log(`Rate limiting enabled: 200 requests per second per IP`);
    });

    // getNativePrice();

    let isShuttingDown = false;

    const unexpectedErrorHandler = async (error: unknown) => {
        console.log("Unexpected error:", error);
        await exitHandler();
    };

    const exitHandler = async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log("Shutting down the server...");

        try {
            if (server) {
                await new Promise<void>((resolve, reject) => {
                    server.close((err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
                console.log("Server closed.");
            }

            process.exit(0);
        } catch (error) {
            console.log("Error during shutdown:", error);
            process.exit(1);
        }
    };

    // Handle process signals
    process.on("SIGINT", exitHandler); // Ctrl+C
    process.on("SIGTERM", exitHandler); // Termination signal (e.g., from Docker)

    process.on("uncaughtException", async (error: unknown) => {
        console.error("💥 [FATAL UNCAUGHT EXCEPTION]", error);
        await exitHandler();
    });

    process.on("unhandledRejection", (reason: unknown) => {
        console.error("⚠️ [UNHANDLED REJECTION] (Server continuing):", reason);
    });

})()




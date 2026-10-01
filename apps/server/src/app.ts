// app.ts
import express, { Express, Router } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";
import { pageNotFoundExceptionHandler } from "./errors/notFoundExceptionHandler";
import { errorConverter, errorHandler } from "./middleware/errorMiddleware";
import { initAndGetCache } from ".";
import { swaggerOptions } from "./swagger/swagger.config";



export async function setupApp(routes: Router[]): Promise<Express> {
  (BigInt.prototype as any).toJSON = function () {
    const int = Number.parseInt(this.toString());
    return int ?? this.toString();
  };

  const app = express();


  const client = await initAndGetCache()


  // Apply rate limiting to all requests
  // app.use(limiter);// done on the reverse proxy level

  // Middleware setup
  app.use(cors());
  app.use(express.json());

  // Comprehensive HTTP Request & Response Logging Middleware
  app.use((req, res, next) => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(2, 8);
    const method = req.method;
    const url = req.originalUrl || req.url;

    console.log(`\n======================================================`);
    console.log(`📥 [HTTP IN #${requestId}] ${method} ${url}`);
    if (req.headers["origin"]) {
      console.log(`   ├── Origin: ${req.headers["origin"]}`);
    }
    if (Object.keys(req.params || {}).length > 0) {
      console.log(`   ├── Params:`, req.params);
    }
    if (Object.keys(req.query || {}).length > 0) {
      console.log(`   ├── Query:`, req.query);
    }
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`   └── Body:`, JSON.stringify(req.body, null, 2));
    }

    res.on("finish", () => {
      const duration = Date.now() - startTime;
      const status = res.statusCode;
      const icon = status < 400 ? "✅" : "❌";
      console.log(`${icon} [HTTP OUT #${requestId}] ${method} ${url} -> Status ${status} (${duration}ms)`);
      console.log(`======================================================\n`);
    });

    next();
  });

  // Swagger documentation setup
  const swaggerSpec = swaggerJsdoc(swaggerOptions);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'EVM Aggregator API Documentation',
  }));

  // Expose Swagger JSON
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Health check
  app.get("/health", async (_req, res) => {
    try {
      const cacheHealth = await client.healthCheck();
      const redisHealthy = cacheHealth.redis;
      const isHealthy = cacheHealth.memory && (redisHealthy === undefined || redisHealthy);

      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? "ok" : "degraded",
        cache: cacheHealth,
      });
    } catch (error) {
      res.status(503).json({ status: "error" });
    }
  });

  // Route setup
  app.use(...routes);



  // 404 error route
  // app.use("*", pageNotFoundExceptionHandler);
  // console.log('routes: ', routes);

  //Error handlers
  app.use(errorConverter);
  app.use(errorHandler);

  return app;
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupApp = setupApp;
// app.ts
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const errorMiddleware_1 = require("./middleware/errorMiddleware");
const _1 = require(".");
const swagger_config_1 = require("./swagger/swagger.config");
async function setupApp(routes) {
    BigInt.prototype.toJSON = function () {
        const int = Number.parseInt(this.toString());
        return int ?? this.toString();
    };
    const app = (0, express_1.default)();
    const client = await (0, _1.initAndGetCache)();
    // Apply rate limiting to all requests
    // app.use(limiter);// done on the reverse proxy level
    // Middleware setup
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
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
    const swaggerSpec = (0, swagger_jsdoc_1.default)(swagger_config_1.swaggerOptions);
    app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swaggerSpec, {
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
        }
        catch (error) {
            res.status(503).json({ status: "error" });
        }
    });
    // Route setup
    app.use(...routes);
    // 404 error route
    // app.use("*", pageNotFoundExceptionHandler);
    // console.log('routes: ', routes);
    //Error handlers
    app.use(errorMiddleware_1.errorConverter);
    app.use(errorMiddleware_1.errorHandler);
    return app;
}

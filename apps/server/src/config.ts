import { z } from "zod";

import path from "path";


// add dotenv
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

console.log("process.env.NODE_ENV: ", process.env.NODE_ENV);

// Define schema using zod for validation
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  // DATABASE_URL: z.string(),
  // POSTGRES_USER: z.string(),
  // POSTGRES_PASSWORD: z.string(),
  // POSTGRES_DB: z.string(),
  // LOG_LEVEL: z.enum(["info", "warn", "error", "debug"]).default("info"),
  // BETTER_STACK_KEY: z.string(),
  PORT: z.string().transform((arg) => {
    return Number(arg);
  }),
  // DEV_KEY_FOR_LOOKUP_TABLE: z.string(),
  // SERVER_BASE_URL: z.string(),

  REDIS_PASSWORD: z.string().optional().default(""),
  REDIS_USER: z.string().optional().default(""),
  REDIS_PORT: z.string().default("6379"),
});

// Parse and validate the environment variables
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.format());
  process.exit(1); // Exit the application if environment validation fails
}
const host = process.env.HOST || "127.0.0.1";

const hostToUse = host


const env = parsedEnv.data;
const authPart = env.REDIS_PASSWORD
  ? (env.REDIS_USER && env.REDIS_USER !== "default" ? `${env.REDIS_USER}:${env.REDIS_PASSWORD}@` : `:${env.REDIS_PASSWORD}@`)
  : "";
const redisUrl = process.env.REDIS_URL || `redis://${authPart}${hostToUse}:${env.REDIS_PORT}`;
const config = {

  REDIS_URL: redisUrl,


};

export { env, config };

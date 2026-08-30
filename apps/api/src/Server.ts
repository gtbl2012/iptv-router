import "@tsed/ajv"
import "@tsed/platform-express"
import "@tsed/swagger"

import { Configuration } from "@tsed/di"

import { ApiControllers, PublicControllers } from "./controllers/index.js"
import { runtimeConfig } from "./config.js"
import { docsAuthMiddleware } from "./middleware/DocsAuthMiddleware.js"

@Configuration({
  acceptMimes: [
    "application/json",
    "application/x-mpegURL",
    "application/vnd.apple.mpegurl",
    "application/xml",
    "video/mp2t",
  ],
  httpPort: runtimeConfig.port,
  httpsPort: false,
  disableComponentsScan: true,
  mount: {
    "/api": ApiControllers,
    "/": PublicControllers,
  },
  middlewares: [
    {
      use: "cors",
      options: {
        origin: runtimeConfig.corsOrigins,
        credentials: true,
        allowedHeaders: ["authorization", "content-type"],
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      },
    },
    "compression",
    {
      use: "json-parser",
      options: { limit: runtimeConfig.inlineBodyMaxBytes },
    },
    {
      use: "urlencoded-parser",
      options: { extended: true, limit: runtimeConfig.inlineBodyMaxBytes },
    },
    docsAuthMiddleware,
  ],
  swagger: [
    {
      path: "/docs",
      specVersion: "3.0.1",
      showExplorer: true,
    },
  ],
  logger: {
    level: runtimeConfig.nodeEnv === "production" ? "info" : "debug",
  },
})
export class Server {}

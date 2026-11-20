import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleParse } from "./server/ai";

/** Serves /api/parse locally (dev + preview) with the same code the Vercel function uses. */
function apiDev(env: Record<string, string>): Plugin {
  const mw: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url !== "/api/parse") return next();
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 20_000) req.destroy();
    });
    req.on("end", async () => {
      let body: unknown = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* handled as empty body */
      }
      const out = req.method === "POST"
        ? await handleParse(body, req.socket.remoteAddress ?? "local", { apiKey: env.VIKEY_API_KEY, model: env.VIKEY_MODEL })
        : { status: 405, json: { error: "POST only" } };
      res.statusCode = out.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(out.json));
    });
  };
  return {
    name: "waxpay-api-dev",
    configureServer: (s) => void s.middlewares.use(mw),
    configurePreviewServer: (s) => void s.middlewares.use(mw),
  };
}

export default defineConfig(({ mode }) => {
  // Third arg "" loads non-VITE_ vars too; they stay server-side (never bundled into the client).
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react(), apiDev(env)] };
});

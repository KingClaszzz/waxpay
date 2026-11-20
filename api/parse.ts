import { handleParse } from "../server/ai";

type Req = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = { status(code: number): Res; json(body: unknown): void; setHeader(k: string, v: string): void };

// Vercel serverless function: POST /api/parse { text, contacts: string[] }
export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() || "unknown";
  const out = await handleParse(req.body, ip, {
    apiKey: process.env.VIKEY_API_KEY,
    model: process.env.VIKEY_MODEL,
  });
  return res.status(out.status).json(out.json);
}

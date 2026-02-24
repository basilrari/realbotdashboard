import type { LiveState } from "./types";

const BOT_URL = process.env.NEXT_PUBLIC_BOT_URL ?? "http://localhost:8080/state";

export async function fetchState(): Promise<LiveState> {
  const res = await fetch(BOT_URL, {
    next: { revalidate: 0 },
    headers: { "Cache-Control": "no-store" },
  });
  if (!res.ok) throw new Error(`Bot state failed: ${res.status}`);
  return res.json() as Promise<LiveState>;
}

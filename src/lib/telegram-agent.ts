import { anthropic, MODEL_ID, SYSTEM_PROMPT } from "@/lib/anthropic";
import { buildAgentTools } from "@/lib/telegram-tools";

/**
 * Petr 2026-06-22: Claude tool-runner loop pro Telegram bot.
 *
 * Beta tool runner drží loop za nás: pošle zprávu → Claude vrátí tool_use →
 * SDK zavolá handler → výsledek → Claude vrátí text → return. Bez manual
 * agentic loop kódu.
 *
 * Tool handlers dostávají `context` (druhý arg run funkce). Předáváme
 * `{ userId }` — jediný user v systému. Kdyby MVP naroste na multi-user,
 * routing přes chat_id → userId zůstává.
 */
export async function runAgent({
  userMessage,
  userId,
}: {
  userMessage: string;
  userId: string;
}): Promise<string> {
  const runner = anthropic.beta.messages.toolRunner({
    model: MODEL_ID,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    // buildAgentTools(userId) zabuduje userId do closure každého tool.run —
    // TS SDK betaZodTool nepředává custom context, tak přes closure.
    tools: buildAgentTools(userId),
    messages: [{ role: "user", content: userMessage }],
  });

  // toolRunner v TS SDK je awaitable — resolves finalMessage after tool loop končí
  const finalMessage = await runner;

  // Extrahuj text bloky (Claude může vrátit thinking + text; nás zajímá text)
  const textParts: string[] = [];
  for (const block of finalMessage.content) {
    if (block.type === "text") textParts.push(block.text);
  }
  const reply = textParts.join("\n").trim();
  return reply || "(prázdná odpověď)";
}

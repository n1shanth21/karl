// The Gemini tool loop. Owner: Nishanth. CONTRACT: inbound.ts calls runAgentTurn for every
// text message that isn't a command, a relay, or a photo.

import type { Content, Part } from "@google/genai";
import { LIMITS } from "../config";
import { db } from "../db";
import { myStuff } from "../flows/buy";
import type { User } from "../types";
import { gemini } from "./gemini";
import { buildSystemPrompt } from "./systemPrompt";
import { tools } from "./tools";

const MAX_TOOL_ROUNDS = 4;
const FALLBACK = "my brain glitched for a sec, try that again?";

/** Relayed messages from the other person are stored as "**Name · item**\n..." outbound rows. Label them so
 *  Gemini doesn't treat them as Karl's own words or as instructions. */
const historyText = (m: { direction: string; text: string }) =>
  m.direction === "out" && m.text.startsWith("**") ? `[relayed from the other person, not Karl's words] ${m.text}` : m.text;

/**
 * Let Gemini decide what the user wants, run the tools it picks (src/agent/tools.ts → src/flows),
 * and return Karl's reply text. Returns null when the tools already messaged the user
 * (e.g. search results were sent as photos) and nothing else needs saying.
 */
export async function runAgentTurn(user: User, text: string): Promise<string | null> {
  try {
    const history = await db.recentMessages(user.id, LIMITS.historyMessages);
    const contents: Content[] = history.map((m) => ({ role: m.direction === "in" ? "user" : "model", parts: [{ text: historyText(m) }] }));
    // Inbound normally saved the user's texts already (a batch is saved as several rows), so only add `text` if it isn't there.
    if (history.at(-1)?.direction !== "in") contents.push({ role: "user", parts: [{ text }] });
    const system = buildSystemPrompt({ user, stuff: await myStuff(user) });

    let usedTools = false;
    const toolsCalled: string[] = [];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const reply = await gemini.chat({ system, contents, tools: round < MAX_TOOL_ROUNDS ? tools : [] }); // last round: no tools, force words
      const calls = (reply.parts ?? []).filter((p) => p.functionCall);
      if (calls.length === 0) {
        const answer = (reply.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
        if (answer) return answer;
        if (usedTools) return null;
        console.error(`[agent] FALLBACK (empty answer, no tools) reply parts: ${partTypes(reply.parts)}`);
        return FALLBACK;
      }
      usedTools = true;
      toolsCalled.push(...calls.map((c) => c.functionCall!.name ?? "?"));
      contents.push(reply); // as returned: Gemini 3 needs its thought signatures echoed back
      const responses: Part[] = [];
      for (const call of calls) responses.push(await runTool(user, call));
      contents.push({ role: "user", parts: responses });
    }
    console.error(`[agent] FALLBACK (max tool rounds) tools called: ${toolsCalled.join(", ")}`);
    return FALLBACK; // still asking for tools after the last round
  } catch (err) {
    console.error(`[agent] FALLBACK (error): ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    return FALLBACK;
  }
}

/** What kinds of parts a Gemini reply had (no user text), e.g. "thought, text" or "none". */
function partTypes(parts: Part[] | undefined): string {
  if (!parts?.length) return "none";
  return parts.map((p) => (p.functionCall ? "functionCall" : p.thought ? "thought" : p.text !== undefined ? "text" : "other")).join(", ");
}

async function runTool(user: User, part: Part): Promise<Part> {
  const { name = "", args = {}, id } = part.functionCall!;
  console.log(`[tool] ${name} ${JSON.stringify(args)}`);
  const tool = tools.find((t) => t.name === name);
  let response: Record<string, unknown>;
  try {
    const fresh = (await db.getUser(user.id)) ?? user; // earlier tools may have changed state
    response = tool ? ((await tool.run(fresh, args)) as Record<string, unknown>) : { error: `unknown tool ${name}` };
  } catch (err) {
    console.error(`[tool] ${name} failed:`, err);
    response = { error: err instanceof Error ? err.message : String(err) };
  }
  return { functionResponse: { id, name, response } };
}

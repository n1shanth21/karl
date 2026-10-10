// Tools Gemini can call. Each one validates its args and calls a plain function in src/flows.
// Gemini speaks dollars; flows speak integer cents. Owner: Nishanth.

import { MEETUP_SPOTS } from "../config";
import { db } from "../db";
import { cancelWant, myStuff, pickResult, saveWant, searchAndShow } from "../flows/buy";
import { cancelMatch, confirmHappened, respondToMatch, setMeetup } from "../flows/match";
import { cancelDraft, confirmDraft, removeListing, updateDraft } from "../flows/sell";
import type { User } from "../types";
import { CONDITIONS, type ToolSpec } from "./gemini";

type Args = Record<string, unknown>;
type Tool = ToolSpec & { run: (user: User, args: Args) => Promise<unknown> };

const NAME_PATTERN = /^[a-z][a-z'-]{0,19}$/i;
const bad = (error: string) => ({ error });
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const cents = (dollars: unknown) => (typeof dollars === "number" && dollars >= 0 ? Math.round(dollars * 100) : null);
const toDollars = (priceCents: number) => priceCents / 100;

const string = (description: string) => ({ type: "string", description });
const price = (description: string) => ({ type: "number", description });
const params = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

const matchId = string("id of the match (see my_stuff)");

export const tools: Tool[] = [
  {
    name: "set_name",
    description: "Save the user's first name once they tell you.",
    parameters: params({ first_name: string("first name only") }, ["first_name"]),
    async run(user, args) {
      const word = str(args.first_name)?.split(/\s+/)[0];
      if (!word) return bad("first_name is required");
      if (!NAME_PATTERN.test(word)) return bad("that doesn't look like a first name (letters only, no digits or handles)");
      const name = word[0]!.toUpperCase() + word.slice(1);
      await db.updateUser(user.id, { firstName: name });
      return { ok: true, first_name: name };
    },
  },
  {
    name: "update_draft",
    description: "Edit the user's current listing draft (price, condition or title). Only pass what changes.",
    parameters: params({
      price_dollars: price("new asking price in dollars"),
      condition: { type: "string", enum: CONDITIONS },
      title: string("new title"),
    }),
    async run(user, args) {
      const priceCents = args.price_dollars === undefined ? undefined : cents(args.price_dollars);
      const condition = CONDITIONS.find((c) => c === args.condition);
      if (priceCents === null) return bad("price_dollars must be a non-negative number");
      if (args.condition !== undefined && !condition) return bad(`condition must be one of ${CONDITIONS.join(", ")}`);
      const patch = { priceCents, condition, title: str(args.title) };
      if (Object.values(patch).every((v) => v === undefined)) return bad("nothing to change");
      const listing = await updateDraft(user, patch);
      if (!listing) return bad("no draft in progress");
      return { ok: true, title: listing.title, condition: listing.condition, price_dollars: toDollars(listing.priceCents) };
    },
  },
  {
    name: "confirm_listing",
    description: "Publish the user's current draft. Use when they say yes / post it / looks good.",
    parameters: params({}),
    async run(user) {
      const res = await confirmDraft(user);
      return res.ok ? { ok: true, title: res.listing.title, price_dollars: toDollars(res.listing.priceCents) } : { ok: false, reason: res.reason };
    },
  },
  {
    name: "cancel_draft",
    description: "Throw away the current draft listing.",
    parameters: params({}),
    async run(user) {
      return { cancelled: await cancelDraft(user) };
    },
  },
  {
    name: "search",
    description: "Look for items for sale. Matching listings are sent to the user as photos automatically. If nothing matches, a want is saved so we text them when one appears.",
    parameters: params({ query: string("what they want, e.g. 'mini fridge'"), max_price_dollars: price("budget in dollars, if they gave one") }, ["query"]),
    async run(user, args) {
      const query = str(args.query);
      const max = args.max_price_dollars === undefined ? null : cents(args.max_price_dollars);
      if (!query) return bad("query is required");
      const shown = await searchAndShow(user, query, max);
      if (shown.length) return { found: shown.length, shown: shown.map((l) => ({ title: l.title, price_dollars: toDollars(l.priceCents) })) };
      await saveWant(user, query, max);
      return { found: 0, saved_want: true };
    },
  },
  {
    name: "pick_result",
    description: "The user chose one of the search results shown to them.",
    parameters: params({ index: { type: "integer", description: "1-based position in the results shown" } }, ["index"]),
    async run(user, args) {
      if (!Number.isInteger(args.index) || (args.index as number) < 1) return bad("index must be a positive integer");
      return { reply: await pickResult(user, { index: args.index as number }) };
    },
  },
  {
    name: "save_want",
    description: "Save a want without searching, so we text them when a matching item is listed.",
    parameters: params({ query: string("what they want"), max_price_dollars: price("budget in dollars") }, ["query"]),
    async run(user, args) {
      const query = str(args.query);
      const max = args.max_price_dollars === undefined ? null : cents(args.max_price_dollars);
      if (!query) return bad("query is required");
      const want = await saveWant(user, query, max);
      return { saved: true, want_id: want.id };
    },
  },
  {
    name: "respond_to_match",
    description: "A seller answers 'ok to hold it for this buyer?'.",
    parameters: params({ match_id: matchId, accept: { type: "boolean" } }, ["match_id", "accept"]),
    async run(user, args) {
      const id = str(args.match_id);
      if (!id || typeof args.accept !== "boolean") return bad("match_id and accept are required");
      return { reply: await respondToMatch(user, id, args.accept) };
    },
  },
  {
    name: "set_meetup",
    description: "Set the meetup spot and time for an accepted match.",
    parameters: params(
      { match_id: matchId, spot: { type: "string", enum: MEETUP_SPOTS }, time_iso: string("ISO 8601 time with timezone offset, daytime") },
      ["match_id", "spot", "time_iso"],
    ),
    async run(user, args) {
      const id = str(args.match_id);
      const spot = MEETUP_SPOTS.find((s) => s.toLowerCase() === str(args.spot)?.toLowerCase());
      const at = new Date(str(args.time_iso) ?? "");
      if (!id) return bad("match_id is required");
      if (!spot) return bad(`spot must be one of: ${MEETUP_SPOTS.join("; ")}`);
      if (Number.isNaN(at.getTime())) return bad("time_iso must be an ISO 8601 time");
      return { reply: await setMeetup(user, id, spot, at) };
    },
  },
  {
    name: "confirm_happened",
    description: "The user says whether the meetup/sale happened.",
    parameters: params({ match_id: matchId, happened: { type: "boolean" } }, ["match_id", "happened"]),
    async run(user, args) {
      const id = str(args.match_id);
      if (!id || typeof args.happened !== "boolean") return bad("match_id and happened are required");
      return { reply: await confirmHappened(user, id, args.happened) };
    },
  },
  {
    name: "cancel_match",
    description: "Buyer or seller backs out of a match.",
    parameters: params({ match_id: matchId }, ["match_id"]),
    async run(user, args) {
      const id = str(args.match_id);
      return id ? { reply: await cancelMatch(user, id) } : bad("match_id is required");
    },
  },
  {
    name: "remove_listing",
    description: "Take down one of the user's own active listings.",
    parameters: params({ listing_id: string("id of the listing (see my_stuff)") }, ["listing_id"]),
    async run(user, args) {
      const id = str(args.listing_id);
      return id ? { removed: await removeListing(user, id) } : bad("listing_id is required");
    },
  },
  {
    name: "cancel_want",
    description: "Stop looking for something the user previously wanted.",
    parameters: params({ want_id: string("id of the want (see my_stuff)") }, ["want_id"]),
    async run(user, args) {
      const id = str(args.want_id);
      return id ? { cancelled: await cancelWant(user, id) } : bad("want_id is required");
    },
  },
  {
    name: "my_stuff",
    description: "The user's active listings, open wants and matches, with ids.",
    parameters: params({}),
    async run(user) {
      return { summary: await myStuff(user) };
    },
  },
];

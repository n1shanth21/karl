// Tests for scanRelayMessage: scams get blocked/warned, normal messages always pass.
import { describe, expect, test } from "bun:test";
import { scanRelayMessage } from "../../src/safety";

const BLOCKED = [
  "text me at 919-555-1234",
  "my number is (919) 555 1234",
  "call +1 919.555.1234",
  "9195551234",
  "just text 555-1234",
  "email me at maya.k@gmail.com",
  "hmu @maya.sells",
  "my insta is mayak",
  "add me on snap",
  "follow me on ig",
  "check https://bit.ly/abc123",
  "pics at www.myfridge.com",
  "more photos on fridgedeals.net",
  "can you pay with an apple gift card",
  "i only take gift cards",
  "wire transfer works best for me",
  "i can do western union",
  "pay in bitcoin?",
  "send it as crypto",
];

const WARNED = [
  "can you venmo me first",
  "pay upfront and i'll bring it",
  "zelle me now and it's yours",
  "need a $20 deposit to hold it",
  "send half now and half when we meet",
  "this deal is only today",
  "last chance, someone else wants it",
  "text me on whatsapp instead",
  "let's move to telegram",
  "dm me",
];

const NORMAL = [
  "omw",
  "running 5 late",
  "can we do the Pit instead",
  "is it still available",
  "$40 ok?",
  "would you take 35?",
  "here in 5 min",
  "i'm by the front door of Davis",
  "wearing a blue hoodie",
  "does it come with the charger wire?",
  "can we meet at 3:30 tomorrow",
  "i'll bring cash",
  "can i venmo you when we meet?",
  "meet @ the pit at 4",
  "send me a pic first?",
  "sounds good see you at the pit",
  "lol perfect",
  "thanks!!",
  "i can do $45 if we meet tomorrow",
  "pickup at 2pm works?",
  "is it 120 or 110?",
  "it's in room 2041 of Craige",
];

describe("scanRelayMessage", () => {
  for (const text of BLOCKED) {
    test(`blocks: ${text}`, async () => {
      const verdict = await scanRelayMessage(text);
      expect(verdict.action).toBe("block");
      expect(verdict.reason?.length).toBeGreaterThan(0);
    });
  }

  for (const text of WARNED) {
    test(`warns: ${text}`, async () => {
      const verdict = await scanRelayMessage(text);
      expect(verdict.action).toBe("warn");
      expect(verdict.reason?.length).toBeGreaterThan(0);
    });
  }

  for (const text of NORMAL) {
    test(`allows: ${text}`, async () => {
      const verdict = await scanRelayMessage(text);
      expect(verdict.action).toBe("allow");
    });
  }
});

# Karl: pitch deck (6 slides, ~4 min with the live demo; cut Slide 4 notes if the slot is shorter)

<!-- Fact sources: UNC student-ticket resale ban: https://goheels.com/sports/2022/8/18/2022-football-student-ticket-policy (2023 football policy; re-check current season) -->

Fill `{{...}}` from the dashboard right before presenting. Dark background, Carolina blue accents, big type, one idea per slide.

---

## Slide 1: The problem

**On-slide text**
- "Where do I even post this?"
- GroupMe. Instagram. Facebook. Repeat.
- Strangers. Scrolling. Buried posts.

**Speaker notes (~25 s)**
Selling a mini fridge at UNC usually means posting it in a few different group chats, getting buried, then meeting someone you know nothing about. Buying means scrolling all of them. There's no one place that remembers what you're looking for.

**Visual:** a screenshot collage of messy group chats (blur all names and numbers).

---

## Slide 2: Karl in one line

**On-slide text**
- **Karl is the campus marketplace that lives in iMessage.**
- One number. No app. No browsing.
- Karl texts *you* when the thing you want shows up.

**Speaker notes (~20 s)**
Karl is a phone number UNC students text. Text a photo to sell. Text what you're looking for to buy. If nothing matches yet, Karl remembers, and texts you the moment someone lists it. Facebook Marketplace makes you search. Karl comes to you.

**Visual:** a single iMessage thread mockup: "need a desk lamp under $20" -> "nothing yet, i'll text you."

---

## Slide 3: Live demo

**On-slide text**
- LIVE
- (QR code: text Karl)

**Speaker notes (~2 min; cue points follow PLAN.md demo script)**
1. Hook: "Students already buy and sell across a dozen group chats. Karl is one number that remembers what you want."
2. Want: judge texts "need a desk lamp under $20." Karl says nothing yet, it'll text.
3. Sell: teammate sends a lamp photo, Karl drafts "desk lamp, good condition, $15. post it?", teammate hearts it.
4. Proactive match: the judge's phone buzzes with the lamp.
5. Relay: seller accepts, judge texts "omw", it shows up on the seller's phone as **Judge · desk lamp** with no number.
6. Safety: seller types "venmo me first pls", Karl warns the buyer.
7. Proof: point at the dashboard counters.
8. Close: "Next: UNC email verification and move-out week."
Fallback: if live fails, play the backup video (see video-script.md).

**Visual:** full-screen dashboard on the projector with the QR code visible; two phones on a table.

---

## Slide 4: Why iMessage

**On-slide text**
- No app to download
- Karl texts *you*
- Numbers stay private

**Speaker notes (~25 s)**
Students already live in iMessage, so there is nothing to install and nothing to learn. Because Karl is a conversation, it can text you when your want shows up, which a feed can't do. And when a buyer and seller need to talk, Karl passes messages between their two separate chats with a bold label like "Maya · mini fridge". Neither person ever sees the other's number. Karl only messages people who texted it first, and `stop` always works.

**Visual:** three-icon row (phone, bell, shield) or a diagram: Buyer <-> Karl <-> Seller, with "no numbers shared" on the arrows.

---

## Slide 5: How it's built

**On-slide text**
- **Photon Spectrum**: iMessage in and out
- **Gemini**: vision, tool calling, embeddings
- **Tiger Data** (Timescale): Postgres + pgvector + hypertables
- **Bun + Hono** on Railway, **Next.js** on Vercel

**Speaker notes (~25 s)**
Photon Spectrum gives us real iMessage. Gemini reads the photo and drafts the listing, decides what the user wants and calls our tools, and creates 768-dimension embeddings so "need a cheap fridge" can match "mini fridge, $40". Tiger Data, Postgres with pgvector and TimescaleDB, holds listings, wants and matches and powers the live stats. Gemini never writes SQL and never sends messages itself; relay routing is plain code, and every relayed message is safety-scanned first. Server on Railway, dashboard on Vercel.

**Visual:** the architecture diagram from README (iPhone -> Photon -> Karl server -> Tiger Data, plus dashboard), with four sponsor logos.

---

## Slide 6: Traction and what's next

**On-slide text**
- {{listedTotal}} listed · {{soldTotal}} sold · {{usersTotal}} people texting Karl, in one weekend
- Next: UNC email verification
- Move-out week launch
- Ratings
- Tickets, only if UNC policy allows (student-ticket resale is banned today)
- More campuses

**Speaker notes (~25 s)**
Since going live at HackNC, {{usersTotal}} people have texted Karl, {{listedTotal}} items have been listed and {{soldTotal}} have sold. Next we add UNC email verification so everyone is a verified student, then launch for move-out week, when the most stuff changes hands. Ratings come after that, then other campuses. Tickets stay off the table unless UNC policy changes. Text Karl and try it.

**Visual:** big live counters (screenshot of the dashboard) on top, a simple left-to-right roadmap strip underneath; QR code in the corner.

---

## Appendix: placeholders to fill

| Placeholder | Source |
|---|---|
| `{{listedTotal}}` | dashboard "listed" counter |
| `{{soldTotal}}` | dashboard "sold" counter |
| `{{usersTotal}}` | dashboard "students using Karl" counter |
| Karl's number / QR | Aarush's production Photon line [VERIFY once live] |

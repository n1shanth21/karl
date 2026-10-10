# Karl: Devpost draft

<!-- Sources: UNC student-ticket policy https://goheels.com/sports/2022/8/18/2022-football-student-ticket-policy ; Gemini 768-dim embeddings https://ai.google.dev/gemini-api/docs/embeddings ; Tiger Data rename https://www.tigerdata.com/blog/timescale-is-now-tigerdata -->

**Tagline:** The campus marketplace that lives in iMessage. Text a number, no app.

**Tracks to submit to:** General · Photon (Best iMessage Agent) · Gemini · Tiger Data · .Tech domain [VERIFY: HackNC 2026 track and sponsor-prize names and rules could not be confirmed from public sources; check the Devpost/HackNC page. VERIFY the .Tech domain is registered and attached]

**Team:** Nishanth, Himagna, Aarush, Aayush

---

## Inspiration

Buying and selling used stuff at UNC mostly happens in scattered GroupMe, Instagram and Facebook posts. They get buried, and you end up meeting strangers you know nothing about. We wanted something as easy as texting a friend who happens to know everyone on campus. And we kept coming back to one thing marketplaces can't do: tell *you* when the thing you want finally shows up.

## What it does

Karl is a contact UNC students text. Sign up once at the QR link, get your Karl line, and you are in. There is no app.

- **Sell:** text a photo. Karl drafts a title, condition and price ("mini fridge, good condition, $45. post it?"). Reply "yes" or tapback a heart and it's live.
- **Buy:** text "need a mini fridge under $60". Karl replies with up to 3 matches (photo, title, price) and you pick one.
- **Wants:** if nothing matches, Karl saves your want and texts you when a matching item is listed, even days later.
- **Match and hold:** the seller is asked "ok to hold it?" and an accepted item is held for 2 hours.
- **Masked relay:** buyer and seller never see each other's number. Karl forwards messages between their separate DMs with a bold label like **Maya · mini fridge**.
- **Meetup and close:** Karl proposes a public campus spot and a daytime slot, then asks both people "did it happen?" and marks the item sold.
- **Safety:** relayed messages are scanned for pay-first asks, gift cards, links, phone numbers and off-platform pressure. Prohibited items are refused. `stop` and `help` always work.
- **Dashboard:** a public page with live counters, recent listings (first names only) and a QR code to text Karl.

Karl never handles money. People pay each other directly, and Karl only reminds them to pay after they have the item.

## How we built it

- **Photon Spectrum** (`spectrum-ts`) for iMessage in and out, with a terminal provider for local testing.
- **Gemini** for vision (reading item photos), function calling (deciding what the user wants and calling our flow functions) and embeddings (768 dimensions via `outputDimensionality`) for matching listings and wants.
- **Tiger Data** (formerly Timescale; Postgres + pgvector + TimescaleDB) for users, listings, wants and matches, with plain SQL. A hypertable backs the listings-over-time stats [VERIFY matches what shipped].
- **Bun + TypeScript + Hono** server on **Railway**: `/health`, `/api/stats`, `/photos/:id`.
- **Next.js** dashboard on **Vercel**, polling `/api/stats`.
- Design rule: Gemini decides intent and calls tools; tools are plain functions that validate input. Gemini never writes SQL or sends messages, and relay routing is plain code, not the model.
- Four people, four branches (agent, data, backend, web) built against shared contracts, with an in-memory DB mode so nobody was blocked.

## Challenges we ran into

- **No group chats on Photon Pro.** Pro uses shared lines, so we can't create a group chat between buyer and seller. We built a masked DM relay instead, which turned into a feature: numbers stay private.
- **Users must text first.** Karl can't cold-text anyone, and only users registered with the Photon line can be messaged. We designed around it: Karl only talks to people who started the conversation, and we pre-added judges' numbers [VERIFY].
- **HEIC photos.** iPhone photos arrive as `image/heic`, so we convert them to JPEG before sending them to Gemini.
- **Safety scanning of relayed messages.** Since Karl sits in the middle of every buyer/seller chat, every relayed message goes through a scanner for scams and off-platform pressure before it's delivered.
- **Duplicate replies.** Only one running process can own a Photon project, so we kept local dev on terminal mode or separate projects.

## Accomplishments that we're proud of

- A want that turns into a proactive text days later: the part that feels like magic in the demo.
- A relay where both people chat and neither sees a phone number.
- A full sell-to-sold loop entirely in iMessage, including a tapback to confirm a listing.
- {{listedTotal}} listings, {{soldTotal}} sold and {{usersTotal}} people texting Karl during HackNC [VERIFY at submit time]

## What we learned

- A conversation can do things a feed can't, like reach out at the right moment.
- Keeping the model on a short leash (intent and tools only, no SQL, no direct sends, no routing) made the system far easier to trust and debug.
- Constraints like "no group chats" can push you to a better design.
- Persona matters: short, warm, lowercase texts feel like a helpful upperclassman, not a bot.

## What's next

- UNC email verification so every user is a verified student.
- Launch for move-out week, when the most stuff changes hands.
- Ratings.
- Tickets, only if UNC's policy allows. Student tickets can't be resold under current policy.
- More campuses.

## Built with

`typescript` `bun` `hono` `photon-spectrum` `imessage` `gemini` `google-genai` `postgresql` `pgvector` `timescaledb` `tiger-data` `nextjs` `react` `railway` `vercel`

## Links

- GitHub: https://github.com/n1shanth21/karl [VERIFY repo is public and URL is final]
- Demo video: {{videoUrl}}
- Live dashboard: {{dashboardUrl}}
- Try Karl: https://karl-production.up.railway.app/signup (QR on the dashboard)
- .Tech domain: {{techDomain}} [VERIFY]

## Submission checklist

- [ ] 2-minute video uploaded and linked
- [ ] Public GitHub link
- [ ] Tracks selected: General, Photon, Gemini, Tiger Data, .Tech
- [ ] Submitted by Sunday 9:30 AM ET (hard deadline 10:00)

# Karl persona review notes

> **Privacy:** never paste phone numbers or last names. Redact to first name or `[num]`.

## Purpose

Karl is the iMessage campus marketplace bot (HackNC). He should read like a friendly UNC upperclassman texting a classmate, not a customer-service script. Aayush and Nishanth use this file to review real transcripts and flag anything robotic, long, cringe, or pushy, then agree on fixes.

## Persona checklist (from CLAUDE.md)

- [ ] 1–3 sentences per message
- [ ] At most one emoji per message
- [ ] Lowercase is fine. Light humor is good.
- [ ] No corporate phrases ("I'd be happy to assist", "please be advised", "kindly")
- [ ] Never pushy. No repeated nudges, no hard sells.
- [ ] Honest about being a bot if someone sincerely asks. Never claim to be human.
- [ ] Reminds buyers to pay only after they have the item. Karl never handles money.

## Review table

| # | Flow (onboard/sell/buy/want/match/relay/meetup/safety/stop) | Karl said (paste, phone numbers removed) | Problem (robotic/long/cringe/unclear/wrong) | Suggested rewrite |
|---|---|---|---|---|
| 1 | onboard | my brain glitched for a sec, try that again? | error fallback on a one-word name reply (bug, not tone) | (fix in code; tone itself is fine) |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |

## Flows to test

- [ ] onboarding with one-word name
- [ ] sell a photo
- [ ] confirm with ❤️
- [ ] buy with a match
- [ ] buy with no match → want saved → later ping
- [ ] seller hold accept
- [ ] relay message with bold label
- [ ] safety warning ("venmo me first")
- [ ] meetup proposal
- [ ] "did it happen?" close
- [ ] stop / start
- [ ] help
- [ ] "are you a bot?"

## Top fixes for Nishanth

1.
2.
3.
4.
5.

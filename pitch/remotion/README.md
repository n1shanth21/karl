# Karl pitch: iMessage clips (Remotion)

Realistic dark-mode iMessage threads that play as video on the 3D phone screens in `pitch/deck`.

```bash
npm install
npm run dev              # Remotion Studio, preview every clip
npm run render           # render all clips to ../deck/public/videos/*.mp4
npm run render MatchPing # render one clip
```

| Clip | What it shows |
|---|---|
| `WantSaved` | "need a desk lamp under $20" → nothing yet, Karl saves the want |
| `SellDraft` | photo of a mini fridge → Karl drafts the listing → ❤️ → live |
| `MatchPing` | a day later, Karl texts first: "someone just listed a desk lamp, $15" |
| `MaskedRelay` | the seller's phone: **Maya · mini fridge** / omw, 5 min |
| `SafetyWarning` | the buyer's phone: "venmo me first pls" followed by Karl's heads up |
| `DemoBackup` | the whole buyer journey, a backup if the live demo stalls |

To edit a clip, change its script in `src/threads.ts` (`at` is the frame the message appears, at 30 fps). Karl's lines are copied from the real code. Use first names only, and never show phone numbers.

Renders use the Mac's SF Pro font, so render on a Mac.

Photo: `mini-fridge.jpg` by BrittanyJ, Wikimedia Commons, CC BY-SA 3.0 (see `seed/photos/CREDITS.md`).

// The deck window and the presenter window talk over a BroadcastChannel
// (same browser, same origin, works offline).

export type SceneInfo = { id: string; title: string; notes: string; move: string };

export type DeckMsg =
  | { type: "state"; index: number; count: number; playing: boolean; scenes: SceneInfo[]; demoBackup: boolean }
  | { type: "hello" } // presenter just opened: please send state
  | { type: "key"; key: string }; // presenter forwards a key press to the deck

export const channel = () => new BroadcastChannel("karl-deck");

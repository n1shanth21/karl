import { Scene } from "../scene";
import { open } from "./s01-open";
import { problem } from "./s02-problem";
import { oneLine } from "./s03-oneline";
import { magic } from "./s04-magic";
import { demo } from "./s05-demo";
import { privacy } from "./s06-privacy";
import { safety } from "./s07-safety";

// The pitch, in order. Number keys jump here (1 = first).
export const SCENES: Scene[] = [open, problem, oneLine, magic, demo, privacy, safety];

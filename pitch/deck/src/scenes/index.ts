import { Scene } from "../scene";
import { open } from "./s01-open";
import { problem } from "./s02-problem";
import { oneLine } from "./s03-oneline";
import { magic } from "./s04-magic";
import { demo } from "./s05-demo";
import { privacy } from "./s06-privacy";
import { safety } from "./s07-safety";
import { built } from "./s08-built";
import { meaning } from "./s09-meaning";
import { traction } from "./s10-traction";
import { next } from "./s11-next";
import { close } from "./s12-close";

// The pitch, in order. Number keys jump here (1-9, 0 = 10, G+two digits for 11-12).
export const SCENES: Scene[] = [open, problem, oneLine, magic, demo, privacy, safety, built, meaning, traction, next, close];

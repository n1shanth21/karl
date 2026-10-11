import "./styles.css";
import { createWorld } from "./world";
import { Director } from "./director";
import { bindControls } from "./controls";
import { createProps } from "./props";
import { SCENES } from "./scenes";

// Canvas labels need the bundled font loaded before they are drawn.
await Promise.all([500, 600, 700].map((wt) => document.fonts.load(`${wt} 40px "Inter Variable"`)));

const world = createWorld();
createProps(world);
const director = new Director(world, SCENES);
bindControls(director, world);

// Handy in the browser console while building scenes: deck.jump(3), deck.next() ...
(window as unknown as { deck: Director }).deck = director;

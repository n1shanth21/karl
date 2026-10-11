import "./styles.css";
import { createWorld } from "./world";
import { Director } from "./director";
import { bindControls } from "./controls";
import { TEST_SCENES } from "./scenes/test";

const world = createWorld();
const director = new Director(world, TEST_SCENES);
bindControls(director, world);

// Handy in the browser console while building scenes: deck.jump(3), deck.next() ...
(window as unknown as { deck: Director }).deck = director;

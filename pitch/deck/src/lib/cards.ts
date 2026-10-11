import * as THREE from "three";
import { canvasPlane, font, roundRect } from "./label";

// Generic group-chat posts for the "problem" scene. No real names, numbers or logos:
// gray avatar dots, a made-up chat name, and the kind of post that gets buried.

const POSTS: [string, string, string][] = [
  ["dorm buy/sell chat", "selling mini fridge, works great", "$50 obo, dm me"],
  ["class of '28 chat", "anyone need a futon??", "moving out friday"],
  ["dorm buy/sell chat", "CHEM 101 textbook 9th ed", "still have it?"],
  ["housing chat", "free desk lol you pick up", "3rd floor no elevator"],
  ["class of '28 chat", "ISO desk lamp, cheap", "anyone??"],
  ["dorm buy/sell chat", "bike for sale", "lock included, $80"],
  ["housing chat", "selling microwave", "barely used"],
  ["class of '28 chat", "who has a calc textbook", "math 231"],
  ["dorm buy/sell chat", "rug 5x7 $20", "pick up today"],
  ["housing chat", "is this still available?", "hello?"],
  ["class of '28 chat", "mini fridge anyone", "need it by sunday"],
  ["dorm buy/sell chat", "office chair, $30", "dm"],
];

export const CARD_W = 4.2;
export const CARD_H = 2.4;

export function createCardTextures(): THREE.Texture[] {
  return POSTS.map(([chat, line1, line2]) => {
    const { mat } = canvasPlane(CARD_W, CARD_H, (ctx, w, h) => {
      ctx.fillStyle = "rgba(28, 40, 58, 0.96)";
      roundRect(ctx, 0, 0, w, h, 26);
      ctx.fill();
      ctx.strokeStyle = "rgba(75, 156, 211, 0.35)";
      ctx.lineWidth = 2;
      roundRect(ctx, 1, 1, w - 2, h - 2, 26);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = font(600, 20);
      ctx.fillText(chat, 28, 40);
      ctx.fillStyle = "#3a4a61";
      ctx.beginPath();
      ctx.arc(52, 112, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = font(600, 30);
      ctx.fillText(line1, 92, 112);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = font(500, 26);
      ctx.fillText(line2, 92, 156);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = font(500, 18);
      ctx.fillText(`${2 + Math.floor(Math.random() * 40)} new messages`, 28, h - 22);
    });
    return mat.map!;
  });
}

export type Card = { mesh: THREE.Mesh; home: THREE.Vector3; seed: number };

export function createCards(n: number, textures: THREE.Texture[], zFrom: number, zTo: number): Card[] {
  const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const cards: Card[] = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshBasicMaterial({ map: textures[i % textures.length], transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    // Spread around a corridor, leaving the middle open for the camera to fly through.
    const a = Math.random() * Math.PI * 2;
    const r = 4.5 + Math.random() * 11;
    const home = new THREE.Vector3(Math.cos(a) * r * 1.4, Math.sin(a) * r * 0.75, zFrom + (i / n) * (zTo - zFrom) + (Math.random() - 0.5) * 6);
    mesh.position.copy(home);
    mesh.rotation.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.35);
    mesh.visible = false;
    mesh.userData.card = true;
    cards.push({ mesh, home, seed: Math.random() });
  }
  return cards;
}

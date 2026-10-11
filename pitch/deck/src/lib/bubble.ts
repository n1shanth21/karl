import * as THREE from "three";
import { bubblePoints } from "./logo";
import { textLabel } from "./label";

// A solid 3D chat bubble (same outline as the logo's bubble) with white text on it.
// About 5.3 units wide at scale 1.

export function createBubble(lines: string[], color = 0x4b9cd3): THREE.Group {
  const pts = bubblePoints();
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 4, curveSegments: 8 });
  geo.translate(0, 0, -0.225);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.05, emissive: color, emissiveIntensity: 0.25 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));

  const label = textLabel(lines, { size: 64, weight: 600, align: "center" });
  const maxW = 4.4;
  const k = Math.min(1, maxW / label.width);
  label.mesh.scale.setScalar(k);
  label.mesh.position.set(0, 0.2, 0.36);
  group.add(label.mesh);
  return group;
}

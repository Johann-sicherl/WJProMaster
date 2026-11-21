// Escala real 1:1 na vista 3D: pixels por mm × zoom da câmera ortográfica (frustum em pixels).
// Cubo de 50 mm medido em pixels CSS na tela; a calibração do TCL TAB A1 Plus vem da ficha da tela.
import * as THREE from "three";
import { FICHAS } from "../src/esboco/escalaReal";

let falhas = 0;
function confere(nome: string, obtido: number, esperado: number, tol = 1e-6) {
  const ok = Math.abs(obtido - esperado) <= tol * Math.max(1, Math.abs(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${obtido.toFixed(4)} (esperado ${esperado.toFixed(4)})`);
}

// px CSS por mm do TCL TAB A1 Plus (mesma conta de detectarPelaFicha: lado maior em px CSS ÷ mm do lado maior)
const f = FICHAS.find((x) => x.nome === "TCL TAB A1 Plus")!;
const mmMaior = (f.pol * 25.4 * f.res[0]) / Math.hypot(f.res[0], f.res[1]);
const pxPorMm = f.res[0] / 2 / mmMaior; // dpr 2: 1200 px CSS no lado maior
console.log(`TCL TAB A1 Plus: ${pxPorMm.toFixed(4)} px CSS/mm`);

/** Câmera como a do viewport: frustum em pixels (w×h), zoom = px por mm. */
function camera(w: number, h: number, zoom: number, dir: THREE.Vector3) {
  const c = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0, 4000);
  c.zoom = zoom;
  c.position.copy(dir.clone().normalize().multiplyScalar(500));
  c.lookAt(0, 0, 0);
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  return c;
}
/** Ponto do mundo → pixel CSS na tela w×h. */
function paraPixel(c: THREE.OrthographicCamera, p: THREE.Vector3, w: number, h: number) {
  const n = p.clone().project(c);
  return { x: ((n.x + 1) / 2) * w, y: ((1 - n.y) / 2) * h };
}

const W = 1200, H = 750;
// vistas de frente, superior e uma diagonal (a aresta paralela à tela mede 50 mm)
const cuboA = new THREE.Vector3(-25, -25, 25), cuboB = new THREE.Vector3(25, -25, 25);
for (const [nome, dir] of [["frontal", new THREE.Vector3(0, 0, 1)], ["girada 40°", new THREE.Vector3(Math.sin(0.7), 0, Math.cos(0.7))]] as const) {
  const c = camera(W, H, pxPorMm, dir);
  const a = paraPixel(c, cuboA, W, H), b = paraPixel(c, cuboB, W, H);
  const px = Math.hypot(a.x - b.x, a.y - b.y);
  if (nome === "frontal") confere("cubo 50 mm de frente: px na tela", px, 50 * pxPorMm);
  else confere("cubo 50 mm girado 40° (aresta no eixo de giro): px", px, 50 * pxPorMm * Math.cos(0.7), 1e-6);
}
// aresta no eixo de giro (vertical) mantém 50 mm em qualquer ângulo
{
  const c = camera(W, H, pxPorMm, new THREE.Vector3(Math.sin(0.7), 0.4, Math.cos(0.7)));
  const a = paraPixel(c, new THREE.Vector3(0, -25, 0), W, H), b = paraPixel(c, new THREE.Vector3(0, 25, 0), W, H);
  confere("50 mm na vertical, câmera girada e inclinada: mm na tela", Math.hypot(a.x - b.x, a.y - b.y) / pxPorMm / Math.cos(Math.asin(0.4 / Math.hypot(0.4, 1))), 50, 1e-3);
}
// girar o tablet (frustum maior/menor) não muda px por mm
{
  const c1 = camera(1200, 750, pxPorMm, new THREE.Vector3(0, 0, 1)), c2 = camera(750, 1200, pxPorMm, new THREE.Vector3(0, 0, 1));
  const m = (c: THREE.OrthographicCamera, w: number, h: number) => { const a = paraPixel(c, cuboA, w, h), b = paraPixel(c, cuboB, w, h); return Math.hypot(a.x - b.x, a.y - b.y); };
  confere("retrato × paisagem: mesmo px por mm", m(c1, 1200, 750), m(c2, 750, 1200));
}
if (falhas) {
  console.log(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\nEscala real 3D: tudo ok");

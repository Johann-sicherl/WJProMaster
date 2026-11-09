// WJSlicer3D: malha na posição de impressão. Lê o STL (reaproveita a leitura e a solda de vértices
// do WJCAD), gira de 90° em 90°, apoia na mesa (Z mínimo = 0, centro em X e Y) e escolhe o melhor
// apoio (a face plana maior virada para baixo). Puro: testado em scripts/teste-slicer.ts.

import { malhaDoStl } from "../kernel/stl";
import type { MalhaImpressao } from "./fatiar";

export function malhaDeStl(bytes: Uint8Array): MalhaImpressao {
  const m = malhaDoStl(bytes);
  return { pos: m.vertices, tri: m.triangulos };
}

/**
 * Malha indexada vinda de outro app (o WJCAD triangula cada face B-Rep à parte: os vértices das
 * bordas se repetem). Passa pelo mesmo caminho do STL para soldar os vértices e orientar.
 */
export function malhaDeTriangulos(vertices: Float32Array, triangulos: Uint32Array): MalhaImpressao {
  const nt = triangulos.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const v = triangulos[t * 3 + k] * 3, o = 84 + t * 50 + 12 + k * 12;
      dv.setFloat32(o, vertices[v], true);
      dv.setFloat32(o + 4, vertices[v + 1], true);
      dv.setFloat32(o + 8, vertices[v + 2], true);
    }
  return malhaDeStl(new Uint8Array(buf));
}

export type Eixo = "x" | "y" | "z";

/** Gira `quartos` × 90° em torno do eixo (regra da mão direita). Rotação própria: a malha continua para fora. */
export function orientarMalha(m: MalhaImpressao, eixo: Eixo, quartos: number): MalhaImpressao {
  const q = ((quartos % 4) + 4) % 4;
  const p = m.pos.slice();
  for (let k = 0; k < q; k++)
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (eixo === "x") {
        p[i + 1] = -z;
        p[i + 2] = y;
      } else if (eixo === "y") {
        p[i] = z;
        p[i + 2] = -x;
      } else {
        p[i] = -y;
        p[i + 1] = x;
      }
    }
  return { pos: p, tri: m.tri };
}

/** Apoia na mesa: Z mínimo em 0 e caixa centrada em X e Y. */
export function centralizar(m: MalhaImpressao): MalhaImpressao {
  const p = m.pos.slice();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  const d = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) p[i + k] -= d[k];
  return { pos: p, tri: m.tri };
}

/** As seis posições de apoio (qual lado da peça fica para baixo). */
const APOIOS: [Eixo, number][] = [["x", 0], ["x", 1], ["x", 2], ["x", 3], ["y", 1], ["y", 3]];

/**
 * Melhor apoio entre as seis posições: a que deixa mais área de triângulos planos encostada na
 * mesa (normal para baixo e no Z mínimo). Menos suporte e melhor aderência, como faria o operador.
 */
export function melhorApoio(m: MalhaImpressao): MalhaImpressao {
  let melhor = m, maior = -1;
  for (const [e, q] of APOIOS) {
    const g = orientarMalha(m, e, q);
    const a = areaNaMesa(g);
    if (a > maior + 1e-6) {
      maior = a;
      melhor = g;
    }
  }
  return melhor;
}

function areaNaMesa(m: MalhaImpressao): number {
  const { pos: p, tri } = m;
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < p.length; i += 3) {
    if (p[i] < zmin) zmin = p[i];
    if (p[i] > zmax) zmax = p[i];
  }
  const tol = Math.max(1e-4, (zmax - zmin) * 1e-5);
  let area = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    if (p[a + 2] - zmin > tol || p[b + 2] - zmin > tol || p[c + 2] - zmin > tol) continue;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1];
    const nz = ux * vy - uy * vx; // normal para baixo: nz < 0
    if (nz < 0) area += -nz / 2;
  }
  return area;
}

// WJGoldDiamond: união da joia paramétrica (OpenCascade) com as esculturas em malha, pela
// booleana de malhas do manifold-3d (Apache-2.0; só o núcleo manifold.js + .wasm). Usada para
// o peso/volume/área e para o STL numa peça só. Carregado só quando há escultura.

import type { Shape3D } from "replicad";
import type { Malha } from "./escultura";
import { volumeMalha } from "./escultura";

type Wasm = { Manifold: any; Mesh: any };
let wasm: Promise<Wasm> | null = null;

/** Carrega o manifold-3d uma vez (no navegador, `local` = URL do .wasm). */
export function carregarManifold(local?: string): Promise<Wasm> {
  wasm ??= import("manifold-3d").then(async (mod) => {
    const w = await (mod.default as unknown as (o?: object) => Promise<any>)(local ? { locateFile: () => local } : undefined);
    w.setup();
    return w as Wasm;
  });
  return wasm;
}

export interface ResultadoUniao { volume: number; area: number; malha: Malha; avisos: string[] }

/** União metal + esculturas. Sem manifold válido, cai na soma dos volumes (com aviso). */
export function unir(w: Wasm, forma: Shape3D, esculturas: Malha[]): ResultadoUniao {
  const avisos: string[] = [];
  const m = forma.mesh({ tolerance: 0.01, angularTolerance: 8 });
  const lixo: any[] = [];
  const paraManifold = (pos: Float32Array, tri: Uint32Array) => {
    const mesh = new w.Mesh({ numProp: 3, vertProperties: pos, triVerts: tri });
    mesh.merge();
    const mf = new w.Manifold(mesh);
    lixo.push(mf);
    return mf;
  };
  try {
    let total = paraManifold(new Float32Array(m.vertices), new Uint32Array(m.triangles));
    let falhas = 0;
    for (const e of esculturas) {
      try {
        const u = total.add(paraManifold(e.pos, e.tri));
        lixo.push(u);
        total = u;
      } catch {
        falhas++;
      }
    }
    if (falhas) avisos.push(`${falhas} escultura(s) com malha aberta ficaram fora da união (peso aproximado).`);
    const out = total.getMesh();
    const r: ResultadoUniao = {
      volume: total.volume(), area: total.surfaceArea(), avisos,
      malha: { pos: new Float32Array(out.vertProperties.length === out.numVert * 3 ? out.vertProperties : Float32Array.from({ length: out.numVert * 3 }, (_, i) => out.vertProperties[Math.floor(i / 3) * out.numProp + (i % 3)])), tri: new Uint32Array(out.triVerts) },
    };
    return r;
  } catch (e) {
    const vol = esculturas.reduce((s, x) => s + volumeMalha(x), 0);
    return { volume: NaN, area: NaN, malha: { pos: new Float32Array(m.vertices), tri: new Uint32Array(m.triangles) }, avisos: [`União com as esculturas falhou (${(e as Error).message || "malha inválida"}); peso das esculturas somado à parte: ${vol.toFixed(1)} mm³.`] };
  } finally {
    for (const x of lixo) x.delete?.();
  }
}

/** STL binário de uma malha (escala opcional a partir da origem: contração da fundição). */
export function stlBinario(m: Malha, escala = 1): ArrayBuffer {
  const n = m.tri.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  const p = m.pos;
  for (let i = 0; i < m.tri.length; i += 3) {
    const a = 3 * m.tri[i], b = 3 * m.tri[i + 1], c = 3 * m.tri[i + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    for (const v of [nx, ny, nz]) { dv.setFloat32(o, v, true); o += 4; }
    for (const k of [a, b, c]) for (let j = 0; j < 3; j++) { dv.setFloat32(o, p[k + j] * escala, true); o += 4; }
    o += 2;
  }
  return buf;
}

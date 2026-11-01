// STL como malha (sem OpenCascade): leitura binária/ASCII, solda de vértices e normais suaves.
// Usado para o "corpo de malha": STL grande demais para virar sólido B-Rep (escaneamentos 3D
// com centenas de milhares de triângulos) é só exibido, como fazem os CADs profissionais.
// Puro: testado em scripts/teste-importar.ts.

/** Acima disto o STL entra como corpo de malha (costurar em sólido levaria minutos no tablet). */
export const LIMITE_TRIANGULOS_SOLIDO = 10000;

const ehBinario = (b: Uint8Array) =>
  b.length >= 84 && 84 + new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true) * 50 === b.length;

export function contarTriangulosStl(b: Uint8Array): number {
  if (ehBinario(b)) return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true);
  const t = new TextDecoder().decode(b);
  return (t.match(/\bfacet\s+normal\b/gi) ?? []).length;
}

/** Posições dos vértices de cada triângulo (9 números por triângulo). */
function triangulosDoStl(b: Uint8Array): Float32Array {
  if (ehBinario(b)) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = dv.getUint32(80, true);
    const p = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) p[i * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
    return p;
  }
  const t = new TextDecoder().decode(b);
  const nums: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (let m; (m = re.exec(t)); ) nums.push(+m[1], +m[2], +m[3]);
  return Float32Array.from(nums.slice(0, nums.length - (nums.length % 9)));
}

export interface MalhaStl {
  vertices: Float32Array;
  normais: Float32Array;
  triangulos: Uint32Array;
  /** caixa: mínimo e máximo */
  min: [number, number, number];
  max: [number, number, number];
  /** volume (mm³) se a malha é fechada (cada aresta em exatamente dois triângulos); senão null */
  volume: number | null;
  area: number;
}

/** Lê o STL, solda vértices iguais (tolerância relativa ao tamanho) e calcula normais suaves. */
export function malhaDoStl(b: Uint8Array): MalhaStl {
  const p = triangulosDoStl(b);
  const nt = p.length / 9;
  if (!nt) throw new Error("O STL não tem triângulos.");
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const q = 1 / (diag * 1e-6); // solda vértices a menos de um milionésimo do tamanho
  const mapa = new Map<string, number>();
  const pos: number[] = [];
  const tri = new Uint32Array(nt * 3);
  for (let i = 0; i < nt * 3; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const k = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let v = mapa.get(k);
    if (v === undefined) {
      v = pos.length / 3;
      mapa.set(k, v);
      pos.push(x, y, z);
    }
    tri[i] = v;
  }
  const vertices = Float32Array.from(pos);
  const normais = new Float32Array(vertices.length);
  let vol = 0, area = 0;
  const arestas = new Map<number, number>(); // aresta orientada → contagem (fechada: cada uma com a oposta)
  const nv = vertices.length / 3;
  let fechada = true;
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b2 = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
    const ux = vertices[b2 * 3] - ax, uy = vertices[b2 * 3 + 1] - ay, uz = vertices[b2 * 3 + 2] - az;
    const vx = vertices[c * 3] - ax, vy = vertices[c * 3 + 1] - ay, vz = vertices[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // 2 × área, ponderada
    for (const v of [a, b2, c]) (normais[v * 3] += nx), (normais[v * 3 + 1] += ny), (normais[v * 3 + 2] += nz);
    area += Math.hypot(nx, ny, nz) / 2;
    vol += (ax * nx + ay * ny + az * nz) / 6; // tetraedro com a origem
    if (fechada)
      for (const [i, j] of [[a, b2], [b2, c], [c, a]]) {
        const ida = i * nv + j, volta = j * nv + i;
        const r = arestas.get(volta);
        if (r) r === 1 ? arestas.delete(volta) : arestas.set(volta, r - 1);
        else arestas.set(ida, (arestas.get(ida) ?? 0) + 1);
        if (arestas.size > 4e6) fechada = false; // malha enorme e aberta: desiste de conferir
      }
  }
  for (let i = 0; i < normais.length; i += 3) {
    const n = Math.hypot(normais[i], normais[i + 1], normais[i + 2]) || 1;
    normais[i] /= n;
    normais[i + 1] /= n;
    normais[i + 2] /= n;
  }
  fechada &&= arestas.size === 0;
  return { vertices, normais, triangulos: tri, min, max, volume: fechada ? Math.abs(vol) : null, area };
}

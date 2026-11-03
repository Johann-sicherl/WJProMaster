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

/**
 * Lê o STL, solda vértices iguais (tolerância relativa ao tamanho) e calcula normais suaves.
 * Só vetores numéricos (tabela de hash e ordenação nativa): um STL de 1,5 milhão de triângulos
 * cabe na memória de um tablet (o kernel roda num worker com pouca memória).
 */
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
  const nc = nt * 3;
  // tabela de hash (endereçamento aberto) com o índice do vértice único; a chave é recalculada
  // a partir da posição guardada
  let cap = 1;
  while (cap < nc * 1.5) cap <<= 1;
  const tabela = new Int32Array(cap).fill(-1);
  const pos = new Float32Array(nc * 3); // posições únicas (o excesso é cortado no fim)
  // chave quantizada recalculada da posição guardada (o STL já é float32: dá o mesmo valor)
  const chave = (v: number, k: number) => Math.round((pos[v * 3 + k] - min[k]) * q);
  let nv = 0;
  const tri = new Uint32Array(nc);
  for (let i = 0; i < nc; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const ix = Math.round((x - min[0]) * q), iy = Math.round((y - min[1]) * q), iz = Math.round((z - min[2]) * q);
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (cap - 1);
    let v = -1;
    for (;;) {
      const t = tabela[h];
      if (t < 0) break;
      if (chave(t, 0) === ix && chave(t, 1) === iy && chave(t, 2) === iz) {
        v = t;
        break;
      }
      h = (h + 1) & (cap - 1);
    }
    if (v < 0) {
      v = nv++;
      tabela[h] = v;
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    }
    tri[i] = v;
  }
  const vertices = pos.slice(0, nv * 3);
  orientar(tri, nv, vertices);
  const normais = new Float32Array(vertices.length);
  let vol = 0, area = 0;
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b2 = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
    const ux = vertices[b2 * 3] - ax, uy = vertices[b2 * 3 + 1] - ay, uz = vertices[b2 * 3 + 2] - az;
    const vx = vertices[c * 3] - ax, vy = vertices[c * 3 + 1] - ay, vz = vertices[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // 2 × área, ponderada
    for (const w of [a, b2, c]) (normais[w * 3] += nx), (normais[w * 3 + 1] += ny), (normais[w * 3 + 2] += nz);
    area += Math.hypot(nx, ny, nz) / 2;
    vol += (ax * nx + ay * ny + az * nz) / 6; // tetraedro com a origem
  }
  for (let i = 0; i < normais.length; i += 3) {
    const n = Math.hypot(normais[i], normais[i + 1], normais[i + 2]) || 1;
    normais[i] /= n;
    normais[i + 1] /= n;
    normais[i + 2] /= n;
  }
  return { vertices, normais, triangulos: tri, min, max, volume: fechada(tri, nv) ? Math.abs(vol) : null, area };
}

/**
 * Deixa coerente a ordem dos vértices (o lado de fora) de triângulos vizinhos. Exportadores
 * e escaneamentos às vezes gravam parte dos triângulos ao contrário: sem isso eles somem na tela
 * (só a frente é desenhada: a peça fica "cheia de furos") e o volume não fecha.
 * Em cada parte conectada (vizinhos pela aresta, só arestas com dois triângulos), percorre os
 * vizinhos e vira os que estão na contramão; o sentido da parte é o da maioria dos triângulos
 * do arquivo (assim cavidades internas continuam para dentro). No fim, se o volume total der
 * negativo, a malha inteira estava do avesso e é virada. Altera `tri` no lugar.
 */
export function orientar(tri: Uint32Array, nv: number, v: Float32Array): number {
  const nc = tri.length, nt = nc / 3;
  const proxima = (h: number) => (h % 3 === 2 ? h - 2 : h + 1);
  // vizinha de cada meia-aresta: índice da meia-aresta do outro triângulo; -1 borda; -2 aresta com 3+
  const viz = new Int32Array(nc).fill(-1);
  {
    let cap = 1;
    while (cap < nc) cap <<= 1;
    const tabela = new Int32Array(cap).fill(-1);
    for (let h = 0; h < nc; h++) {
      const a = tri[h], b = tri[proxima(h)];
      if (a === b) continue; // triângulo degenerado: aresta sem comprimento
      const lo = a < b ? a : b, hi = a < b ? b : a;
      let k = (Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663)) & (cap - 1);
      for (;;) {
        const g = tabela[k];
        if (g < 0) {
          tabela[k] = h;
          break;
        }
        const c = tri[g], d = tri[proxima(g)];
        if ((c === lo && d === hi) || (c === hi && d === lo)) {
          if (viz[g] === -1) {
            viz[g] = h;
            viz[h] = g;
          } else {
            // aresta não variedade: não propaga por ela
            if (viz[g] >= 0) viz[viz[g]] = -2;
            viz[g] = -2;
            viz[h] = -2;
          }
          break;
        }
        k = (k + 1) & (cap - 1);
      }
    }
  }
  const inv = new Uint8Array(nt); // 1 = virar este triângulo (relativo ao arquivo)
  const visto = new Uint8Array(nt);
  const fila = new Int32Array(nt);
  let viradas = 0;
  for (let s = 0; s < nt; s++) {
    if (visto[s]) continue;
    visto[s] = 1;
    let ini = 0, fim = 0, invertidos = 0;
    fila[fim++] = s;
    while (ini < fim) {
      const t = fila[ini++];
      if (inv[t]) invertidos++;
      for (let e = 0; e < 3; e++) {
        const h = t * 3 + e, g = viz[h];
        if (g < 0) continue;
        const u = (g / 3) | 0;
        if (visto[u]) continue;
        visto[u] = 1;
        // mesmo sentido no arquivo (começam no mesmo vértice) = um deles tem de virar
        inv[u] = (tri[h] === tri[g] ? 1 : 0) ^ inv[t];
        fila[fim++] = u;
      }
    }
    // maioria do arquivo decide o lado da parte
    if (invertidos * 2 > fim) for (let i = 0; i < fim; i++) inv[fila[i]] ^= 1;
  }
  let vol = 0;
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b = tri[t * 3 + (inv[t] ? 2 : 1)], c = tri[t * 3 + (inv[t] ? 1 : 2)];
    const ax = v[a * 3], ay = v[a * 3 + 1], az = v[a * 3 + 2];
    const bx = v[b * 3], by = v[b * 3 + 1], bz = v[b * 3 + 2];
    const cx = v[c * 3], cy = v[c * 3 + 1], cz = v[c * 3 + 2];
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  // do avesso só faz sentido em malha fechada (numa aberta o sinal depende da origem)
  let aberta = false;
  for (let h = 0; h < nc && !aberta; h++) if (viz[h] === -1 && tri[h] !== tri[proxima(h)]) aberta = true;
  const tudo = !aberta && vol < 0 ? 1 : 0;
  for (let t = 0; t < nt; t++)
    if (inv[t] ^ tudo) {
      const x = tri[t * 3 + 1];
      tri[t * 3 + 1] = tri[t * 3 + 2];
      tri[t * 3 + 2] = x;
      viradas++;
    }
  return viradas;
}

/**
 * Malha fechada para o volume: cada aresta orientada (a→b) tem a oposta (b→a) em outro triângulo,
 * contando repetições (vale também para arestas com 4 triângulos, comuns em escaneamentos).
 */
function fechada(tri: Uint32Array, nv: number): boolean {
  const ida = new Float64Array(tri.length), volta = new Float64Array(tri.length);
  for (let t = 0; t < tri.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = tri[t + e], b = tri[t + ((e + 1) % 3)];
      ida[t + e] = a * nv + b;
      volta[t + e] = b * nv + a;
    }
  ida.sort();
  volta.sort();
  for (let i = 0; i < ida.length; i++) if (ida[i] !== volta[i]) return false;
  return true;
}

// ---------- simplificar (reduzir triângulos) ----------

/**
 * Uma passada de agrupamento: os vértices de cada célula da grade (lado `lado`) viram um só,
 * posto onde o erro quadrático aos planos dos triângulos em volta é mínimo (preserva quinas e
 * bordas melhor que a média), preso dentro da célula. Triângulos que degeneram saem; triângulos
 * repetidos (ou o mesmo nos dois sentidos, lâminas internas) também.
 */
function agrupar(m: MalhaStl, lado: number): { pos: Float32Array; tri: Uint32Array } {
  const v = m.vertices, nv = v.length / 3, t = m.triangulos;
  const nx = Math.max(1, Math.ceil((m.max[0] - m.min[0]) / lado) + 1), ny = Math.max(1, Math.ceil((m.max[1] - m.min[1]) / lado) + 1);
  // célula de cada vértice → índice compacto do grupo
  let cap = 1;
  while (cap < nv * 1.5) cap <<= 1;
  const chaves = new Float64Array(cap).fill(-1), idGrupo = new Int32Array(cap);
  const grupoDe = new Int32Array(nv);
  let ng = 0;
  for (let i = 0; i < nv; i++) {
    const cx = Math.floor((v[i * 3] - m.min[0]) / lado), cy = Math.floor((v[i * 3 + 1] - m.min[1]) / lado), cz = Math.floor((v[i * 3 + 2] - m.min[2]) / lado);
    const k = (cz * ny + cy) * nx + cx;
    let h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) & (cap - 1);
    while (chaves[h] !== -1 && chaves[h] !== k) h = (h + 1) & (cap - 1);
    if (chaves[h] === -1) {
      chaves[h] = k;
      idGrupo[h] = ng++;
    }
    grupoDe[i] = idGrupo[h];
  }
  // quádricas (10 termos) e soma das posições de cada grupo
  const Q = new Float64Array(ng * 10), soma = new Float64Array(ng * 3), cont = new Uint32Array(ng);
  for (let i = 0; i < nv; i++) {
    const g = grupoDe[i];
    soma[g * 3] += v[i * 3]; soma[g * 3 + 1] += v[i * 3 + 1]; soma[g * 3 + 2] += v[i * 3 + 2];
    cont[g]++;
  }
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let px = uy * wz - uz * wy, py = uz * wx - ux * wz, pz = ux * wy - uy * wx;
    const ar = Math.hypot(px, py, pz);
    if (ar < 1e-20) continue;
    px /= ar; py /= ar; pz /= ar;
    const d = -(px * v[a] + py * v[a + 1] + pz * v[a + 2]);
    const peso = ar; // planos de triângulos maiores pesam mais
    const q = [px * px, px * py, px * pz, px * d, py * py, py * d, pz * pz, pz * d, d * d, pz * py];
    for (const g of [grupoDe[t[k]], grupoDe[t[k + 1]], grupoDe[t[k + 2]]]) for (let j = 0; j < 10; j++) Q[g * 10 + j] += q[j] * peso;
  }
  const pos = new Float32Array(ng * 3);
  for (let g = 0; g < ng; g++) {
    const mx = soma[g * 3] / cont[g], my = soma[g * 3 + 1] / cont[g], mz = soma[g * 3 + 2] / cont[g];
    // A·x = −b, com A = [[xx xy xz][xy yy yz][xz yz zz]], b = [xd yd zd]
    const o = g * 10;
    const a11 = Q[o], a12 = Q[o + 1], a13 = Q[o + 2], a22 = Q[o + 4], a23 = Q[o + 9], a33 = Q[o + 6];
    const b1 = -Q[o + 3], b2 = -Q[o + 5], b3 = -Q[o + 7];
    const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
    const escala = (a11 + a22 + a33) ** 3;
    let x = mx, y = my, z = mz;
    if (escala > 0 && Math.abs(det) > 1e-6 * escala) {
      x = (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3)) / det;
      y = (a11 * (b2 * a33 - b3 * a23) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13)) / det;
      z = (a11 * (a22 * b3 - a23 * b2) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13)) / det;
      // longe demais do grupo (plano quase paralelo): fica a média
      if (!(Math.abs(x - mx) <= lado && Math.abs(y - my) <= lado && Math.abs(z - mz) <= lado)) { x = mx; y = my; z = mz; }
    }
    pos[g * 3] = x; pos[g * 3 + 1] = y; pos[g * 3 + 2] = z;
  }
  // triângulos que sobram, sem repetição (tabela de hash pelo trio ordenado de grupos)
  const nt = t.length / 3;
  const ord = new Int32Array(nt * 3); // trio ordenado de cada triângulo de saída
  const saida = new Int32Array(nt * 3);
  const vivo = new Uint8Array(nt);
  const sentido = new Int8Array(nt); // paridade do trio (a, b, c) em relação ao ordenado
  const paridade = (a: number, b: number, c: number) => ((a < b ? 1 : 0) + (b < c ? 1 : 0) + (c < a ? 1 : 0)) === 2 ? 1 : -1;
  let ns = 0;
  let capT = 1;
  while (capT < nt * 1.5) capT <<= 1;
  const tab = new Int32Array(capT).fill(-1);
  for (let k = 0; k < t.length; k += 3) {
    const a = grupoDe[t[k]], b = grupoDe[t[k + 1]], c = grupoDe[t[k + 2]];
    if (a === b || b === c || a === c) continue;
    const x = Math.min(a, b, c), z = Math.max(a, b, c), y = a + b + c - x - z;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (capT - 1);
    let ja = -1;
    for (;;) {
      const e = tab[h];
      if (e < 0) break;
      if (ord[e * 3] === x && ord[e * 3 + 1] === y && ord[e * 3 + 2] === z) {
        ja = e;
        break;
      }
      h = (h + 1) & (capT - 1);
    }
    if (ja < 0) {
      tab[h] = ns;
      ord[ns * 3] = x; ord[ns * 3 + 1] = y; ord[ns * 3 + 2] = z;
      saida[ns * 3] = a; saida[ns * 3 + 1] = b; saida[ns * 3 + 2] = c;
      vivo[ns] = 1;
      sentido[ns] = paridade(a, b, c);
      ns++;
    } else if (vivo[ja] && sentido[ja] !== paridade(a, b, c)) {
      vivo[ja] = 0; // o mesmo triângulo no sentido contrário: lâmina interna, os dois saem
    } else {
      // já cancelado por um par, ou repetido no mesmo sentido: entra como triângulo próprio (tirar
      // desequilibraria as arestas opostas, abrindo a malha)
      if (ns >= nt) continue;
      saida[ns * 3] = a; saida[ns * 3 + 1] = b; saida[ns * 3 + 2] = c;
      ord[ns * 3] = -1; // não volta a ser achado na tabela
      vivo[ns] = 1;
      sentido[ns] = paridade(a, b, c);
      ns++;
    }
  }
  let nvivos = 0;
  for (let k = 0; k < ns; k++) nvivos += vivo[k];
  const tri = new Uint32Array(nvivos * 3);
  for (let k = 0, o = 0; k < ns; k++) if (vivo[k]) { tri[o++] = saida[k * 3]; tri[o++] = saida[k * 3 + 1]; tri[o++] = saida[k * 3 + 2]; }
  return { pos, tri };
}

/**
 * Reduz a malha para no máximo `alvo` triângulos (o mais perto possível por baixo) e devolve o
 * STL binário resultante. Busca o tamanho da grade por bisseção (cada passada é linear).
 */
export function simplificarStl(b: Uint8Array, alvo: number): { bytes: Uint8Array; triangulos: number; original: number } {
  const m = malhaDoStl(b);
  const original = m.triangulos.length / 3;
  if (original <= alvo) return { bytes: b, triangulos: original, original };
  const diag = Math.hypot(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]) || 1;
  // lado da célula: entre um detalhe minúsculo e a peça inteira
  let lo = diag * 1e-5, hi = diag / 2;
  let melhor = agrupar(m, hi);
  for (let i = 0; i < 18; i++) {
    const lado = Math.sqrt(lo * hi);
    const r = agrupar(m, lado);
    const n = r.tri.length / 3;
    if (n > alvo) lo = lado;
    else {
      hi = lado;
      melhor = r;
      if (n > alvo * 0.95) break; // perto o bastante do pedido
    }
  }
  const nt = melhor.tri.length / 3;
  const out = new Uint8Array(84 + 50 * nt);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, nt, true);
  for (let k = 0; k < nt; k++) {
    for (let j = 0; j < 3; j++) {
      const vi = melhor.tri[k * 3 + j];
      for (let e = 0; e < 3; e++) dv.setFloat32(84 + k * 50 + 12 + (j * 3 + e) * 4, melhor.pos[vi * 3 + e], true);
    }
  }
  return { bytes: out, triangulos: nt, original };
}

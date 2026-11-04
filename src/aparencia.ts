// Aparências (cores) de faces e corpos: casa as faces guardadas por assinatura com as faces da
// peça atual (milhares de faces vindas de STEP: por centro arredondado, depois a mais parecida)
// e monta os trechos de triângulos coloridos que o viewport pinta. Puro: testado em teste-importar.

import type { Aparencia, AssinaturaFace } from "./model";

export interface CorDeFace {
  ass: AssinaturaFace;
  cor: number;
}

const chave = (a: AssinaturaFace, passo: number) => `${a.geom}:${a.centro.map((v) => Math.round(v / passo)).join(",")}`;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Nota de semelhança (menor = mais parecida; Infinity = não serve). Mesma regra de `acharFace`. */
function nota(f: AssinaturaFace, a: AssinaturaFace): number {
  if (f.geom !== a.geom) return Infinity;
  const esc = (u?: number[], v?: number[]) => (u && v ? u[0] * v[0] + u[1] * v[1] + u[2] * v[2] : 1);
  if (a.normal && f.normal && esc(a.normal, f.normal) < 0.995) return Infinity;
  if (a.eixo && f.eixo && Math.abs(esc(a.eixo, f.eixo)) < 0.995) return Infinity;
  const n = dist(f.centro, a.centro) + Math.abs(f.area - a.area) / Math.max(1, Math.sqrt(a.area)) +
    (a.raio !== undefined && f.raio !== undefined ? Math.abs(a.raio - f.raio) * 2 : 0);
  return n <= Math.max(2, 0.25 * Math.sqrt(a.area)) ? n : Infinity;
}

/**
 * Cor de cada face da peça (-1 = sem cor própria). Quem vem depois na lista vence. Primeiro o
 * casamento exato pelo centro (as faces que não mudaram); as que sobram procuram a mais parecida.
 */
export function casarFaces(faces: AssinaturaFace[], cores: CorDeFace[]): Int32Array {
  const out = new Int32Array(faces.length).fill(-1);
  if (!cores.length || !faces.length) return out;
  const passo = 1e-3;
  const porChave = new Map<string, number[]>();
  faces.forEach((f, i) => {
    const k = chave(f, passo);
    (porChave.get(k) ?? porChave.set(k, []).get(k)!).push(i);
  });
  const sobra: CorDeFace[] = [];
  for (const c of cores) {
    const cand = porChave.get(chave(c.ass, passo));
    let melhor = -1, n = Infinity;
    for (const i of cand ?? []) {
      const v = nota(faces[i], c.ass);
      if (v < n) (n = v), (melhor = i);
    }
    if (melhor >= 0) out[melhor] = c.cor;
    else sobra.push(c);
  }
  // faces que mudaram (recurso depois da importação): a mais parecida, se não forem muitas
  if (sobra.length && sobra.length * faces.length <= 4e7)
    for (const c of sobra) {
      let melhor = -1, n = Infinity;
      for (let i = 0; i < faces.length; i++) {
        const v = nota(faces[i], c.ass);
        if (v < n) (n = v), (melhor = i);
      }
      if (melhor >= 0) out[melhor] = c.cor;
    }
  return out;
}

/** Trecho de triângulos (índices em `triangulos`) e a cor dele. */
export interface TrechoCor {
  ini: number;
  qtd: number;
  cor: number;
}

/**
 * Trechos coloridos da peça: cores vindas do arquivo (`coresArquivo`, por face), depois os corpos
 * pintados e por fim as faces pintadas pelo usuário. `faces` = [ini, qtd, …] de cada face na malha.
 */
export function trechosDeCor(
  facesMalha: ArrayLike<number>,
  topoFaces: AssinaturaFace[],
  coresArquivo: ArrayLike<number> | undefined,
  aparencias: Aparencia[] | undefined,
  corpos: { faces: number[]; malha?: { ini: number; qtd: number } }[] | undefined,
  corpoDe: (a: Extract<Aparencia, { alvo: "corpo" }>) => number,
): TrechoCor[] {
  const nFaces = Math.floor(facesMalha.length / 3);
  const corFace = new Int32Array(nFaces).fill(-1);
  if (coresArquivo) for (let i = 0; i < Math.min(nFaces, coresArquivo.length); i++) corFace[i] = coresArquivo[i];
  const trechos: TrechoCor[] = [];
  for (const a of aparencias ?? []) {
    if (a.alvo !== "corpo") continue;
    const k = corpoDe(a);
    const c = k >= 0 ? corpos?.[k] : undefined;
    if (!c) continue;
    for (const f of c.faces) if (f < nFaces) corFace[f] = a.cor;
    if (c.malha) trechos.push({ ini: c.malha.ini, qtd: c.malha.qtd, cor: a.cor });
  }
  const daFace = (aparencias ?? []).filter((a): a is Extract<Aparencia, { alvo: "face" }> => a.alvo === "face");
  const usuario = casarFaces(topoFaces, daFace.map((a) => ({ ass: a.ass, cor: a.cor })));
  for (let i = 0; i < nFaces; i++) {
    const c = usuario[i] >= 0 ? usuario[i] : corFace[i];
    if (c >= 0) trechos.push({ ini: facesMalha[i * 3], qtd: facesMalha[i * 3 + 1], cor: c });
  }
  return trechos;
}

/** Corpo da lista mais parecido com a referência guardada (centro e volume; malha pelo id). */
export function indiceDoCorpoRef(corpos: { centro: number[]; volume: number; malha?: { id: string; copia: number } }[], r: { centro: number[]; volume: number; malha?: string; copia?: number }): number {
  if (r.malha) return corpos.findIndex((c) => c.malha?.id === r.malha && c.malha?.copia === (r.copia ?? 0));
  let melhor = -1, n = Infinity;
  corpos.forEach((c, i) => {
    if (c.malha) return;
    const v = dist(c.centro, r.centro) + Math.abs(c.volume - r.volume) / Math.max(1, Math.cbrt(Math.abs(r.volume)) ** 2);
    if (v < n) (n = v), (melhor = i);
  });
  return melhor;
}

/** "#rrggbb" ↔ número. */
export const hexDeCor = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
export const corDeHex = (h: string) => parseInt(h.replace("#", ""), 16) & 0xffffff;

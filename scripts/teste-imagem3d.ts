// Testes do gerador imagens → modelo 3D (fase 1, casco visual): silhueta pelo fundo liso,
// medidas pelas proporções, escultura das vistas ortogonais e diagonais, superfície fechada e
// orientada, quantidade de faces e STL.
import { esculpir, gerarCasco, medidas, silhuetaDaImagem, stlBinario, superficie, suavizar, type MalhaCasco, type NomeVista, type Silhueta } from "../src/imagem3d/casco";
import { contarTriangulosStl, malhaDoStl, simplificarStl } from "../src/kernel/stl";

let falhas = 0;
const ok = (c: boolean, m: string) => {
  if (!c) { falhas++; console.error("FALHOU:", m); } else console.log("ok", m);
};
const perto = (a: number, b: number, tolRel: number) => Math.abs(a - b) <= Math.abs(b) * tolRel;

/** Foto sintética: fundo claro levemente ruidoso, peça escura onde `dentro(x, y)` (mm, y para cima). */
function foto(wmm: number, hmm: number, pxmm: number, dentro: (x: number, y: number) => boolean, margem = 20) {
  const w = Math.round((wmm + 2 * margem) * pxmm), h = Math.round((hmm + 2 * margem) * pxmm);
  const rgba = new Uint8ClampedArray(w * h * 4);
  let semente = 7;
  const ruido = () => ((semente = (semente * 16807) % 2147483647) % 9) - 4;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / pxmm - margem - wmm / 2, y = hmm - ((py + 0.5) / pxmm - margem);
      const i = (py * w + px) * 4;
      const c = dentro(x, y) ? 60 : 235;
      rgba[i] = c + ruido();
      rgba[i + 1] = c + ruido();
      rgba[i + 2] = c + 5 + ruido();
      rgba[i + 3] = 255;
    }
  return { rgba, w, h };
}
const sil = (f: ReturnType<typeof foto>, tol = 60) => silhuetaDaImagem(f.rgba, f.w, f.h, tol);

function volume(m: MalhaCasco) {
  let v = 0;
  const p = m.pos;
  for (let t = 0; t < m.tri.length; t += 3) {
    const a = m.tri[t] * 3, b = m.tri[t + 1] * 3, c = m.tri[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}
/** cada aresta em exatamente dois triângulos, em sentidos opostos */
function fechada(m: MalhaCasco) {
  const cont = new Map<string, number>();
  for (let t = 0; t < m.tri.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = m.tri[t + e], b = m.tri[t + ((e + 1) % 3)];
      const k = `${a},${b}`;
      cont.set(k, (cont.get(k) ?? 0) + 1);
    }
  for (const [k, n] of cont) {
    const [a, b] = k.split(",");
    if (n !== 1 || cont.get(`${b},${a}`) !== 1) return false;
  }
  return true;
}

// ---- silhueta ----
{
  const f = foto(60, 50, 4, (x, y) => Math.abs(x) <= 30 && y >= 0 && y <= 50);
  const s = sil(f);
  ok(s.x1 + 1 - s.x0 === 240 && s.y1 + 1 - s.y0 === 200, `caixa da silhueta 240×200 px (deu ${s.x1 + 1 - s.x0}×${s.y1 + 1 - s.y0})`);
  // reflexo pequeno dentro da peça some; furo passante grande fica
  const g = foto(60, 50, 4, (x, y) => Math.abs(x) <= 30 && y >= 0 && y <= 50 && !(Math.hypot(x - 10, y - 30) < 0.5) && !(Math.hypot(x + 10, y - 25) < 8));
  const t = sil(g);
  const px = (x: number, y: number) => t.m[Math.floor((50 - y + 20) * 4) * t.w + Math.floor((x + 30 + 20) * 4)];
  ok(px(10, 30) === 1, "reflexo pequeno dentro da peça é preenchido");
  ok(px(-10, 25) === 0, "furo passante grande continua furo");
  let erro = "";
  try { silhuetaDaImagem(new Uint8ClampedArray(40 * 40 * 4).fill(200), 40, 40, 30); } catch (e) { erro = (e as Error).message; }
  ok(/Não achei a peça/.test(erro), "foto só com fundo: erro claro");
}

// ---- medidas ----
{
  const frente = sil(foto(60, 50, 4, (x, y) => Math.abs(x) <= 30 && y >= 0 && y <= 50));
  const lado = sil(foto(40, 50, 3, (x, y) => Math.abs(x) <= 20 && y >= 0 && y <= 50)); // outra escala de foto
  const d = medidas({ frente, esquerda: lado }, "largura", 60);
  ok(perto(d.W, 60, 1e-9) && perto(d.H, 50, 0.01) && perto(d.D, 40, 0.02), `medidas frente+lado: ${d.W.toFixed(1)}×${d.H.toFixed(1)}×${d.D.toFixed(1)}`);
  const cima = sil(foto(60, 40, 2, (x, y) => Math.abs(x) <= 30 && y >= 0 && y <= 40));
  const d2 = medidas({ frente, cima }, "altura", 50);
  ok(perto(d2.W, 60, 0.01) && perto(d2.D, 40, 0.02), `medidas frente+cima: ${d2.W.toFixed(1)}×${d2.H.toFixed(1)}×${d2.D.toFixed(1)}`);
  let erro = "";
  try { medidas({ frente, tras: frente }, "largura", 60); } catch (e) { erro = (e as Error).message; }
  ok(/Faltam vistas/.test(erro), "só frente e trás: pede mais uma direção");
}

// ---- cilindro (eixo Y, Ø60 × 50): frente/lado retângulos, cima círculo ----
{
  const ret = (x: number, y: number) => Math.abs(x) <= 30 && y >= 0 && y <= 50;
  const circ = (x: number, y: number) => Math.hypot(x, y - 30) <= 30;
  const v: Partial<Record<NomeVista, Silhueta>> = {
    frente: sil(foto(60, 50, 5, ret)), direita: sil(foto(60, 50, 5, ret)), cima: sil(foto(60, 60, 5, circ)),
  };
  const dim = medidas(v, "largura", 60);
  const m = superficie(esculpir(v, dim, 96));
  const vol = volume(m), esperado = Math.PI * 900 * 50;
  ok(perto(vol, esperado, 0.02), `volume do cilindro ${vol.toFixed(0)} ≈ ${esperado.toFixed(0)} mm³`);
  ok(fechada(m), "malha do cilindro fechada e orientada (cada aresta 2×, sentidos opostos)");
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 1; i < m.pos.length; i += 3) { ymin = Math.min(ymin, m.pos[i]); ymax = Math.max(ymax, m.pos[i]); }
  ok(Math.abs(ymin) < 0.6 && Math.abs(ymax - 50) < 0.6, `apoiada em Y=0 e com 50 de altura (${ymin.toFixed(2)}…${ymax.toFixed(2)})`);
  const v0 = volume(m);
  suavizar(m);
  ok(perto(volume(m), v0, 0.01), "suavização não encolhe a peça (< 1%)");
}

// ---- bloco com furo passante (frente) ----
{
  const frente = sil(foto(60, 40, 4, (x, y) => Math.abs(x) <= 30 && y >= 0 && y <= 40 && Math.hypot(x, y - 20) > 10));
  const lado = sil(foto(30, 40, 4, (x, y) => Math.abs(x) <= 15 && y >= 0 && y <= 40));
  const v = { frente, esquerda: lado };
  const dim = medidas(v, "largura", 60);
  const m = superficie(esculpir(v, dim, 100));
  const esperado = (60 * 40 - Math.PI * 100) * 30;
  ok(perto(volume(m), esperado, 0.03), `bloco com furo: ${volume(m).toFixed(0)} ≈ ${esperado.toFixed(0)} mm³`);
  ok(fechada(m), "bloco com furo fechado");
}

// ---- vistas diagonais cortam os cantos (prisma 60×60×50 → octógono) ----
{
  const q = (x: number, y: number) => Math.abs(x) <= 30 && y >= 0 && y <= 50;
  const diag = (x: number, y: number) => Math.abs(x) <= 30 && y >= 0 && y <= 50; // largura 60 a 45°
  const sem = { frente: sil(foto(60, 50, 4, q)), esquerda: sil(foto(60, 50, 4, q)) };
  const com = { ...sem, frenteEsq: sil(foto(60, 50, 4, diag)), frenteDir: sil(foto(60, 50, 4, diag)) };
  const dim = medidas(sem, "largura", 60);
  const vSem = volume(superficie(esculpir(sem, dim, 100)));
  const vCom = volume(superficie(esculpir(com, dim, 100)));
  const canto = 60 - 30 * Math.SQRT2 * 2 / Math.SQRT2 * Math.SQRT1_2 * 2; // perna do triângulo cortado
  const perna = 60 - 60 / Math.SQRT2;
  const esperado = (3600 - 2 * perna * perna) * 50;
  void canto;
  ok(perto(vSem, 3600 * 50, 0.02), `sem diagonais: prisma ${vSem.toFixed(0)}`);
  ok(perto(vCom, esperado, 0.03), `com diagonais: octógono ${vCom.toFixed(0)} ≈ ${esperado.toFixed(0)}`);
}

// ---- quantidade de faces e STL ----
{
  const ret = (x: number, y: number) => Math.abs(x) <= 30 && y >= 0 && y <= 50;
  const circ = (x: number, y: number) => Math.hypot(x, y - 30) <= 30;
  const v = { frente: sil(foto(60, 50, 6, ret)), esquerda: sil(foto(60, 50, 6, ret)), cima: sil(foto(60, 60, 6, circ)) };
  for (const alvo of [50_000, 500_000]) {
    const t0 = Date.now();
    const r = gerarCasco(v, { eixo: "largura", valor: 60 }, alvo);
    const stl = stlBinario(r.malha);
    const red = simplificarStl(stl, alvo);
    const n = contarTriangulosStl(red.bytes);
    ok(r.malha.tri.length / 3 >= alvo && n <= alvo && n >= alvo * 0.9, `${alvo} faces: grade ${r.N}, ${r.malha.tri.length / 3} → ${n} (${Date.now() - t0} ms)`);
    const mm = malhaDoStl(red.bytes);
    ok(mm.volume !== null && perto(Math.abs(mm.volume), Math.PI * 900 * 50, 0.03), `STL lido de volta: volume ${mm.volume?.toFixed(0)}`);
  }
}

if (falhas) {
  console.error(`${falhas} falha(s) no gerador imagens → 3D`);
  process.exit(1);
}
console.log("gerador imagens → 3D: tudo certo");

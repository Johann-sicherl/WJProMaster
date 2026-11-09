// Testes do motor do WJSlicer3D (src/slicer): fatiamento, material e tempo, em Node.
// Casos com resposta analítica: cubo cheio (100% = volume da peça), tubo (paredes e furo),
// cascas, suporte numa ponte, planejador de velocidade e limites de vazão.
import { estimar, ajustesPadrao, tempoTrapezio, tempoLaco, espacamento, volumeMalha, type MalhaImpressao } from "../src/slicer/fatiar";
import { MAQUINAS, maquinaPorId, materialDa, materiaisDa } from "../src/slicer/perfis";
import { orientarMalha, malhaDeStl, centralizar } from "../src/slicer/malha";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas++;
};
const perto = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/** Caixas (cada uma com 12 triângulos, normais para fora) numa malha só. */
function caixas(lista: [number, number, number, number, number, number][]): MalhaImpressao {
  const pos: number[] = [], tri: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of lista) {
    const b = pos.length / 3;
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) pos.push(x, y, z);
    // vértice i = x + 2y + 4z
    const f = [
      [0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5],
    ];
    for (const [a, bb, c, d] of f) tri.push(b + a, b + bb, b + c, b + a, b + c, b + d);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

/** Tubo quadrado: externo L, furo l, altura H (8 faces laterais, anéis em cima e embaixo). */
function tubo(L: number, l: number, H: number): MalhaImpressao {
  const e = (L - l) / 2;
  // quatro caixas que formam o anel (sem sobreposição; faces internas coincidentes se cancelam no volume
  // mas aqui as caixas só se tocam nas bordas: montamos o anel como 4 caixas separadas por 0)
  return caixas([
    [0, 0, 0, L, e, H],
    [0, L - e, 0, L, L, H],
    [0, e, 0, e, L - e, H],
    [L - e, e, 0, L, L - e, H],
  ]);
}

const x1c = maquinaPorId("bbl-x1c");
const pla = materialDa(x1c, "pla");

// ---------- planejador ----------
ok(perto(tempoTrapezio(100, 100, 100, 100, 1000), 1, 1e-9), "trapézio: velocidade constante → L/v");
ok(perto(tempoTrapezio(100, 0, 0, 100, 1000), 1.1, 1e-9), "trapézio: parte e para → L/v + v/a");
ok(perto(tempoTrapezio(1, 0, 0, 100, 1000), 2 * Math.sqrt(1 / 1000), 1e-9), "triângulo: linha curta não chega à velocidade");
{
  // quadrado de 20 mm: 4 cantos de 90°; com jerk 9 o canto passa a ~6,4 mm/s
  const t = tempoLaco([20, 20, 20, 20], [Math.PI / 2, Math.PI / 2, Math.PI / 2, Math.PI / 2], 4, 200, 5000, 9);
  ok(t > 80 / 200 && t < 80 / 200 + 4 * (200 / 5000) + 0.01, `laço quadrado: ${t.toFixed(3)} s entre o ideal e o com paradas`);
  // círculo: freia menos que o quadrado e menos ainda com mais lados (cantos mais suaves)
  const circulo = (n: number) => tempoLaco(new Array(n).fill((Math.PI * 20) / n), new Array(n).fill((2 * Math.PI) / n), n, 200, 5000, 9);
  const c64 = circulo(64), c512 = circulo(512);
  ok(c512 < c64 && c512 >= (Math.PI * 20) / 200 - 1e-9, `círculo: 64 lados ${c64.toFixed(3)} s > 512 lados ${c512.toFixed(3)} s ≥ sem frear`);
}
ok(perto(espacamento(0.4, 0.2), 0.4 - 0.2 * (1 - Math.PI / 4), 1e-12), "espaçamento entre linhas desconta o arredondamento");

// ---------- cubo de 20 mm ----------
const cubo = caixas([[0, 0, 0, 20, 20, 20]]);
ok(perto(volumeMalha(cubo)!, 8000, 1e-6), "volume do cubo pela malha = 8000 mm³");
{
  const aj = { ...ajustesPadrao(x1c.processo), preenchimento: 1 };
  const r = estimar(cubo, x1c, pla, aj);
  ok(r.camadas === 100, `cubo: 100 camadas de 0,2 mm (${r.camadas})`);
  ok(perto(r.volumeMm3, 8000, 0.03), `cubo 100%: filamento ≈ volume da peça (${r.volumeMm3.toFixed(0)} mm³)`);
  ok(perto(r.massaG, 8 * pla.densidade, 0.03), `cubo 100%: massa ≈ 8 cm³ × densidade (${r.massaG.toFixed(2)} g)`);
}
{
  const aj = ajustesPadrao(x1c.processo);
  const r = estimar(cubo, x1c, pla, aj);
  // conta à mão: paredes 3 voltas, 5 topo + 3 fundo sólidas, resto 15%
  const h = 0.2, sE = espacamento(0.4, h), sI = espacamento(0.45, h);
  const parede = 80 * (sE + 2 * sI); // mm² por camada (aprox.; ignora cantos)
  const interior = 400 - parede;
  const esperado = parede * 20 + interior * 8 * h + interior * 92 * h * 0.15;
  ok(perto(r.volumeMm3, esperado, 0.05), `cubo padrão: ${r.volumeMm3.toFixed(0)} mm³ ≈ conta à mão ${esperado.toFixed(0)} mm³`);
  ok(r.massaG > 3 && r.massaG < 6, `cubo padrão X1 Carbon PLA: ${r.massaG.toFixed(2)} g (faixa típica 3–6 g)`);
  ok(r.tempoS > 5 * 60 && r.tempoS < 25 * 60, `cubo padrão X1 Carbon: ${(r.tempoS / 60).toFixed(1)} min (faixa típica 5–25 min)`);
  ok(r.partes.resfriamento.tempo > 0 && r.tempoS >= 100 * pla.tempoCamada, "cubo de 20 mm: cada camada respeita o tempo mínimo de camada do PLA");
  ok(perto(r.comprimentoM, r.volumeMm3 / (Math.PI * 0.875 ** 2) / 1000, 1e-9), "comprimento do filamento de 1,75 mm");
  ok(r.partes.esparso.volume > 0 && r.partes.solido.volume > 0 && r.partes.topo.volume > 0, "cubo: tem esparso, sólido e topo");
  ok(perto(r.partes.topo.volume, (400 - parede) * h, 0.1), `topo exposto = só a última camada (${r.partes.topo.volume.toFixed(0)} mm³)`);
  ok(r.avisos.length === 0, "cubo cabe na mesa, malha fechada, sem avisos");
  // máquina mais lenta demora mais; mais preenchimento gasta mais
  const neo = maquinaPorId("acu-k2neo");
  const rn = estimar(cubo, neo, materialDa(neo, "pla"), ajustesPadrao(neo.processo));
  ok(rn.tempoS > r.tempoS * 1.5, `Kobra 2 Neo (2000 mm/s², 60 mm/s na parede) mais lenta: ${(rn.tempoS / 60).toFixed(1)} min`);
  const cubo60 = caixas([[0, 0, 0, 60, 60, 60]]);
  const r15 = estimar(cubo60, x1c, pla, aj), r40 = estimar(cubo60, x1c, pla, { ...aj, preenchimento: 0.4 });
  ok(r40.massaG > r15.massaG * 1.5 && r40.tempoS > r15.tempoS * 1.3, `cubo de 60 mm: 40% (${r40.massaG.toFixed(0)} g, ${(r40.tempoS / 60).toFixed(0)} min) gasta mais que 15% (${r15.massaG.toFixed(0)} g, ${(r15.tempoS / 60).toFixed(0)} min)`);
  ok(r15.partes.resfriamento.tempo === 0, "cubo de 60 mm: camadas longas, sem espera para resfriar");
  // camada mais grossa: menos camadas, menos tempo
  const r28 = estimar(cubo, x1c, pla, { ...aj, altura: 0.28 });
  ok(r28.camadas < r.camadas && r28.tempoS < r.tempoS, `camada de 0,28 mm: ${r28.camadas} camadas, mais rápido`);
}
{
  // vazão volumétrica: TPU (3,6 mm³/s) é muito mais lento que PLA (21 mm³/s) na mesma máquina
  const tpu = materialDa(x1c, "tpu");
  const r = estimar(cubo, x1c, pla, ajustesPadrao(x1c.processo));
  const rt = estimar(cubo, x1c, tpu, ajustesPadrao(x1c.processo));
  ok(rt.tempoS > r.tempoS * 2, `TPU limitado pela vazão: ${(rt.tempoS / 60).toFixed(1)} min contra ${(r.tempoS / 60).toFixed(1)} min`);
}
{
  // peça pequena: tempo mínimo de camada (resfriamento) entra
  const mini = caixas([[0, 0, 0, 5, 5, 10]]);
  const r = estimar(mini, x1c, materialDa(maquinaPorId("bbl-a1m"), "pla"), ajustesPadrao(x1c.processo));
  ok(r.partes.resfriamento.tempo > 0, `peça de 5 mm: espera para resfriar (${r.partes.resfriamento.tempo.toFixed(0)} s)`);
}

// ---------- tubo: furo e paredes ----------
{
  const t = tubo(30, 20, 10); // anel de 5 mm de parede
  const vol = 30 * 30 * 10 - 20 * 20 * 10;
  const r = estimar(t, x1c, pla, { ...ajustesPadrao(x1c.processo), preenchimento: 1 });
  ok(perto(r.volumeMm3, vol, 0.05), `tubo 100%: ${r.volumeMm3.toFixed(0)} mm³ ≈ ${vol} mm³ (furo descontado)`);
}

// ---------- suporte: ponte com vão ----------
{
  // dois pilares de 10 × 10 × 10 e um tampo de 40 × 10 × 2 em cima: o vão de 20 mm pede suporte
  const ponte = caixas([
    [0, 0, 0, 10, 10, 10],
    [30, 0, 0, 40, 10, 10],
    [0, 0, 10, 40, 10, 12],
  ]);
  const aj = ajustesPadrao(x1c.processo);
  const sem = estimar(ponte, x1c, pla, aj);
  const com = estimar(ponte, x1c, pla, { ...aj, suporte: true });
  ok(sem.partes.suporte.volume === 0, "sem suporte: nada de suporte");
  // suporte ≈ vão 20 × 10 × 10 mm × densidade (~14% corpo + interface)
  const v = com.partes.suporte.volume;
  ok(v > 200 && v < 900, `com suporte: ${v.toFixed(0)} mm³ sob o vão de 20 × 10 × 10 mm`);
  ok(com.tempoS > sem.tempoS, "com suporte demora mais");
  const cuboSup = estimar(cubo, x1c, pla, { ...aj, suporte: true });
  ok(cuboSup.partes.suporte.volume === 0, "cubo não pede suporte");
}

// ---------- borda e avisos ----------
{
  const aj = ajustesPadrao(x1c.processo);
  const r = estimar(cubo, x1c, pla, { ...aj, borda: true });
  ok(r.partes.borda.volume > 0, `borda de 5 mm: ${r.partes.borda.volume.toFixed(0)} mm³`);
  const grande = caixas([[0, 0, 0, 200, 200, 2]]);
  const ra = estimar(grande, maquinaPorId("bbl-a1m"), pla, aj);
  ok(ra.avisos.some((a) => a.includes("não cabe")), "peça de 200 mm não cabe na A1 mini (180 mm): aviso");
}

// ---------- malha: STL, orientação e centralização ----------
{
  // STL binário do cubo
  const c = caixas([[0, 0, 0, 20, 10, 5]]);
  const nt = c.tri.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = c.tri[t * 3 + k];
      for (let e = 0; e < 3; e++) dv.setFloat32(84 + t * 50 + 12 + k * 12 + e * 4, c.pos[v * 3 + e], true);
    }
  }
  const m = malhaDeStl(new Uint8Array(buf));
  ok(perto(volumeMalha(m)!, 1000, 1e-4), "STL binário lido e soldado: volume 1000 mm³");
  // Y para cima → Z para cima: a altura vira a profundidade
  const girada = orientarMalha(m, "x", 1);
  const { max, min } = (() => {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < girada.pos.length; i += 3) for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], girada.pos[i + k]);
      mx[k] = Math.max(mx[k], girada.pos[i + k]);
    }
    return { min: mn, max: mx };
  })();
  ok(perto(max[2] - min[2], 10, 1e-6) && perto(max[1] - min[1], 5, 1e-6), "girar 90° em X troca Y e Z");
  ok(perto(volumeMalha(girada)!, 1000, 1e-4), "girar mantém o volume (malha continua para fora)");
  const ct = centralizar(girada);
  let zmin = Infinity;
  for (let i = 2; i < ct.pos.length; i += 3) zmin = Math.min(zmin, ct.pos[i]);
  ok(Math.abs(zmin) < 1e-6, "centralizar apoia a peça na mesa (Z mínimo = 0)");
  const r = estimar(ct, x1c, pla, ajustesPadrao(x1c.processo));
  ok(r.camadas === 50, `peça deitada com 10 mm de altura: 50 camadas (${r.camadas})`);
}

// ---------- perfis ----------
ok(MAQUINAS.length >= 10 && MAQUINAS.some((m) => m.marca === "Bambu Lab") && MAQUINAS.some((m) => m.marca === "Anycubic"), `perfis: ${MAQUINAS.length} impressoras das duas marcas`);
ok(MAQUINAS.every((m) => materiaisDa(m).some((x) => x.id === "pla")), "toda impressora oferece PLA");
ok(MAQUINAS.every((m) => m.processo.altura === 0.2 && m.jerk > 0 && m.aMax > 0), "processos de 0,20 mm com limites da máquina");

console.log(falhas ? `\n${falhas} falha(s)` : "\nWJSlicer3D: tudo certo");
if (falhas) process.exit(1);

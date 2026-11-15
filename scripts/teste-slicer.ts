// Testes do motor do WJSlicer3D (src/slicer): campo de distância e contornos, planejador, fatiamento
// real (paredes, preenchimentos, cascas, pontes, suporte normal e em árvore, borda, saia), várias peças
// na mesa, perfis e leitura de STL. Casos de referência (cubo, cilindro, peça com balanço) conferidos
// contra os valores medidos pelo Johann quando existirem (tabela REFERENCIAS: ±5 %).
import { campoDistancia, contornos, rasterizar, recortar, comprimento, type Grade } from "../src/slicer/campo";
import { estimar, fatiarPlaca, ajustesPadrao, espacamento, volumeMalha, tempoTrapezio, velJuncao, PARTES, type MalhaImpressao, type Ajustes } from "../src/slicer/fatiar";
import { Planejador } from "../src/slicer/planejador";
import { MAQUINAS, maquinaPorId, materialDa, materiaisDa, type Padrao } from "../src/slicer/perfis";
import { orientarMalha, malhaDeStl, centralizar, organizar } from "../src/slicer/malha";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas++;
};
const perto = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const min = (s: number) => (s / 60).toFixed(1);

/** Caixas (12 triângulos cada, normais para fora) numa malha só. */
function caixas(lista: [number, number, number, number, number, number][]): MalhaImpressao {
  const pos: number[] = [], tri: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of lista) {
    const b = pos.length / 3;
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) pos.push(x, y, z);
    for (const [a, bb, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tri.push(b + a, b + bb, b + c, b + a, b + c, b + d);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

/** Cilindro de raio R e altura H com `n` lados, centrado em X = Y = 0. */
function cilindro(R: number, H: number, n = 128): MalhaImpressao {
  const pos: number[] = [0, 0, 0, 0, 0, H];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    pos.push(R * Math.cos(a), R * Math.sin(a), 0, R * Math.cos(a), R * Math.sin(a), H);
  }
  const tri: number[] = [];
  for (let k = 0; k < n; k++) {
    const b0 = 2 + 2 * k, t0 = b0 + 1, b1 = 2 + 2 * ((k + 1) % n), t1 = b1 + 1;
    tri.push(0, b1, b0, 1, t0, t1, b0, b1, t1, b0, t1, t0);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

const p1s = maquinaPorId("bbl-p1s"), k3 = maquinaPorId("acu-k3");
const plaP = materialDa(p1s, "pla"), plaK = materialDa(k3, "pla");

// ---------- campo de distância e contornos ----------
{
  const g: Grade = { x0: -2, y0: -2, c: 0.1, cols: 241, lins: 241 };
  const quad = Float64Array.from([0, 0, 20, 0, 20, 0, 20, 20, 20, 20, 0, 20, 0, 20, 0, 0]);
  const dentro = rasterizar(quad, 4, g);
  const f = campoDistancia(quad, 4, dentro, g);
  for (const d of [0.2, 1, 3]) {
    const ls = contornos(f, g, d);
    const L = ls.reduce((s, l) => s + comprimento(l.pts, true), 0);
    ok(ls.length === 1 && perto(L, 4 * (20 - 2 * d), 0.003) && ls[0].area > 0, `quadrado de 20 mm deslocado ${d} mm para dentro: ${L.toFixed(2)} mm (esperado ${4 * (20 - 2 * d)})`);
  }
  const fora = contornos(f, g, -1);
  const Lf = comprimento(fora[0].pts, true);
  ok(fora.length === 1 && perto(Lf, 80 + 2 * Math.PI, 0.01), `para fora 1 mm (borda): ${Lf.toFixed(2)} mm ≈ 80 + 2π`);
  const linhas: number[][] = [];
  recortar([-5, 10, 25, 10], g, f, 0.5, null, 0, linhas);
  ok(linhas.length === 1 && perto(comprimento(linhas[0], false), 19, 0.005), "linha recortada pela região deslocada 0,5 mm: 19 mm");
  // anel: contorno externo anti-horário, furo horário
  const n = 256, seg: number[] = [];
  for (const [R, s] of [[9, 1], [5, -1]] as const)
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n, b = (2 * Math.PI * (k + s)) / n;
      seg.push(10 + R * Math.cos(a), 10 + R * Math.sin(a), 10 + R * Math.cos(b), 10 + R * Math.sin(b));
    }
  const sa = Float64Array.from(seg);
  const fa = campoDistancia(sa, sa.length / 4, rasterizar(sa, sa.length / 4, g), g);
  const la = contornos(fa, g, 0.5);
  const ext = la.find((l) => l.area > 0), furo = la.find((l) => l.area < 0);
  ok(la.length === 2 && !!ext && !!furo, "anel: um contorno externo e um furo");
  ok(!!ext && perto(comprimento(ext.pts, true), 2 * Math.PI * 8.5, 0.01) && !!furo && perto(comprimento(furo.pts, true), 2 * Math.PI * 5.5, 0.01), "anel: raios 8,5 e 5,5 mm depois de deslocar 0,5 mm");
}

// ---------- planejador ----------
ok(perto(tempoTrapezio(100, 100, 100, 100, 1000), 1, 1e-9), "trapézio: velocidade constante → L/v");
ok(perto(tempoTrapezio(100, 0, 0, 100, 1000), 1.1, 1e-9), "trapézio: parte e para → L/v + v/a");
ok(perto(tempoTrapezio(1, 0, 0, 100, 1000), 2 * Math.sqrt(1 / 1000), 1e-9), "triângulo: linha curta não chega à velocidade");
ok(perto(velJuncao(1, 0, 0, 1, 9), 9, 1e-9) && velJuncao(1, 0, 1, 0, 9) === Infinity, "junção: canto de 90° passa no jerk; reta não limita");
{
  const quadrado = (lado: number, v: number, a: number, j: number) => {
    const pl = new Planejador({ aMax: 20000, vMax: 500, jerk: j, aceleraDesacelera: 0 });
    pl.posicionar(0, 0);
    for (const [x, y] of [[lado, 0], [lado, lado], [0, lado], [0, 0]]) pl.mover(x, y, v, a, 0, "paredeExt", 0);
    return pl.fecharCamada(0, 0);
  };
  const t = quadrado(20, 200, 5000, 9);
  ok(t > 80 / 200 && t < 80 / 200 + 4 * (2 * 200 / 5000), `quadrado de 20 mm a 200 mm/s: ${t.toFixed(3)} s entre o ideal e com paradas`);
  ok(quadrado(20, 200, 5000, 20) < t, "jerk maior (Kobra 3): cantos mais rápidos");
  const pl = new Planejador({ aMax: 20000, vMax: 500, jerk: 9, aceleraDesacelera: 0 });
  pl.posicionar(0, 0);
  pl.mover(10, 0, 100, 5000, 0, "paredeExt", 1);
  const tc = pl.fecharCamada(8, 20);
  ok(tc > 0.5 && tc < 0.65, `tempo mínimo de camada: 10 mm desacelerados até 20 mm/s (5×, rampas inclusas) → ${tc.toFixed(2)} s, sem espera parada até 8 s`);
}
ok(perto(espacamento(0.4, 0.2), 0.4 - 0.2 * (1 - Math.PI / 4), 1e-12), "espaçamento entre linhas desconta o arredondamento");

// ---------- cubo de 20 mm ----------
const cubo = caixas([[0, 0, 0, 20, 20, 20]]);
ok(perto(volumeMalha(cubo)!, 8000, 1e-6), "volume do cubo pela malha = 8000 mm³");
const resultados: Record<string, { t: number; g: number }> = {};
{
  const aj = ajustesPadrao(p1s.processo);
  const r = estimar(cubo, p1s, plaP, aj);
  resultados["cubo P1S"] = { t: r.tempoS, g: r.massaG };
  ok(r.camadas === 100, `cubo: 100 camadas de 0,2 mm (${r.camadas})`);
  const r100 = estimar(cubo, p1s, plaP, { ...aj, preenchimento: 1 });
  ok(perto(r100.volumeMm3, 8000 * plaP.fluxo, 0.05), `cubo 100%: filamento ${r100.volumeMm3.toFixed(0)} mm³ ≈ volume × fluxo ${(8000 * plaP.fluxo).toFixed(0)} mm³`);
  // conta à mão: 2 paredes, 5 topo + 3 fundo sólidas, 15% no resto (sem as âncoras)
  const h = 0.2, sE = espacamento(0.42, h), sI = espacamento(0.45, h);
  const parede = 80 * (sE + sI);
  const interior = (20 - 2 * (sE + sI)) ** 2;
  const esperado = (parede * 100 * h + interior * 8 * h + interior * 92 * h * 0.15) * plaP.fluxo;
  ok(r.volumeMm3 > esperado * 0.97 && r.volumeMm3 < esperado * 1.25, `cubo padrão: ${r.volumeMm3.toFixed(0)} mm³ (conta à mão sem âncoras ${esperado.toFixed(0)} mm³)`);
  ok(r.partes.paredeExt.volume > 0 && r.partes.paredeInt.volume > 0 && r.partes.esparso.volume > 0 && r.partes.solido.volume > 0 && r.partes.topo.volume > 0, "cubo: paredes, esparso, sólido e topo");
  ok(perto(r.partes.paredeExt.volume, 100 * 4 * (20 - sE) * sE * h * plaP.fluxo, 0.03), `parede externa: ${r.partes.paredeExt.volume.toFixed(0)} mm³ (laço de ${(4 * (20 - sE)).toFixed(1)} mm × 100 camadas)`);
  ok(r.tempoS > 5 * 60 && r.tempoS < 20 * 60, `cubo padrão P1S: ${min(r.tempoS)} min, ${r.massaG.toFixed(2)} g`);
  ok(r.partes.resfriamento.tempo > 0, "cubo de 20 mm na P1S: camadas curtas desaceleram para resfriar (4 s por camada)");
  ok(perto(r.comprimentoM, r.volumeMm3 / (Math.PI * 0.875 ** 2) / 1000, 1e-9), "comprimento do filamento de 1,75 mm");
  ok(r.avisos.length === 0, "cubo cabe na mesa, malha fechada, sem avisos");
  const rk = estimar(cubo, k3, plaK, ajustesPadrao(k3.processo));
  resultados["cubo Kobra 3"] = { t: rk.tempoS, g: rk.massaG };
  ok(rk.tempoS > r.tempoS, `Kobra 3 (PLA com 8 s de camada mínima, paredes a 130 mm/s): ${min(rk.tempoS)} min > P1S ${min(r.tempoS)} min`);
  const r28 = estimar(cubo, p1s, plaP, { ...aj, altura: 0.28 });
  ok(r28.camadas < r.camadas && r28.tempoS < r.tempoS, `camada de 0,28 mm: ${r28.camadas} camadas, mais rápido`);
  const cubo60 = caixas([[0, 0, 0, 60, 60, 30]]);
  const r15 = estimar(cubo60, p1s, plaP, aj), r40 = estimar(cubo60, p1s, plaP, { ...aj, preenchimento: 0.4 });
  ok(r40.massaG > r15.massaG * 1.4 && r40.tempoS > r15.tempoS * 1.2, `bloco 60 × 60 × 30: 40% (${r40.massaG.toFixed(0)} g, ${min(r40.tempoS)} min) > 15% (${r15.massaG.toFixed(0)} g, ${min(r15.tempoS)} min)`);
  ok(r15.partes.resfriamento.tempo === 0, "bloco de 60 mm: camadas longas, sem desacelerar para resfriar");
  const rt = estimar(cubo60, p1s, materialDa(p1s, "tpu"), aj);
  ok(rt.tempoS > r15.tempoS * 2, `TPU limitado pela vazão (3,2 mm³/s): ${min(rt.tempoS)} min contra ${min(r15.tempoS)} min`);
}

// ---------- padrões de preenchimento: densidade e tempo próprios ----------
{
  const bloco = caixas([[0, 0, 0, 40, 40, 10]]);
  const aj0: Ajustes = { ...ajustesPadrao(p1s.processo), topo: 0, fundo: 0, paredes: 1 };
  const sp = espacamento(0.45, 0.2);
  const area = (40 - 2 * espacamento(0.42, 0.2)) ** 2;
  const linhas: string[] = [];
  for (const padrao of ["linhas", "grade", "cruzado", "triangulos", "cubico", "giroide", "favo"] as Padrao[]) {
    const r = estimar(bloco, p1s, plaP, { ...aj0, padrao, preenchimento: 0.2 });
    const esperado = area * 0.2 * (10 - 0.2) * plaP.fluxo;
    const v = r.partes.esparso.volume;
    linhas.push(`${padrao} ${v.toFixed(0)} mm³ ${min(r.partes.esparso.tempo)} min`);
    ok(v > esperado * 0.9 && v < esperado * 1.35, `padrão ${padrao}: esparso ${v.toFixed(0)} mm³ ≈ 20% da área (${esperado.toFixed(0)} mm³ sem âncoras), ${min(r.partes.esparso.tempo)} min`);
  }
  void sp;
  void linhas;
}

// ---------- cilindro Ø20 × 20 ----------
{
  const cil = cilindro(10, 20);
  const r = estimar(cil, p1s, plaP, ajustesPadrao(p1s.processo));
  resultados["cilindro P1S"] = { t: r.tempoS, g: r.massaG };
  const r100 = estimar(cil, p1s, plaP, { ...ajustesPadrao(p1s.processo), preenchimento: 1 });
  const vol = volumeMalha(cil)!;
  ok(perto(r100.volumeMm3, vol * plaP.fluxo, 0.05), `cilindro 100%: ${r100.volumeMm3.toFixed(0)} mm³ ≈ ${(vol * plaP.fluxo).toFixed(0)} mm³`);
  ok(r.massaG < 0.9 * estimar(cubo, p1s, plaP, ajustesPadrao(p1s.processo)).massaG, `cilindro (${r.massaG.toFixed(2)} g) gasta menos que o cubo que o envolve`);
  const rk = estimar(cil, k3, plaK, ajustesPadrao(k3.processo));
  resultados["cilindro Kobra 3"] = { t: rk.tempoS, g: rk.massaG };
}

// ---------- peça com balanço: suporte normal e em árvore, pontes, paredes em balanço ----------
{
  // coluna 10 × 10 × 20 com tampo 30 × 10 × 3 em cima (10 mm de balanço de cada lado)
  const T = caixas([[10, 0, 0, 20, 10, 20], [0, 0, 20, 30, 10, 23]]);
  const aj = ajustesPadrao(p1s.processo);
  const sem = estimar(T, p1s, plaP, aj);
  resultados["balanço P1S"] = { t: sem.tempoS, g: sem.massaG };
  ok(sem.partes.suporte.volume === 0 && sem.partes.ponte.volume > 0, `sem suporte: nada de suporte, ponte no balanço (${sem.partes.ponte.volume.toFixed(0)} mm³)`);
  const normal = estimar(T, p1s, plaP, { ...aj, suporte: "normal" });
  const arvore = estimar(T, p1s, plaP, { ...aj, suporte: "arvore" });
  const vn = normal.partes.suporte.volume + normal.partes.interface.volume, va = arvore.partes.suporte.volume + arvore.partes.interface.volume;
  ok(vn > 100 && vn < 1200, `suporte normal sob 2 × (10 × 10 × 20): ${vn.toFixed(0)} mm³, ${min(normal.partes.suporte.tempo + normal.partes.interface.tempo)} min`);
  ok(normal.partes.interface.volume > 0, "suporte normal: interface densa logo abaixo do contato");
  ok(va > 20 && va < vn * 1.5, `suporte em árvore: ${va.toFixed(0)} mm³, ${min(arvore.partes.suporte.tempo + arvore.partes.interface.tempo)} min`);
  ok(normal.tempoS > sem.tempoS && arvore.tempoS > sem.tempoS, "com suporte demora mais");
  ok(normal.partes.ponte.volume < sem.partes.ponte.volume + 1, "com suporte o balanço não é mais tratado como ponte só se houver apoio (ponte ≤ sem suporte)");
  ok(estimar(cubo, p1s, plaP, { ...aj, suporte: "normal" }).partes.suporte.volume === 0, "cubo não pede suporte");
  ok(estimar(cubo, p1s, plaP, { ...aj, suporte: "arvore" }).partes.suporte.volume === 0, "cubo não pede árvore");
  // Kobra 3: suporte só na mesa e ângulo de 40°
  const rk = estimar(T, k3, plaK, { ...ajustesPadrao(k3.processo), suporte: "normal" });
  ok(rk.partes.suporte.volume + rk.partes.interface.volume > 0, "Kobra 3: suporte normal até a mesa");
  // rampa a 60° da horizontal não pede suporte (limite 30°); paredes em balanço desaceleram
  const pos: number[] = [], tri: number[] = [];
  const rampa = (x0: number, inc: number) => {
    // prisma com a face direita inclinada: base 10 mm, topo deslocado `inc` mm
    const v = [[x0, 0, 0], [x0 + 10, 0, 0], [x0 + 10 + inc, 0, 10], [x0, 0, 10], [x0, 10, 0], [x0 + 10, 10, 0], [x0 + 10 + inc, 10, 10], [x0, 10, 10]];
    const b = pos.length / 3;
    for (const p of v) pos.push(...p);
    for (const [a, bb, c, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) tri.push(b + a, b + bb, b + c, b + a, b + c, b + d);
  };
  rampa(0, 10 / Math.tan((60 * Math.PI) / 180));
  const m60 = { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
  ok(perto(volumeMalha(m60)!, 10 * 10 * (10 + 10 / Math.tan(Math.PI / 3) / 2), 1e-4), "rampa a 60°: malha fechada");
  ok(estimar(m60, p1s, plaP, { ...aj, suporte: "normal" }).partes.suporte.volume === 0, "rampa a 60° não pede suporte (limite 30° na P1S)");
}

// ---------- várias peças na mesa ----------
{
  const peca = centralizar(cubo);
  const um = fatiarPlaca([{ nome: "Cubo", malha: peca, posicoes: [[0, 0]] }], p1s, plaP, ajustesPadrao(p1s.processo)).r;
  const pos = organizar([{ malha: peca, copias: 4 }], p1s.mesa, 6)[0];
  ok(pos.length === 4 && pos.every(([x, y]) => Math.abs(x) + 10 <= 128 && Math.abs(y) + 10 <= 128), `organizar: 4 cópias dentro da mesa (${pos.map((p) => p.map((v) => v.toFixed(0)).join(";")).join(" | ")})`);
  const quatro = fatiarPlaca([{ nome: "Cubo", malha: peca, posicoes: pos }], p1s, plaP, ajustesPadrao(p1s.processo));
  ok(perto(quatro.r.massaG, 4 * um.massaG, 0.01), `4 cópias: ${quatro.r.massaG.toFixed(1)} g = 4 × ${um.massaG.toFixed(2)} g`);
  ok(quatro.r.tempoS < 4 * um.tempoS && quatro.r.tempoS > 2.5 * um.tempoS, `4 cópias: ${min(quatro.r.tempoS)} min (< 4 × ${min(um.tempoS)}: camadas maiores não esperam para resfriar)`);
  ok(quatro.r.copias === 4 && quatro.previa.seg.length === quatro.r.camadas, "prévia: uma lista de caminhos por camada");
  ok(quatro.previa.seg[50].length / 4 === quatro.previa.parte[50].length && quatro.previa.parte[50].length > 0, "prévia: segmentos e parte de cada um");
  const duas = fatiarPlaca([{ nome: "Cubo", malha: peca, posicoes: [[0, 0]] }, { nome: "Cilindro", malha: centralizar(cilindro(10, 12)), posicoes: [[40, 0]] }], p1s, plaP, ajustesPadrao(p1s.processo)).r;
  ok(duas.camadas === 100 && duas.massaG > um.massaG, "peças de alturas diferentes: camadas até a mais alta");
  const fora = fatiarPlaca([{ nome: "Cubo", malha: peca, posicoes: [[125, 0]] }], p1s, plaP, ajustesPadrao(p1s.processo)).r;
  ok(fora.avisos.some((a) => a.includes("borda da mesa")), "peça fora da mesa: aviso");
  const grande = fatiarPlaca([{ nome: "Placa", malha: centralizar(caixas([[0, 0, 0, 300, 20, 2]])), posicoes: [[0, 0]] }], p1s, plaP, ajustesPadrao(p1s.processo)).r;
  ok(grande.avisos.some((a) => a.includes("não cabe")), "peça de 300 mm não cabe na mesa de 256 mm: aviso");
}

// ---------- borda e saia ----------
{
  const aj = ajustesPadrao(p1s.processo);
  const peca = centralizar(cubo);
  const r = estimar(peca, p1s, plaP, { ...aj, borda: true });
  const sB = espacamento(0.5, 0.2), voltas = Math.ceil(5 / sB);
  const esperado = voltas * (80 + 2 * Math.PI * (0.1 + (voltas * sB) / 2)) * sB * 0.2 * plaP.fluxo;
  ok(perto(r.partes.borda.volume, esperado, 0.08), `borda de 5 mm: ${r.partes.borda.volume.toFixed(0)} mm³ ≈ ${esperado.toFixed(0)} mm³`);
  const s = estimar(peca, p1s, plaP, { ...aj, saia: true });
  const Ls = 80 + 2 * Math.PI * (2 + sB / 2 + espacamento(0.5, 0.2) / 2);
  ok(perto(s.partes.borda.volume, Ls * sB * 0.2 * plaP.fluxo, 0.08), `saia a 2 mm: ${s.partes.borda.volume.toFixed(1)} mm³ (uma volta de ~${Ls.toFixed(0)} mm)`);
}

// ---------- referências medidas pelo Johann (fatiador de referência, mesmas configurações) ----------
// Preencher com os valores que ele mandar: tempo em minutos e massa em gramas (perfil padrão, PLA, sem suporte).
const REFERENCIAS: Record<string, { min: number | null; g: number | null }> = {
  "cubo P1S": { min: null, g: null },
  "cubo Kobra 3": { min: null, g: null },
  "cilindro P1S": { min: null, g: null },
  "cilindro Kobra 3": { min: null, g: null },
  "balanço P1S": { min: null, g: null },
};
const faltam: string[] = [];
for (const [caso, ref] of Object.entries(REFERENCIAS)) {
  const r = resultados[caso];
  console.log(`  ${caso}: estimado ${min(r.t)} min, ${r.g.toFixed(2)} g`);
  if (ref.min === null || ref.g === null) {
    faltam.push(caso);
    continue;
  }
  ok(perto(r.t / 60, ref.min, 0.05), `${caso}: tempo ${min(r.t)} min dentro de ±5% de ${ref.min} min`);
  ok(perto(r.g, ref.g, 0.05), `${caso}: massa ${r.g.toFixed(2)} g dentro de ±5% de ${ref.g} g`);
}
if (faltam.length) console.log(`  (pendente: valores de referência medidos pelo Johann para ${faltam.join(", ")})`);

// ---------- malha: STL, orientação e centralização ----------
{
  const c = caixas([[0, 0, 0, 20, 10, 5]]);
  const nt = c.tri.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const v = c.tri[t * 3 + k];
      for (let e = 0; e < 3; e++) dv.setFloat32(84 + t * 50 + 12 + k * 12 + e * 4, c.pos[v * 3 + e], true);
    }
  const m = malhaDeStl(new Uint8Array(buf));
  ok(perto(volumeMalha(m)!, 1000, 1e-4), "STL binário lido e soldado: volume 1000 mm³");
  const girada = centralizar(orientarMalha(m, "x", 1));
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < girada.pos.length; i += 3) {
    zmin = Math.min(zmin, girada.pos[i]);
    zmax = Math.max(zmax, girada.pos[i]);
  }
  ok(Math.abs(zmin) < 1e-6 && perto(zmax, 10, 1e-6) && perto(volumeMalha(girada)!, 1000, 1e-4), "girar 90° em X e apoiar: 10 mm de altura, volume mantido");
  ok(estimar(girada, p1s, plaP, ajustesPadrao(p1s.processo)).camadas === 50, "peça deitada com 10 mm de altura: 50 camadas");
}

// ---------- perfis ----------
ok(MAQUINAS.length === 2 && MAQUINAS.map((m) => m.modelo).join() === "P1S,Kobra 3", "perfis: só P1S e Kobra 3");
ok(MAQUINAS.every((m) => m.processo.altura === 0.2 && m.processo.alturaPrimeira === 0.2 && m.jerk > 0 && m.aMax > 0), "processos de 0,20 mm (bico 0,4) com limites da máquina");
ok(MAQUINAS.every((m) => materiaisDa(m).length === 6 && materiaisDa(m).every((x) => x.vazaoMax > 0 && x.densidade > 1 && x.fluxo > 0.9)), "seis materiais por máquina com densidade, fluxo e vazão");
ok(PARTES.length === 11, "tempo por tipo de caminho: 11 partes");

{
  // desempenho: esfera facetada de 40 mm (≈ 20 mil triângulos)
  const nU = 100, nV = 50, R = 20, pos: number[] = [], tri: number[] = [];
  for (let j = 0; j <= nV; j++)
    for (let i = 0; i < nU; i++) {
      const v = (Math.PI * j) / nV, u = (2 * Math.PI * i) / nU;
      pos.push(R * Math.sin(v) * Math.cos(u), R * Math.sin(v) * Math.sin(u), R - R * Math.cos(v));
    }
  for (let j = 0; j < nV; j++)
    for (let i = 0; i < nU; i++) {
      const a = j * nU + i, b = j * nU + ((i + 1) % nU), c = a + nU, d = b + nU;
      tri.push(a, c, b, b, c, d);
    }
  const esfera = { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
  const t0 = performance.now();
  const r = estimar(esfera, p1s, plaP, { ...ajustesPadrao(p1s.processo), suporte: "arvore" });
  const ms = performance.now() - t0;
  console.log(`  esfera Ø40 com árvore: ${min(r.tempoS)} min, ${r.massaG.toFixed(1)} g, fatiada em ${(ms / 1000).toFixed(1)} s`);
  ok(ms < 30000, "esfera de 40 mm fatiada em menos de 30 s no Node");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nWJSlicer3D: tudo certo");
if (falhas) process.exit(1);

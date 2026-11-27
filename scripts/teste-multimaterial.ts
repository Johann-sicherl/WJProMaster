// Testes da fatia X1 do WJSlicer3D (multimaterial, src/slicer/fatiar.ts): filamento por função (parede, sólido interno,
// suporte, interface), torre de purga completa (borda, posição, giro, volume de purga, linhas, alargamento) e purga
// aproveitada no preenchimento, nos objetos e no suporte. Com os padrões novos o resultado é IDÊNTICO ao de antes da X1
// (linha de base gravada abaixo, tirada do código anterior). Contas de troca e de material conferidas à mão.
import { fatiarPlaca, ajustesPadrao, espacamento, PARTES, type MalhaImpressao, type Ajustes, type Previa } from "../src/slicer/fatiar";
import { maquinaPorId, materialDa, MULTIMATERIAL_PADRAO, type Maquina, type Processo } from "../src/slicer/perfis";
import { filamentosPadrao, topologia } from "../src/slicer/cores";
import { campoDe } from "../src/slicer/esquema";
import { resolver } from "../src/slicer/camadas";
import { desempacotar, empacotar } from "../src/slicer/projeto";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas++;
};
const perto = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/** Linha de base (código anterior à X1): tempo, volume, massa, custo, trocas, camadas com troca, máx./camada, purga, tempo das trocas, camadas/volume/tempo da torre e volume de cada cor. */
const BASE: Record<string, number[]> = {"bbl-p1s:sem":[448.488212437,2832.92725669,3.56948834343,0.428338601212,0,0,0,0,0,0,0,0,2832.92725669,0,0,0],"bbl-p1s:2cores":[621.334626323,3649.46364287,4.59832419001,0.551798902801,1,1,1,280,66.1111111111,51,536.536386174,108.356839466,1626.69390519,2022.76973767,0,0],"bbl-p1s:4cores":[800.047634252,4465.35336552,5.62634524055,0.675161428866,3,3,1,840,198.333333333,76,792.426108825,158.087496871,965.018114875,1069.62065164,1069.62065164,1361.09394735],"bbl-p1s:topo":[1012.60342272,5271.00749926,6.64146944907,0.796976333888,5,5,1,1400,330.555555556,100,1038.08024257,205.82892798,3613.13083467,1657.87666459,0,0],"bbl-p1s:fundo":[744.261386378,4008.39096428,5.050572615,0.6060687138,4,4,1,1120,264.444444444,4,55.4637075918,14.863203544,3239.65287038,0,768.738093905,0],"bbl-p1s:laterais":[20613.6725995,87871.0074993,110.717469449,13.2860963339,300,100,3,84000,19833.3333333,100,1038.08024257,205.82892798,29106.3286078,28836.2168931,15155.0831697,14773.3788286],"acu-k3:sem":[839.608084185,2881.99543068,3.57367433404,0.428840920085,0,0,0,0,0,0,0,0,2881.99543068,0,0,0],"acu-k3:2cores":[1051.952656,3657.58209469,4.53540179741,0.544248215689,1,1,1,250,81.25,51,525.586664007,135.86713565,1648.56948007,2009.01261462,0,0],"acu-k3:4cores":[1267.95469357,4408.2495781,5.46622947684,0.655947537221,3,3,1,750,243.75,76,776.25414742,198.914300889,970.349511064,1053.55371071,1053.55371071,1330.79264561],"acu-k3:topo":[1530.08436141,5148.89036217,6.3846240491,0.766154885892,5,5,1,1250,406.25,100,1016.8949315,259.439579518,3599.46164023,1549.42872194,0,0],"acu-k3:fundo":[1191.99202739,3936.32722587,4.88104576008,0.58572549121,4,4,1,1000,325,4,54.331795192,17.3384650013,3231.84909307,0,704.478132805,0],"acu-k3:laterais":[25262.8579079,78898.8903622,97.8346240491,11.7401548859,300,100,3,75000,24375,100,1016.8949315,259.439579518,26068.3852319,25851.4153416,13642.1079051,13336.9818836]};
const BASE_T: Record<string, number[]> = {"bbl-p1s:T-normal:sem":[506.566250267,1984.37313339,2.50031014807,0.300037217769,0,0,0,0,0,0,0,0,1984.37313339,0,0,0],"bbl-p1s:T-normal:pint":[925.390540769,3893.16014268,4.90538177977,0.588645813573,3,3,1,840,198.333333333,103,1068.78700929,211.796606869,2283.75335599,1609.40678669,0,0],"bbl-p1s:T-arvore:sem":[533.677648315,1804.92011322,2.27419934265,0.272903921118,0,0,0,0,0,0,0,0,1804.92011322,0,0,0],"bbl-p1s:T-arvore:pint":[952.501938817,3713.7071225,4.67927097435,0.561512516922,3,3,1,840,198.333333333,103,1068.78700929,211.796606869,2104.30033581,1609.40678669,0,0],"acu-k3:T-normal:sem":[950.429686799,3664.64875372,4.54416445461,0.545299734553,0,0,0,0,0,0,0,0,3664.64875372,0,0,0],"acu-k3:T-normal:pint":[1467.29502801,5461.62378322,6.7724134912,0.812689618944,3,3,1,750,243.75,103,1046.97502951,267.005239347,3931.66514024,1529.95864298,0,0],"acu-k3:T-arvore:sem":[952.116635162,2235.30736455,2.77178113204,0.332613735845,0,0,0,0,0,0,0,0,2235.30736455,0,0,0],"acu-k3:T-arvore:pint":[1468.98197638,4032.28239406,5.00003016863,0.600003620235,3,3,1,750,243.75,103,1046.97502951,267.005239347,2502.32375107,1529.95864298,0,0]};

/** Cubo de lado L com d × d quadrados por face (malha soldada). */
function cuboDiv(L: number, d: number): MalhaImpressao {
  const pos: number[] = [], tri: number[] = [], idx = new Map<string, number>();
  const v = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    let i = idx.get(k);
    if (i === undefined) {
      i = pos.length / 3;
      idx.set(k, i);
      pos.push((x * L) / d, (y * L) / d, (z * L) / d);
    }
    return i;
  };
  const face = (f: (a: number, b: number) => [number, number, number], inv: boolean) => {
    for (let a = 0; a < d; a++)
      for (let b = 0; b < d; b++) {
        const p0 = v(...f(a, b)), p1 = v(...f(a + 1, b)), p2 = v(...f(a + 1, b + 1)), p3 = v(...f(a, b + 1));
        if (inv) tri.push(p0, p2, p1, p0, p3, p2);
        else tri.push(p0, p1, p2, p0, p2, p3);
      }
  };
  face((a, b) => [a, b, 0], true);
  face((a, b) => [a, b, d], false);
  face((a, b) => [a, 0, b], false);
  face((a, b) => [a, d, b], true);
  face((a, b) => [0, a, b], true);
  face((a, b) => [d, a, b], false);
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}
/** Caixas (12 triângulos cada) numa malha só. */
function caixas(lista: [number, number, number, number, number, number][]): MalhaImpressao {
  const pos: number[] = [], tri: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of lista) {
    const b = pos.length / 3;
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) pos.push(x, y, z);
    for (const [a, bb, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tri.push(b + a, b + bb, b + c, b + a, b + c, b + d);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

const p1s = maquinaPorId("bbl-p1s"), k3 = maquinaPorId("acu-k3");
const m = cuboDiv(20, 20), top = topologia(m), nTri = m.tri.length / 3;
const faixa = (c: number[]) => {
  const r = new Uint8Array(nTri);
  for (let t = 0; t < nTri; t++) r[t] = c.filter((x) => top.centro[t * 3 + 2] > x).length;
  return r;
};
const lados = new Uint8Array(nTri);
for (let t = 0; t < nTri; t++) {
  const nx = top.normal[t * 3], ny = top.normal[t * 3 + 1];
  lados[t] = nx > 0.9 ? 0 : ny > 0.9 ? 1 : nx < -0.9 ? 2 : ny < -0.9 ? 3 : 0;
}
const soTopo = new Uint8Array(nTri), soFundo = new Uint8Array(nTri);
for (let t = 0; t < nTri; t++) {
  if (top.normal[t * 3 + 2] > 0.99) soTopo[t] = 1;
  if (top.normal[t * 3 + 2] < -0.99) soFundo[t] = 2;
}
const T = caixas([[10, 0, 0, 20, 10, 20], [0, 0, 20, 30, 10, 23]]);
const topT = topologia(T), nT = T.tri.length / 3;
const pintT = new Uint8Array(nT);
for (let t = 0; t < nT; t++) pintT[t] = topT.centro[t * 3 + 2] > 20 ? 1 : 0;
/** coluna com a face +X na cor 2: as camadas que têm suporte também têm troca */
const ladoT = new Uint8Array(nT);
for (let t = 0; t < nT; t++) ladoT[t] = topT.normal[t * 3] > 0.9 && topT.centro[t * 3 + 2] < 20 ? 1 : 0;

const assinatura = (r: ReturnType<typeof fatiarPlaca>["r"]) =>
  [r.tempoS, r.volumeMm3, r.massaG, r.custo, r.trocas.total, r.trocas.camadas, r.trocas.maximoPorCamada, r.trocas.purgaMm3, r.trocas.tempoS, r.trocas.torreCamadas, r.trocas.torreMm3, r.trocas.torreTempoS, ...r.cores.map((c) => c.volumeMm3)].map((x) => +Number(x).toPrecision(12));
/** Fatia com o Processo da máquina com os campos multimaterial dados por cima e a troca dada. */
function fatiar(maq: Maquina, pecas: Parameters<typeof fatiarPlaca>[0], mm: Partial<Processo> = {}, troca: Partial<Maquina["troca"]> = {}, aj?: Partial<Ajustes>) {
  const q = { ...maq, processo: { ...maq.processo, ...mm } };
  return fatiarPlaca(pecas, q, materialDa(q, "pla"), { ...ajustesPadrao(q.processo), ...aj }, undefined, { filamentos: filamentosPadrao("pla", 120), troca: { ...maq.troca, ...troca } });
}
const cubo = (cores?: Uint8Array, pos: [number, number][] = [[0, 0]]) => [{ nome: "cubo", malha: m, posicoes: pos, cores }];
/** Nenhum número do resultado é NaN ou infinito. */
function semNaN(o: unknown): boolean {
  if (typeof o === "number") return Number.isFinite(o);
  if (Array.isArray(o)) return o.every(semNaN);
  if (o && typeof o === "object") return Object.values(o).every(semNaN);
  return true;
}
/** Material de cada parte numa camada, pela prévia (segmentos × seção). */
function volumeNaCamada(pv: Previa, i: number, parte: (typeof PARTES)[number], w: number, h: number, fluxoMat: number) {
  const s = pv.seg[i], pp = pv.parte[i], ip = PARTES.indexOf(parte);
  let L = 0;
  for (let k = 0; k < pp.length; k++) if (pp[k] === ip) L += Math.hypot(s[k * 4 + 2] - s[k * 4], s[k * 4 + 3] - s[k * 4 + 1]);
  return L * espacamento(w, h) * h * fluxoMat;
}

// ---------- 1. padrões novos desligados: resultado IDÊNTICO ao de antes ----------
{
  let iguais = 0, total = 0;
  const difs: string[] = [];
  for (const [id, maq] of [["bbl-p1s", p1s], ["acu-k3", k3]] as const)
    for (const [nome, cores] of [["sem", undefined], ["2cores", faixa([10])], ["4cores", faixa([5, 10, 15])], ["topo", soTopo], ["fundo", soFundo], ["laterais", lados]] as const) {
      const a = assinatura(fatiar(maq, cubo(cores)).r), b = BASE[`${id}:${nome}`];
      total++;
      if (JSON.stringify(a) === JSON.stringify(b)) iguais++;
      else difs.push(`${id}:${nome}`);
    }
  for (const [id, maq] of [["bbl-p1s", p1s], ["acu-k3", k3]] as const)
    for (const sup of ["normal", "arvore"] as const)
      for (const [nome, cores] of [["sem", undefined], ["pint", pintT]] as const) {
        const a = assinatura(fatiar(maq, [{ nome: "T", malha: T, posicoes: [[0, 0]], cores }], {}, {}, { suporte: sup }).r), b = BASE_T[`${id}:T-${sup}:${nome}`];
        total++;
        if (JSON.stringify(a) === JSON.stringify(b)) iguais++;
        else difs.push(`${id}:T-${sup}:${nome}`);
      }
  ok(iguais === total && total === 20, `padrões novos desligados: ${iguais} de ${total} casos idênticos aos de antes (cubo 20 mm sem pintura, 2 e 4 cores, só topo, só fundo, laterais; peça com balanço e suporte normal/árvore; P1S e Kobra 3)${difs.length ? " — diferem: " + difs.join(", ") : ""}`);
  const proc = p1s.processo as unknown as Record<string, unknown>;
  ok(Object.entries(MULTIMATERIAL_PADRAO).every(([k, v]) => proc[k] === v && (k3.processo as unknown as Record<string, unknown>)[k] === v), "as duas impressoras saem de fábrica com o multimaterial neutro (filamento do bico, torre de hoje, sem aproveitar purga)");
}

// ---------- 2. filamento por função ----------
{
  const semTorre = { torre: false };
  const purga = p1s.troca.purgaMm3;
  // parede na cor 2, miolo (sem pintura) na cor 1: duas cores por camada → 1 troca por camada
  const { r } = fatiar(p1s, cubo(), { filamentoParede: 2 }, semTorre);
  ok(r.trocas.total === r.camadas && r.trocas.camadas === r.camadas && r.trocas.maximoPorCamada === 1, `parede na cor 2 e miolo na cor 1: ${r.trocas.total} trocas em ${r.camadas} camadas (1 por camada)`);
  // à mão: camada 0 começa na cor 1 e troca para a 2; a camada seguinte começa na 2 e troca para a 1… → 50 purgas em cada cor
  const paredes = r.partes.paredeExt.volume + r.partes.paredeInt.volume;
  ok(perto(r.cores[1].volumeMm3, paredes + 50 * purga, 1e-9), `cor 2 = paredes (${paredes.toFixed(0)} mm³) + 50 purgas de ${purga} mm³ = ${r.cores[1].volumeMm3.toFixed(0)} mm³`);
  ok(perto(r.cores[0].volumeMm3, r.volumeMm3 - paredes - 100 * purga + 50 * purga, 1e-9), "cor 1 = o resto (sólido, topo, esparso) + 50 purgas");
  ok(perto(r.trocas.purgaMm3, 100 * purga, 1e-9) && perto(r.trocas.tempoS, 100 * (p1s.troca.tempoS + purga / p1s.troca.vazaoPurga), 1e-9), "purga e tempo: 100 trocas × (35 s + 280 ÷ 9 s)");
  const rk = fatiar(k3, cubo(), { filamentoParede: 2 }, semTorre).r;
  ok(rk.trocas.total === rk.camadas && rk.trocas.maximoPorCamada === 1 && perto(rk.trocas.purgaMm3, rk.camadas * k3.troca.purgaMm3, 1e-9), `Kobra 3: parede na cor 2 → ${rk.trocas.total} trocas (1 por camada) com a purga dela`);
  // a mesma cor da pintura: nada muda (cubo todo na cor 1 e parede na cor 1)
  const rIgual = fatiar(p1s, cubo(), { filamentoParede: 1, filamentoSolidoInterno: 1 }, semTorre).r;
  ok(rIgual.trocas.total === 0 && perto(rIgual.tempoS, fatiar(p1s, cubo(), {}, semTorre).r.tempoS, 1e-12), "parede e sólido na mesma cor do objeto: nenhuma troca, tempo igual");
  // sólido interno na cor 3: só as camadas com sólido interno (fundo e topo) trocam
  const rS = fatiar(p1s, cubo(), { filamentoSolidoInterno: 3 }, semTorre).r;
  ok(rS.cores[2].usada && perto(rS.cores[2].volumeMm3, rS.partes.solido.volume + (rS.cores[2].volumeMm3 - rS.partes.solido.volume), 1e-9) && rS.trocas.total > 0 && rS.trocas.camadas < r.camadas,
    `sólido interno na cor 3: ${rS.trocas.total} trocas em ${rS.trocas.camadas} camadas (só onde há sólido interno), ${rS.partes.solido.volume.toFixed(0)} mm³ de sólido`);
  ok(Math.abs((rS.cores[2].volumeMm3 - rS.partes.solido.volume) / purga - Math.round((rS.cores[2].volumeMm3 - rS.partes.solido.volume) / purga)) < 1e-9, "cor 3 = sólido interno + um número inteiro de purgas");

  // suporte na cor 3 e interface na cor 4 (peça com balanço, suporte normal, sem pintura)
  const { r: rs, previa } = fatiar(p1s, [{ nome: "T", malha: T, posicoes: [[0, 0]] }], { filamentoSuporte: 3, filamentoInterface: 4 }, semTorre, { suporte: "normal" });
  // à mão pela prévia: cores de cada camada (objeto = 1, suporte = 3, interface = 4); começa com a do bico, termina numa da camada de cima
  const iSup = PARTES.indexOf("suporte"), iInt = PARTES.indexOf("interface");
  const conj = previa.parte.map((pp) => {
    const c = new Set<number>();
    for (const x of pp) c.add(x === iSup ? 2 : x === iInt ? 3 : 0);
    return c;
  });
  let bico = -1, esperado = 0;
  conj.forEach((c, i) => {
    if (!c.size) return;
    const prox = conj[i + 1] ?? new Set<number>();
    esperado += c.size - (c.has(bico) ? 1 : 0);
    const fins = [...c].filter((x) => x !== bico || c.size === 1);
    bico = (fins.find((x) => prox.has(x)) ?? fins.sort((a, b) => a - b)[fins.length - 1]);
    if (c.size === 1) bico = [...c][0];
  });
  ok(rs.trocas.total === esperado, `suporte na cor 3 e interface na cor 4: ${rs.trocas.total} trocas (conta à mão pelas camadas: ${esperado})`);
  const k2 = (rs.cores[2].volumeMm3 - rs.partes.suporte.volume) / purga, k4 = (rs.cores[3].volumeMm3 - rs.partes.interface.volume) / purga, k1 = (rs.cores[0].volumeMm3 - (rs.volumeMm3 - rs.partes.suporte.volume - rs.partes.interface.volume - rs.trocas.purgaMm3)) / purga;
  const inteiro = (x: number) => Math.abs(x - Math.round(x)) < 1e-9;
  ok(rs.partes.suporte.volume > 0 && rs.partes.interface.volume > 0 && inteiro(k2) && inteiro(k4) && inteiro(k1) && Math.round(k1 + k2 + k4) === rs.trocas.total,
    `material por cor: cor 3 = suporte ${rs.partes.suporte.volume.toFixed(0)} mm³ + ${Math.round(k2)} purgas; cor 4 = interface ${rs.partes.interface.volume.toFixed(0)} mm³ + ${Math.round(k4)} purgas; cor 1 = peça + ${Math.round(k1)} purgas`);
  ok(rs.cores[2].usada && rs.cores[3].usada && !rs.cores[1].usada, "cores usadas: 1, 3 e 4");
  ok(semNaN(r) && semNaN(rs) && semNaN(rS), "filamento por função: nenhum NaN no resultado");
}

// ---------- 3. torre de purga ----------
{
  const c2 = faixa([10]);
  const base = fatiar(p1s, cubo(c2)).r;
  ok(base.trocas.torreCamadas === 51 && base.trocas.torreLado === 35 && base.trocas.torrePosicao === null, "torre automática: 51 camadas (até a última troca), lado 35 mm");
  const parede = fatiar(p1s, cubo(), { filamentoParede: 2 }).r;
  ok(parede.trocas.torreCamadas === parede.camadas, `trocas em todas as camadas: torre em todas as ${parede.trocas.torreCamadas} (estável até a última troca)`);
  // borda da torre: voltas para fora do anel só na 1ª camada (conta à mão)
  const rb = fatiar(p1s, cubo(c2), { torreBorda: 3 }).r;
  const h0 = 0.2, s0 = espacamento(p1s.processo.lPrimeira, h0), voltas = Math.ceil(3 / s0 - 1e-9);
  let cb = 0;
  for (let k = 1; k <= voltas; k++) cb += 4 * (35 - s0 + 2 * k * s0);
  const fl = materialDa(p1s, "pla").fluxo;
  ok(perto(rb.trocas.torreMm3 - base.trocas.torreMm3, cb * s0 * h0 * fl, 1e-9) && perto(rb.trocas.torreOcupa, 35 + 6, 1e-12), `borda da torre de 3 mm: ${voltas} voltas, +${(cb * s0 * h0 * fl).toFixed(1)} mm³; ocupa 41 mm`);
  // giro de 45°: a área ocupada na mesa vira a diagonal
  ok(perto(fatiar(p1s, cubo(c2), { torreAngulo: 45 }).r.trocas.torreOcupa, 35 * Math.SQRT2, 1e-9), "torre girada 45°: ocupa 35 × √2 mm na mesa");
  // posição escolhida: dentro da mesa e longe da peça → sem aviso
  const pos = fatiar(p1s, cubo(c2), { torreAuto: false, torreX: 20, torreY: 20 }).r;
  ok(pos.avisos.every((a) => !a.includes("torre")) && pos.trocas.torrePosicao?.[0] === 20 && pos.trocas.torrePosicao?.[1] === 20, "posição escolhida (20; 20) cabe na mesa e fica fora da peça: sem aviso");
  ok(perto(pos.tempoS, base.tempoS, 1e-12) && perto(pos.volumeMm3, base.volumeMm3, 1e-12), "mudar a posição não muda tempo nem material");
  const borda = fatiar(p1s, cubo(c2), { torreAuto: false, torreX: 240, torreY: 20 }).r;
  ok(borda.avisos.some((a) => a.includes("passa da borda") && a.includes("X 240")), "torre em X 240 (35 mm numa mesa de 256): aviso de que passa da borda, com a posição");
  const encosta = fatiar(p1s, cubo(c2), { torreAuto: false, torreX: 115, torreY: 115 }).r;
  ok(encosta.avisos.some((a) => a.includes("encosta em cubo") && a.includes("X 115 / Y 115")), "torre sobre a peça: aviso dizendo em qual peça e a posição");
  const giradaBorda = fatiar(p1s, cubo(c2), { torreAuto: false, torreX: 0, torreY: 0, torreAngulo: 45 }).r;
  ok(giradaBorda.avisos.some((a) => a.includes("passa da borda")), "torre no canto girada 45°: a diagonal passa da borda e avisa");
  const grande = fatiar(p1s, cubo(c2), {}, { larguraTorre: 240 }).r;
  ok(grande.avisos.some((a) => a.includes("não cabe ao lado das peças")), "torre automática de 240 mm não cabe ao lado das peças: aviso");
  // volume de purga na torre: 45 mm³ por troca entram na torre e na cor que entra
  const rv = fatiar(p1s, cubo(c2), { torreVolume: 45 }).r;
  ok(perto(rv.trocas.torrePurgaMm3, 45, 1e-12) && perto(rv.trocas.torreMm3 - base.trocas.torreMm3, 45, 1e-9) && perto(rv.cores[1].volumeMm3 - base.cores[1].volumeMm3, 45, 1e-9) && perto(rv.cores[0].volumeMm3, base.cores[0].volumeMm3, 1e-12),
    "volume de purga na torre (45 mm³, 1 troca): +45 mm³ na torre, todos na cor que entra");
  ok(rv.trocas.torreTempoS > base.trocas.torreTempoS && rv.trocas.torreLado === 35, `linhas de purga somam tempo à torre (${(rv.trocas.torreTempoS - base.trocas.torreTempoS).toFixed(1)} s) e cabem no anel de 35 mm`);
  // purga demais numa camada: a torre se alarga e avisa (laterais: 3 trocas por camada × 1000 mm³)
  const rg = fatiar(p1s, cubo(lados), { torreVolume: 1000, torreEspacoExtra: 0.5 }).r;
  const s1 = espacamento(p1s.processo.lParedeExt, 0.2), passo = s1 + 0.5, comp = 3000 / (s1 * 0.2 * fl);
  ok(perto(rg.trocas.torreLado, Math.sqrt(comp * passo) + 2 * s1, 1e-9) && rg.avisos.some((a) => a.includes("foi alargada")), `3 trocas × 1000 mm³ por camada: a torre vai a ${rg.trocas.torreLado.toFixed(1)} mm (área das linhas com espaço extra de 0,5 mm) e avisa`);
  const rf = fatiar(p1s, cubo(lados), { torreVolume: 1000, torreFluxoExtra: 1.5 }).r;
  const rf1 = fatiar(p1s, cubo(lados), { torreVolume: 1000 }).r;
  ok(rf.trocas.torreLado < rf1.trocas.torreLado && perto(rf.trocas.torrePurgaMm3, rf1.trocas.torrePurgaMm3, 1e-12), "fluxo extra da purga 1,5: linhas mais grossas, torre menor, mesmo volume");
  const sem = fatiar(p1s, cubo(c2), { torreVolume: 45, torreBorda: 3 }, { torre: false }).r;
  ok(sem.trocas.torreMm3 === 0 && sem.trocas.torreCamadas === 0 && perto(sem.cores[1].volumeMm3, base.cores[1].volumeMm3 - base.trocas.torreMm3 / 2, 1e-6), "torre desligada: sem anel, sem borda e sem purga da torre");
  ok([base, parede, rb, pos, borda, encosta, grande, rv, rg, rf, sem].every(semNaN), "torre: nenhum NaN no resultado");
}

// ---------- 4. purgar no preenchimento / nos objetos / no suporte ----------
{
  const c2 = faixa([10]);
  const purga = p1s.troca.purgaMm3, vaz = p1s.troca.vazaoPurga;
  const { r: base, previa } = fatiar(p1s, cubo(c2));
  // a troca é na camada 50 (z = 10,2 mm): o esparso dessa camada é o que pode receber a purga
  const i = base.alturas.findIndex((z) => z > 10);
  const fl = materialDa(p1s, "pla").fluxo;
  const esparso = volumeNaCamada(previa, i, "esparso", p1s.processo.lEsparso, 0.2, fl);
  const { r: rp } = fatiar(p1s, cubo(c2), { purgarNoPreenchimento: true });
  const ap = rp.trocas.purgaAproveitadaMm3;
  ok(ap > 0 && perto(ap, Math.min(purga, esparso), 1e-4), `purgar no preenchimento: aproveita ${ap.toFixed(2)} mm³ = o esparso da camada da troca (${esparso.toFixed(2)} mm³; limite físico < ${purga} mm³)`);
  ok(perto(rp.trocas.purgaMm3, purga - ap, 1e-12) && perto(rp.volumeMm3, base.volumeMm3 - ap, 1e-9) && perto(rp.cores[1].volumeMm3, base.cores[1].volumeMm3 - ap, 1e-9), "a purga desperdiçada cai o mesmo tanto (material total e da cor que entra)");
  ok(perto(rp.trocas.tempoS, p1s.troca.tempoS + (purga - ap) / vaz, 1e-9) && perto(base.tempoS - rp.tempoS, ap / vaz, 1e-6), `tempo da troca cai ${(ap / vaz).toFixed(2)} s (aproveitado ÷ vazão da purga)`);
  // purga pequena: tudo aproveitado, nunca mais do que a purga
  const rpq = fatiar(p1s, cubo(c2), { purgarNoPreenchimento: true }, { purgaMm3: 5 }).r;
  ok(rpq.trocas.purgaAproveitadaMm3 === 5 && rpq.trocas.purgaMm3 === 0 && perto(rpq.trocas.tempoS, p1s.troca.tempoS, 1e-12), "purga de 5 mm³ cabe toda no esparso: purga desperdiçada 0, tempo só o da troca");
  // nos objetos: tudo o que é da peça na cor que entra (paredes, sólido, esparso…) na camada
  const obj = (["paredeExt", "paredeInt", "solido", "topo", "ponte", "esparso"] as const).reduce((s, p) => {
    const w = p === "paredeExt" ? p1s.processo.lParedeExt : p === "paredeInt" ? p1s.processo.lParedeInt : p === "esparso" ? p1s.processo.lEsparso : p === "topo" ? p1s.processo.lTopo : p1s.processo.lSolido;
    return s + volumeNaCamada(previa, i, p, w, 0.2, fl) * (p === "topo" ? p1s.processo.fluxoTopo : p === "ponte" ? p1s.processo.fluxoPonte : 1);
  }, 0);
  const ro = fatiar(p1s, cubo(c2), { purgarNosObjetos: true }).r;
  ok(perto(ro.trocas.purgaAproveitadaMm3, Math.min(purga, obj), 1e-4) && ro.trocas.purgaAproveitadaMm3 > ap, `purgar nos objetos: ${ro.trocas.purgaAproveitadaMm3.toFixed(1)} mm³ (tudo o que a peça tem na cor nova na camada: ${obj.toFixed(1)} mm³)`);
  // muitas trocas (laterais: 3 por camada): nunca passa da purga de cada troca
  const rl = fatiar(p1s, cubo(lados), { purgarNoPreenchimento: true, purgarNosObjetos: true }).r;
  ok(rl.trocas.purgaAproveitadaMm3 > 0 && rl.trocas.purgaAproveitadaMm3 <= rl.trocas.total * purga + 1e-9 && perto(rl.trocas.purgaMm3 + rl.trocas.purgaAproveitadaMm3, 300 * purga, 1e-9), `4 cores nas laterais: ${rl.trocas.purgaAproveitadaMm3.toFixed(0)} de ${300 * purga} mm³ aproveitados (nunca mais do que a purga)`);
  // no suporte: peça com balanço com a lateral da coluna na cor 2 (troca nas camadas com suporte), suporte com o filamento do bico
  const sb = fatiar(p1s, [{ nome: "T", malha: T, posicoes: [[0, 0]], cores: ladoT }], {}, {}, { suporte: "normal" }).r;
  const ss = fatiar(p1s, [{ nome: "T", malha: T, posicoes: [[0, 0]], cores: ladoT }], { purgarNoSuporte: true }, {}, { suporte: "normal" }).r;
  ok(ss.trocas.total === sb.trocas.total && ss.trocas.purgaAproveitadaMm3 > 0 && perto(ss.volumeMm3, sb.volumeMm3 - ss.trocas.purgaAproveitadaMm3, 1e-6), `purgar no suporte: ${ss.trocas.purgaAproveitadaMm3.toFixed(1)} mm³ aproveitados no suporte, mesmas ${ss.trocas.total} trocas`);
  ok(ss.trocas.purgaAproveitadaMm3 <= ss.partes.suporte.volume + 1e-9, "a purga aproveitada no suporte não passa do suporte impresso");
  // suporte na cor 3 com purga no suporte: a purga das trocas para a cor 3 vai para o corpo do suporte
  const s3 = fatiar(p1s, [{ nome: "T", malha: T, posicoes: [[0, 0]] }], { filamentoSuporte: 3, purgarNoSuporte: true }, { torre: false }, { suporte: "normal" }).r;
  const s3b = fatiar(p1s, [{ nome: "T", malha: T, posicoes: [[0, 0]] }], { filamentoSuporte: 3 }, { torre: false }, { suporte: "normal" }).r;
  ok(s3.trocas.purgaAproveitadaMm3 > 0 && perto(s3.cores[2].volumeMm3, s3b.cores[2].volumeMm3 - s3.trocas.purgaAproveitadaMm3, 1e-6), "suporte na cor 3 + purgar no suporte: a purga da cor 3 sai dentro do suporte");
  ok([rp, rpq, ro, rl, sb, ss, s3].every(semNaN), "purga aproveitada: nenhum NaN no resultado");
}

// ---------- 5. esquema, perfil e projeto (.wjslc) ----------
{
  const motor = ["filamentoParede", "filamentoSolidoInterno", "filamentoSuporte", "filamentoInterface", "torreBorda", "torreAuto", "torreX", "torreY", "torreAngulo", "torreVolume", "torreEspacoLinhas", "torreEspacoExtra", "torreFluxoExtra", "purgarNoPreenchimento", "purgarNoSuporte"];
  ok(motor.every((id) => campoDe(id)?.estado === "motor" && campoDe(id)?.origem === "processo"), "esquema: filamento por função, torre e purga no preenchimento/suporte marcados ✅ (no Processo)");
  ok(campoDe("purgarNosObjetos")?.estado === "parcial" && !!campoDe("purgarNosObjetos")?.nota, "esquema: purgar nos objetos 🟡 (todas as peças; escolher a peça é da O1)");
  ok(["torreParede", "torreAnguloCone", "torreDistPonte"].every((id) => campoDe(id)?.estado === "naoAplicado" && !!campoDe(id)?.nota), "esquema: nervura, cone e distância de ponte da torre 🔶 com a nota do que falta");
  const res = resolver({ maquina: "acu-k3", projeto: { filamentoParede: 2, torreAuto: false, torreX: 30, purgarNoPreenchimento: true, torreVolume: 45, filamentoSuporte: 9 } });
  ok(res.processo.filamentoParede === 2 && res.processo.torreAuto === false && res.processo.torreX === 30 && res.processo.purgarNoPreenchimento && res.processo.torreVolume === 45 && res.processo.filamentoSuporte === 0, "perfil do projeto chega ao Processo do motor (filamento 9 fora do limite é descartado)");
  const perfil = { filamentoParede: 2, filamentoInterface: 4, torreAuto: false, torreX: 30, torreY: 12.5, torreAngulo: 30, torreVolume: 45, purgarNoSuporte: true, torreParede: "nervura" };
  const texto = await empacotar({ nome: "X1", maquina: "acu-k3", material: "pla", perfil, precos: {}, filamentos: filamentosPadrao("pla", 120), trocas: {}, pecas: [{ nome: "Cubo", copias: 1, pos: m.pos, tri: m.tri, cores: faixa([10]) }] });
  const p = await desempacotar(texto);
  ok(JSON.stringify(p.perfil) === JSON.stringify(perfil), "projeto .wjslc salvo e lido com os campos multimaterial (inclusive os 🔶 guardados)");
  const r = fatiar(k3, cubo(p.pecas[0].cores), resolver({ maquina: "acu-k3", projeto: p.perfil }).processo).r;
  ok(r.trocas.torrePosicao?.[0] === 30 && r.trocas.torreTempoS > 0 && semNaN(r), "projeto reaberto fatia com a torre na posição gravada, sem NaN");
}

// ---------- 6. desempenho (o motor roda no worker; nenhuma etapa pode pesar a mais) ----------
{
  const t0 = performance.now();
  fatiar(p1s, cubo(lados));
  const tBase = performance.now() - t0;
  const t1 = performance.now();
  fatiar(p1s, cubo(lados), { filamentoParede: 2, filamentoSolidoInterno: 3, purgarNoPreenchimento: true, purgarNosObjetos: true, torreVolume: 200, torreBorda: 3 });
  const tX1 = performance.now() - t1;
  ok(tX1 < tBase * 1.5 + 300, `4 cores com tudo ligado: ${tX1.toFixed(0)} ms (sem nada: ${tBase.toFixed(0)} ms)`);
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nWJSlicer3D multimaterial (X1): tudo certo");
if (falhas) process.exit(1);

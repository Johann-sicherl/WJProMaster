// Testes da fatia M1 do WJSlicer3D (src/slicer/paredes.ts + caminhos.ts): gerador de paredes clássico × largura
// variável, preenchimento de vãos, uma parede só no topo / na 1ª camada e perímetros pequenos.
// 1. Com os padrões (tudo desligado) o resultado é IDÊNTICO ao de antes da M1 (valores medidos antes de mexer).
// 2. Partes finas (placa de 0,9 mm, cunha de 3 → 0,5 mm, anel fino): cobertura da seção ≈ área, sem sobreposição,
//    material ≈ volume da peça × fluxo, caminho dentro da peça e sem NaN.
// 3. Topo com uma parede, 1ª camada com uma parede, perímetro pequeno mais lento; desempenho.
import { campoDistancia, amostrar, rasterizar, comprimento } from "../src/slicer/campo";
import { alturasCamadas, fatiarMalha, gerarCamada, type Contexto, type Trecho, type MalhaImpressao } from "../src/slicer/caminhos";
import { estimar, ajustesPadrao, espacamento, volumeMalha } from "../src/slicer/fatiar";
import { maquinaPorId, materialDa, type Maquina, type Processo } from "../src/slicer/perfis";
import { pilhaVariavel, posicaoParede, indexar, raio, type ParamParedes } from "../src/slicer/paredes";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas++;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// ---------- malhas ----------
function caixas(lista: [number, number, number, number, number, number][]): MalhaImpressao {
  const pos: number[] = [], tri: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of lista) {
    const b = pos.length / 3;
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) pos.push(x, y, z);
    for (const [a, bb, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tri.push(b + a, b + bb, b + c, b + a, b + c, b + d);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}
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
/** Prisma de um polígono convexo (anti-horário) com altura H. */
function prisma(pol: [number, number][], H: number): MalhaImpressao {
  const n = pol.length, pos: number[] = [], tri: number[] = [];
  for (const [x, y] of pol) pos.push(x, y, 0, x, y, H);
  for (let k = 1; k + 1 < n; k++) tri.push(0, 2 * (k + 1), 2 * k, 1, 2 * k + 1, 2 * (k + 1) + 1);
  for (let k = 0; k < n; k++) {
    const b0 = 2 * k, t0 = b0 + 1, b1 = 2 * ((k + 1) % n), t1 = b1 + 1;
    tri.push(b0, b1, t1, b0, t1, t0);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}
/** Anel de raios R1 > R2 e altura H. */
function anel(R1: number, R2: number, H: number, n = 256): MalhaImpressao {
  const pos: number[] = [], tri: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n, c = Math.cos(a), s = Math.sin(a);
    pos.push(R1 * c, R1 * s, 0, R1 * c, R1 * s, H, R2 * c, R2 * s, 0, R2 * c, R2 * s, H);
  }
  for (let k = 0; k < n; k++) {
    const a = 4 * k, b = 4 * ((k + 1) % n);
    tri.push(a, b, b + 1, a, b + 1, a + 1); // externa
    tri.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2); // interna
    tri.push(a + 1, b + 1, b + 3, a + 1, b + 3, a + 3); // topo
    tri.push(a, a + 2, b + 2, a, b + 2, b); // fundo
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

const p1s = maquinaPorId("bbl-p1s"), k3 = maquinaPorId("acu-k3");
const plaP = materialDa(p1s, "pla"), plaK = materialDa(k3, "pla");
const com = (maq: Maquina, extra: Partial<Processo>): Maquina => ({ ...maq, processo: { ...maq.processo, ...extra } });
const VAR: Partial<Processo> = { geradorParedes: "larguraVariavel" };

/** Trechos de todas as camadas (contexto igual ao do fatiamento da mesa). */
function camadas(m: MalhaImpressao, maq: Maquina) {
  const pr = maq.processo, aj = ajustesPadrao(pr);
  let H = 0;
  for (let k = 2; k < m.pos.length; k += 3) H = Math.max(H, m.pos[k]);
  const zs = alturasCamadas(H, pr.alturaPrimeira, aj.altura);
  const f = fatiarMalha(m, zs, 1);
  const ctx: Contexto = { f, maq, aj, zs, vazaoMax: materialDa(maq, "pla").vazaoMax, sup: null, campoAbaixo: null };
  return { f, zs, cams: zs.map((_, i) => gerarCamada(ctx, i)) };
}

/**
 * Cobertura de uma camada numa grade fina: fração da seção coberta pelos filetes (retângulos de largura = espaçamento
 * ao longo de cada segmento), fração coberta duas vezes por paredes/vãos diferentes (o preenchimento entra nas paredes
 * de propósito, 15 %) e fração fora da peça.
 */
function cobertura(m: MalhaImpressao, maq: Maquina, i: number, partes?: (t: Trecho) => boolean) {
  const { f, zs, cams } = camadas(m, maq);
  const h = i === 0 ? zs[0] : zs[i] - zs[i - 1];
  const g0 = f.g, c = 0.02;
  const g = { x0: g0.x0, y0: g0.y0, c, cols: Math.ceil((g0.cols * g0.c) / c), lins: Math.ceil((g0.lins * g0.c) / c) };
  const ns = f.segs[i].length / 4;
  const dentro = rasterizar(f.segs[i], ns, g);
  const conta = new Uint8Array(g.cols * g.lins), contaP = new Uint8Array(g.cols * g.lins), dono = new Int32Array(g.cols * g.lins).fill(-1);
  let id = 0, finito = true, sobra = 0;
  const campoF = campoDistancia(f.segs[i], ns, rasterizar(f.segs[i], ns, g0), g0);
  for (const t of cams[i].trechos) {
    if (partes && !partes(t)) continue;
    id++;
    const s = espacamento(t.w, h), p = t.pts, np = p.length / 2;
    const parede = t.parte === "paredeExt" || t.parte === "paredeInt" || t.parte === "vaos";
    for (let k = 0; k < np; k++) {
      if (!Number.isFinite(p[k * 2]) || !Number.isFinite(p[k * 2 + 1])) finito = false;
      else if (amostrar(campoF, g0, p[k * 2], p[k * 2 + 1]) < -0.05) sobra++;
    }
    for (let k = 0; k < (t.fechado ? np : np - 1); k++) {
      const ax = p[k * 2], ay = p[k * 2 + 1], bx = p[((k + 1) % np) * 2], by = p[((k + 1) % np) * 2 + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-9) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      const x0 = Math.min(ax, bx) - s, x1 = Math.max(ax, bx) + s, y0 = Math.min(ay, by) - s, y1 = Math.max(ay, by) + s;
      for (let j = Math.max(0, Math.floor((y0 - g.y0) / c)); j <= Math.min(g.lins - 1, Math.floor((y1 - g.y0) / c)); j++)
        for (let ii = Math.max(0, Math.floor((x0 - g.x0) / c)); ii <= Math.min(g.cols - 1, Math.floor((x1 - g.x0) / c)); ii++) {
          const x = g.x0 + (ii + 0.5) * c - ax, y = g.y0 + (j + 0.5) * c - ay;
          const a = x * ux + y * uy, b = -x * uy + y * ux;
          if (a < 0 || a >= L || Math.abs(b) > s / 2) continue;
          const q = j * g.cols + ii;
          if (dono[q] === id) continue;
          dono[q] = id;
          if (conta[q] < 255) conta[q]++;
          if (parede && contaP[q] < 255) contaP[q]++;
        }
    }
  }
  let area = 0, coberto = 0, duplo = 0, fora = 0;
  for (let q = 0; q < conta.length; q++) {
    if (dentro[q]) {
      area++;
      if (conta[q]) coberto++;
    } else if (conta[q]) fora++;
    if (contaP[q] >= 2) duplo++;
  }
  return { cob: coberto / area, duplo: duplo / area, fora: fora / area, finito, sobra, cam: cams[i] };
}

const volExtr = (r: ReturnType<typeof estimar>) => r.volumeMm3;

// ---------- 1. padrões = idêntico ao de antes da M1 ----------
{
  // medido no main antes da M1 (27/11/2026), mesmo código de teste: [tempo s, massa g]
  const ANTES: Record<string, [number, number]> = {
    "cubo bbl-p1s": [448.4882124366969, 3.5694883434303946], "cubo acu-k3": [839.6080841847775, 3.5736743340414048],
    "cilindro bbl-p1s": [432.54714235484005, 2.8800808290131004], "cilindro acu-k3": [815.8028698864206, 2.7247201269232315],
    "balanço bbl-p1s": [503.62684651447876, 1.8299109048905517], "balanço acu-k3": [933.5398877388595, 1.7837813434174021],
  };
  const casos: [string, MalhaImpressao][] = [["cubo", caixas([[0, 0, 0, 20, 20, 20]])], ["cilindro", cilindro(10, 20)], ["balanço", caixas([[10, 0, 0, 20, 10, 20], [0, 0, 20, 30, 10, 23]])]];
  for (const [nome, m] of casos)
    for (const maq of [p1s, k3]) {
      const r = estimar(m, maq, materialDa(maq, "pla"), ajustesPadrao(maq.processo));
      const [t, g] = ANTES[`${nome} ${maq.id}`];
      ok(r.tempoS === t && r.massaG === g, `${nome} ${maq.modelo} com os padrões: ${(r.tempoS / 60).toFixed(2)} min, ${r.massaG.toFixed(3)} g — idêntico ao de antes`);
    }
  ok(p1s.processo.geradorParedes === "classico" && !p1s.processo.preenchimentoVaos && !p1s.processo.umaParedeTopo && !p1s.processo.umaParedePrimeira && p1s.processo.limitePerimetroPequeno === 0, "padrões da M1: clássico, sem vãos, todas as paredes no topo e perímetro pequeno desligado");
}

// ---------- 2. pilha de paredes (conta pura) ----------
{
  const s = espacamento(0.45, 0.2), sE = espacamento(0.42, 0.2);
  const P: ParamParedes = { sE, sI: s, voltas: 2, sMin: espacamento(0.34, 0.2), sMax: 2 * s, detMin: 0.1, distrib: 1 };
  const soma = (T: number) => {
    const p = pilhaVariavel(T, P);
    return 2 * p.lados.reduce((a, b) => a + b, 0) + p.centro;
  };
  let todas = true;
  for (let T = 0.35; T < 2 * (sE + s); T += 0.01) {
    const p = pilhaVariavel(T, P);
    if (Math.abs(soma(T) - T) > 1e-9 || p.lados.some((l) => l < P.sMin - 1e-9 || l > P.sMax + 1e-9) || (p.centro > 0 && p.centro > P.sMax + 1e-9)) todas = false;
  }
  ok(todas, "largura variável: de 0,35 mm até 4 paredes, os filetes somam exatamente a espessura e ficam entre a largura mínima e 2× a linha");
  const p09 = pilhaVariavel(0.9, P);
  ok(p09.m === 2 && Math.abs(p09.lados[0] - 0.45) < 1e-9 && Math.abs(posicaoParede(p09, 0) - 0.225) < 1e-9, `placa de 0,9 mm: 2 filetes de 0,45 mm (centros a 0,225 mm da borda)`);
  const p05 = pilhaVariavel(0.5, P);
  ok(p05.m === 1 && p05.centro === 0.5, "parte de 0,5 mm: um filete só no meio, de 0,5 mm");
  ok(pilhaVariavel(0.05, P).m === 0, "mais fino que o tamanho mínimo de detalhe: nada");
  ok(pilhaVariavel(3, P).m === 4 && pilhaVariavel(3, P).lados[1] === s, "parte grossa: as 2 paredes de cada lado com a largura nominal (o meio é preenchimento)");
  const p3 = pilhaVariavel(1.45, { ...P, distrib: 3 }), p1 = pilhaVariavel(1.45, P);
  const d3 = (1.45 - 2 * (sE + s)) / 4;
  ok(p3.m === 4 && Math.abs(p3.lados[0] - (sE + d3)) < 1e-9 && Math.abs(p3.lados[1] - (s + d3)) < 1e-9, "paredes na transição ≥ 2: em 1,45 mm a sobra se divide igual pelos 4 filetes");
  ok(p1.m === 4 && p1.lados[0] === sE && Math.abs(p1.lados[1] - (1.45 / 2 - sE)) < 1e-9, "1 parede na transição: a externa fica nominal e só a de dentro absorve a sobra");
  // raio até o outro lado, com o ângulo de transição
  const seg = Float64Array.from([0, 0, 10, 0, 0, 1, 10, 1.2, 0, 3, 10, 6]);
  const ix = indexar(seg, 3);
  ok(Math.abs(raio(ix, 5, 0.01, 0, 1, 5, Math.cos((10 * Math.PI) / 180)) - 1.09) < 0.01, "raio na normal acha o outro lado (cunha de 1,1°)");
  ok(raio(ix, 5, 1.2, 0, 1, 5, Math.cos((10 * Math.PI) / 180)) === Infinity, "lado inclinado além do ângulo de transição não conta como parte fina");
}

// ---------- 3. partes finas: placa de 0,9 mm, cunha e anel ----------
const placa = caixas([[0, 0, 0, 0.9, 20, 5]]);
{
  const meio = 12;
  const cl = cobertura(placa, p1s, meio);
  const vr = cobertura(placa, com(p1s, VAR), meio);
  const vz = cobertura(placa, com(p1s, { preenchimentoVaos: true }), meio);
  console.log(`  placa 0,9 mm (camada ${meio}): clássico cobre ${pct(cl.cob)}, com vãos ${pct(vz.cob)}, largura variável ${pct(vr.cob)} (dupla ${pct(vr.duplo)}, fora ${pct(vr.fora)})`);
  ok(cl.cob < 0.9, `clássico deixa vão no meio da placa de 0,9 mm (cobre ${pct(cl.cob)})`);
  ok(vr.cob > 0.97 && vr.duplo < 0.03 && vr.fora < 0.03, `largura variável cobre a seção (${pct(vr.cob)}), sem sobreposição (${pct(vr.duplo)}) nem sobra para fora (${pct(vr.fora)})`);
  const lados = vr.cam.trechos.filter((t) => (t.parte === "paredeExt" || t.parte === "paredeInt") && comprimento(t.pts, t.fechado) > 5);
  ok(lados.length === 2 && lados.every((t) => Math.abs(espacamento(t.w, 0.2) - 0.45) < 0.005), `placa: os dois lados com um filete de 0,45 mm cada (${lados.map((t) => espacamento(t.w, 0.2).toFixed(3)).join(", ")}); as pontas ficam como no clássico`);
  ok(vz.cob > 0.97 && vz.duplo < 0.03 && vz.cam.trechos.some((t) => t.parte === "vaos"), `clássico + preenchimento de vãos: o vão central vira um filete fino (cobre ${pct(vz.cob)}, dupla ${pct(vz.duplo)})`);
  ok(vr.finito && vr.sobra === 0 && vz.finito && vz.sobra === 0, "caminhos sem NaN e dentro da peça");
  const vol = volumeMalha(placa)!;
  const rv = estimar(placa, com(p1s, VAR), plaP, ajustesPadrao(p1s.processo));
  const rc = estimar(placa, p1s, plaP, ajustesPadrao(p1s.processo));
  const rz = estimar(placa, com(p1s, { preenchimentoVaos: true }), plaP, ajustesPadrao(p1s.processo));
  console.log(`  placa: volume ${vol.toFixed(1)} mm³ × fluxo = ${(vol * plaP.fluxo).toFixed(1)}; clássico ${volExtr(rc).toFixed(1)}, vãos ${volExtr(rz).toFixed(1)} (${rz.partes.vaos.volume.toFixed(1)} de vão, ${(rz.partes.vaos.tempo).toFixed(0)} s), variável ${volExtr(rv).toFixed(1)} mm³`);
  ok(Math.abs(volExtr(rv) / (vol * plaP.fluxo) - 1) < 0.04, `placa com largura variável: material ${volExtr(rv).toFixed(1)} mm³ ≈ volume × fluxo (${pct(volExtr(rv) / (vol * plaP.fluxo))})`);
  ok(rz.partes.vaos.volume > 0 && rz.partes.vaos.tempo > 0 && volExtr(rz) > volExtr(rc), "vãos entram no tempo e no material como tipo próprio");
}
{
  // cunha: 25 mm de comprimento, de 3 mm a 0,5 mm de espessura, 3 mm de altura
  const cunha = prisma([[0, 0], [25, 1.25], [25, 1.75], [0, 3]], 3);
  const cl = cobertura(cunha, p1s, 6), vr = cobertura(cunha, com(p1s, VAR), 6);
  console.log(`  cunha 3 → 0,5 mm: clássico cobre ${pct(cl.cob)} (dupla ${pct(cl.duplo)}), largura variável ${pct(vr.cob)} (dupla ${pct(vr.duplo)}, fora ${pct(vr.fora)})`);
  ok(vr.cob > 0.95 && vr.duplo < 0.05 && vr.fora < 0.03 && vr.cob > cl.cob, `cunha 3 → 0,5 mm com largura variável: cobre ${pct(vr.cob)} da seção, ${pct(vr.duplo)} coberta duas vezes`);
  ok(vr.finito && vr.sobra === 0, "cunha: caminho sem NaN e dentro da peça");
  const ws = vr.cam.trechos.filter((t) => t.parte !== "esparso" && t.parte !== "solido" && t.parte !== "topo").map((t) => espacamento(t.w, 0.2));
  ok(Math.min(...ws) > 0.25 && Math.max(...ws) < 0.85, `cunha: filetes entre ${Math.min(...ws).toFixed(2)} e ${Math.max(...ws).toFixed(2)} mm (largura mínima a ~2× a linha)`);
}
{
  const a = anel(10, 9.2, 4);
  const cl = cobertura(a, p1s, 8), vr = cobertura(a, com(p1s, VAR), 8);
  console.log(`  anel de 0,8 mm: clássico cobre ${pct(cl.cob)}, largura variável ${pct(vr.cob)} (dupla ${pct(vr.duplo)})`);
  ok(vr.cob > 0.97 && vr.duplo < 0.03 && vr.cam.trechos.filter((t) => t.fechado).length === 2, `anel fino com largura variável: 2 laços que cobrem ${pct(vr.cob)} da seção`);
  const fino = anel(10, 9.5, 4);
  const v5 = cobertura(fino, com(p1s, VAR), 8);
  const centro = v5.cam.trechos.filter((t) => t.parte === "paredeExt");
  ok(centro.length === 1 && centro[0].fechado && v5.cob > 0.97 && v5.duplo < 0.03, `anel de 0,5 mm: um filete só no meio, fechado (cobre ${pct(v5.cob)}, dupla ${pct(v5.duplo)})`);
  const vol = volumeMalha(fino)!, r = estimar(fino, com(p1s, VAR), plaP, ajustesPadrao(p1s.processo));
  ok(Math.abs(r.volumeMm3 / (vol * plaP.fluxo) - 1) < 0.04, `anel de 0,5 mm: material ${r.volumeMm3.toFixed(1)} mm³ ≈ volume × fluxo (${pct(r.volumeMm3 / (vol * plaP.fluxo))})`);
}
{
  // parte grossa com largura variável: só muda nos cantos e nas partes finas (cubo ≈ clássico)
  const cubo = caixas([[0, 0, 0, 20, 20, 20]]);
  const rc = estimar(cubo, p1s, plaP, ajustesPadrao(p1s.processo)), rv = estimar(cubo, com(p1s, VAR), plaP, ajustesPadrao(p1s.processo));
  ok(Math.abs(rv.massaG / rc.massaG - 1) < 0.01 && Math.abs(rv.tempoS / rc.tempoS - 1) < 0.02, `cubo de 20 mm com largura variável ≈ clássico (${rv.massaG.toFixed(2)} × ${rc.massaG.toFixed(2)} g; ${(rv.tempoS / 60).toFixed(2)} × ${(rc.tempoS / 60).toFixed(2)} min)`);
  const rz = estimar(cubo, com(p1s, { preenchimentoVaos: true }), plaP, ajustesPadrao(p1s.processo));
  ok(rz.partes.vaos.volume < 1, `cubo sem vão estreito: preenchimento de vãos quase nada (${rz.partes.vaos.volume.toFixed(2)} mm³)`);
}

// ---------- 4. uma parede no topo, na 1ª camada e perímetro pequeno ----------
{
  const cubo = caixas([[0, 0, 0, 20, 20, 20]]);
  const laços = (t: Trecho[], parte: string) => t.filter((x) => x.parte === parte).length;
  const { cams } = camadas(cubo, com(p1s, { umaParedeTopo: true }));
  const ult = cams[cams.length - 1].trechos, meio = cams[50].trechos;
  ok(laços(ult, "paredeExt") === 1 && laços(ult, "paredeInt") === 0, `uma parede no topo: a última camada só tem o laço externo (${laços(ult, "paredeExt")} externo, ${laços(ult, "paredeInt")} internos)`);
  ok(laços(meio, "paredeExt") === 1 && laços(meio, "paredeInt") === 1, "camadas do meio continuam com 2 paredes");
  const Lint = (t: Trecho[]) => t.filter((x) => x.parte === "paredeInt").reduce((s, x) => s + comprimento(x.pts, x.fechado), 0);
  const c0 = camadas(cubo, p1s).cams;
  ok(Lint(c0[c0.length - 1].trechos) > 70 && Lint(ult) === 0, `comprimento da parede interna no topo: ${Lint(c0[c0.length - 1].trechos).toFixed(1)} mm → ${Lint(ult).toFixed(1)} mm`);
  const rc = estimar(cubo, p1s, plaP, ajustesPadrao(p1s.processo)), r1 = estimar(cubo, com(p1s, { umaParedeTopo: true }), plaP, ajustesPadrao(p1s.processo));
  ok(r1.partes.topo.volume > rc.partes.topo.volume && Math.abs(r1.volumeMm3 / rc.volumeMm3 - 1) < 0.01, `o topo sólido ocupa o lugar da parede interna (topo ${rc.partes.topo.volume.toFixed(1)} → ${r1.partes.topo.volume.toFixed(1)} mm³; total quase igual)`);
  const cobT = cobertura(cubo, com(p1s, { umaParedeTopo: true }), cams.length - 1);
  ok(cobT.cob > 0.97 && cobT.duplo < 0.05, `topo com uma parede: seção coberta (${pct(cobT.cob)}, dupla ${pct(cobT.duplo)})`);
  // degrau: topo do degrau de baixo perde a parede interna só onde não há nada em cima
  const degrau = caixas([[0, 0, 0, 20, 20, 10], [0, 0, 10, 10, 20, 20]]);
  const d0 = camadas(degrau, p1s).cams, d1 = camadas(degrau, com(p1s, { umaParedeTopo: true })).cams;
  const k = 49; // última camada do degrau de baixo (z 9,8–10)
  ok(Lint(d1[k].trechos) < Lint(d0[k].trechos) - 15 && Lint(d1[k].trechos) > 20, `degrau: na superfície de topo de baixo a parede interna encolhe (${Lint(d0[k].trechos).toFixed(1)} → ${Lint(d1[k].trechos).toFixed(1)} mm)`);
  const lim = camadas(degrau, com(p1s, { umaParedeTopo: true, umaParedeTopoLimite: 25 })).cams;
  ok(Math.abs(Lint(lim[k].trechos) - Lint(d0[k].trechos)) < 0.5, "topo mais estreito que o limite fica com todas as paredes");
  const pr1 = camadas(cubo, com(p1s, { umaParedePrimeira: true })).cams;
  ok(laços(pr1[0].trechos, "paredeExt") === 1 && laços(pr1[0].trechos, "paredeInt") === 0 && laços(pr1[1].trechos, "paredeInt") === 1, "uma parede só na 1ª camada");
  // perímetro pequeno: cilindro Ø5 (laços de ~15 mm) com limite de 20 mm anda a 30 mm/s
  const cil = cilindro(2.5, 5);
  const pq = com(p1s, { limitePerimetroPequeno: 20, vPerimetroPequeno: 30 });
  const cp = camadas(cil, pq).cams[10].trechos.filter((t) => t.parte === "paredeExt" || t.parte === "paredeInt");
  ok(cp.length === 2 && cp.every((t) => t.v === 30), "perímetros menores que o limite andam na velocidade de perímetro pequeno");
  const big = camadas(cilindro(10, 2), pq).cams[5].trechos.filter((t) => t.parte === "paredeExt");
  ok(big.every((t) => t.v === p1s.processo.vParedeExt), "perímetro maior que o limite continua na velocidade da parede");
  const rp = estimar(cil, pq, plaP, ajustesPadrao(p1s.processo)), rn = estimar(cil, p1s, plaP, ajustesPadrao(p1s.processo));
  ok(rp.partes.paredeExt.tempo > rn.partes.paredeExt.tempo && rp.massaG === rn.massaG, `perímetro pequeno: parede externa ${rn.partes.paredeExt.tempo.toFixed(0)} → ${rp.partes.paredeExt.tempo.toFixed(0)} s, mesmo material`);
  // Kobra 3 também
  const rk = estimar(placa, com(k3, VAR), plaK, ajustesPadrao(k3.processo));
  ok(Math.abs(rk.volumeMm3 / (volumeMalha(placa)! * plaK.fluxo) - 1) < 0.04, "Kobra 3: placa de 0,9 mm com largura variável ≈ volume × fluxo");
}

// ---------- 5. desempenho ----------
{
  const medir = (f: () => void) => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  };
  const cubo = caixas([[0, 0, 0, 20, 20, 20]]), cil = cilindro(10, 20);
  const tudo = com(p1s, { ...VAR, preenchimentoVaos: true, umaParedeTopo: true });
  // aquece o JIT
  estimar(cubo, p1s, plaP, ajustesPadrao(p1s.processo));
  estimar(cubo, tudo, plaP, ajustesPadrao(p1s.processo));
  let tc = 0, tv = 0;
  for (const m of [cubo, cil]) {
    tc += medir(() => estimar(m, p1s, plaP, ajustesPadrao(p1s.processo)));
    tv += medir(() => estimar(m, tudo, plaP, ajustesPadrao(p1s.processo)));
  }
  console.log(`  cubo + cilindro: clássico ${tc.toFixed(0)} ms, com tudo da M1 ligado ${tv.toFixed(0)} ms (${(tv / tc).toFixed(2)}×)`);
  ok(tv < 1.5 * tc + 100, `M1 ligada fatia em até ~1,5× o tempo do clássico (${(tv / tc).toFixed(2)}×)`);
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
  let r: ReturnType<typeof estimar> | null = null;
  const ms = medir(() => (r = estimar(esfera, tudo, plaP, { ...ajustesPadrao(p1s.processo), suporte: "arvore" })));
  console.log(`  esfera Ø40 com árvore e M1 ligada: ${(r!.tempoS / 60).toFixed(1)} min, ${r!.massaG.toFixed(1)} g, fatiada em ${(ms / 1000).toFixed(1)} s`);
  ok(ms < 15000 && Number.isFinite(r!.tempoS) && Number.isFinite(r!.massaG), "esfera de 40 mm com árvore e M1 ligada fatiada em poucos segundos");
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTodos os testes da M1 (paredes) passaram.");
if (falhas) process.exit(1);

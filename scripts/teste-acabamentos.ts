// Testes da fatia M3 do WJSlicer3D (src/slicer/acabamentos.ts + caminhos.ts + fatiar.ts): passar ferro, pele felpuda,
// vaso em espiral, pé de elefante, compensação XY de contorno e de furo, polifuro, modo de fatiamento e sequência por objeto.
// 1. Com os padrões o resultado é IDÊNTICO ao de antes da M3 (mesmos valores medidos antes da M2/M3, por igualdade exata).
// 2. Cada recurso ligado muda a geometria e o tempo/material do jeito esperado (contas à mão em cubo, cilindro e anel).
import { comprimento } from "../src/slicer/campo";
import { alturasCamadas, fatiarMalha, gerarCamada, type Contexto, type MalhaImpressao, type Trecho } from "../src/slicer/caminhos";
import { campoPolifuro, ladosPolifuro, peleFelpuda, ruidoSuave, vaziosDaSecao, vazioMaisPerto } from "../src/slicer/acabamentos";
import { estimar, fatiarPlaca, ajustesPadrao, espacamento, type Ajustes } from "../src/slicer/fatiar";
import { maquinaPorId, materialDa, ACABAMENTOS_PADRAO, type Maquina, type Processo } from "../src/slicer/perfis";
import { campoDe, valorValido } from "../src/slicer/esquema";

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas++;
};

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
function anel(R1: number, R2: number, H: number, n = 128): MalhaImpressao {
  const pos: number[] = [], tri: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n, c = Math.cos(a), s = Math.sin(a);
    pos.push(R1 * c, R1 * s, 0, R1 * c, R1 * s, H, R2 * c, R2 * s, 0, R2 * c, R2 * s, H);
  }
  for (let k = 0; k < n; k++) {
    const a = 4 * k, b = 4 * ((k + 1) % n);
    tri.push(a, b, b + 1, a, b + 1, a + 1, a + 2, a + 3, b + 3, a + 2, b + 3, b + 2, a + 1, b + 1, b + 3, a + 1, b + 3, a + 3, a, a + 2, b + 2, a, b + 2, b);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

const p1s = maquinaPorId("bbl-p1s"), k3 = maquinaPorId("acu-k3");
const plaP = materialDa(p1s, "pla");
const com = (maq: Maquina, extra: Partial<Processo>): Maquina => ({ ...maq, processo: { ...maq.processo, ...extra } });
const cubo = caixas([[0, 0, 0, 20, 20, 20]]), cil = cilindro(10, 20), aro = anel(12, 6, 10);
const ajP = ajustesPadrao(p1s.processo);
const finito = (r: ReturnType<typeof estimar>) => Number.isFinite(r.tempoS) && Number.isFinite(r.massaG) && Object.values(r.partes).every((p) => Number.isFinite(p.tempo) && Number.isFinite(p.volume));
const est = (m: MalhaImpressao, maq: Maquina, aj: Ajustes = ajustesPadrao(maq.processo)) => estimar(m, maq, materialDa(maq, "pla"), aj);

/** Trechos de todas as camadas (contexto igual ao do fatiamento da mesa, camadas em ordem). */
function camadas(m: MalhaImpressao, maq: Maquina) {
  const pr = maq.processo, aj = ajustesPadrao(pr);
  let H = 0;
  for (let k = 2; k < m.pos.length; k += 3) H = Math.max(H, m.pos[k]);
  const zs = alturasCamadas(H, pr.alturaPrimeira, aj.altura);
  const f = fatiarMalha(m, zs, 1, undefined, undefined, undefined, pr.modoFatiamento);
  const ctx: Contexto = { f, maq, aj, zs, vazaoMax: materialDa(maq, "pla").vazaoMax, sup: null, campoAbaixo: null };
  return { f, zs, cams: zs.map((_, i) => gerarCamada(ctx, i)) };
}
const lacosExt = (ts: Trecho[]) => ts.filter((t) => t.parte === "paredeExt" && t.fechado);
const maisLongo = (ts: Trecho[]) => ts.reduce((a, t) => (comprimento(t.pts, true) > comprimento(a.pts, true) ? t : a));
const maisCurto = (ts: Trecho[]) => ts.reduce((a, t) => (comprimento(t.pts, true) < comprimento(a.pts, true) ? t : a));

// ---------- 1. padrões = idêntico ao de antes da M3 ----------
{
  const ANTES: Record<string, [number, number]> = {
    "cubo bbl-p1s": [448.4882124366969, 3.5694883434303946], "cubo acu-k3": [839.6080841847775, 3.5736743340414048],
    "cilindro bbl-p1s": [432.54714235484005, 2.8800808290131004], "cilindro acu-k3": [815.8028698864206, 2.7247201269232315],
    "balanço bbl-p1s": [503.62684651447876, 1.8299109048905517], "balanço acu-k3": [933.5398877388595, 1.7837813434174021],
  };
  const balanco = caixas([[10, 0, 0, 20, 10, 20], [0, 0, 20, 30, 10, 23]]);
  for (const [nome, m] of [["cubo", cubo], ["cilindro", cil], ["balanço", balanco]] as [string, MalhaImpressao][])
    for (const maq of [p1s, k3]) {
      const r = est(m, maq);
      const [t, g] = ANTES[`${nome} ${maq.id}`];
      ok(r.tempoS === t && r.massaG === g, `${nome} ${maq.modelo} com os padrões: ${(r.tempoS / 60).toFixed(2)} min, ${r.massaG.toFixed(3)} g — idêntico ao de antes`);
    }
  const MESA: Record<string, [number, number]> = {
    "balanço bbl-p1s nenhum": [622.1874596234686, 3.82285623947027], "balanço bbl-p1s normal": [701.4789719318912, 5.626359977776537],
    "balanço bbl-p1s arvore": [877.2811228446797, 4.731760494125111], "balanço acu-k3 nenhum": [1064.5255819488373, 3.72349804242393],
    "balanço acu-k3 normal": [1358.536471373554, 9.245296461642637], "balanço acu-k3 arvore": [1172.6697956913365, 5.797836542822304],
    "anel bbl-p1s nenhum": [580.4050455148848, 4.896189535573802], "anel acu-k3 nenhum": [623.4541810188366, 4.482468921999566],
    "duas bbl-p1s nenhum": [246.52182327934878, 1.468732420384013], "duas acu-k3 nenhum": [323.3394748441088, 1.4209490430194334],
  };
  const duas = caixas([[0, 0, 0, 8, 8, 6], [14, 0, 0, 22, 8, 6]]);
  let todos = true;
  for (const [chave, [t, g]] of Object.entries(MESA)) {
    const [nome, id, sup] = chave.split(" ");
    const m = nome === "balanço" ? balanco : nome === "anel" ? aro : duas, maq = maquinaPorId(id);
    const aj = { ...ajustesPadrao(maq.processo), suporte: sup as "nenhum", borda: true, saia: true };
    const r = fatiarPlaca([{ nome, malha: m, posicoes: [[-25, 0], [25, 0]] }], maq, materialDa(maq, "pla"), aj).r;
    if (r.tempoS !== t || r.massaG !== g) {
      todos = false;
      console.log(`  ${chave}: ${r.tempoS} s, ${r.massaG} g (antes ${t}, ${g})`);
    }
  }
  ok(todos, "mesa com 2 cópias, borda, saia e suporte normal/árvore (10 casos, P1S e Kobra 3): idênticos ao de antes");
  const pr = p1s.processo;
  ok(Object.entries(ACABAMENTOS_PADRAO).every(([k, v]) => pr[k as keyof Processo] === v && k3.processo[k as keyof Processo] === v), "padrões da M3 nas duas impressoras: sem ferro, sem pele felpuda, sem espiral, sem compensação, normal, por camada");
  const ids = Object.keys(ACABAMENTOS_PADRAO);
  ok(ids.length === 19 && ids.every((k) => campoDe(k)?.origem === "processo" && (campoDe(k)?.estado === "motor" || k === "modoFatiamento") && valorValido(campoDe(k)!, pr[k as keyof Processo])),
    "esquema: os 19 campos da M3 vêm do processo, estão ✅ no motor (modo de fatiamento 🟡) e o padrão é válido");
  // par-ímpar = normal (a regra do corte de hoje)
  const a = est(aro, p1s), b = est(aro, com(p1s, { modoFatiamento: "parImpar" }));
  ok(a.tempoS === b.tempoS && a.massaG === b.massaG, "modo par-ímpar = normal (mesma regra do corte)");
}

// ---------- 2. passar ferro ----------
{
  const base = est(cubo, p1s);
  const h = p1s.processo.altura, fl = 0.15;
  const ferro = est(cubo, com(p1s, { ferroTipo: "todasTopo" }));
  const dV = ferro.partes.topo.volume - base.partes.topo.volume;
  // a área passada a ferro é o topo dentro das paredes: entre (20 − 2·0,9)² e (20 − 2·0,6)²
  const area = dV / (h * fl * plaP.fluxo);
  ok(area > (20 - 1.8) ** 2 && area < (20 - 1.2) ** 2, `cubo, todas as superfícies de topo: material do ferro = área ${area.toFixed(1)} mm² × camada × 15 % (área entre ${((20 - 1.8) ** 2).toFixed(0)} e ${((20 - 1.2) ** 2).toFixed(0)} mm²)`);
  const dT = ferro.tempoS - base.tempoS, Lfe = area / 0.1;
  ok(dT > (0.9 * Lfe) / 15 && dT < (1.6 * Lfe) / 15, `tempo do ferro ${dT.toFixed(0)} s ≈ ${Lfe.toFixed(0)} mm de linhas a 15 mm/s (${(Lfe / 15).toFixed(0)} s mais as voltas)`);
  ok(base.partes.paredeExt.volume === ferro.partes.paredeExt.volume && base.partes.esparso.volume === ferro.partes.esparso.volume, "ferro não muda paredes nem esparso");
  // só o topo mais alto × todas as superfícies (degrau: duas superfícies de topo)
  const degrau = caixas([[0, 0, 0, 20, 10, 5], [0, 10, 0, 20, 20, 10]]);
  const b0 = est(degrau, p1s);
  const so = est(degrau, com(p1s, { ferroTipo: "soTopoMaisAlto" })).partes.topo.volume - b0.partes.topo.volume;
  const tod = est(degrau, com(p1s, { ferroTipo: "todasTopo" })).partes.topo.volume - b0.partes.topo.volume;
  ok(so > 0 && tod > 1.6 * so, `degrau: "todas as superfícies" (${tod.toFixed(1)} mm³) passa nos dois topos, "só o mais alto" (${so.toFixed(1)} mm³) só no de cima`);
  const sol = est(cubo, com(p1s, { ferroTipo: "todoSolido" })).partes;
  const dSol = sol.topo.volume - base.partes.topo.volume;
  ok(dSol > 5 * dV, `todo o sólido: passa em todas as camadas sólidas (fundo e topo), ${(dSol / dV).toFixed(1)}× o só topo`);
  const conc = est(cubo, com(p1s, { ferroTipo: "todasTopo", ferroPadrao: "concentrico" })).partes.topo.volume - base.partes.topo.volume;
  ok(Math.abs(conc / dV - 1) < 0.1, `concêntrico cobre a mesma área (${(conc / dV * 100).toFixed(0)} % do retilíneo)`);
  const rec = est(cubo, com(p1s, { ferroTipo: "todasTopo", ferroRecuo: 2 })).partes.topo.volume - base.partes.topo.volume;
  const esperado = ((Math.sqrt(area) - 4) / Math.sqrt(area)) ** 2;
  ok(Math.abs(rec / dV - esperado) < 0.05, `recuo de 2 mm: área cai para ${(rec / dV * 100).toFixed(0)} % (conta: ${(esperado * 100).toFixed(0)} %)`);
  const dobro = est(cubo, com(p1s, { ferroTipo: "todasTopo", ferroFluxo: 0.3 })).partes.topo.volume - base.partes.topo.volume;
  ok(Math.abs(dobro / dV - 2) < 1e-6, "fluxo de 30 % = o dobro do material do ferro");
  // direção: ângulo 0 cruza as linhas do topo; 45° a mais gira as linhas
  const { cams } = camadas(cubo, com(p1s, { ferroTipo: "todasTopo" }));
  const ult = cams[cams.length - 1].trechos;
  const flF = (fl * 0.1) / espacamento(p1s.processo.lTopo, h);
  const linhasF = ult.filter((t) => Math.abs(t.fluxo - flF) < 1e-9);
  const dir = (t: Trecho) => Math.atan2(t.pts[3] - t.pts[1], t.pts[2] - t.pts[0]);
  const topo = ult.find((t) => t.parte === "topo" && Math.abs(t.fluxo - flF) > 1e-9)!;
  const cruz = Math.abs(Math.cos(dir(linhasF[0]) - dir(topo)));
  ok(linhasF.length > 0 && cruz < 0.02, `ângulo 0: as linhas do ferro cruzam as do topo (cos ${cruz.toFixed(3)})`);
  ok(cams.slice(0, -5).every((c) => !c.trechos.some((t) => Math.abs(t.fluxo - flF) < 1e-9)), "camadas sem superfície de topo não são passadas a ferro (nem a 1ª)");
  ok(finito(ferro), "ferro sem NaN");
}

// ---------- 3. pele felpuda ----------
{
  const pts = Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10]);
  const f = peleFelpuda(pts, true, { espessura: 0.4, distancia: 0.5, ruido: "aleatorio", z: 1, semente: 5 });
  let fora = 0;
  for (let k = 0; k < f.length; k += 2) {
    const x = f[k], y = f[k + 1];
    const d = Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(y), Math.abs(y - 10));
    if (d > 0.2 + 1e-9) fora++;
  }
  ok(f.length / 2 === 80 && fora === 0, `quadrado de 10 mm: ${f.length / 2} pontos a cada 0,5 mm, todos a até ±0,2 mm do contorno`);
  const g = peleFelpuda(pts, true, { espessura: 0.4, distancia: 0.5, ruido: "aleatorio", z: 1, semente: 5 });
  ok(f.every((v, k) => v === g[k]), "mesma peça = mesma pele (sorteio fixo)");
  let suave = 0;
  for (let k = 0; k < 200; k++) suave = Math.max(suave, Math.abs(ruidoSuave(k * 0.05, 0.3, 0.7, 3) - ruidoSuave((k + 1) * 0.05, 0.3, 0.7, 3)));
  ok(suave < 0.2, `ruído suave muda pouco de ponto a ponto (salto máximo ${suave.toFixed(3)})`);

  const base = est(cubo, p1s);
  const pele = est(cubo, com(p1s, { peleFelpuda: "contorno" }));
  ok(pele.partes.paredeExt.volume > base.partes.paredeExt.volume * 1.001 && pele.partes.paredeInt.volume === base.partes.paredeInt.volume,
    `contorno: parede externa com mais caminho (+${((pele.partes.paredeExt.volume / base.partes.paredeExt.volume - 1) * 100).toFixed(1)} %), internas iguais`);
  const { cams } = camadas(cubo, com(p1s, { peleFelpuda: "contorno" }));
  const { cams: c0 } = camadas(cubo, p1s);
  const e0 = lacosExt(c0[0].trechos)[0], e1 = lacosExt(cams[0].trechos)[0];
  ok(e0.pts.length === e1.pts.length && e0.pts.every((v, k) => v === e1.pts[k]), "a 1ª camada não ganha pele felpuda");
  const sE = espacamento(p1s.processo.lParedeExt, p1s.processo.altura);
  let maxD = 0;
  const l5 = lacosExt(cams[5].trechos)[0];
  for (let k = 0; k < l5.pts.length; k += 2) {
    const x = l5.pts[k], y = l5.pts[k + 1];
    maxD = Math.max(maxD, Math.min(Math.abs(x - sE / 2), Math.abs(x - 20 + sE / 2), Math.abs(y - sE / 2), Math.abs(y - 20 + sE / 2)));
  }
  ok(maxD <= 0.15 + 0.01, `camada 6: a pele fica a até ±0,15 mm da parede externa (${maxD.toFixed(3)} mm)`);
  const aleat = est(cubo, com(p1s, { peleFelpuda: "contorno", peleRuido: "aleatorio" }));
  ok(aleat.tempoS !== pele.tempoS && aleat.partes.paredeExt.volume > base.partes.paredeExt.volume * 1.01, `ruído aleatório: pele mais áspera (+${((aleat.partes.paredeExt.volume / base.partes.paredeExt.volume - 1) * 100).toFixed(1)} % de parede externa)`);
  const tod = est(cubo, com(p1s, { peleFelpuda: "todasParedes" }));
  ok(tod.partes.paredeInt.volume > base.partes.paredeInt.volume * 1.001, "todas as paredes: as internas também ganham pele");
  // anel: contorno = só o de fora; contorno e furos = os dois
  const { cams: ca } = camadas(aro, com(p1s, { peleFelpuda: "contorno" }));
  const { cams: cb } = camadas(aro, com(p1s, { peleFelpuda: "contornoFuros" }));
  const { cams: cn } = camadas(aro, p1s);
  const furoN = maisCurto(lacosExt(cn[5].trechos)), furoA = maisCurto(lacosExt(ca[5].trechos)), furoB = maisCurto(lacosExt(cb[5].trechos));
  const extN = maisLongo(lacosExt(cn[5].trechos)), extA = maisLongo(lacosExt(ca[5].trechos));
  const igual = (a: Trecho, b: Trecho) => a.pts.length === b.pts.length && a.pts.every((v, k) => v === b.pts[k]);
  ok(igual(furoA, furoN) && !igual(extA, extN) && !igual(furoB, furoN),
    "anel: \"contorno\" mexe só no laço de fora; \"contorno e furos\" também no furo");
  ok(finito(tod) && finito(aleat), "pele felpuda sem NaN");
}

// ---------- 4. vaso em espiral ----------
{
  const pr = p1s.processo;
  const vaso = est(cil, com(p1s, { vasoEspiral: true }));
  // o mesmo caminho fatiado do jeito comum (uma parede, sem topo nem preenchimento): mesmo material, mais paradas
  const comum = est(cil, p1s, { ...ajP, paredes: 1, topo: 0, preenchimento: 0 });
  // (o fatiamento comum ainda fecha a última camada com a superfície de topo; o vaso fica aberto)
  ok(Math.abs(vaso.volumeMm3 - (comum.volumeMm3 - comum.partes.topo.volume)) < 1e-9 * comum.volumeMm3, `cilindro: material do vaso = uma parede sem topo nem preenchimento, aberto em cima (${vaso.massaG.toFixed(3)} g)`);
  ok(vaso.partes.paredeInt.volume === 0 && vaso.partes.esparso.volume === 0 && vaso.partes.topo.volume === 0, "vaso: sem parede interna, esparso nem topo");
  ok(vaso.partes.solido.volume > 0, "vaso: o fundo continua sólido");
  const nEsp = vaso.camadas - Math.max(pr.fundo, Math.ceil(pr.fundoMm / pr.altura - 1e-6));
  const ganho = comum.partes.deslocamento.tempo - vaso.partes.deslocamento.tempo;
  ok(ganho > 0.5 * nEsp * (p1s.retracao / p1s.vRetracao), `vaso: ${nEsp} camadas sem troca de camada parada (deslocamentos −${ganho.toFixed(1)} s)`);
  const { cams } = camadas(cil, com(p1s, { vasoEspiral: true }));
  ok(cams.slice(3).every((c) => c.espiral && c.trechos.length === 1 && c.trechos[0].parte === "paredeExt"), "camadas do espiral: um laço só, a parede externa");
  const duas = caixas([[0, 0, 0, 8, 8, 6], [14, 0, 0, 22, 8, 6]]);
  const r2 = est(duas, com(p1s, { vasoEspiral: true }));
  ok(r2.avisos.some((a) => a.includes("só o maior")), "duas ilhas no vaso: aviso de que só o maior laço é impresso");
  const mesa = fatiarPlaca([{ nome: "c", malha: cil, posicoes: [[-40, 0], [40, 0]] }], com(p1s, { vasoEspiral: true }), plaP, ajP).r;
  ok(mesa.avisos.some((a) => a.includes("mais de uma peça")), "vaso com duas cópias por camada: aviso");
  ok(finito(vaso), "vaso sem NaN");
}

// ---------- 5. pé de elefante e compensação XY ----------
{
  const { cams: c0 } = camadas(cubo, p1s);
  const { cams: cp } = camadas(cubo, com(p1s, { peDeElefante: 0.2 }));
  const L0 = comprimento(lacosExt(c0[0].trechos)[0].pts, true), Lp = comprimento(lacosExt(cp[0].trechos)[0].pts, true);
  ok(Math.abs(L0 - Lp - 8 * 0.2) < 0.1, `pé de elefante 0,2 mm: o laço externo da 1ª camada encolhe ${(L0 - Lp).toFixed(3)} mm (conta: 1,6 mm)`);
  const L1 = comprimento(lacosExt(c0[1].trechos)[0].pts, true), L1p = comprimento(lacosExt(cp[1].trechos)[0].pts, true);
  ok(Math.abs(L1 - L1p) < 1e-9, "pé de elefante: da 2ª camada em diante nada muda");
  ok(est(cubo, com(p1s, { peDeElefante: 0.2 })).massaG < est(cubo, p1s).massaG, "pé de elefante: menos material na 1ª camada");

  const { cams: cc } = camadas(cubo, com(p1s, { compensacaoContornoXY: 0.1 }));
  const dL = [0, 10, 50].map((i) => comprimento(lacosExt(cc[i].trechos)[0].pts, true) - comprimento(lacosExt(c0[i].trechos)[0].pts, true));
  ok(dL.every((d) => Math.abs(d - 0.8) < 0.1), `contorno +0,1 mm: o laço externo cresce ${dL.map((d) => d.toFixed(3)).join(" / ")} mm em todas as camadas (conta: 0,8)`);
  const { cams: an } = camadas(aro, p1s);
  const { cams: af } = camadas(aro, com(p1s, { compensacaoFuroXY: 0.1 }));
  const dFuro = comprimento(maisCurto(lacosExt(af[5].trechos)).pts, true) - comprimento(maisCurto(lacosExt(an[5].trechos)).pts, true);
  const dExt = comprimento(maisLongo(lacosExt(af[5].trechos)).pts, true) - comprimento(maisLongo(lacosExt(an[5].trechos)).pts, true);
  ok(Math.abs(dFuro - 2 * Math.PI * 0.1) < 0.05 && Math.abs(dExt) < 1e-9, `furo +0,1 mm: o laço do furo cresce ${dFuro.toFixed(3)} mm (conta: 2π·0,1 = 0,628), o de fora não muda`);
  const { cams: am } = camadas(aro, com(p1s, { compensacaoFuroXY: -0.1, compensacaoContornoXY: -0.1 }));
  const dm = comprimento(maisLongo(lacosExt(am[5].trechos)).pts, true) - comprimento(maisLongo(lacosExt(an[5].trechos)).pts, true);
  ok(Math.abs(dm + 2 * Math.PI * 0.1) < 0.05, `contorno −0,1 mm no anel: o de fora encolhe ${(-dm).toFixed(3)} mm (conta: 0,628)`);
}

// ---------- 6. polifuro ----------
{
  ok(ladosPolifuro(3) === 6 && ladosPolifuro(12) === 24 && ladosPolifuro(0.5) === 3, "lados do polifuro: Ø3 → 6, Ø12 → 24, mínimo 3");
  const fp = { cx: 0, cy: 0, r: 5, lados: 6 };
  ok(Math.abs(campoPolifuro(fp, 5, 0)) < 1e-12 && Math.abs(campoPolifuro(fp, 5 / Math.cos(Math.PI / 6) * Math.cos(Math.PI / 6), 5 * Math.tan(Math.PI / 6))) < 1e-9 && campoPolifuro(fp, 0, 0) === -5,
    "campo do polifuro: zero no meio do lado e no canto, −r no centro");
  const { cams: an } = camadas(aro, p1s);
  const { cams: ap } = camadas(aro, com(p1s, { furoParaPolifuro: true }));
  const sE = espacamento(p1s.processo.lParedeExt, p1s.processo.altura);
  const furo = maisCurto(lacosExt(ap[5].trechos));
  const n = ladosPolifuro(12), passo = (2 * Math.PI) / n;
  let erro = 0, rMax = 0;
  for (let k = 0; k < furo.pts.length; k += 2) {
    const x = furo.pts[k], y = furo.pts[k + 1];
    let m = -Infinity;
    for (let j = 0; j < n; j++) m = Math.max(m, x * Math.cos(j * passo) + y * Math.sin(j * passo));
    erro = Math.max(erro, Math.abs(m - (6 + sE / 2)));
    rMax = Math.max(rMax, Math.hypot(x, y));
  }
  ok(erro < 0.03, `anel Ø12: a parede do furo vira um polígono de ${n} lados a ${(6 + sE / 2).toFixed(3)} mm do centro (erro ${erro.toFixed(3)} mm)`);
  ok(rMax > (6 + sE / 2) / Math.cos(Math.PI / n) - 0.03, `os cantos do polifuro saem do círculo (${rMax.toFixed(3)} mm; círculo inscrito ${(6 + sE / 2).toFixed(3)})`);
  const extN = maisLongo(lacosExt(an[5].trechos)), extP = maisLongo(lacosExt(ap[5].trechos));
  ok(Math.abs(comprimento(extN.pts, true) - comprimento(extP.pts, true)) < 1e-9, "polifuro não mexe no contorno de fora");
  const c1 = est(cubo, p1s), c2 = est(cubo, com(p1s, { furoParaPolifuro: true }));
  ok(c1.tempoS === c2.tempoS && c1.massaG === c2.massaG, "peça sem furo: polifuro não muda nada");
  // vazios: o de fora e o furo
  const { f } = camadas(aro, p1s);
  const N = f.g.cols * f.g.lins, dentro = new Uint8Array(N);
  for (let q = 0; q < N; q++) dentro[q] = (f.bits[5][q >>> 5] >>> (q & 31)) & 1;
  const v = vaziosDaSecao(dentro, f.g), perto = vazioMaisPerto(v.rot, f.g);
  const externos = [...v.externo].filter((x) => x).length;
  ok(v.n === 2 && externos === 1 && perto.every((k) => k > 0), "anel: dois vazios (fora e furo) e toda célula sabe o mais perto");
}

// ---------- 7. fechar furos ----------
{
  const normal = est(aro, p1s), fechado = est(aro, com(p1s, { modoFatiamento: "fecharFuros" })), disco = est(cilindro(12, 10), p1s);
  const zs = alturasCamadas(10, p1s.processo.alturaPrimeira, p1s.processo.altura);
  const aN = fatiarMalha(aro, zs, 1).areas[5], aF = fatiarMalha(aro, zs, 1, undefined, undefined, undefined, "fecharFuros").areas[5];
  ok(Math.abs(aF - Math.PI * 144) < 3 && Math.abs(aN - Math.PI * (144 - 36)) < 3 && fechado.massaG !== normal.massaG, `anel com "fechar furos": seção ${aF.toFixed(0)} mm² (π·12² = 452; o anel tem ${aN.toFixed(0)})`);
  ok(Math.abs(fechado.massaG / disco.massaG - 1) < 0.01, `anel fechado ≈ disco cheio de Ø24 (${fechado.massaG.toFixed(3)} × ${disco.massaG.toFixed(3)} g)`);
  const { cams } = camadas(aro, com(p1s, { modoFatiamento: "fecharFuros" }));
  ok(cams.every((c) => lacosExt(c.trechos).length === 1), "fechar furos: cada camada só com o laço de fora");
  const c1 = est(cubo, p1s), c2 = est(cubo, com(p1s, { modoFatiamento: "fecharFuros" }));
  ok(c1.tempoS === c2.tempoS && c1.massaG === c2.massaG, "peça sem furo: fechar furos não muda nada");
}

// ---------- 8. sequência por objeto ----------
{
  const peca = caixas([[0, 0, 0, 8, 8, 6]]);
  const pos: [number, number][] = [[-60, 0], [60, 0]];
  const camada = fatiarPlaca([{ nome: "p", malha: peca, posicoes: pos }], p1s, plaP, ajP);
  const objeto = fatiarPlaca([{ nome: "p", malha: peca, posicoes: pos }], com(p1s, { sequenciaImpressao: "porObjeto" }), plaP, ajP);
  ok(Math.abs(objeto.r.massaG - camada.r.massaG) < 1e-9 * camada.r.massaG, `por objeto: o mesmo material (${objeto.r.massaG.toFixed(3)} g)`);
  ok(objeto.r.partes.deslocamento.tempo < camada.r.partes.deslocamento.tempo - 3,
    `por objeto: cópias a 120 mm, os deslocamentos caem de ${camada.r.partes.deslocamento.tempo.toFixed(0)} para ${objeto.r.partes.deslocamento.tempo.toFixed(0)} s (uma ida só)`);
  ok(objeto.previa.seg.length === camada.previa.seg.length && objeto.previa.seg.every((s, i) => s.length === camada.previa.seg[i].length), "por objeto: a prévia continua com todas as camadas das duas cópias");
  const uma = est(cubo, com(p1s, { sequenciaImpressao: "porObjeto" })), umaC = est(cubo, p1s);
  ok(uma.tempoS === umaC.tempoS && uma.massaG === umaC.massaG, "uma cópia só: por objeto = por camada");
  const perto = fatiarPlaca([{ nome: "p", malha: peca, posicoes: [[-9, 0], [9, 0]] }], com(p1s, { sequenciaImpressao: "porObjeto", sequenciaFolga: 20 }), plaP, ajP).r;
  const longe = fatiarPlaca([{ nome: "p", malha: peca, posicoes: [[-9, 0], [9, 0]] }], com(p1s, { sequenciaImpressao: "porObjeto", sequenciaFolga: 5 }), plaP, ajP).r;
  ok(perto.avisos.some((a) => a.includes("Sequência por objeto")) && !longe.avisos.some((a) => a.includes("Sequência por objeto")), "folga entre objetos: 10 mm entre as cópias avisa com folga de 20 mm, não avisa com 5 mm");
  // espiral por objeto: cada cópia sobe sem parar
  const vasos = fatiarPlaca([{ nome: "c", malha: cil, posicoes: [[-40, 0], [40, 0]] }], com(p1s, { vasoEspiral: true, sequenciaImpressao: "porObjeto" }), plaP, ajP).r;
  ok(!vasos.avisos.some((a) => a.includes("mais de uma peça")) && finito(vasos), "vaso em espiral por objeto: sem aviso, sem NaN");
}

// ---------- 9. tudo ligado ----------
{
  const tudo = com(k3, {
    ferroTipo: "todasTopo", ferroPadrao: "concentrico", peleFelpuda: "todasParedes", peDeElefante: 0.15, compensacaoContornoXY: 0.05, compensacaoFuroXY: 0.1,
    furoParaPolifuro: true, sequenciaImpressao: "porObjeto", sequenciaFolga: 5,
  });
  const r = fatiarPlaca([{ nome: "anel", malha: aro, posicoes: [[-30, 0], [30, 0]] }], tudo, materialDa(k3, "pla"), { ...ajustesPadrao(k3.processo), borda: true, saia: true, suporte: "arvore" }).r;
  ok(finito(r) && r.massaG > 0, `tudo ligado no Kobra 3 (anel, 2 cópias, borda, saia, árvore): ${(r.tempoS / 60).toFixed(1)} min, ${r.massaG.toFixed(2)} g, sem NaN`);
}

if (falhas) {
  console.log(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\nTodos os testes da M3 (acabamentos) passaram.");

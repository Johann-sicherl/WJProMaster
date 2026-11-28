// Testes da fatia M2 do WJSlicer3D (src/slicer/costura.ts + caminhos.ts + fatiar.ts): posição da costura (mais próxima,
// alinhada, alinhada atrás, atrás, aleatória), costuras internas alternadas, vão da costura, costura em rampa
// (escarfada), limpar nos laços / antes da parede externa, ordem das paredes e evitar cruzar paredes.
// 1. Com os padrões o resultado é IDÊNTICO ao de antes da M2 (valores medidos antes de mexer, por igualdade exata).
// 2. Costura alinhada em cubo (no canto, na mesma vertical) e em cilindro (na mesma vertical); atrás; aleatória.
// 3. Rampa e ordem não mudam o material das paredes; vão tira o que deve; ordem, rampa e limpeza mudam o tempo como
//    esperado; desvio fica dentro da peça; sem NaN.
import { campoDistancia, amostrar, rasterizar, comprimento } from "../src/slicer/campo";
import { alturasCamadas, fatiarMalha, gerarCamada, type Contexto, type MalhaImpressao, type Trecho } from "../src/slicer/caminhos";
import { escolherCostura, notasDeCanto, transformarLaco, desviar, girar, sorteio } from "../src/slicer/costura";
import { estimar, fatiarPlaca, ajustesPadrao, espacamento } from "../src/slicer/fatiar";
import { maquinaPorId, materialDa, COSTURA_PADRAO, type Maquina, type Processo } from "../src/slicer/perfis";
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
const volParedes = (r: ReturnType<typeof estimar>) => r.partes.paredeExt.volume + r.partes.paredeInt.volume;
const finito = (r: ReturnType<typeof estimar>) => Number.isFinite(r.tempoS) && Number.isFinite(r.massaG) && Object.values(r.partes).every((p) => Number.isFinite(p.tempo) && Number.isFinite(p.volume));

/** Trechos de todas as camadas (contexto igual ao do fatiamento da mesa, as camadas em ordem). */
function camadas(m: MalhaImpressao, maq: Maquina, paredes?: number) {
  const pr = maq.processo, aj = { ...ajustesPadrao(pr), ...(paredes ? { paredes } : {}) };
  let H = 0;
  for (let k = 2; k < m.pos.length; k += 3) H = Math.max(H, m.pos[k]);
  const zs = alturasCamadas(H, pr.alturaPrimeira, aj.altura);
  const f = fatiarMalha(m, zs, 1);
  const ctx: Contexto = { f, maq, aj, zs, vazaoMax: materialDa(maq, "pla").vazaoMax, sup: null, campoAbaixo: null };
  return { f, zs, cams: zs.map((_, i) => gerarCamada(ctx, i)) };
}
/** Costura (início) do laço externo de cada camada. */
const costurasExt = (cams: { trechos: Trecho[] }[]) => cams.map((c) => c.trechos.find((t) => t.parte === "paredeExt")!).map((t) => [t.pts[0], t.pts[1]] as [number, number]);
const espalhamento = (ps: [number, number][]) => {
  const mx = ps.reduce((s, p) => s + p[0], 0) / ps.length, my = ps.reduce((s, p) => s + p[1], 0) / ps.length;
  return Math.max(...ps.map((p) => Math.hypot(p[0] - mx, p[1] - my)));
};

// ---------- 1. padrões = idêntico ao de antes da M2 ----------
{
  const ANTES: Record<string, [number, number]> = {
    "cubo bbl-p1s": [448.4882124366969, 3.5694883434303946], "cubo acu-k3": [839.6080841847775, 3.5736743340414048],
    "cilindro bbl-p1s": [432.54714235484005, 2.8800808290131004], "cilindro acu-k3": [815.8028698864206, 2.7247201269232315],
    "balanço bbl-p1s": [503.62684651447876, 1.8299109048905517], "balanço acu-k3": [933.5398877388595, 1.7837813434174021],
  };
  const balanco = caixas([[10, 0, 0, 20, 10, 20], [0, 0, 20, 30, 10, 23]]);
  for (const [nome, m] of [["cubo", cubo], ["cilindro", cil], ["balanço", balanco]] as [string, MalhaImpressao][])
    for (const maq of [p1s, k3]) {
      const r = estimar(m, maq, materialDa(maq, "pla"), ajustesPadrao(maq.processo));
      const [t, g] = ANTES[`${nome} ${maq.id}`];
      ok(r.tempoS === t && r.massaG === g, `${nome} ${maq.modelo} com os padrões: ${(r.tempoS / 60).toFixed(2)} min, ${r.massaG.toFixed(3)} g — idêntico ao de antes`);
    }
  // mesa com 2 cópias, borda, saia e suporte (o caminho de emissão inteiro), medidos antes da M2
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
  ok(todos, `mesa com 2 cópias, borda, saia e suporte normal/árvore (10 casos, P1S e Kobra 3): idênticos ao de antes`);
  const pr = p1s.processo;
  ok(Object.entries(COSTURA_PADRAO).every(([k, v]) => pr[k as keyof Processo] === v && k3.processo[k as keyof Processo] === v), "padrões da M2 nas duas impressoras: mais próxima, sem rampa, vão, limpeza nem desvio, de dentro para fora");
  ok(Object.keys(COSTURA_PADRAO).length === 15 && Object.keys(COSTURA_PADRAO).every((k) => campoDe(k)?.origem === "processo" && campoDe(k)?.estado === "motor" && valorValido(campoDe(k)!, pr[k as keyof Processo])), "esquema: os 15 campos da M2 vêm do processo, estão ✅ no motor e o padrão é válido");
}

// ---------- 2. costura: escolha do vértice (conta pura) ----------
{
  // quadrado de 10 mm anti-horário com vértices a cada 0,5 mm
  const q: number[] = [];
  const lado = (x0: number, y0: number, dx: number, dy: number) => {
    for (let k = 0; k < 20; k++) q.push(x0 + dx * k * 0.5, y0 + dy * k * 0.5);
  };
  lado(0, 0, 1, 0);
  lado(10, 0, 0, 1);
  lado(10, 10, -1, 0);
  lado(0, 10, 0, -1);
  const p = Float64Array.from(q);
  const nota = notasDeCanto(p);
  const cantos = [0, 20, 40, 60];
  ok(cantos.every((k) => nota[k] > 0.5) && [10, 30, 50, 70].every((k) => nota[k] === 0), `notas de canto: os 4 cantos > 0,5 (${cantos.map((k) => nota[k].toFixed(2)).join(", ")}), o meio dos lados 0`);
  const k = escolherCostura(p, "alinhada", null, [9.6, 10.3], () => 0);
  ok(k === 40, `alinhada: a costura da camada de baixo perto de (10, 10) puxa para o canto (10, 10) (vértice ${k})`);
  const k2 = escolherCostura(p, "alinhada", null, [5, -0.2], () => 0);
  ok(k2 === 10, `alinhada: no meio de um lado, longe dos cantos, fica na referência (vértice ${k2} = (5, 0))`);
  const ka = escolherCostura(p, "atras", null, [], () => 0);
  ok(p[ka * 2 + 1] === 10 && p[ka * 2] === 0, `atrás: o canto do fundo à esquerda (${p[ka * 2]}, ${p[ka * 2 + 1]})`);
  const km = escolherCostura(p, "maisProxima", [7.2, -3], [], () => 0);
  ok(km === 14, `mais próxima: o vértice mais perto do bico (${p[km * 2]}, ${p[km * 2 + 1]})`);
  const r1 = sorteio(5), r2 = sorteio(5);
  ok(escolherCostura(p, "aleatoria", null, [], r1) === escolherCostura(p, "aleatoria", null, [], r2), "aleatória: determinística (mesma semente, mesmo vértice)");
  // rampa e vão no laço
  const t: Trecho = { pts: p, fechado: true, parte: "paredeExt", w: 0.42, fluxo: 1, v: 200, a: 5000, j: 9 };
  const g0 = girar(t, 0);
  const vol = (ts: Trecho[]) => ts.reduce((s, x) => s + comprimento(x.pts, x.fechado) * x.fluxo, 0);
  const rampa = transformarLaco(g0, { vao: 0, rampa: true, rampaAltura: 0, rampaComp: 10, rampaPassos: 10, rampaV: 0, limpar: 0, limparAntes: 0 });
  const Lr = rampa.reduce((s, x) => s + comprimento(x.pts, false), 0);
  ok(rampa.length === 21 && Math.abs(Lr - 50) < 1e-9 && Math.abs(vol(rampa) - 40) < 1e-9, `rampa de 10 mm em 10 passos: 21 pedaços, caminho 40 + 10 mm, material = o do laço (${vol(rampa).toFixed(6)} mm·fluxo)`);
  const r50 = transformarLaco(g0, { vao: 0, rampa: true, rampaAltura: 0.5, rampaComp: 10, rampaPassos: 4, rampaV: 50, limpar: 0, limparAntes: 0 });
  ok(Math.abs(vol(r50) - 40) < 1e-9 && r50[0].fluxo === 0.5 + 0.5 * 0.125 && r50[0].v === 50 && r50[4].v === 200, "rampa com altura inicial de 50 %: fluxo começa em 56 %, material igual, velocidade própria só na rampa");
  const inteira = transformarLaco(g0, { vao: 0, rampa: true, rampaAltura: 0, rampaComp: Infinity, rampaPassos: 10, rampaV: 0, limpar: 0, limparAntes: 0 });
  ok(Math.abs(inteira.reduce((s, x) => s + comprimento(x.pts, false), 0) - 80) < 1e-9 && Math.abs(vol(inteira) - 40) < 1e-9, "rampa no laço inteiro: o caminho dá duas voltas (80 mm) com o material de uma");
  const vao = transformarLaco(g0, { vao: 0.06, rampa: false, rampaAltura: 0, rampaComp: 0, rampaPassos: 1, rampaV: 0, limpar: 0.42, limparAntes: 0.42 });
  ok(vao.length === 1 && !vao[0].fechado && Math.abs(comprimento(vao[0].pts, false) - 39.94) < 1e-9 && vao[0].limpar === 0.42 && vao[0].limparAntes === 0.42, "vão de 0,06 mm: laço aberto de 39,94 mm, com a limpeza antes e depois marcada");
}

// ---------- 3. costura alinhada em cubo e cilindro ----------
{
  const alin = com(p1s, { costuraPosicao: "alinhada" });
  const c = costurasExt(camadas(cubo, alin).cams);
  const esp = espalhamento(c.slice(1));
  const noCanto = c.every(([x, y]) => Math.min(x, 20 - x) < 0.6 && Math.min(y, 20 - y) < 0.6);
  ok(esp < 0.15 && noCanto, `cubo, costura alinhada: as 100 costuras no mesmo canto (${c[5][0].toFixed(2)}, ${c[5][1].toFixed(2)}), espalhamento ${esp.toFixed(3)} mm`);
  const ci = costurasExt(camadas(cil, alin).cams);
  const espC = espalhamento(ci.slice(1));
  ok(espC < 0.3, `cilindro, costura alinhada: as costuras na mesma vertical (espalhamento ${espC.toFixed(3)} mm)`);
  const ciP = costurasExt(camadas(cil, com(p1s, { costuraPosicao: "aleatoria" })).cams);
  ok(espalhamento(ciP) > 5, `cilindro, costura aleatória: espalhada pela volta (${espalhamento(ciP).toFixed(1)} mm)`);
  const at = costurasExt(camadas(cil, com(p1s, { costuraPosicao: "atras" })).cams);
  ok(at.every(([x, y]) => y > 9.6 && Math.abs(x) < 0.6), `cilindro, costura atrás: todas no fundo (+Y), em (${at[3][0].toFixed(2)}, ${at[3][1].toFixed(2)})`);
  const aa = costurasExt(camadas(cil, com(p1s, { costuraPosicao: "alinhadaAtras" })).cams);
  ok(aa.every(([x, y]) => y > 9.6 && Math.abs(x) < 0.6) && espalhamento(aa.slice(1)) < 0.3, "cilindro, alinhada atrás: começa atrás e fica alinhada");
  const aK = costurasExt(camadas(cubo, com(k3, { costuraPosicao: "alinhada" })).cams);
  ok(espalhamento(aK.slice(1)) < 0.15, `cubo no Kobra 3, costura alinhada: espalhamento ${espalhamento(aK.slice(1)).toFixed(3)} mm`);
  // internas: alinhadas com a externa; alternadas recuam pela profundidade
  const cams3 = camadas(cubo, com(p1s, { costuraPosicao: "alinhada" }), 3).cams[50].trechos.filter((t) => t.fechado && t.parte.startsWith("parede"));
  const ext = cams3.find((t) => t.parte === "paredeExt")!;
  const ints = cams3.filter((t) => t.parte === "paredeInt");
  ok(ints.every((t) => Math.hypot(t.pts[0] - ext.pts[0], t.pts[1] - ext.pts[1]) < 1.5), "3 paredes, alinhada: as costuras das internas no mesmo canto da externa");
  const alt = camadas(cubo, com(p1s, { costuraPosicao: "alinhada", costuraAlternada: true }), 3).cams[50].trechos.filter((t) => t.fechado && t.parte === "paredeInt");
  const d = alt.map((t, k) => Math.hypot(t.pts[0] - ints[k].pts[0], t.pts[1] - ints[k].pts[1])).sort((a, b) => a - b);
  ok(d.length === 2 && Math.abs(d[0] - 0.45) < 0.05 && Math.abs(d[1] - 0.9) < 0.05, `costuras internas alternadas: recuadas ${d.map((x) => x.toFixed(2)).join(" e ")} mm (1ª e 2ª interna: 1 e 2 larguras de linha)`);
}

// ---------- 4. ordem das paredes, rampa, vão e limpeza no resultado ----------
{
  const aj = ajustesPadrao(p1s.processo), aj3 = { ...aj, paredes: 3 };
  const base = estimar(cubo, com(p1s, { costuraPosicao: "atras" }), plaP, aj);
  const ei = estimar(cubo, com(p1s, { costuraPosicao: "atras", ordemParedes: "externaInterna" }), plaP, aj);
  ok(volParedes(ei) === volParedes(base) && ei.tempoS !== base.tempoS, `ordem externa → interna: material das paredes igual (${volParedes(ei).toFixed(2)} mm³), tempo muda (${base.tempoS.toFixed(2)} → ${ei.tempoS.toFixed(2)} s)`);
  const camEI = camadas(cubo, com(p1s, { ordemParedes: "externaInterna" })).cams[10].trechos.filter((t) => t.parte.startsWith("parede"));
  const camIE = camadas(cubo, p1s).cams[10].trechos.filter((t) => t.parte.startsWith("parede"));
  ok(camEI[0].parte === "paredeExt" && camEI[1].parte === "paredeInt" && camIE[0].parte === "paredeInt" && camIE[1].parte === "paredeExt", "ordem: de fora para dentro começa pela externa; o padrão começa pela interna");
  const camIEI = camadas(cubo, com(p1s, { ordemParedes: "internaExternaInterna" }), 3).cams[10].trechos.filter((t) => t.parte.startsWith("parede"));
  const prof = (t: Trecho) => Math.min(t.pts[0], 20 - t.pts[0], t.pts[1], 20 - t.pts[1]);
  ok(camIEI.length === 3 && camIEI[1].parte === "paredeExt" && prof(camIEI[0]) < prof(camIEI[2]), "interna, externa, interna (3 paredes): a 2ª, a externa e depois a 3ª");
  const b3 = estimar(cubo, p1s, plaP, aj3), iei3 = estimar(cubo, com(p1s, { ordemParedes: "internaExternaInterna" }), plaP, aj3);
  ok(volParedes(iei3) === volParedes(b3) && iei3.partes.deslocamento.tempo > b3.partes.deslocamento.tempo, `3 paredes, interna-externa-interna: o bico pula a parede do meio — mais deslocamento (${b3.partes.deslocamento.tempo.toFixed(1)} → ${iei3.partes.deslocamento.tempo.toFixed(1)} s), mesmo material`);
  const ext2 = estimar(cubo, com(k3, { costuraPosicao: "atras", ordemParedes: "externaInterna" }), materialDa(k3, "pla"), ajustesPadrao(k3.processo));
  const base2 = estimar(cubo, com(k3, { costuraPosicao: "atras" }), materialDa(k3, "pla"), ajustesPadrao(k3.processo));
  ok(volParedes(ext2) === volParedes(base2) && ext2.tempoS !== base2.tempoS, `Kobra 3, externa → interna: tempo ${base2.tempoS.toFixed(2)} → ${ext2.tempoS.toFixed(2)} s, paredes iguais`);
  // rampa: mesmo material de parede, caminho maior em 10 mm por contorno, mais tempo de parede externa
  const ramp = estimar(cubo, com(p1s, { costuraPosicao: "atras", costuraRampaTipo: "contorno" }), plaP, aj);
  ok(Math.abs(volParedes(ramp) / volParedes(base) - 1) < 1e-9 && ramp.partes.paredeExt.tempo > base.partes.paredeExt.tempo * 1.1, `costura em rampa: material das paredes igual, parede externa ${base.partes.paredeExt.tempo.toFixed(1)} → ${ramp.partes.paredeExt.tempo.toFixed(1)} s`);
  const Lext = (m: Maquina) => camadas(cubo, m).cams.slice(1).reduce((s, c) => s + c.trechos.filter((t) => t.parte === "paredeExt").reduce((a, t) => a + comprimento(t.pts, t.fechado), 0), 0);
  const dL = Lext(com(p1s, { costuraPosicao: "atras", costuraRampaTipo: "contorno" })) - Lext(com(p1s, { costuraPosicao: "atras" }));
  ok(Math.abs(dL - 99 * 10) < 1e-6, `rampa de 10 mm: caminho da parede externa cresce ${dL.toFixed(3)} mm em 99 camadas`);
  const anelR = (tipo: "contorno" | "contornoFuros") => camadas(aro, com(p1s, { costuraPosicao: "atras", costuraRampaTipo: tipo })).cams[20].trechos.filter((t) => t.parte === "paredeExt").length;
  ok(anelR("contorno") === 21 + 1 && anelR("contornoFuros") === 21 + 21, `anel: "contorno" faz rampa só no externo (${anelR("contorno")} pedaços), "contorno e furos" também no furo (${anelR("contornoFuros")})`);
  const inteira = estimar(cubo, com(p1s, { costuraPosicao: "atras", costuraRampaTipo: "contorno", costuraRampaLacoInteiro: true }), plaP, aj);
  ok(inteira.partes.paredeExt.tempo > 1.8 * base.partes.paredeExt.tempo && Math.abs(volParedes(inteira) / volParedes(base) - 1) < 1e-9, `rampa no laço inteiro: parede externa ~2× o tempo (${inteira.partes.paredeExt.tempo.toFixed(1)} s), mesmo material`);
  // vão: tira o comprimento do vão de cada laço de parede
  const vao = estimar(cubo, com(p1s, { costuraPosicao: "atras", costuraVao: 0.15 }), plaP, aj);
  const sec = (w: number, h: number) => espacamento(w, h) * h * plaP.fluxo;
  const esperado = 0.06 * (sec(p1s.processo.lPrimeira, 0.2) * 2 + 99 * (sec(p1s.processo.lParedeExt, 0.2) + sec(p1s.processo.lParedeInt, 0.2)));
  ok(Math.abs(volParedes(base) - volParedes(vao) - esperado) < 1e-6, `vão de 15 % do bico (0,06 mm): paredes perdem ${(volParedes(base) - volParedes(vao)).toFixed(4)} mm³ (esperado ${esperado.toFixed(4)})`);
  // limpar nos laços: um movimento para dentro de uma largura de linha por laço externo, na velocidade de limpeza
  const l1 = estimar(cubo, com(p1s, { costuraPosicao: "atras", limparNosLacos: true, limpezaVelocidade: 1 }), plaP, aj);
  const l500 = estimar(cubo, com(p1s, { costuraPosicao: "atras", limparNosLacos: true, limpezaVelocidade: 500 }), plaP, aj);
  // (o total sobe menos: o tempo mínimo de camada desacelera menos a extrusão)
  const dt = l1.partes.deslocamento.tempo - l500.partes.deslocamento.tempo, esp = p1s.processo.lPrimeira / 1 + 99 * (p1s.processo.lParedeExt / 1);
  ok(Math.abs(dt / esp - 1) < 0.05 && volParedes(l1) === volParedes(base) && l1.tempoS > l500.tempoS, `limpar nos laços a 1 mm/s: deslocamento +${dt.toFixed(1)} s ≈ 100 laços × uma largura de linha (${esp.toFixed(1)} s); material igual`);
  const antes = estimar(cubo, com(p1s, { costuraPosicao: "atras", limparAntesParedeExt: true }), plaP, aj);
  ok(antes.partes.deslocamento.tempo > base.partes.deslocamento.tempo && volParedes(antes) === volParedes(base), `limpar antes da parede externa: chega por dentro (deslocamento ${base.partes.deslocamento.tempo.toFixed(1)} → ${antes.partes.deslocamento.tempo.toFixed(1)} s), material igual`);
  ok([base, ei, b3, iei3, ramp, inteira, vao, l1, l500, antes, ext2].every(finito), "resultados sem NaN");
}

// ---------- 5. evitar cruzar paredes ----------
{
  // peça em U (malha única): o bico passa de um braço para o outro por cima do vão
  const pol: [number, number][] = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 8], [10, 8], [10, 30], [0, 30]];
  const furo = (() => {
    const pos: number[] = [], tri: number[] = [], n = pol.length, H = 3;
    for (const [x, y] of pol) pos.push(x, y, 0, x, y, H);
    for (let k = 0; k < n; k++) {
      const b0 = 2 * k, t0 = b0 + 1, b1 = 2 * ((k + 1) % n), t1 = b1 + 1;
      tri.push(b0, b1, t1, b0, t1, t0);
    }
    for (const [x0, y0, x1, y1] of [[0, 0, 30, 8], [0, 8, 10, 30], [20, 8, 30, 30]]) {
      const b = pos.length / 3;
      for (const z of [0, H]) for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) pos.push(x, y, z);
      tri.push(b, b + 2, b + 1, b, b + 3, b + 2, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7);
    }
    return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) } as MalhaImpressao;
  })();
  const m = com(p1s, { evitarCruzarParedes: true });
  const contar = (mq: Maquina) => {
  const { f, cams } = camadas(furo, mq);
  let comVia = 0, dentro = true, cruzaSem = 0;
  for (let i = 0; i < cams.length; i++) {
  const g = f.g, ns = f.segs[i].length / 4;
  const campo = campoDistancia(f.segs[i], ns, rasterizar(f.segs[i], ns, g), g);
  const tr = cams[i].trechos;
  for (let k = 1; k < tr.length; k++) {
    const t = tr[k];
    const prev = tr[k - 1];
    const a = prev.fechado ? [prev.pts[0], prev.pts[1]] : [prev.pts[prev.pts.length - 2], prev.pts[prev.pts.length - 1]];
    const b = [t.pts[0], t.pts[1]];
    const pontos = [a[0], a[1], ...(t.via ?? []), b[0], b[1]];
    let sai = false;
    for (let q = 2; q < pontos.length; q += 2) {
      const L = Math.hypot(pontos[q] - pontos[q - 2], pontos[q + 1] - pontos[q - 1]), n = Math.ceil(L / 0.05);
      for (let s = 1; s < n; s++) if (amostrar(campo, g, pontos[q - 2] + ((pontos[q] - pontos[q - 2]) * s) / n, pontos[q - 1] + ((pontos[q + 1] - pontos[q - 1]) * s) / n) < 0) sai = true;
    }
    if (t.via) {
      comVia++;
      if (sai) dentro = false;
    } else if (sai) cruzaSem++;
  }
  }
  return { comVia, dentro, cruzaSem };
  };
  const { comVia, dentro, cruzaSem } = contar(m), sem = contar(com(p1s, { costuraPosicao: "atras" }));
  ok(sem.comVia === 0 && sem.cruzaSem > 10, `peça em U sem a opção: ${sem.cruzaSem} deslocamentos passam por cima do vão`);
  ok(comVia > 10 && dentro && cruzaSem === 0, `evitar cruzar paredes: ${comVia} deslocamentos desviam por dentro da peça, nenhum passa por cima do vão`);
  const aj = ajustesPadrao(p1s.processo);
  const r0 = estimar(furo, com(p1s, { costuraPosicao: "atras" }), plaP, aj), r1 = estimar(furo, com(p1s, { costuraPosicao: "atras", evitarCruzarParedes: true }), plaP, aj);
  ok(r1.partes.deslocamento.tempo > r0.partes.deslocamento.tempo && r1.massaG === r0.massaG && finito(r1), `evitar cruzar: deslocamento mais longo (${r0.partes.deslocamento.tempo.toFixed(1)} → ${r1.partes.deslocamento.tempo.toFixed(1)} s), mesmo material`);
  const rLim = contar(com(p1s, { evitarCruzarParedes: true, evitarCruzarDesvio: 5 })).comVia;
  ok(rLim < comVia, `desvio máximo de 5 mm: só ${rLim} desvios (de ${comVia})`);
  // conta pura: desvio em volta de um quadrado vazio
  const via = desviar(0, 5, 10, 5, Float32Array.from([1]), { x0: -100, y0: -100, c: 200, cols: 1, lins: 1 }, 0.5, () => [], 0);
  ok(via === null, "desviar: caminho todo dentro da peça → nada a desviar");
}

// ---------- 6. tudo ligado, pintura e desempenho ----------
{
  const tudo: Partial<Processo> = {
    costuraPosicao: "alinhada", costuraAlternada: true, costuraRampaTipo: "contornoFuros", costuraRampaAltura: 0.3, costuraVelocidade: 60,
    limparNosLacos: true, limparAntesParedeExt: true, ordemParedes: "internaExternaInterna", evitarCruzarParedes: true,
  };
  const t0 = performance.now();
  const r = estimar(cil, com(p1s, tudo), plaP, ajustesPadrao(p1s.processo));
  const tM2 = performance.now() - t0;
  const t1 = performance.now();
  estimar(cil, p1s, plaP, ajustesPadrao(p1s.processo));
  const tB = performance.now() - t1;
  ok(finito(r) && r.massaG > 0, `tudo ligado no cilindro: ${(r.tempoS / 60).toFixed(2)} min, ${r.massaG.toFixed(3)} g, sem NaN`);
  ok(tM2 < 3 * tB + 300, `desempenho: com a M2 inteira ${tM2.toFixed(0)} ms × padrão ${tB.toFixed(0)} ms`);
  // peça pintada em 2 cores com a M2: laços cortados pela cor perdem a limpeza, o resto continua
  const cores = new Uint8Array(cubo.tri.length / 3);
  for (let t = 0; t < cores.length; t++) {
    const z = Math.max(cubo.pos[cubo.tri[t * 3] * 3 + 2], cubo.pos[cubo.tri[t * 3 + 1] * 3 + 2], cubo.pos[cubo.tri[t * 3 + 2] * 3 + 2]);
    cores[t] = z > 10 ? 1 : 0;
  }
  const rc = fatiarPlaca([{ nome: "cubo", malha: cubo, posicoes: [[0, 0]], cores }], com(p1s, tudo), plaP, ajustesPadrao(p1s.processo)).r;
  ok(finito(rc) && rc.trocas.total >= 1, `cubo pintado em 2 cores com a M2 inteira: ${rc.trocas.total} troca(s), sem NaN`);
}

if (falhas) {
  console.error(`\n${falhas} teste(s) da M2 (costura) falharam.`);
  process.exit(1);
}
console.log("\nTodos os testes da M2 (costura e ordem das paredes) passaram.");

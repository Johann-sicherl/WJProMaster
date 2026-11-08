// Testes do WJGoldDiamond: motor puro (tamanhos, lapidações, quilates, posições, zonas, ficha)
// e geometria no OpenCascade (aro, cabeça, pavé, gravação, texturas, ocar, fabricação).
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import {
  agruparLacos, area, contorno, diametroInterno, diametroPorQuilates, docNovo, ficha, intervalosLivres, LAPIDACOES, montar, poligonoFacetas, quilates, raioNaDirecao,
  tamanhos, uExterno, uInterno, validarDoc, verificar, zonasOcupadas, type DocJoia, type Lapidacao, type P2,
} from "../src/joia/regras";
import { construir, medidas, paraFabricar } from "../src/joia/geometria";
import { malhaGema } from "../src/joia/malhaGema";
import { aplicarToque, codificar, decodificar, dentroDoRaio, esculturaNova, icosfera, malhaLocal, malhasNoMundo, normais, subdividir, vizinhanca, volumeMalha } from "../src/joia/escultura";
import { carregarManifold, stlBinario, unir } from "../src/joia/uniao";
import { esbocoNovoOrnamento, ornamentar, ornamentoVintage, type Ornamento } from "../src/joia/ornamento";

let falhas = 0;
const ok = (c: boolean, m: string) => {
  if (!c) { falhas++; console.error("FALHOU:", m); } else console.log("ok", m);
};
const perto = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// tamanhos
ok(perto(diametroInterno("BR", 16), 17.83, 0.01), "aro BR 16 ≈ 17,83 mm");
ok(perto(diametroInterno("US", 7), 17.32, 0.01), "aro US 7 ≈ 17,32 mm");
ok(perto(diametroInterno("ISO", 52), 16.55, 0.01), "ISO 52 ≈ 16,55 mm");
ok(perto(tamanhos(diametroInterno("BR", 20)).BR, 20, 1e-9), "conversão de volta BR");

// lapidações
ok(perto(quilates({ lapidacao: "redonda", material: "diamante", comprimento: 6.5, largura: 6.5 }), 1.02, 0.03), "redonda 6,5 mm ≈ 1 ct");
ok(perto(diametroPorQuilates(1), 6.5, 0.05), "1 ct ≈ 6,5 mm");
ok(quilates({ lapidacao: "redonda", material: "rubi", comprimento: 5, largura: 5 }) > quilates({ lapidacao: "redonda", material: "diamante", comprimento: 5, largura: 5 }), "rubi mais pesado que diamante no mesmo tamanho");
for (const lap of Object.keys(LAPIDACOES) as Lapidacao[]) {
  const C = 8, L = lap === "redonda" || lap === "princesa" || lap === "coracao" || lap === "trilliant" ? 8 : 5;
  const c = contorno(lap, C, L);
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  ok(area(c) > 0 && perto(Math.max(...xs) - Math.min(...xs), C, 0.35) && perto(Math.max(...ys) - Math.min(...ys), L, 0.35), `contorno ${lap} anti-horário e com as medidas`);
  const m = malhaGema({ lapidacao: lap, material: "diamante", comprimento: C, largura: L });
  ok(m.length % 9 === 0 && m.length > 0 && m.every(Number.isFinite), `malha da gema ${lap}`);
}
ok(perto(raioNaDirecao(contorno("redonda", 4, 4), 0.3), 2, 0.01), "raio na direção (círculo)");

// perfil
ok(perto(uExterno("meia-cana", 3, 1.5, 0), 1.5, 1e-9) && perto(uExterno("meia-cana", 3, 1.5, 1.5), 0, 1e-9), "meia-cana: topo e borda");
ok(perto(uInterno("conforto", 3, 1.6, 1.5), 0.4, 1e-9) && uInterno("conforto", 3, 1.6, 0) === 0, "conforto abaulado por dentro");

// zonas livres
const z = intervalosLivres([[0, 30], [180, 20]]);
ok(z.length === 2 && perto(z[0][0], 30, 1e-9) && perto(z[0][1], 160, 1e-9) && perto(z[1][0], 200, 1e-9) && perto(z[1][1], 330, 1e-9), "intervalos livres");
const z2 = intervalosLivres([[180, 20]]);
ok(z2.length === 1 && perto(z2[0][0], -160, 1e-9) && perto(z2[0][1], 160, 1e-9), "intervalo livre atravessando 0°");

// texto
const quad = (x: number, y: number, s: number): P2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const ag = agruparLacos([quad(0, 0, 4), quad(1, 1, 2), quad(6, 0, 4)]);
ok(ag.grupos.length === 2 && ag.grupos[0].contornos.length === 2 && perto(ag.largura, 10, 1e-9), "letras: externo + furo agrupados");

// validação
const v = validarDoc({ aro: { tamanho: 999, perfil: "x" }, cabeca: { gema: { lapidacao: "redonda", largura: 6 } } });
ok(v.aro.tamanho === 80 && v.aro.perfil === "conforto" && v.cabeca.gema.comprimento === 6, "validação limita e completa");

// posições
const doc = docNovo();
const m0 = montar(doc);
ok(m0.garras.length === 4 && !!m0.galeria && !!m0.cabeca, "solitário: 4 garras e galeria");
const dp: DocJoia = { ...docNovo(), pave: { ...docNovo().pave, ativo: true } };
const m1 = montar(dp);
const ths = m1.pave.map((g) => Math.atan2(g.ref.p[0], g.ref.p[1]));
ok(m1.pave.length >= 4 && ths.every((t) => Math.abs(t) > (m1.zonaCabeca * Math.PI) / 180 - 0.05), `pavé ao lado da cabeça (${m1.pave.length} pedras)`);
ok(m1.contas.length >= m1.pave.length, `contas do pavé (${m1.contas.length})`);
for (let i = 0; i < m1.pave.length; i++)
  for (let j = i + 1; j < m1.pave.length; j++) {
    const a = m1.pave[i].ref.p, b = m1.pave[j].ref.p;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < (m1.pave[i].gema.largura + m1.pave[j].gema.largura) / 2) ok(false, "pavé sem colisão");
  }
const et: DocJoia = { ...docNovo(), cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil: "reto", largura: 3, espessura: 1.8, larguraBase: 3, espessuraBase: 1.8 }, pave: { ...docNovo().pave, ativo: true, eternidade: true, dInicial: 1.8, fileiras: 1 } };
const m2 = montar(et);
ok(m2.pave.length > 20 && m2.descartadas === 0, `eternidade dá a volta toda (${m2.pave.length} pedras)`);
const livresFac = intervalosLivres(zonasOcupadas(docNovo(), m0, 0, false));
ok(!!poligonoFacetas({ ...docNovo(), textura: { tipo: "facetas", quantidade: 16, profundidade: 0.2 } }, m0, livresFac), "polígono das facetas");
ok(verificar({ ...docNovo(), cabeca: { ...docNovo().cabeca, diamGarra: 0.4 } }, m0, 0).some((x) => x.includes("Garras")), "verificação: garra fina");

// ornamentos (puro)
const ornTeste = (): Ornamento => {
  const esb = esbocoNovoOrnamento("t", 2.4, null, 20);
  esb.pontos.push({ id: "a", x: 1, y: 0.5 }, { id: "b", x: 4, y: 1 }, { id: "c", x: 0, y: 0 }, { id: "q", x: 6, y: 0 });
  esb.geos.push({ id: "l", tipo: "linha", p1: "a", p2: "b" }, { id: "ci", tipo: "circulo", c: "c", r: 0.8 }, { id: "pq", tipo: "ponto", p: "q" });
  return { id: "t", nome: "T", ativo: true, esboco: esb, altura: 0.1, diametro: 0.6, simetria: "xy", envolver: true, pontas: true, fios: { l: { d0: 0.6, d1: 0.3 } }, pontos: { q: { tipo: "inglesa", d: 1.5, material: "rubi" } } };
};
{
  const o = ornTeste();
  const r = ornamentar([o], 9, () => 1.7);
  const linhas = r.fios.filter((f) => f.pts.length && Math.hypot(f.pts[0][0] - f.pts[f.pts.length - 1][0], f.pts[0][1] - f.pts[f.pts.length - 1][1], f.pts[0][2] - f.pts[f.pts.length - 1][2]) > 1e-6);
  ok(linhas.length === 4 && r.fios.length === 5, `simetria xy: 4 cópias da linha, círculo central sem repetição (${r.fios.length} fios)`);
  ok(perto(linhas[0].raios[0], 0.3, 1e-9) && perto(linhas[0].raios[linhas[0].raios.length - 1], 0.15, 1e-9) && linhas[0].bolinhaIni, "fio afinando com bolinha na ponta solta");
  const p0 = linhas[0].pts[0];
  ok(perto(Math.hypot(p0[0], p0[1]), 9 + 1.7 + 0.1 + 0.3, 1e-6) && perto(p0[2], 0.5, 1e-9), "fio envolvido no aro (raio = R + t + altura + r)");
  ok(r.pontos.length === 2 && r.pontos.every((q) => q.tipo === "inglesa"), "ponto espelhado vira duas pedrinhas");
  const m = montar({ ...docNovo(), cabeca: { ...docNovo().cabeca, ativo: false }, ornamentos: [o] });
  ok(m.gemasOrn.length === 2 && ficha({ ...docNovo(), ornamentos: [o] }, m, 100).gemas.some((g) => g.descricao.startsWith("Rubi")), "pedrinhas dos ornamentos na ficha");
}

// escultura (puro)
{
  ok([2, 3, 4, 5].every((n) => icosfera(n).pos.length / 3 === 10 * 4 ** n + 2), "icosfera: 10·4ⁿ + 2 vértices");
  ok(perto(volumeMalha(icosfera(5)), (4 / 3) * Math.PI, 0.02), "icosfera fechada e para fora (volume ≈ 4π/3)");
  for (const b of ["esfera", "gota", "folha", "capsula"] as const) ok(volumeMalha(malhaLocal(esculturaNova("x", b, 1))) > 0, `forma inicial ${b} fechada`);
  const m = malhaLocal(esculturaNova("x", "esfera", 1));
  const nor = normais(m.pos, m.tri), vz = vizinhanca(m.tri, m.pos.length / 3);
  const v0 = volumeMalha(m);
  aplicarToque(m.pos, nor, vz, { pincel: "puxar", c: [0.5, 0.86, 0], n: [0.5, 0.86, 0], r: 0.4, f: 1, inverter: false }, true);
  const v1 = volumeMalha(m);
  ok(v1 > v0, `puxar levanta (volume ${v0.toFixed(3)} → ${v1.toFixed(3)})`);
  const vMeio = (sinal: number) => { let s = 0; for (let i = 0; i < m.pos.length; i += 3) if (m.pos[i] * sinal > 0.3 && m.pos[i + 1] > 0.6) s += m.pos[i + 1]; return s; };
  ok(perto(vMeio(1), vMeio(-1), 1e-3), "simetria: o traço espelhado sobe igual do outro lado");
  aplicarToque(m.pos, nor, vz, { pincel: "puxar", c: [0, -1, 0], n: [0, -1, 0], r: 0.3, f: 1, inverter: true }, false);
  ok(volumeMalha(m) < v1, "inverter afunda");
  const pesos = dentroDoRaio(m.pos, [0, 0, 1], 0.4);
  const z0 = m.pos[3 * [...pesos.keys()][0] + 2];
  aplicarToque(m.pos, nor, vz, { pincel: "arrastar", c: [0, 0, 1], n: [0, 0, 1], r: 0.4, f: 1, inverter: false, d: [0, 0, 0.3], pesos }, false);
  ok(m.pos[3 * [...pesos.keys()][0] + 2] > z0, "arrastar leva os vértices junto");
  const c = codificar(m.pos), d = decodificar(c, m.pos.length)!;
  ok(d.every((x, i) => Math.abs(x - m.pos[i]) < 1e-4), "posições quantizadas em 16 bits");
  const e = { ...esculturaNova("x", "folha", 1), pos: c, base: "esfera" as const };
  const s2 = subdividir(e);
  ok(s2.nivel === 6 && malhaLocal(s2).pos.length / 3 === 40962 && perto(volumeMalha(malhaLocal(s2)), volumeMalha(m), 0.1), "subdividir mantém a forma");
  const mundo = malhasNoMundo([{ ...esculturaNova("f", "folha", 1), espelhar: true }], 9, () => 1.7);
  ok(mundo.length === 2 && mundo.every((x) => volumeMalha(x) > 0), "cópia espelhada fechada e para fora");
}

// geometria
const OC = await (opencascade as any)({ locateFile: () => createRequire(import.meta.url).resolve("replicad-opencascadejs/wasm") });
setOC(OC);
const tempo = (n: string, f: () => void) => { const t = performance.now(); f(); console.log(`   ${n}: ${(performance.now() - t).toFixed(0)} ms`); };

const R = diametroInterno("BR", 16) / 2;
const liso: DocJoia = { ...docNovo(), cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil: "reto", largura: 3, espessura: 2, larguraBase: 3, espessuraBase: 2 } };
tempo("aliança reta", () => {
  const r = construir(liso);
  const esperado = Math.PI * ((R + 2) ** 2 - R * R) * 3;
  ok(perto(medidas(r.forma).volume, esperado, esperado * 0.002), "aliança reta: volume exato");
});
tempo("perfis", () => {
  for (const perfil of ["meia-cana", "conforto", "faca"] as const) {
    const r = construir({ ...liso, aro: { ...liso.aro, perfil } });
    const vol = medidas(r.forma).volume;
    ok(vol > 0 && vol < Math.PI * ((R + 2) ** 2 - R * R) * 3, `perfil ${perfil}: volume ${vol.toFixed(1)}`);
  }
});
let volAfunilado = 0;
tempo("afunilado", () => {
  const r = construir({ ...liso, aro: { ...liso.aro, larguraBase: 2, espessuraBase: 1.4 } });
  volAfunilado = medidas(r.forma).volume;
  const vMin = Math.PI * ((R + 1.4) ** 2 - R * R) * 2, vMax = Math.PI * ((R + 2) ** 2 - R * R) * 3;
  ok(volAfunilado > vMin && volAfunilado < vMax, `aro afunilado: ${volAfunilado.toFixed(1)} entre ${vMin.toFixed(0)} e ${vMax.toFixed(0)}`);
});
tempo("torcido", () => {
  const r = construir({ ...liso, aro: { ...liso.aro, torcao: 3 } });
  const vol = medidas(r.forma).volume;
  ok(vol > 0 && r.forma.isValid?.() !== false, `aro torcido: ${vol.toFixed(1)}`);
});
let volSol = 0;
tempo("solitário", () => {
  const r = construir(docNovo());
  volSol = medidas(r.forma).volume;
  ok(volSol > 100 && volSol < 600, `solitário: volume ${volSol.toFixed(1)} mm³`);
  const f = ficha(docNovo(), r.montagem, volSol);
  ok(perto(f.peso, (volSol / 1000) * 15.5, 1e-9) && perto(f.ctTotal, 0.5, 0.06), `ficha: ${f.peso.toFixed(2)} g, ${f.ctTotal.toFixed(2)} ct`);
});
tempo("inglesa oval", () => {
  const d: DocJoia = { ...docNovo(), cabeca: { ...docNovo().cabeca, tipo: "inglesa", gema: { lapidacao: "oval", material: "safira", comprimento: 7, largura: 5 } } };
  const vol = medidas(construir(d).forma).volume;
  ok(vol > 100, `inglesa oval: ${vol.toFixed(1)}`);
});
for (const lap of ["princesa", "gota", "navete", "esmeralda", "coracao", "almofada", "baguete", "trilliant"] as Lapidacao[]) {
  tempo(`cabeça ${lap}`, () => {
    const d: DocJoia = { ...docNovo(), cabeca: { ...docNovo().cabeca, garras: LAPIDACOES[lap].garras, gema: { lapidacao: lap, material: "diamante", comprimento: 7, largura: lap === "princesa" || lap === "coracao" || lap === "trilliant" ? 7 : 4.5 } } };
    const vol = medidas(construir(d).forma).volume;
    ok(vol > 100 && vol < 900, `cabeça ${lap}: ${vol.toFixed(1)}`);
  });
}
tempo("solitário + pavé", () => {
  const r = construir(dp);
  const vol = medidas(r.forma).volume;
  ok(vol > 100 && r.montagem.pave.length > 0, `pavé com ${r.montagem.pave.length} pedras e ${r.montagem.contas.length} contas: ${vol.toFixed(1)}`);
});
tempo("pavé trilho 2 fileiras", () => {
  const d: DocJoia = { ...dp, aro: { ...dp.aro, perfil: "reto", largura: 4, larguraBase: 3, espessura: 2, espessuraBase: 1.8 }, pave: { ...dp.pave, tipo: "trilho", fileiras: 2, dInicial: 1.3, dFinal: 1.3 } };
  const r = construir(d);
  ok(medidas(r.forma).volume > 100 && r.montagem.trilhos.length > 0, `trilho: ${r.montagem.pave.length} pedras`);
});
tempo("eternidade", () => {
  const r = construir(et);
  ok(medidas(r.forma).volume > 100, `eternidade com ${r.montagem.pave.length} pedras`);
});
tempo("gravação, facetas, ocar", () => {
  const grupos = agruparLacos([quad(0, -0.5, 1), quad(1.4, -0.5, 1), quad(1.6, -0.3, 0.6)]);
  const d: DocJoia = { ...docNovo(), gravacao: { ...docNovo().gravacao, ativo: true }, textura: { tipo: "facetas", quantidade: 16, profundidade: 0.2 }, fabricacao: { ...docNovo().fabricacao, ocar: true, parede: 0.5 } };
  const base = medidas(construir(docNovo()).forma).volume;
  const r = construir(d, grupos.grupos, grupos.largura);
  const vol = medidas(r.forma).volume;
  ok(vol < base - 1, `gravação + facetas + ocar tiram metal (${base.toFixed(1)} → ${vol.toFixed(1)}) ${r.avisos.join(" ")}`);
  const ext = construir({ ...docNovo(), gravacao: { ...docNovo().gravacao, ativo: true, lado: "externo" }, textura: { tipo: "frisos", quantidade: 24, profundidade: 0.2 } }, grupos.grupos, grupos.largura);
  ok(medidas(ext.forma).volume < base, "gravação externa e frisos");
});
tempo("fabricação", () => {
  const r = construir(docNovo());
  const d = { ...docNovo(), fabricacao: { ...docNovo().fabricacao, contracao: 2, canais: 2 } };
  const f = paraFabricar(d, r.forma, true);
  const vf = medidas(f).volume;
  ok(vf > volSol * 1.02 ** 3, `canais e contração: ${volSol.toFixed(1)} → ${vf.toFixed(1)}`);
  const stl = f.blobSTL({ tolerance: 0.01, angularTolerance: 5, binary: true } as never);
  ok(stl.size > 1000, `STL ${stl.size} bytes`);
});
tempo("perfis × afunilado × pavé", () => {
  for (const perfil of ["meia-cana", "reto", "conforto", "faca"] as const) {
    const d: DocJoia = { ...docNovo(), cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil, largura: 2.8, espessura: 1.8, larguraBase: 2.2, espessuraBase: 1.5 }, pave: { ...docNovo().pave, ativo: true, dInicial: 1.6, dFinal: 1.6, arco: 150 } };
    const r = construir(d);
    const vol = medidas(r.forma).volume, aro = medidas(construir({ ...d, pave: { ...d.pave, ativo: false } }).forma).volume;
    ok(vol > aro * 0.7 && vol < aro && !r.avisos.some((x) => x.includes("kernel")), `${perfil} afunilado com pavé: ${aro.toFixed(1)} → ${vol.toFixed(1)}`);
  }
});
// combinações sorteadas (semente fixa): nada pode quebrar nem sumir
let semente = 7;
const sorte = () => ((semente = (semente * 16807) % 2147483647) - 1) / 2147483646;
const um = <T,>(xs: readonly T[]) => xs[Math.floor(sorte() * xs.length)];
for (let i = 0; i < 10; i++) {
  const b = docNovo();
  const wt = 1.8 + sorte() * 2.5, tt = 1.3 + sorte() * 1.2;
  const lap = um(Object.keys(LAPIDACOES) as Lapidacao[]);
  const d = validarDoc({
    ...b,
    aro: { ...b.aro, perfil: um(["meia-cana", "reto", "conforto", "faca"] as const), tamanho: 8 + Math.round(sorte() * 18), largura: wt, espessura: tt, larguraBase: wt * (0.7 + 0.3 * sorte()), espessuraBase: tt * (0.75 + 0.25 * sorte()) },
    cabeca: { ...b.cabeca, ativo: sorte() < 0.7, tipo: um(["garras", "inglesa"] as const), garras: LAPIDACOES[lap].garras, gema: { lapidacao: lap, material: "diamante", comprimento: 4 + sorte() * 4, largura: 3.5 + sorte() * 3 } },
    pave: { ...b.pave, ativo: sorte() < 0.6, tipo: um(["garras", "trilho"] as const), dInicial: 1 + sorte(), dFinal: 0.9 + sorte() * 0.6 },
    gravacao: { ...b.gravacao, ativo: false },
    textura: { ...b.textura, tipo: um(["nenhuma", "facetas", "frisos"] as const) },
    fabricacao: { ...b.fabricacao, ocar: sorte() < 0.4 },
  });
  tempo(`sorteio ${i}`, () => {
    const r = construir(d);
    const vol = medidas(r.forma).volume;
    ok(vol > 30 && !r.avisos.some((x) => x.includes("kernel")), `sorteio ${i} (${d.aro.perfil}, ${d.cabeca.ativo ? d.cabeca.tipo + " " + lap : "sem cabeça"}, pavé ${d.pave.ativo ? d.pave.tipo : "não"}, ${d.textura.tipo}${d.fabricacao.ocar ? ", ocado" : ""}): ${vol.toFixed(1)} ${r.avisos.join(" ")}`);
  });
}
tempo("falha do aro cortado sob a gema (oval 8×6, aro 10)", () => {
  const b = docNovo();
  const d: DocJoia = { ...b, aro: { ...b.aro, tamanho: 10 }, cabeca: { ...b.cabeca, gema: { lapidacao: "oval", material: "rubi", comprimento: 8, largura: 6 } } };
  const r = construir(d);
  let solidos = 0;
  const ex = new (OC as any).TopExp_Explorer(r.forma.wrapped, (OC as any).TopAbs_ShapeEnum.TopAbs_SOLID, (OC as any).TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) solidos++;
  ok(solidos === 1, `um sólido só (aro inteiro sob a gema): ${solidos}`);
  ok(montar(d).avisos.some((x) => x.includes("culaça")), "aviso da culaça entrando no aro");
});
tempo("garra alongada, garra dupla e aro dividido", () => {
  const b = docNovo();
  for (const ponta of ["alongada", "dupla"] as const) {
    const vol = medidas(construir({ ...b, cabeca: { ...b.cabeca, pontaGarra: ponta } }).forma).volume;
    ok(vol > volSol, `ponta ${ponta}: ${volSol.toFixed(1)} → ${vol.toFixed(1)}`);
  }
  const dv: DocJoia = { ...b, aro: { ...b.aro, largura: 3.2, larguraBase: 3.2, dividido: 1.2, divisao: 40 } };
  const r = construir(dv);
  const cheio = medidas(construir({ ...dv, aro: { ...dv.aro, dividido: 0 } }).forma).volume;
  ok(medidas(r.forma).volume < cheio - 1 && !r.avisos.some((x) => x.includes("kernel")), `aro dividido tira metal no topo (${cheio.toFixed(1)} → ${medidas(r.forma).volume.toFixed(1)})`);
});
tempo("anel vintage com filigrana", () => {
  const b = docNovo();
  const d: DocJoia = {
    ...b, aro: { ...b.aro, perfil: "meia-cana", tamanho: 14, largura: 2.2, espessura: 1.6, larguraBase: 2.0, espessuraBase: 1.5 },
    cabeca: { ...b.cabeca, gema: { lapidacao: "oval", material: "diamante", comprimento: 8, largura: 6 }, girar: 90, pontaGarra: "alongada", galeria: false, elevacao: 2.9, diamGarra: 0.9 },
    ornamentos: [ornamentoVintage("v", 2.2)],
  };
  const r = construir(d);
  const vol = medidas(r.forma).volume;
  const semOrn = medidas(construir({ ...d, ornamentos: [] }).forma).volume;
  ok(vol > semOrn + 20 && !r.avisos.length && r.montagem.gemasOrn.length === 2, `vintage: ${semOrn.toFixed(1)} → ${vol.toFixed(1)} mm³, ${r.montagem.orn.fios.length} fios ${r.avisos.join(" ")}`);
});
{
  const w = await carregarManifold();
  const d: DocJoia = { ...docNovo(), esculturas: [{ ...esculturaNova("f", "folha", 1), espelhar: true }] };
  const r = construir(d);
  const metal = medidas(r.forma).volume;
  const esc = malhasNoMundo(d.esculturas, diametroInterno(d.aro.norma, d.aro.tamanho) / 2, () => d.aro.espessura);
  const somaEsc = esc.reduce((s2, x) => s2 + volumeMalha(x), 0);
  const t0 = performance.now();
  const u = unir(w, r.forma, esc);
  ok(u.volume > metal && u.volume < metal + somaEsc && !u.avisos.length, `união: metal ${metal.toFixed(1)} + folhas ${somaEsc.toFixed(1)} → ${u.volume.toFixed(1)} mm³ (sobreposição descontada) em ${(performance.now() - t0).toFixed(0)} ms`);
  const stl = stlBinario(u.malha, 1.02);
  ok(stl.byteLength === 84 + 50 * (u.malha.tri.length / 3), `STL da união numa peça só (${stl.byteLength} bytes)`);
}

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1); }
console.log("teste-joia: tudo certo");

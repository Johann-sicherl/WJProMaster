// Testes do WJGoldDiamond: motor puro (tamanhos, lapidações, quilates, posições, zonas, ficha)
// e geometria no OpenCascade (aro, cabeça, pavé, gravação, texturas, ocar, fabricação).
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import {
  agruparLacos, area, contorno, diametroInterno, diametroPorQuilates, docNovo, ficha, intervalosLivres, LAPIDACOES, montar, poligonoFacetas, quilates, raioNaDirecao,
  tamanhos, uExterno, uInterno, validarDoc, verificar, zonasOcupadas, type DocJoia, type Lapidacao, type P2,
} from "../src/joia/regras";
import { booleana, capsulaRev, construir, cortador, fazerAro, medidas, paraFabricar, pecas } from "../src/joia/geometria";
import { gemaLivreNova, noMundo, type GemaLivre } from "../src/joia/gemasLivres";
import { anelFolhasOval } from "../src/joia/modelos";
import { superficie, verificar as verificarJoia, quilates as qt } from "../src/joia/regras";
import { malhaGema } from "../src/joia/malhaGema";
import { aplicarToque, codificar, decodificar, dentroDoRaio, esculturaNova, icosfera, malhaLocal, malhasNoMundo, normais, subdividir, vizinhanca, volumeMalha } from "../src/joia/escultura";
import { carregarManifold, stlBinario, unir } from "../src/joia/uniao";
import { esbocoNovoOrnamento, ornamentar, ornamentoVintage, type Ornamento } from "../src/joia/ornamento";
import { readFileSync } from "node:fs";
import { alinharCamera, anguloEntre, cantosNoMundo, escalaPorMedida, fotoNoEsboco, fotoNoPlano, olharPara, projetar, referenciaNova, rodrigues } from "../src/joia/referencia";
import { areaSecao, interpolar, secaoUnitaria, tubo, volumeComSinal } from "../src/joia/fios";
import { folhaNova, larguraRelativa, malhaFolha, volumeEsperado } from "../src/joia/folhas";
import { construirMalha, malhaDe, previaMalha } from "../src/joia/final";
import { espessuras } from "../src/joia/concordancia";
import { LIGAS, type V3 } from "../src/joia/regras";

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

// gemas livres (puro)
{
  const R = diametroInterno("BR", 16) / 2;
  const base: DocJoia = { ...docNovo(), cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil: "reto", largura: 2.4, espessura: 1.7, larguraBase: 2.4, espessuraBase: 1.7 } };
  // redonda 2 mm de lado (θ = 90°), seguindo a superfície: eixo da gema = +X (normal), comprimento = tangente (−Y)
  const red: GemaLivre = { ...gemaLivreNova("r", 1, "redonda"), gema: { lapidacao: "redonda", material: "diamante", comprimento: 2, largura: 2 }, th: 90, altura: 0.4, garras: 4, diamGarra: 0.6 };
  const m = montar({ ...base, gemasLivres: [red] });
  const l = m.livres[0];
  ok(m.livres.length === 1 && perto(l.gema.ref.p[0], R + 1.7 + 0.4, 1e-9) && perto(l.gema.ref.p[1], 0, 1e-9), "gema livre: cintura em R + t + altura no lado do aro");
  // garra a 45°: topo = p + rc·cos45·T + yTopo·n − rc·sin45·Z (à mão: T = (0,−1,0), n = (1,0,0), Z = (0,0,1))
  const pr = { coroa: 0.15 * 2, cintura: 0.03 * 2 }, rc = 1 + 0.6 * 0.25, yTopo = pr.cintura + pr.coroa * 0.55;
  const esperado = [R + 1.7 + 0.4 + yTopo, -rc * Math.SQRT1_2, -rc * Math.SQRT1_2];
  ok(l.hastes.some((h) => Math.hypot(h.topo[0] - esperado[0], h.topo[1] - esperado[1], h.topo[2] - esperado[2]) < 1e-9), "gema livre: topo da garra a 45° conferido à mão");
  ok(l.hastes.length === 8 && l.folga > 0 && l.folga < 0.3 && l.hastes.filter((h) => perto(h.r, 0.3 * 1.04, 1e-9)).every((h) => perto(Math.hypot(h.base[0], h.base[1]), R + 1.7 - 0.25, 1e-6)), "gema livre: 4 garras + 4 hastes até o aro (embutidas 0,25 mm)");
  // navete no topo, de pé: garra em V nas duas pontas (ápice além da ponta, ao longo do comprimento = X)
  const nav: GemaLivre = { ...gemaLivreNova("n", 2, "navete"), th: 0, seguir: false, altura: 0.5, diamGarra: 0.6 };
  const mn = montar({ ...base, gemasLivres: [nav] }).livres[0];
  const pN = mn.gema.ref.p, prN = { coroa: 0.14, cintura: 0.03 };
  const apice = [1 + 0.6 * 0.45, prN.cintura + prN.coroa * 0.55 - 0.6 * 0.15];
  ok([1, -1].every((sx) => mn.hastes.some((h) => Math.hypot(h.base[0] - pN[0] - sx * apice[0], h.base[1] - pN[1] - apice[1], h.base[2]) < 1e-9)), "navete: garra em V nas duas pontas (ápice conferido)");
  ok(mn.hastes.length === 8 && mn.hastes.every((h) => h.r >= 0.3 - 1e-9), "navete: 2 V × (2 braços + descida + apoio), nenhuma haste abaixo do Ø pedido");
  const nav90 = montar({ ...base, gemasLivres: [{ ...nav, giro: 90 }] }).livres[0];
  ok(perto(noMundo(nav90.gema.ref, [1, 0, 0])[2] - nav90.gema.ref.p[2], -1, 1e-9), "giro 90°: eixo longo ao longo do dedo");
  const inc = montar({ ...base, gemasLivres: [{ ...nav, inclinacao: 30 }] }).livres[0];
  ok(perto(noMundo(inc.gema.ref, [1, 0, 0])[1] - inc.gema.ref.p[1], -0.5, 1e-9), "inclinação 30°: a ponta da frente desce (sen 30°)");
  // simetria
  const fora: GemaLivre = { ...nav, th: 20, z: 0.5, giro: 30 };
  const cop = montar({ ...base, gemasLivres: [{ ...fora, simetria: "xy" }] }).livres;
  const ps = cop.map((x) => x.gema.ref.p);
  ok(cop.length === 4 && [[1, 1], [-1, 1], [1, -1], [-1, -1]].every(([sx, sz]) => ps.some((q) => perto(q[0], sx * ps[0][0], 1e-9) && perto(q[2], sz * ps[0][2], 1e-9) && perto(q[1], ps[0][1], 1e-9))), "simetria dois eixos: 4 cópias espelhadas");
  const eixo = (x: (typeof cop)[0]) => { const e = noMundo(x.gema.ref, [1, 0, 0]); return [e[0] - x.gema.ref.p[0], e[2] - x.gema.ref.p[2]]; };
  ok(perto(eixo(cop[1])[0], -eixo(cop[0])[0], 1e-9) && perto(eixo(cop[1])[1], eixo(cop[0])[1], 1e-9), "simetria: a cópia esquerda↔direita espelha o eixo longo");
  ok(montar({ ...base, gemasLivres: [{ ...nav, simetria: "x" }] }).livres.length === 1, "simetria: gema sobre o plano de espelho não duplica");
  const dLivres = { ...base, gemasLivres: [{ ...fora, simetria: "xy" as const }] };
  const fL = ficha(dLivres, montar(dLivres), 100);
  ok(fL.gemas.length === 1 && fL.gemas[0].quantidade === 4 && perto(fL.ctTotal, 4 * qt(nav.gema), 1e-12), "ficha: as cópias contam (4 navetes, ct somado)");
  // colisões e avisos
  ok(montar({ ...base, gemasLivres: [nav, { ...nav, id: "n2", nome: "Gema 3", z: 0.3 }] }).avisos.some((x) => x.includes("colide com Gema 3")), "colisão gema × gema gera aviso");
  ok(montar({ ...docNovo(), gemasLivres: [{ ...nav, refAltura: "central", altura: 0 }] }).avisos.some((x) => x.includes("colide com a gema central")), "colisão com a gema central gera aviso");
  const garraC = montar(docNovo()).garras[0].topo;
  ok(montar({ ...docNovo(), gemasLivres: [{ ...nav, refAltura: "central", th: Math.atan2(garraC[0], garraC[1]) * 180 / Math.PI, z: garraC[2] + 0.55, altura: 0.6 }] }).avisos.some((x) => x.includes("garra da gema central")), "colisão gema × garra da central gera aviso");
  ok(montar({ ...base, gemasLivres: [{ ...nav, altura: 2.5 }] }).avisos.some((x) => x.includes("sem apoio")), "garra sem apoio a até 1,5 mm gera aviso");
  ok(montar({ ...base, gemasLivres: [{ ...nav, altura: 6 }] }).avisos.some((x) => x.includes("fora do metal")), "gema longe do metal gera aviso");
  ok(montar({ ...base, gemasLivres: [{ ...nav, altura: -1 }] }).avisos.some((x) => x.includes("dentro do aro")), "gema enterrada no aro gera aviso");
  ok(verificarJoia({ ...base, gemasLivres: [{ ...nav, diamGarra: 0.45 }] }, montar(base), 0).some((x) => x.includes("mínimo recomendado")), "garra da gema livre abaixo do mínimo da liga gera aviso");
  // .wjgd antigo (sem o campo) abre igual
  const antigo = JSON.parse(JSON.stringify(docNovo()));
  delete antigo.gemasLivres; delete antigo.gemasLivresAtivo; delete antigo.aro.afastamento;
  const lido = validarDoc(antigo);
  ok(Array.isArray(lido.gemasLivres) && lido.gemasLivres.length === 0 && lido.gemasLivresAtivo && lido.aro.afastamento === 0 && JSON.stringify(montar(lido).avisos) === JSON.stringify(montar(docNovo()).avisos), ".wjgd antigo abre igual (lista vazia)");
  const ida = validarDoc(JSON.parse(JSON.stringify({ ...base, gemasLivres: [fora, { ...red, garras: 99, simetria: "zz" }] })));
  ok(ida.gemasLivres.length === 2 && ida.gemasLivres[0].giro === 30 && ida.gemasLivres[1].garras === 8 && ida.gemasLivres[1].simetria === "nenhuma", "gema livre ida e volta pelo arquivo (valores fora da faixa limitados)");
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

// gemas livres: assento no mesmo corte em lote, volume com e sem assento
tempo("gema livre: volume com e sem assento", () => {
  const b = docNovo();
  const d: DocJoia = { ...b, cabeca: { ...b.cabeca, ativo: false }, aro: { ...b.aro, perfil: "reto", largura: 2.4, espessura: 1.7, larguraBase: 2.4, espessuraBase: 1.7 }, gemasLivres: [{ ...gemaLivreNova("n", 1, "navete"), gema: { lapidacao: "navete", material: "diamante", comprimento: 4, largura: 2 }, th: 0, altura: -0.2, seguir: true, diamGarra: 0.6 }] };
  const r = construir(d);
  const l = r.montagem.livres[0];
  const sem = booleana("unir", fazerAro(d, r.montagem.R), l.hastes.map(capsulaRev));
  const assento = cortador(l.gema, 0, 16);
  const vSem = medidas(sem).volume, vCom = medidas(r.forma).volume, vInter = medidas(booleana("comum", sem, [assento])).volume;
  ok(vInter > 0.5 && perto(vSem - vCom, vInter, 0.01 * vSem), `assento da gema livre: ${vSem.toFixed(2)} − ${vCom.toFixed(2)} = ${(vSem - vCom).toFixed(2)} ≈ interseção ${vInter.toFixed(2)} mm³`);
});

// ---------------------------------------------------------------------------------------------
// J9b: referência por foto, fios avançados, folhas, concordância e montagem final na malha

const volStl = (buf: ArrayBuffer) => {
  const dv = new DataView(buf), n = dv.getUint32(80, true);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i + 12, p = (k: number) => dv.getFloat32(o + 4 * k, true);
    v += p(0) * (p(4) * p(8) - p(5) * p(7)) - p(1) * (p(3) * p(8) - p(5) * p(6)) + p(2) * (p(3) * p(7) - p(4) * p(6));
  }
  return v / 6;
};
const W8 = await carregarManifold();
const componentes = (mm: { pos: Float32Array; tri: Uint32Array }) => {
  const mesh = new W8.Mesh({ numProp: 3, vertProperties: mm.pos, triVerts: mm.tri });
  mesh.merge();
  const mf = new W8.Manifold(mesh);
  const r = { comp: mf.decompose().length, vol: mf.volume() };
  mf.delete();
  return r;
};

// câmera alinhada à foto: pontos sintéticos projetados por uma câmera conhecida
{
  const W = 1600, H = 1200, alvo: V3 = [0, 10.5, 0];
  const pos: V3 = [14, 30, 22];
  const giro = rodrigues([0, 0, 0.21]), base = olharPara(pos, alvo);
  const rot = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => [0, 1, 2].reduce((s2, k) => s2 + giro[3 * i + k] * base[3 * k + j], 0)));
  const cam = { pos, rot, f: 1850 };
  const conjuntos: [string, V3[]][] = [
    ["4 pontos fora de um plano", [[0, 11.5, 4], [0, 11.5, -4], [3.5, 11.2, 0], [-2, 9, 2.5]]],
    ["pontas da oval e centros das redondas", [[0, 11.5, 4], [0, 11.5, -4], [3.1, 11.1, 0.4], [-3.0, 11.0, -0.5]]],
  ];
  for (const [nome, pts] of conjuntos) {
    const pares = pts.map((mo) => ({ foto: projetar(cam, W, H, mo)!, modelo: mo }));
    const t0 = performance.now();
    const r = alinharCamera(pares, W, H);
    const dPos = Math.hypot(r.camera.pos[0] - pos[0], r.camera.pos[1] - pos[1], r.camera.pos[2] - pos[2]) / Math.hypot(pos[0] - alvo[0], pos[1] - alvo[1], pos[2] - alvo[2]);
    const dAng = anguloEntre(r.camera.rot, cam.rot);
    ok(dPos < 0.005 && dAng < 0.5 && Math.abs(r.camera.f / cam.f - 1) < 0.005, `câmera pela foto (${nome}): posição ${(dPos * 100).toFixed(4)} %, giro ${dAng.toFixed(4)}°, foco ${r.camera.f.toFixed(1)} px, erro ${r.erro.toExponential(1)} px em ${(performance.now() - t0).toFixed(0)} ms`);
  }
  // 2 pares: parte da câmera da vista (mesma direção) e acerta posição e giro no eixo de visão
  const pares2 = ([[0, 11.5, 4], [0, 11.5, -4]] as V3[]).map((mo) => ({ foto: projetar(cam, W, H, mo)!, modelo: mo }));
  const r2 = alinharCamera(pares2, W, H, { pos: [pos[0] * 1.3, pos[1] * 1.3, pos[2] * 1.3], rot: cam.rot, f: 1850 });
  ok(r2.erro < 0.01, `câmera com 2 pares: erro ${r2.erro.toExponential(1)} px`);
}

// escala pela medida conhecida e foto fixa na vista
{
  const e = escalaPorMedida([400, 300], [400, 700], 8);
  ok(perto(e, 0.02, 1e-12), "escala pela medida: 8 mm em 400 px = 0,02 mm/px");
  const r = { ...referenciaNova("data:image/jpeg;base64,AAAA", 800, 1000), escala: e, cx: 400, cy: 500 };
  const a = fotoNoPlano(r, 400, 300), b = fotoNoPlano(r, 400, 700);
  ok(perto(a[1], 4, 1e-9) && perto(b[1], -4, 1e-9) && perto(a[0], 0, 1e-9), "foto fixa: as pontas medidas ficam a ±4 mm do ponto de referência");
  const ce = cantosNoMundo({ ...r, vista: "cima" }, [0, 12, 0]);
  ok(perto(ce[0][0], -8, 1e-9) && perto(ce[0][2], -10, 1e-9) && perto(ce[0][1], 12, 1e-9), "foto na vista de cima: canto no plano y = referência, x e z pela escala");
  const [ex, ey] = fotoNoEsboco(r, 400, 300);
  ok(perto(ex, 0, 1e-9) && perto(ey, -4, 1e-9), "decalque no esboço: (x, y) do esboço = (X, Z) da vista de cima");
  const lido = validarDoc({ ...docNovo(), referencia: r });
  ok(!!lido.referencia && lido.referencia.escala === e && validarDoc({ ...docNovo(), referencia: { imagem: "http://fora" } }).referencia === null, "referência salva no .wjgd e lida de volta (só imagem embutida)");
}

// seções dos fios (área conferida à mão) e fio torcido (volume ≈ seção × comprimento)
{
  ok(perto(areaSecao("oval", 1, 0.6), Math.PI * 0.6 / 4, 1e-12) && perto(areaSecao("meia-cana", 1, 0.5), Math.PI / 8, 1e-12) && perto(areaSecao("faca", 1, 0.6), 0.3, 1e-12), "áreas: oval 1 × 0,6 = 0,4712; meia-cana 1 × 0,5 = π/8 = 0,3927; faca 1 × 0,6 = 0,3000 mm²");
  for (const pf of ["redondo", "meia-cana", "oval", "faca"] as const) {
    const sec = secaoUnitaria(pf);
    let a2 = 0;
    for (let i = 0, j = sec.length - 1; i < sec.length; j = i++) a2 += sec[j][0] * sec[i][1] - sec[i][0] * sec[j][1];
    ok(perto(a2 / 2, areaSecao(pf, 1, 1), 1e-9), `seção ${pf}: polígono com a área exata (${(a2 / 2).toFixed(4)} mm² na seção unitária)`);
  }
  const n = 145, L = 12;
  const pts: V3[] = Array.from({ length: n }, (_, i) => [(L * i) / (n - 1), 0, 0]);
  const up: V3[] = pts.map(() => [0, 1, 0]);
  for (const [pf, w0, h0] of [["oval", 0.9, 0.5], ["meia-cana", 0.9, 0.45], ["faca", 0.9, 0.6]] as const) {
    const mm = tubo(pts, up, pts.map(() => w0), pts.map(() => h0), pts.map((_, i) => (2 * Math.PI * 3 * i) / (n - 1)), pf, false);
    const v = volumeComSinal(mm), esp = areaSecao(pf, w0, h0) * L;
    ok(Math.abs(v / esp - 1) < 0.02 && componentes(mm).comp === 1, `fio ${pf} torcido (3 voltas): volume ${v.toFixed(3)} ≈ seção × comprimento ${esp.toFixed(3)} mm³ (${((v / esp - 1) * 100).toFixed(2)} %)`);
  }
  // pontos de controle: Ø no meio diferente do início e do fim (interpolação suave, sem passar do valor)
  const iv = interpolar([{ u: 0, v: 0.8 }, { u: 0.5, v: 0.5 }, { u: 1, v: 0.8 }], [0, 0.25, 0.5, 0.75, 1]);
  ok(perto(iv[2], 0.5, 1e-12) && iv[1] < 0.8 && iv[1] > 0.5 && iv.every((x) => x >= 0.5 - 1e-12 && x <= 0.8 + 1e-12), `pontos de controle: ${iv.map((x) => x.toFixed(3)).join(" → ")}`);
}

// ornamento com fio avançado (perfil, controles, torção, trançado, subida até uma garra)
{
  const b = docNovo();
  const esb = esbocoNovoOrnamento("adv-esb", b.aro.largura, null, 26);
  esb.pontos.push({ id: "q1", x: -5, y: 0.5 }, { id: "q2", x: -1, y: 0.7 }, { id: "q3", x: 3, y: 0.5 }, { id: "q4", x: 6, y: 0.3 }, { id: "q5", x: 1.4, y: 3.2 });
  esb.geos.push({ id: "fA", tipo: "linha", p1: "q1", p2: "q2" }, { id: "fB", tipo: "linha", p1: "q3", p2: "q4" }, { id: "fC", tipo: "linha", p1: "q4", p2: "q5" });
  const orn: Ornamento = {
    id: "adv", nome: "Avançado", ativo: true, esboco: esb, altura: 0, diametro: 0.7, simetria: "nenhuma", envolver: true, pontas: true, pontos: {},
    fios: {
      fA: { perfil: "oval", torcao: 1, controles: [{ u: 0, d: 0.9, h: 0.55, a: 0 }, { u: 0.5, d: 0.7, h: 0.45, a: 0.3 }, { u: 1, d: 0.9, h: 0.55, a: 0 }] },
      fB: { trancado: true, torcao: 2, d0: 0.45 },
      fC: { perfil: "meia-cana", d0: 0.7, subir: "fim" },
    },
  };
  const d: DocJoia = { ...b, ornamentos: [orn] };
  const m = montar(d);
  const fA = m.orn.fios[0], fC = m.orn.fios[2];
  const meio = fA.malha!.larguras[Math.floor(fA.pts.length / 2)];
  ok(!!fA.malha && perto(meio, 0.7, 0.02) && perto(fA.malha.larguras[0], 0.9, 1e-9), `fio oval com 3 pontos de controle: largura 0,9 → ${meio.toFixed(3)} → 0,9 mm`);
  const garra = m.garras.map((g) => g.topo).reduce((x, y) => (Math.hypot(...(y.map((v, i) => v - fC.pts[fC.pts.length - 1][i]) as V3)) < Math.hypot(...(x.map((v, i) => v - fC.pts[fC.pts.length - 1][i]) as V3)) ? y : x));
  const fimC = fC.pts[fC.pts.length - 1];
  const dGarra = Math.min(...m.garras.map((g) => { const ab = g.topo.map((v, i) => v - g.base[i]), aq = fimC.map((v, i) => v - g.base[i]); const t = Math.max(0, Math.min(1, (ab[0] * aq[0] + ab[1] * aq[1] + ab[2] * aq[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2))); return Math.hypot(...(aq.map((v, i) => v - t * ab[i]) as V3)); }));
  void garra;
  ok(dGarra < 1e-6, `fio que sobe livre: a ponta encaixa na garra da central (distância ${dGarra.toExponential(1)} mm)`);
  const r = construirMalha(W8, d);
  const sem = construirMalha(W8, { ...d, ornamentos: [] });
  ok(componentes(r.malha).comp === 1 && r.volume > sem.volume + 2 && !r.avisos.length, `ornamento avançado unido: ${sem.volume.toFixed(1)} → ${r.volume.toFixed(1)} mm³, peça única ${r.avisos.join(" ")}`);
}

// folha paramétrica: volume e espessura mínima; folha com pedra (a garra se apoia na folha)
{
  const f0 = { ...folhaNova("t", 1), dobra: 0, curvatura: 0, nervura: "nenhuma" as const, comprimento: 3, largura: 1.4, espessura: 0.6 };
  const mf = malhaFolha(f0);
  const v = volumeComSinal(mf), esp = volumeEsperado(f0);
  ok(Math.abs(v / esp - 1) < 0.03 && componentes(mf).comp === 1, `folha plana: volume ${v.toFixed(3)} ≈ integral da seção ${esp.toFixed(3)} mm³ (${((v / esp - 1) * 100).toFixed(2)} %)`);
  for (const f of [f0, folhaNova("t2", 2), { ...folhaNova("t3", 3), contorno: "coracao" as const, ponta: "arredondada" as const, nervura: "saliente" as const, dobra: -30, curvatura: 0.4 }, { ...folhaNova("t4", 4), contorno: "oval" as const, borda: "viva" as const }]) {
    const mm = malhaFolha(f);
    // espessura no miolo da chapa (longe da borda e das pontas): raios para dentro a partir da face de cima
    const vs: number[] = [];
    for (let i = 0; i < mm.pos.length / 3; i++) {
      const x = mm.pos[3 * i], z = mm.pos[3 * i + 2], s2 = x / f.comprimento;
      if (s2 < 0.2 || s2 > 0.8) continue;
      if (Math.abs(z) < 0.45 * (f.largura / 2) * larguraRelativa(f, s2)) vs.push(i);
    }
    const e = espessuras(mm, vs, f.espessura * 0.97);
    ok(vs.length > 20 && e.abaixo === 0 && e.menor >= f.espessura * 0.97, `folha ${f.contorno} (${f.nervura}, dobra ${f.dobra}°, borda ${f.borda}): espessura mínima ${e.menor.toFixed(3)} mm ≥ ${f.espessura} mm em ${vs.length} pontos`);
  }
  const b = docNovo();
  const navete: GemaLivre = { ...gemaLivreNova("nv", 1, "navete"), gema: { lapidacao: "navete", material: "diamante", comprimento: 3, largura: 1.5 }, th: 28, z: 0.3, altura: 0.6, seguir: true };
  const comPedra: DocJoia = { ...b, gemasLivres: [navete], folhas: [{ ...folhaNova("fp", 1), comprimento: 4.4, largura: 2.4, pedra: "nv", altura: -0.1 }] };
  const m = montar(comPedra);
  const folga = m.livres[0].folga;
  const r = construirMalha(W8, comPedra);
  const semAssento = construirMalha(W8, { ...comPedra, gemasLivres: [{ ...navete, ativo: false }] });
  ok(m.folhas.length === 1 && folga < 0.05 && componentes(r.malha).comp === 1 && !r.avisos.some((x) => /solta|não/.test(x)), `folha com pedra: garras apoiadas na folha (folga ${folga.toFixed(3)} mm), peça única, ${r.volume.toFixed(1)} mm³`);
  void semAssento;
}

// concordância: peça única fechada, volume só um pouco maior e nada de metal perdido (nenhum ponto afina)
{
  const b = docNovo();
  const d: DocJoia = {
    ...b, aro: { ...b.aro, perfil: "reto", largura: 2, espessura: 1.5, larguraBase: 2, espessuraBase: 1.5 },
    gemasLivres: [{ ...gemaLivreNova("g", 1, "navete"), th: 35, altura: 0.3 }],
    folhas: [{ ...folhaNova("f", 1), th: -30, altura: -0.2 }],
    ornamentos: [ornamentoVintage("v", 2)],
  };
  const t0 = performance.now();
  const sem = construirMalha(W8, d, [], 0, { concordancia: false });
  const t1 = performance.now();
  const com = construirMalha(W8, { ...d, concordancia: { ativo: true, raio: 0.2 } });
  const t2 = performance.now();
  const c = componentes(com.malha);
  // contenção: o sólido sem concordância fica inteiro dentro do sólido com ela
  const mA = new W8.Manifold(Object.assign(new W8.Mesh({ numProp: 3, vertProperties: sem.malha.pos, triVerts: sem.malha.tri }), {}));
  const mB = new W8.Manifold(new W8.Mesh({ numProp: 3, vertProperties: com.malha.pos, triVerts: com.malha.tri }));
  const perdido = mA.subtract(mB).volume();
  ok(c.comp === 1 && com.volume > sem.volume && com.volume < sem.volume * 1.03 && !com.avisos.length, `concordância 0,2 mm: peça única fechada, ${sem.volume.toFixed(2)} → ${com.volume.toFixed(2)} mm³ (+${(((com.volume / sem.volume) - 1) * 100).toFixed(2)} %) em ${((t2 - t1) / 1000).toFixed(1)} s (sem: ${((t1 - t0) / 1000).toFixed(1)} s)`);
  ok(perdido < 1e-3, `concordância só acrescenta metal (perdido ${perdido.toExponential(1)} mm³): nenhum ponto fica mais fino que antes`);
  const fios = com.montagem.orn.fios.every((f) => f.raios.every((r) => 2 * r >= LIGAS[d.liga].garraMin - 1e-9));
  ok(fios && d.folhas.every((f) => f.espessura >= LIGAS[d.liga].garraMin), "nenhuma peça abaixo do mínimo da liga (fios e folhas ≥ 0,6 mm; a concordância só acrescenta)");
  const stl = stlBinario(com.malha);
  ok(perto(volStl(stl), com.volume, 0.01 * com.volume), `STL com concordância reaberto: ${volStl(stl).toFixed(1)} ≈ ${com.volume.toFixed(1)} mm³`);
  mA.delete(); mB.delete();
}

// .wjgd do J9a abre igual (sem folhas, concordância desligada, sem foto; mesmo metal)
{
  const bruto = JSON.parse(readFileSync("scripts/modelos/j9a-anel-folhas.wjgd", "utf8"));
  const d = validarDoc(bruto);
  const iguais = JSON.stringify({ ...d, folhas: undefined, folhasAtivo: undefined, concordancia: undefined, referencia: undefined }) === JSON.stringify({ ...bruto, folhas: undefined, folhasAtivo: undefined, concordancia: undefined, referencia: undefined });
  ok(iguais && d.folhas.length === 0 && !d.concordancia.ativo && d.referencia === null, ".wjgd do J9a lido sem mudar nada (campos novos com o padrão)");
  const occ = medidas(construir(d).forma).volume;
  const r = construirMalha(W8, d);
  ok(perto(occ, 189.5, 0.3) && perto(r.volume, 191.7, 0.01 * 191.7) && componentes(r.malha).comp === 1, `.wjgd do J9a: metal ${occ.toFixed(1)} mm³ (OpenCascade, J9a: 189,5) e ${r.volume.toFixed(1)} mm³ com as folhinhas na malha (J9a: 191,7)`);
}

// modelo "Anel folhas com oval" (ANEL AMOR) refeito com folhas e fios avançados
{
  const d = validarDoc(JSON.parse(JSON.stringify(anelFolhasOval())));
  const m = montar(d);
  const nGemas = (m.cabeca ? 1 : 0) + m.livres.length + m.pave.length + m.gemasOrn.length;
  const f0 = ficha(d, m, 0);
  ok(perto(2 * m.R, 15.92, 0.02) && nGemas === 9 && f0.ctTotal > 1.3 && f0.ctTotal < 1.5, `modelo: Ø ${(2 * m.R).toFixed(3)} mm, 9 gemas, ${f0.ctTotal.toFixed(3)} ct`);
  ok(m.folhas.length === 8 && d.esculturas.length === 0 && m.orn.fios.some((f) => f.malha?.perfil === "oval" && f.malha.torcao) && m.orn.fios.some((f) => f.malha?.perfil === "meia-cana") && d.concordancia.ativo, `modelo: 8 folhas paramétricas, ramos ovais torcidos, moldura em meia-cana, concordância ligada`);
  ok(m.livres.every((x) => x.hastes.every((h) => 2 * h.r >= 0.6 - 1e-9)) && m.garras.every((h) => 2 * h.r >= 0.6) && m.orn.fios.every((f) => f.raios.every((r) => 2 * r >= 0.5 - 1e-9)) && d.folhas.every((f) => f.espessura >= 0.6), "modelo: garras ≥ 0,6 mm, folhas com 0,6 mm e fios ≥ 0,5 mm de altura");
  const av = verificar(d, m, 0);
  ok(av.length === 0, `modelo: nenhum aviso (${av.join(" | ")})`);
  let t0 = performance.now();
  const pc = pecas(d, [], 0, true, m);
  const previa = [malhaDe(pc.aro), ...pc.partes.map((x) => malhaDe(x.s)), previaMalha(d, m)];
  const msPrevia = performance.now() - t0;
  ok(previa.length > 10 && msPrevia < 2000, `modelo: prévia (sem booleanas nem concordância) em ${msPrevia.toFixed(0)} ms`);
  t0 = performance.now();
  const r = construirMalha(W8, d);
  const ms = performance.now() - t0;
  const c = componentes(r.malha), peso = (r.volume / 1000) * 15.5;
  ok(c.comp === 1 && !r.avisos.length && peso >= 2.5 && peso <= 3.5 && (r.concordancia?.acrescimo ?? 0) > 0, `modelo: peça única fechada com concordância, ${r.volume.toFixed(1)} mm³ = ${peso.toFixed(2)} g em ouro 750 (faixa 2,5–3,5 g) ${r.avisos.join(" ")}`);
  console.log(`   tempo de reconstrução do modelo (Node): ${(ms / 1000).toFixed(1)} s (${Object.entries(r.tempos).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(", ")})`);
  const vU = volStl(stlBinario(r.malha));
  ok(perto(vU, r.volume, 0.01 * r.volume), `STL do modelo reaberto: ${vU.toFixed(1)} ≈ ${r.volume.toFixed(1)} mm³`);
}

if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1); }
console.log("teste-joia: tudo certo");

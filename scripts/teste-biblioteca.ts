// Teste da biblioteca de componentes de fixação (src/biblioteca) em Node: tabelas, nomes padronizados,
// geração de todas as peças no kernel, volume/massa de 5 itens contra a conta direta da tabela da norma,
// rosca real, furos/entrada/pose, posicionamentos de encaixe resolvidos pelo solver e "furos iguais".
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { MATERIAIS, novaFeature, novoEsboco, type Documento, type FeatureExtrusao } from "../src/model";
import { regenerar } from "../src/kernel/regenerar";
import * as op from "../src/esboco/operacoes";
import { FAMILIAS, LISTA_COMPRIMENTOS, PASSO_GROSSO, PASSOS_FINOS, diametroNominal, familiaPorId } from "../src/biblioteca/dados";
import { comprimentosDoPadrao, descricaoDe, gerarPeca, massaEmGramas, nomePadrao, passoGrosso } from "../src/biblioteca/gerar";
import { buscar, arvore } from "../src/biblioteca/busca";
import {
  compatibilidadeDoFuro, comprimentoMinimo, empilhadoNoLado, entradaDoFuro, furosDoComponente, furosIguais, ladoParaCamera, planasDoComponente, poseDoFixador, posicionamentosDoEncaixe, proximoDaLista, quatDeY,
} from "../src/biblioteca/encaixe";
import { aplicarDirecao, aplicarPonto, embutirPeca, inserirComponente, montagemVazia, type Transformacao } from "../src/montagem/modelo";
import { resolverMontagem } from "../src/montagem/solver";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));

let falhas = 0;
function confere(nome: string, obtido: number | null | undefined, esperado: number, tol = 2e-3) {
  const v = obtido ?? NaN;
  const ok = Math.abs(v - esperado) <= tol * Math.max(1, Math.abs(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${v.toFixed(3)} (esperado ${esperado.toFixed(3)})`);
}
function verdade(nome: string, v: boolean, extra = "") {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}${v ? "" : ` ${extra}`}`);
}
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}
const r3 = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4 + 0);
const hex = (s: number) => (Math.sqrt(3) / 2) * s * s; // área do sextavado com largura entre faces s
const circ = (d: number) => (Math.PI * d * d) / 4;

// ---------- dados das tabelas ----------
{
  const grupos = new Set(FAMILIAS.map((f) => f.grupo));
  igual("grupos da árvore", [...grupos], ["Parafusos", "Porcas", "Arruelas", "Rebites", "Pinos"]);
  igual("tipos de parafuso pedidos", FAMILIAS.filter((f) => f.grupo === "Parafusos").map((f) => f.tipo), ["Sextavado", "Allen cilíndrico", "Escareado", "Abaulado", "Prisioneiro", "Sem cabeça"]);
  igual("tipos de porca pedidos", FAMILIAS.filter((f) => f.grupo === "Porcas").map((f) => f.tipo), ["Sextavada", "Autotravante", "Castelo", "Borboleta"]);
  igual("tipos de arruela pedidos", FAMILIAS.filter((f) => f.grupo === "Arruelas").map((f) => f.tipo), ["Lisa", "De pressão", "Dentada"]);
  igual("rebites e pinos pedidos", FAMILIAS.filter((f) => f.grupo === "Rebites" || f.grupo === "Pinos").map((f) => f.tipo), ["De repuxo", "Maciço", "Elástico", "Cilíndrico"]);
  const ids = FAMILIAS.map((f) => f.id);
  verdade("ids únicos", new Set(ids).size === ids.length);
  const sext = familiaPorId("iso4017")!, porca = familiaPorId("iso4032")!, arruela = familiaPorId("iso7089")!;
  igual("ISO 4017 cobre M2–M30 (17 tamanhos)", [sext.tamanhos.length, sext.tamanhos[0].tam, sext.tamanhos.at(-1)!.tam], [17, "M2", "M30"]);
  igual("ISO 4032 e ISO 7089 cobrem M2–M30", [porca.tamanhos.length, arruela.tamanhos.length], [17, 17]);
  // conferência cruzada com a norma: largura entre faces e altura, porca e arruela de alguns tamanhos
  const dado = (f: typeof sext, tam: string) => f.tamanhos.find((t) => t.tam === tam)!.cotas;
  igual("ISO 4017 M8: s=13 k=5,3", [dado(sext, "M8").s, dado(sext, "M8").k], [13, 5.3]);
  igual("ISO 4017 M16: s=24 k=10", [dado(sext, "M16").s, dado(sext, "M16").k], [24, 10]);
  igual("ISO 4032 M12: s=18 m=10,8", [dado(porca, "M12").s, dado(porca, "M12").m], [18, 10.8]);
  igual("ISO 7089 M10: 10,5 / 20 / 2", [dado(arruela, "M10").d1, dado(arruela, "M10").d2, dado(arruela, "M10").h], [10.5, 20, 2]);
  igual("ISO 4762 M6: dk=10 k=6 s=5", [dado(familiaPorId("iso4762")!, "M6").dk, dado(familiaPorId("iso4762")!, "M6").k, dado(familiaPorId("iso4762")!, "M6").s], [10, 6, 5]);
  igual("ISO 10642 M8: dk=17,92 k=4,96 s=5", [dado(familiaPorId("iso10642")!, "M8").dk, dado(familiaPorId("iso10642")!, "M8").k, dado(familiaPorId("iso10642")!, "M8").s], [17.92, 4.96, 5]);
  igual("passo grosso M8/M12/M30", [PASSO_GROSSO.M8, PASSO_GROSSO.M12, PASSO_GROSSO.M30], [1.25, 1.75, 3.5]);
  igual("passos finos M10", PASSOS_FINOS.M10, [1.25, 1]);
  igual("diâmetro nominal", [diametroNominal("M6"), diametroNominal("M2,5"), diametroNominal("Ø3,2")], [6, 2.5, 3.2]);
  // coerência: todo tamanho roscado tem passo grosso e fino; lmin < lmax; a lista do padrão não é vazia
  let incoerente = "";
  for (const f of FAMILIAS) for (const t of f.tamanhos) {
    if (f.roscado && !PASSO_GROSSO[t.tam]) incoerente += `${f.id} ${t.tam} sem passo; `;
    if (f.comprimento && (t.lmin === undefined || t.lmax === undefined || t.lmin >= t.lmax || !comprimentosDoPadrao(f, t.tam, LISTA_COMPRIMENTOS).length)) incoerente += `${f.id} ${t.tam} sem faixa; `;
    if (!f.comprimento && t.lmin !== undefined) incoerente += `${f.id} ${t.tam} faixa sobrando; `;
  }
  verdade("todas as linhas das tabelas são coerentes", incoerente === "", incoerente);
  // cabeça maior que a haste, furo da arruela maior que o diâmetro nominal
  let geom = "";
  for (const t of familiaPorId("iso4762")!.tamanhos) if (!(t.cotas.dk > diametroNominal(t.tam))) geom += `Allen ${t.tam}; `;
  for (const t of arruela.tamanhos) if (!(t.cotas.d1 > diametroNominal(t.tam) && t.cotas.d2 > t.cotas.d1)) geom += `arruela ${t.tam}; `;
  for (const t of sext.tamanhos) if (!(t.cotas.s > diametroNominal(t.tam))) geom += `sextavado ${t.tam}; `;
  verdade("cabeças, arruelas e sextavados maiores que a haste", geom === "", geom);
}

// ---------- nomes padronizados e descrição ----------
{
  const allen = familiaPorId("iso4762")!;
  igual("nome Allen M6x20", nomePadrao(allen, "M6", 20), "Parafuso ISO 4762 M6x20");
  igual("nome passo fino", nomePadrao(allen, "M8", 30, 1), "Parafuso ISO 4762 M8x1x30");
  igual("passo grosso informado não vira fino", nomePadrao(allen, "M8", 30, 1.25), "Parafuso ISO 4762 M8x30");
  igual("nome porca", nomePadrao(familiaPorId("iso4032")!, "M8"), "Porca ISO 4032 M8");
  igual("nome arruela", nomePadrao(familiaPorId("iso7089")!, "M10"), "Arruela lisa ISO 7089 M10");
  igual("nome com vírgula decimal", nomePadrao(familiaPorId("iso2338")!, "Ø2,5", 14), "Pino cilíndrico ISO 2338 Ø2,5x14");
  igual("descrição", descricaoDe(allen, "M6", 20), "Parafuso allen cilíndrico M6, comprimento 20 mm, ISO 4762");
  igual("comprimentos do padrão M6 Allen", comprimentosDoPadrao(allen, "M6", LISTA_COMPRIMENTOS).filter((l) => l <= 20), [10, 12, 14, 16, 18, 20]);
  igual("passo grosso do tamanho", passoGrosso("M10"), 1.5);
  let erro = "";
  try { gerarPeca({ familia: "iso4762", tam: "M6", comprimento: 500 }); } catch (e) { erro = (e as Error).message; }
  verdade("comprimento fora do padrão é recusado com mensagem", /comprimento de 10 a 80 mm/.test(erro), erro);
  erro = "";
  try { gerarPeca({ familia: "iso4762", tam: "M6" }); } catch (e) { erro = (e as Error).message; }
  verdade("sem comprimento é recusado", /informe o comprimento/.test(erro), erro);
  erro = "";
  try { gerarPeca({ familia: "iso4762", tam: "M7", comprimento: 20 }); } catch (e) { erro = (e as Error).message; }
  verdade("tamanho que não existe é recusado", /não existe na norma/.test(erro), erro);
}

// ---------- busca e árvore ----------
{
  igual("árvore: 5 grupos", arvore().map((g) => g.grupo), ["Parafusos", "Porcas", "Arruelas", "Rebites", "Pinos"]);
  igual("árvore: tipos de Porcas", arvore().find((g) => g.grupo === "Porcas")!.familias.map((f) => f.tipo), ["Sextavada", "Autotravante", "Castelo", "Borboleta"]);
  igual("busca 'allen' acha o ISO 4762", buscar("allen").map((f) => f.id).includes("iso4762"), true);
  igual("busca por norma 'din 935'", buscar("din 935").map((f) => f.id), ["din935"]);
  igual("busca sem acento 'cabeca'", buscar("cabeca").length > 0, true);
  igual("busca vazia = tudo", buscar("").length, FAMILIAS.length);
  igual("busca sem resultado", buscar("xyzxyz").length, 0);
}

// ---------- geração no kernel: todas as peças ----------
{
  let ruins = "", total = 0;
  for (const f of FAMILIAS) for (const t of f.tamanhos) {
    const ls = f.comprimento ? comprimentosDoPadrao(f, t.tam, LISTA_COMPRIMENTOS) : [undefined];
    for (const L of f.comprimento ? [ls[0], ls[ls.length - 1]] : ls) {
      total++;
      try {
        const r = gerarPeca({ familia: f.id, tam: t.tam, comprimento: L });
        const g = regenerar(r.doc.features);
        if (g.erros.length || !((g.volume ?? 0) > 0) || (g.corpos?.length ?? 1) !== 1) ruins += `${r.nome}(${g.erros[0]?.mensagem ?? g.corpos?.length}); `;
      } catch (e) {
        ruins += `${f.id} ${t.tam}: ${(e as Error).message}; `;
      }
    }
  }
  verdade(`as ${total} peças (todas as famílias × tamanhos × menor/maior comprimento) regeneram em 1 corpo sem erro`, ruins === "", ruins);
}

// ---------- volume e massa de 5 itens contra a conta da tabela da norma ----------
{
  const aço = MATERIAIS["aco-1045"].densidade;
  const vol = (pedido: Parameters<typeof gerarPeca>[0]) => regenerar(gerarPeca(pedido).doc.features).volume!;
  // 1) ISO 4017 M8x30: cabeça sextavada s=13 k=5,3 + haste Ø8×30
  const v1 = vol({ familia: "iso4017", tam: "M8", comprimento: 30 });
  confere("ISO 4017 M8x30: volume (mm³)", v1, hex(13) * 5.3 + circ(8) * 30);
  confere("ISO 4017 M8x30: massa (g) ≈ tabela comercial ~17,9 g", massaEmGramas(v1, aço), 17.9, 0.03);
  // 2) ISO 4762 M6x20: cabeça Ø10×6 + haste Ø6×20 − sextavado interno s=5 prof. 3
  const v2 = vol({ familia: "iso4762", tam: "M6", comprimento: 20 });
  confere("ISO 4762 M6x20: volume (mm³)", v2, circ(10) * 6 + circ(6) * 20 - hex(5) * 3);
  confere("ISO 4762 M6x20: massa (g) ≈ tabela comercial ~7,7 g", massaEmGramas(v2, aço), 7.7, 0.05);
  // 3) ISO 4032 M8: sextavado s=13 m=6,8 − furo do diâmetro menor D1 = 8 − 1,0825·1,25
  const v3 = vol({ familia: "iso4032", tam: "M8" });
  confere("ISO 4032 M8: volume (mm³)", v3, hex(13) * 6.8 - circ(8 - 1.0825 * 1.25) * 6.8);
  // 4) ISO 7089 M8: anel 8,4 / 16 × 1,6
  const v4 = vol({ familia: "iso7089", tam: "M8" });
  confere("ISO 7089 M8: volume (mm³)", v4, (circ(16) - circ(8.4)) * 1.6);
  confere("ISO 7089 M8: massa (g) ≈ tabela comercial ~1,85 g", massaEmGramas(v4, aço), 1.85, 0.04);
  // 5) ISO 2338 Ø6x20: cilindro maciço
  const v5 = vol({ familia: "iso2338", tam: "Ø6", comprimento: 20 });
  confere("ISO 2338 Ø6x20: volume (mm³)", v5, circ(6) * 20);
  confere("ISO 2338 Ø6x20: massa (g)", massaEmGramas(v5, aço), (circ(6) * 20 * 7.85) / 1000);
  // extras: escareado (cone + haste − sextavado) e rebite maciço (calota + haste)
  const v6 = vol({ familia: "iso10642", tam: "M6", comprimento: 20 });
  const cone = (Math.PI * 3.72 / 3) * ((13.44 / 2) ** 2 + (13.44 / 2) * 3 + 9);
  confere("ISO 10642 M6x20: volume (mm³)", v6, cone + circ(6) * (20 - 3.72) - hex(4) * 2.2, 5e-3);
  const v7 = vol({ familia: "iso1051", tam: "Ø4", comprimento: 20 });
  const a = 3.5, k = 2.8; // calota: V = πk(3a² + k²)/6
  confere("ISO 1051 Ø4x20: volume (mm³)", v7, (Math.PI * k * (3 * a * a + k * k)) / 6 + circ(4) * 20, 5e-3);
  // massa usa a densidade do material da peça gerada
  const r = gerarPeca({ familia: "iso15977", tam: "Ø4", comprimento: 12 });
  igual("rebite de repuxo: material alumínio", r.doc.material, "aluminio-5052");
}

// ---------- propriedades para a lista de materiais ----------
{
  const r = gerarPeca({ familia: "iso4762", tam: "M6", comprimento: 20 });
  igual("propriedades do Allen M6x20", r.doc.propriedades, {
    norma: "ISO 4762", descricao: "Parafuso allen cilíndrico M6, comprimento 20 mm, ISO 4762", material: "aco-1045", tamanho: "M6", comprimento: "20", passo: "1", rosca: "cosmética",
    conferencia: "norma", apoio: "6", grupo: "Parafusos", biblioteca: "iso4762",
  });
  igual("nome do documento = nome padronizado", r.doc.nome, "Parafuso ISO 4762 M6x20");
  const rf = gerarPeca({ familia: "iso4017", tam: "M10", comprimento: 40, passo: 1.25, roscaReal: true });
  igual("passo fino e rosca real nas propriedades", [rf.doc.propriedades!.passo, rf.doc.propriedades!.rosca], ["1.25", "real"]);
  const rp = gerarPeca({ familia: "iso7089", tam: "M6" });
  igual("arruela não tem passo nem comprimento", [rp.doc.propriedades!.passo, rp.doc.propriedades!.comprimento], [undefined, undefined]);
  igual("apoio da arruela = espessura", rp.doc.propriedades!.apoio, "1.6");
}

// ---------- rosca real ----------
{
  const vol = (r: ReturnType<typeof gerarPeca>) => { const g = regenerar(r.doc.features); return { v: g.volume!, erros: g.erros.length }; };
  const cos = vol(gerarPeca({ familia: "iso4762", tam: "M6", comprimento: 20 }));
  const real = gerarPeca({ familia: "iso4762", tam: "M6", comprimento: 20, roscaReal: true });
  const rr = vol(real);
  verdade("rosca real: sem erros", rr.erros === 0);
  verdade("rosca real tira material da haste (volume menor, mas não vazio)", rr.v < cos.v && rr.v > cos.v * 0.9, `${rr.v} vs ${cos.v}`);
  igual("propriedade rosca = real", real.doc.propriedades!.rosca, "real");
  const fino = vol(gerarPeca({ familia: "iso4017", tam: "M8", comprimento: 20, passo: 1, roscaReal: true }));
  const grosso = vol(gerarPeca({ familia: "iso4017", tam: "M8", comprimento: 20, roscaReal: true }));
  verdade("rosca real passo fino e grosso regeneram", fino.erros === 0 && grosso.erros === 0 && fino.v !== grosso.v);
  const porca = gerarPeca({ familia: "iso4032", tam: "M8", roscaReal: true });
  igual("porca ignora rosca real (fica cosmética)", porca.doc.propriedades!.rosca, "cosmética");
  const esc = vol(gerarPeca({ familia: "iso10642", tam: "M6", comprimento: 20, roscaReal: true }));
  verdade("escareado com rosca real regenera", esc.erros === 0);
}

// ---------- posição: eixo Y, apoio em y = 0 ----------
{
  const caixa = (doc: Documento) => {
    const v = regenerar(doc.features).malha!.vertices;
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[i + k]); mx[k] = Math.max(mx[k], v[i + k]); }
    return { mn: r3(mn), mx: r3(mx) };
  };
  const b = caixa(gerarPeca({ familia: "iso4762", tam: "M6", comprimento: 20 }).doc);
  igual("Allen M6x20: cabeça em y ∈ [0, 6], ponta em y = −20", [b.mn[1], b.mx[1]], [-20, 6]);
  const n = caixa(gerarPeca({ familia: "iso4032", tam: "M8" }).doc);
  igual("porca M8: y ∈ [0, 6,8]", [n.mn[1], n.mx[1]], [0, 6.8]);
  const e = caixa(gerarPeca({ familia: "iso10642", tam: "M6", comprimento: 20 }).doc);
  igual("escareado M6x20: topo em y = 0, ponta em −20", [e.mn[1], e.mx[1]], [-20, 0]);
  const p = caixa(gerarPeca({ familia: "iso2338", tam: "Ø6", comprimento: 20 }).doc);
  igual("pino Ø6x20: y ∈ [−20, 0]", [p.mn[1], p.mx[1]], [-20, 0]);
}

// ---------- encaixe em furos da montagem ----------
{
  // chapa 60 × 40 × 10 (y de 0 a 10) com dois furos passantes Ø6,6 em x = ±15
  const retang = novoEsboco(1, { tipo: "plano", plano: "XZ", deslocamento: 0 });
  op.retangulo(retang, op.ponto(retang, { x: -30, y: -20 }), op.ponto(retang, { x: 30, y: 20 }));
  const base = { ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: retang.id, profundidade: 10 };
  const furos = novoEsboco(2, { tipo: "plano", plano: "XZ", deslocamento: 10 });
  for (const x of [-15, 15]) op.circulo(furos, op.ponto(furos, { x, y: 0 }), 3.3);
  const corte = { ...(novaFeature("extrusao", 2) as FeatureExtrusao), esboco: furos.id, operacao: "cortar" as const, profundidade: 10, inverter: true };
  const chapa: Documento = { formato: "wjcad", versao: 3, nome: "Chapa", features: [retang, base, furos, corte], material: "aco-1045" };
  const g = regenerar(chapa.features);
  confere("chapa com 2 furos: volume", g.volume, 60 * 40 * 10 - 2 * Math.PI * 3.3 * 3.3 * 10);

  const m = montagemVazia("Teste");
  const pc = embutirPeca(m, chapa, { nome: "Chapa" });
  const cc = inserirComponente(m, pc); // primeiro: fixo na origem
  const t0: Transformacao = cc.t;
  const fs = furosDoComponente(cc.id, t0, g.topologia!, g.malha!);
  igual("2 furos achados (cilindros côncavos)", fs.length, 2);
  verdade("furo: raio 3,3 e comprimento 10 (espessura atravessada)", fs.every((f) => Math.abs(f.raio - 3.3) < 1e-6 && Math.abs(f.comprimento - 10) < 1e-3));
  igual("furos iguais ao primeiro: o outro", furosIguais(fs, fs[0]).map((f) => f.indice), [fs.find((f) => f !== fs[0])!.indice]);
  const planas = planasDoComponente(cc.id, t0, g.topologia!);

  // lado de cima (câmera olhando de +Y) e de baixo
  const furo = fs.find((f) => f.centro[0] > 0)!;
  igual("lado voltado para a câmera (olho em +Y)", ladoParaCamera(furo, [0, 1, 0]) * furo.eixo[1], 1);
  const lado = ladoParaCamera(furo, [0, 1, 0]);
  const entrada = entradaDoFuro(furo, lado, planas);
  igual("entrada de cima: y = 10, normal +Y, com face de apoio", [r3(entrada.origem), r3(entrada.u), !!entrada.apoio], [[15, 10, 0], [0, 1, 0], true]);
  const baixo = entradaDoFuro(furo, (lado * -1) as 1 | -1, planas);
  igual("entrada de baixo: y = 0, normal −Y", [r3(baixo.origem), r3(baixo.u), !!baixo.apoio], [[15, 0, 0], [0, -1, 0], true]);
  igual("quatDeY(+Y) = identidade; quatDeY(−Y) gira 180° em X", [quatDeY([0, 1, 0]), quatDeY([0, -1, 0])], [[0, 0, 0, 1], [1, 0, 0, 0]]);
  const qx = quatDeY([1, 0, 0]);
  igual("quatDeY(+X): Y vira X", r3(aplicarDirecao({ pos: [0, 0, 0], rot: qx }, [0, 1, 0])), [1, 0, 0]);

  // parafuso Allen M6x20 por cima
  const parafuso = gerarPeca({ familia: "iso4762", tam: "M6", comprimento: 20 });
  const pp = embutirPeca(m, parafuso.doc, { nome: parafuso.nome });
  const cp = inserirComponente(m, pp, poseDoFixador(entrada));
  m.posicionamentos.push(...posicionamentosDoEncaixe(cp.id, furo, entrada));
  igual("encaixe cria concêntrico + coincidente", m.posicionamentos.map((x) => x.tipo), ["concentrico", "coincidente"]);
  const sol = resolverMontagem(m, { preferido: cp.id });
  const tp = sol.poses.get(cp.id) ?? cp.t;
  igual("sem erros no solver", [...sol.erros.keys()], []);
  igual("posição do parafuso resolvida: origem na borda do furo (15, 10, 0)", r3(tp.pos), [15, 10, 0]);
  igual("eixo do parafuso = +Y; ponta atravessa a chapa (y = −10)", [r3(aplicarDirecao(tp, [0, 1, 0])), r3(aplicarPonto(tp, [0, -20, 0]))[1]], [[0, 1, 0], -10]);

  // o solver também traz o parafuso de volta se ele estiver fora do lugar (arrastado e solto longe)
  const fora = { pos: [22, 17, 4] as [number, number, number], rot: [0, 0, 0, 1] as [number, number, number, number] };
  cp.t = fora;
  const sol0 = resolverMontagem(m, { preferido: cp.id });
  const tv = sol0.poses.get(cp.id) ?? cp.t;
  igual("parafuso fora do lugar volta ao furo (±0,05)", r3(tv.pos.map((v, i) => Math.round(v * 20) / 20)), [15, 10, 0]);
  cp.t = tv;
  // arruela sob a cabeça: parafuso passa a ficar sobre ela (deslocamento = altura da arruela)
  const arruela = gerarPeca({ familia: "iso7089", tam: "M6" });
  const pa = embutirPeca(m, arruela.doc, { nome: arruela.nome });
  const ca = inserirComponente(m, pa, poseDoFixador(entrada));
  m.posicionamentos.push(...posicionamentosDoEncaixe(ca.id, furo, entrada));
  const direcaoDe = (id: string) => { const t = sol.poses.get(id) ?? m.componentes.find((c) => c.id === id)!.t; return aplicarDirecao(t, [0, 1, 0]); };
  const alturaDe = (id: string) => { const c = m.componentes.find((x) => x.id === id)!; const p = m.pecas.find((x) => x.id === c.peca)!; const pr = p.doc.propriedades; return pr && (pr.grupo === "Arruelas" || pr.grupo === "Porcas") ? Number(pr.apoio) : null; };
  // só arruelas e porcas empilham (a cabeça do parafuso não): a pilha de cima é a arruela, 1,6
  const pilha = empilhadoNoLado(m.posicionamentos, furo, entrada.u, direcaoDe, alturaDe);
  confere("pilha no lado de cima = arruela (a cabeça não empilha)", pilha, 1.6);
  const pilhaBaixo = empilhadoNoLado(m.posicionamentos, furo, [0, -1, 0], direcaoDe, alturaDe);
  confere("lado de baixo vazio", pilhaBaixo, 0);
  // porca por baixo, com arruela sob ela: porca vai para y = −1,6 (distância = altura da arruela)
  const porca = gerarPeca({ familia: "iso4032", tam: "M6" });
  const pn = embutirPeca(m, porca.doc, { nome: porca.nome });
  const entBaixo = entradaDoFuro(furo, (lado * -1) as 1 | -1, planas);
  const cn = inserirComponente(m, pn, poseDoFixador(entBaixo, 1.6));
  const mates = posicionamentosDoEncaixe(cn.id, furo, entBaixo, 1.6);
  igual("com arruela embaixo: concêntrico + distância", mates.map((x) => [x.tipo, x.valor ?? null]), [["concentrico", null], ["distancia", 1.6]]);
  m.posicionamentos.push(...mates);
  const sol2 = resolverMontagem(m, { preferido: cn.id });
  igual("sem erros com a porca", [...sol2.erros.keys()], []);
  const tn = sol2.poses.get(cn.id) ?? cn.t;
  igual("porca por baixo: y = −1,6, eixo apontando para −Y", [r3(tn.pos), r3(aplicarDirecao(tn, [0, 1, 0]))], [[15, -1.6, 0], [0, -1, 0]]);

  // comprimento sugerido: espessura 10 + porca 5,2 + 2 passos (2) = 17,2 → 20 da lista
  const min = comprimentoMinimo({ espessura: 10, empilhado: 0, comPorca: true, alturaPorca: 5.2, d: 6, passo: 1 });
  confere("comprimento mínimo com porca", min, 17.2);
  const lista = comprimentosDoPadrao(familiaPorId("iso4762")!, "M6", LISTA_COMPRIMENTOS);
  igual("sugerido da lista do padrão", proximoDaLista(lista, min), 18);
  confere("furo roscado: espessura + 1,5·d", comprimentoMinimo({ espessura: 10, empilhado: 0, comPorca: false, alturaPorca: 0, d: 6, passo: 1 }), 19);
  igual("sugerido acima do máximo usa o maior", proximoDaLista([10, 12], 50), 12);
  // compatibilidade do furo com a haste
  igual("Ø6,6 para M6: folga", compatibilidadeDoFuro(6, 1, 6.6), "folga");
  igual("Ø5 para M6: furo de rosca (6 − 1,0825 = 4,92)", compatibilidadeDoFuro(6, 1, 5), "roscado");
  igual("Ø5,5 para M6: apertado", compatibilidadeDoFuro(6, 1, 5.5), "apertado");
  igual("Ø3 para M6: pequeno", compatibilidadeDoFuro(6, 1, 3), "pequeno");
  igual("Ø14 para M6: grande demais", compatibilidadeDoFuro(6, 1, 14), "grande");
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);

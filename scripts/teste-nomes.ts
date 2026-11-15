// Nomes persistentes das faces/arestas (src/kernel/nomes.ts) e esboço que acompanha a peça na
// reconstrução: filete que continua nas mesmas arestas depois de mudar as cotas, rasgo na borda que
// continua rasgo (não vira furo) ao subir e descer a altura, migração das referências antigas, aviso
// de referência perdida sem derrubar o recurso, STEP importado pela assinatura e a relação automática
// "linha sobre a aresta da peça".
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import {
  documentoImportado, novaFeature, novoEsboco, type AssinaturaAresta, type Feature, type FeatureEsboco, type FeatureExtrusao, type FeatureFilete, type Referencia,
} from "../src/model";
import { definirSolverEsboco, exportar, regenerar } from "../src/kernel/regenerar";
import * as op from "../src/esboco/operacoes";
import { criarExterna, projetar } from "../src/esboco/externas";
import { eixoXParaNormal, referencial } from "../src/esboco/referencial";
import { SolverEsboco } from "../src/esboco/solver";
import { linhaSobreModelo } from "../src/esboco/relacoesAuto";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));
const solver = await SolverEsboco.criar();
definirSolverEsboco(solver);

let falhas = 0;
function verdade(nome: string, v: boolean, extra = "") {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}${!v && extra ? ` — ${extra}` : ""}`);
}
function confere(nome: string, obtido: number | null | undefined, esperado: number, tol = 1e-3) {
  const v = obtido ?? NaN;
  verdade(`${nome}: ${v.toFixed(2)} (esperado ${esperado.toFixed(2)})`, Math.abs(v - esperado) <= tol * Math.max(1, Math.abs(esperado)));
}
const semErros = (nome: string, r: ReturnType<typeof regenerar>) => verdade(`${nome}: sem erros`, !r.erros.length, r.erros.map((e) => e.mensagem).join(" | "));

/** Caixa W×H no plano Frontal, centrada na origem; mudar a cota = mover os pontos (como o solver faria). */
function caixa(w: number, h: number, prof = 100) {
  const esb = novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.retangulo(esb, op.ponto(esb, { x: -w / 2, y: -h / 2 }), op.ponto(esb, { x: w / 2, y: h / 2 }));
  const ex = { ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: esb.id, profundidade: prof };
  const cotas = (W: number, H: number) => {
    for (const p of esb.pontos) {
      if (p.id === "origem") continue;
      p.x = Math.sign(p.x) * W / 2;
      p.y = Math.sign(p.y) * H / 2;
    }
  };
  return { esb, ex, cotas };
}
const areaTopo = (r: ReturnType<typeof regenerar>, z: number) =>
  r.topologia!.faces.find((f) => f.normal && f.normal[2] > 0.999 && Math.abs(f.centro[2] - z) < 1e-6)?.area ?? NaN;

// ---------- 1. filete nas 4 bordas de cima continua depois de 80 → 120 e 100 → 60 ----------
{
  const { esb, ex, cotas } = caixa(80, 100);
  const r0 = regenerar([esb, ex]);
  semErros("caixa 80×100×100", r0);
  const topo = r0.topologia!;
  verdade("faces da caixa ganham nome (4 laterais + início + fim)", topo.faces.every((f) => !!f.nome) && new Set(topo.faces.map((f) => f.nome)).size === 6);
  verdade("tampa de cima = fim, de baixo = início", topo.faces.find((f) => f.centro[2] > 99)?.nome === `${ex.id}:fim` && topo.faces.find((f) => f.centro[2] < 1)?.nome === `${ex.id}:inicio`);
  const bordas = topo.arestas.filter((a) => a.geom === "linha" && Math.abs(a.a[2] - 100) < 1e-6 && Math.abs(a.b[2] - 100) < 1e-6);
  verdade("4 arestas de cima, cada uma com o par de faces", bordas.length === 4 && bordas.every((a) => a.nome?.includes(`${ex.id}:fim`)));
  const fil = { ...(novaFeature("filete", 1) as FeatureFilete), raio: 5, itens: bordas.map((ass): Referencia => ({ tipo: "aresta", ass: { ...ass } })) };
  const feats: Feature[] = [esb, ex, fil];
  const r1 = regenerar(feats);
  semErros("filete R5 nas 4 bordas", r1);
  confere("face de cima depois do filete = (80−10)×(100−10)", areaTopo(r1, 100), 70 * 90);
  cotas(120, 100);
  const r2 = regenerar(feats);
  semErros("filete depois de 80 → 120", r2);
  confere("face de cima = (120−10)×(100−10)", areaTopo(r2, 100), 110 * 90);
  cotas(120, 60);
  const r3 = regenerar(feats);
  semErros("filete depois de 100 → 60", r3);
  confere("face de cima = (120−10)×(60−10)", areaTopo(r3, 100), 110 * 50);
  cotas(300, 20);
  const r4 = regenerar(feats);
  semErros("filete depois de um salto grande (300×20)", r4);
  confere("face de cima = (300−10)×(20−10)", areaTopo(r4, 100), 290 * 10);
  verdade("a reserva (assinatura) acompanha a peça", Math.abs((fil.itens[0] as { ass: AssinaturaAresta }).ass.comprimento - 300) < 1e-6 || Math.abs((fil.itens[0] as { ass: AssinaturaAresta }).ass.comprimento - 20) < 1e-6);
}

// ---------- 2. referência antiga (só assinatura) migra sozinha na primeira reconstrução ----------
{
  const { esb, ex, cotas } = caixa(80, 100);
  const bordas = regenerar([esb, ex]).topologia!.arestas.filter((a) => a.geom === "linha" && Math.abs(a.a[2] - 100) < 1e-6 && Math.abs(a.b[2] - 100) < 1e-6);
  const fil = { ...(novaFeature("filete", 1) as FeatureFilete), raio: 5, itens: bordas.map((a): Referencia => { const { nome: _, ...ass } = a; return { tipo: "aresta", ass }; }) };
  const r1 = regenerar([esb, ex, fil]);
  semErros("arquivo antigo: filete pela assinatura", r1);
  verdade("arquivo antigo: as 4 arestas ganharam nome", fil.itens.every((it) => it.tipo === "aresta" && !!it.ass.nome));
  const at = r1.atualizacoes ?? [];
  verdade("a interface recebe as 4 atualizações (caminho itens/k/ass, valor de antes)", at.filter((a) => a.id === fil.id && a.caminho[0] === "itens" && a.caminho[2] === "ass").length === 4 && at.every((a) => !JSON.parse(a.antes).nome));
  cotas(120, 60);
  const r2 = regenerar([esb, ex, fil]);
  semErros("arquivo antigo, depois de 80 → 120 e 100 → 60", r2);
  confere("face de cima = (120−10)×(60−10)", areaTopo(r2, 100), 110 * 50);
}

// ---------- 3. aresta perdida: aviso no recurso, sem derrubar o filete nem os seguintes ----------
{
  const { esb, ex } = caixa(80, 100);
  const bordas = regenerar([esb, ex]).topologia!.arestas.filter((a) => a.geom === "linha" && Math.abs(a.a[2] - 100) < 1e-6 && Math.abs(a.b[2] - 100) < 1e-6);
  const perdida: AssinaturaAresta = { geom: "linha", meio: [900, 900, 900], a: [890, 900, 900], b: [910, 900, 900], comprimento: 20, nome: ["xx:fim", "xx:yy"] };
  const fil = { ...(novaFeature("filete", 1) as FeatureFilete), raio: 5, itens: [...bordas.map((ass): Referencia => ({ tipo: "aresta", ass: { ...ass } })), { tipo: "aresta", ass: perdida }] as Referencia[] };
  const furo = novoEsboco(3, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.circulo(furo, op.ponto(furo, { x: 0, y: 0 }), 5);
  const corte = { ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: furo.id, operacao: "cortar", profundidade: 10, condicao: { tipo: "passante", dist: 0 } } as FeatureExtrusao;
  const r = regenerar([esb, ex, fil, furo, corte]);
  semErros("filete com 1 aresta perdida + furo depois", r);
  const aviso = r.avisos?.find((a) => a.id === fil.id)?.mensagem ?? "";
  verdade("aviso no filete diz qual item se perdeu", /item 5 de 5/.test(aviso) && /recurso excluído/.test(aviso), aviso);
  confere("filete feito nas outras 4 (face de cima)", areaTopo(r, 100), 70 * 90 - Math.PI * 25);
  const todas = { ...fil, itens: [{ tipo: "aresta", ass: { ...perdida } }] as Referencia[] };
  const r2 = regenerar([esb, ex, todas, furo, corte]);
  verdade("nenhuma aresta achada: erro no filete, o furo depois continua", r2.erros.length === 1 && r2.erros[0].id === fil.id && Math.abs((r2.volume ?? 0) - (800000 - Math.PI * 25 * 100)) < 1);
}

// ---------- 4. rasgo na borda continua rasgo ao subir e ao descer a altura ----------
/**
 * Caixa 80×H×100 (do centro, plano Frontal); esboço na face lateral x = 40 com a borda de cima como
 * referência do modelo; retângulo 20×20 cruzando a borda, cotado a 10 mm dela (ou com o lado de cima
 * Colinear com a borda, 15 de altura); corte passante. Rasgo = tira sempre 20 × prof × 80.
 */
function rasgo(modo: "cota" | "colinear") {
  const { esb: base, ex, cotas } = caixa(80, 100);
  const t0 = regenerar([base, ex]).topologia!;
  const lado = t0.faces.find((f) => f.normal && f.normal[0] > 0.99)!;
  const borda = t0.arestas.find((a) => a.geom === "linha" && [a.a, a.b].every((p) => Math.abs(p[0] - 40) < 1e-6 && Math.abs(p[1] - 50) < 1e-6))!;
  const n: [number, number, number] = [1, 0, 0];
  const esb = novoEsboco(2, { tipo: "face", origem: [40, 0, 0], normal: n, eixoX: eixoXParaNormal(n), face: { ...lado } });
  const ref: Referencia = { tipo: "aresta", ass: { ...borda } };
  const g = criarExterna(esb, projetar(ref, referencial(esb.suporte))!, ref);
  const [y0, y1] = modo === "cota" ? [40, 60] : [35, 50];
  const geos = op.retangulo(esb, op.ponto(esb, { x: -60, y: y0 }), op.ponto(esb, { x: -40, y: y1 }));
  for (const l of geos.slice(0, 2)) op.restringir(esb, { tipo: "distancia", a: l.id, valor: Math.abs(dist(esb, l)) } as never);
  if (modo === "cota") {
    const baixo = esb.pontos.find((p) => Math.abs(p.y - 40) < 1e-9 && Math.abs(p.x + 60) < 1e-9)!;
    op.restringir(esb, { tipo: "distancia", a: baixo.id, b: g.id, valor: 10 } as never);
  } else {
    const cima = geos.find((l) => l.tipo === "linha" && [l.p1, l.p2].every((id) => Math.abs(esb.pontos.find((p) => p.id === id)!.y - 50) < 1e-9))!;
    op.restringir(esb, { tipo: "colinear", a: cima.id, b: g.id } as never);
  }
  verdade(`rasgo (${modo}): esboço resolvido`, solver.resolver(esb).ok);
  const corte = { ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: esb.id, operacao: "cortar", profundidade: 10, inverter: true, condicao: { tipo: "passante", dist: 0 } } as FeatureExtrusao;
  const tirado = modo === "cota" ? 20 * 10 * 80 : 20 * 15 * 80;
  for (const H of [100, 140, 60, 100]) {
    cotas(80, H);
    const r = regenerar([base, ex, esb, corte] as Feature[]);
    semErros(`rasgo (${modo}) com altura ${H}`, r);
    confere(`rasgo (${modo}) com altura ${H}: material tirado`, 80 * H * 100 - (r.volume ?? 0), tirado);
    verdade(`rasgo (${modo}) com altura ${H}: o esboço voltou para a interface`, H === 100 && r.atualizacoes?.length === 0 ? true : !!r.atualizacoes?.some((a) => a.id === esb.id && a.caminho.length === 0));
  }
  verdade(`rasgo (${modo}): o suporte do esboço guarda o nome da face`, esb.suporte.tipo === "face" && esb.suporte.face?.nome === `${ex.id}:${lado.nome!.split(":")[1]}`);
}
const dist = (esb: FeatureEsboco, l: { tipo: string; p1?: string; p2?: string }) => {
  const a = esb.pontos.find((p) => p.id === l.p1)!, b = esb.pontos.find((p) => p.id === l.p2)!;
  return Math.hypot(b.x - a.x, b.y - a.y);
};
rasgo("cota");
rasgo("colinear");

// ---------- 5. STEP importado continua pela assinatura ----------
{
  const { esb, ex } = caixa(60, 40, 20);
  regenerar([esb, ex]);
  const bytes = new Uint8Array(await exportar("step").arrayBuffer());
  const imp = documentoImportado("bloco.step", bytes).features[0];
  const r0 = regenerar([imp]);
  semErros("STEP importado", r0);
  verdade("faces do STEP ficam sem nome (sem história)", r0.topologia!.faces.every((f) => !f.nome));
  const bordas = r0.topologia!.arestas.filter((a) => a.geom === "linha" && Math.abs(a.a[2] - 20) < 1e-6 && Math.abs(a.b[2] - 20) < 1e-6);
  const fil = { ...(novaFeature("filete", 1) as FeatureFilete), raio: 2, itens: bordas.map((ass): Referencia => ({ tipo: "aresta", ass: { ...ass } })) };
  const r1 = regenerar([imp, fil]);
  semErros("filete no STEP pela assinatura", r1);
  confere("face de cima do STEP depois do filete", areaTopo(r1, 20), 56 * 36);
  verdade("referências do STEP continuam sem nome", fil.itens.every((it) => it.tipo === "aresta" && !it.ass.nome));
  // extrusão depois do STEP: só as faces novas ganham nome
  const s2 = novoEsboco(4, { tipo: "plano", plano: "XY", deslocamento: 20 });
  op.circulo(s2, op.ponto(s2, { x: 0, y: 0 }), 5);
  const pino = { ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: s2.id, profundidade: 10 };
  const r2 = regenerar([imp, fil, s2, pino]);
  semErros("pino sobre o STEP", r2);
  const cil = r2.topologia!.faces.find((f) => f.geom === "cilindro" && Math.abs((f.raio ?? 0) - 5) < 1e-6);
  verdade("face cilíndrica do pino ganha o nome do círculo", cil?.nome === `${pino.id}:${s2.geos[0].id}`);
}

// ---------- 6. plano médio e direção 2: as duas tampas têm nome ----------
{
  const { esb } = caixa(40, 20);
  const pm = { ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: esb.id, profundidade: 10, condicao: { tipo: "planoMedio", dist: 0 } } as FeatureExtrusao;
  const nomes = new Set(regenerar([esb, pm]).topologia!.faces.map((f) => f.nome?.split(":")[1]));
  verdade("plano médio: fim e fim2", nomes.has("fim") && nomes.has("fim2") && !nomes.has("inicio"));
}

// ---------- 7. relação automática: linha desenhada sobre a aresta da peça ----------
{
  const e = novoEsboco(5, { tipo: "plano", plano: "XY", deslocamento: 0 });
  const l = op.linha(e, op.ponto(e, { x: -10, y: 50.2 }), op.ponto(e, { x: 30, y: 49.9 }));
  const arestas = [{ a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }, { a: { x: -100, y: 50 }, b: { x: 100, y: 50 } }, { a: { x: -100, y: 49 }, b: { x: 100, y: 49 } }];
  verdade("linha sobre a aresta da peça: acha a aresta colinear mais próxima", linhaSobreModelo(e, l.id, arestas, 0.5) === 1);
  verdade("longe demais (fora do raio de encaixe): nenhuma", linhaSobreModelo(e, l.id, arestas, 0.1) === -1);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
if (falhas) process.exit(1);

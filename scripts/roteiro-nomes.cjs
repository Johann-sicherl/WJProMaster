// Roteiro dos nomes persistentes e do esboço que acompanha a peça (pedido do Johann, 15/11/2026), no
// tablet simulado (1280×800, toque e caneta):
// 1) arquivo antigo: filete nas 4 bordas de cima com referências só por assinatura → ao abrir, ganham nome
//    persistente no documento; 80 → 120 e 100 → 60 (Ctrl+B): o filete continua nas mesmas arestas, sem erro;
// 2) rasgo na borda (esboço na face lateral, cotado a 10 mm da borda, corte passante): subir e descer a altura
//    mantém o rasgo (volume confere no rodapé) e o documento recebe o esboço resolvido;
// 3) no esboço sobre a peça: linha desenhada sobre a aresta da peça fica presa a ela (Colinear/Coincidente) e
//    um ponto arrastado (caneta) e solto na aresta da peça ganha Coincidente (símbolo antes de soltar); fora do esboço,
//    mudar a altura leva a linha junto.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-nomes.cjs [pasta-das-capturas]
const { chromium } = require("playwright");
const URL = process.env.URL_WJCAD ?? "http://localhost:5199/cad/";
const PASTA = process.argv[2];
let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` (${extra})` : ""}`);
};

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: PASTA ? 2 : 1 });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const errosJs = [];
  p.on("pageerror", (e) => errosJs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.addInitScript(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
  });
  await p.goto(URL);
  await p.waitForTimeout(2500);
  const pronto = async () => {
    for (let i = 0; i < 120; i++) {
      await p.waitForTimeout(150);
      if (!(await p.evaluate(() => /Reconstruindo/i.test(document.body.innerText)))) break;
    }
    await p.waitForTimeout(700);
  };
  const botao = (rot) => p.locator(`#faixa-comandos button[title^="${rot}"], #faixa-comandos button:has(span:text-is("${rot}"))`).first();
  const aba = (rot) => p.locator("#abas button", { hasText: rot }).first().tap();
  const volume = async () => {
    const t = await p.locator("#st-volume").innerText();
    return parseFloat(t.replace(/[^\d,]/g, "").replace(",", "."));
  };
  const comErro = () => p.evaluate(() => [...document.querySelectorAll("#arvore li.com-erro")].map((li) => li.title || li.textContent));
  const doc = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__cad.doc())));
  /** Muda as cotas da caixa (pontos do esboço base, como o solver faria) e reconstrói com Ctrl+B. */
  const cotas = async (W, H) => {
    await p.evaluate(([W, H]) => {
      const base = window.__cad.doc().features.find((f) => f.nome === "Base");
      for (const q of base.pontos) if (q.id !== "origem") { q.x = Math.sign(q.x) * W / 2; q.y = Math.sign(q.y) * H / 2; }
    }, [W, H]);
    await p.keyboard.press("Control+b");
    await pronto();
    await pronto(); // a 2ª reconstrução (suporte do esboço com nome novo) pode vir logo atrás
  };

  // ---------- 1. arquivo antigo: filete nas 4 bordas de cima ----------
  await p.evaluate(async () => {
    const m = await import("/src/model.ts");
    const op = await import("/src/esboco/operacoes.ts");
    const base = m.novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
    base.nome = "Base";
    op.retangulo(base, op.ponto(base, { x: -40, y: -50 }), op.ponto(base, { x: 40, y: 50 }));
    const ex = { ...m.novaFeature("extrusao", 1), esboco: base.id, profundidade: 100 };
    const aresta = (a, b) => ({ tipo: "aresta", ass: { geom: "linha", a, b, meio: a.map((v, i) => (v + b[i]) / 2), comprimento: Math.hypot(...a.map((v, i) => v - b[i])) } });
    const itens = [aresta([-40, -50, 100], [40, -50, 100]), aresta([40, -50, 100], [40, 50, 100]), aresta([40, 50, 100], [-40, 50, 100]), aresta([-40, 50, 100], [-40, -50, 100])];
    const fil = { ...m.novaFeature("filete", 1), nome: "Filete1", raio: 5, itens };
    window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Nomes persistentes", features: [base, ex, fil] });
  });
  await pronto();
  let d = await doc();
  let fil = d.features.find((f) => f.tipo === "filete");
  ok("arquivo antigo: as 4 arestas do filete ganharam nome persistente no documento", fil.itens.every((it) => Array.isArray(it.ass.nome)), JSON.stringify(fil.itens.map((it) => it.ass.nome)));
  ok("filete sem erro (80 × 100)", !(await comErro()).length);
  const v0 = await volume();
  await cotas(120, 100);
  ok("80 → 120: filete continua, sem erro", !(await comErro()).length, (await comErro()).join(" | "));
  const v1 = await volume();
  await cotas(120, 60);
  ok("100 → 60: filete continua, sem erro", !(await comErro()).length, (await comErro()).join(" | "));
  const v2 = await volume();
  ok("volumes mudam com as cotas (o filete acompanhou)", v0 > 0 && v1 > v0 && v2 < v1, `${v0} → ${v1} → ${v2} cm³`);
  if (PASTA) await p.screenshot({ path: `${PASTA}/1-filete-120x60.png` });

  // ---------- 2. rasgo na borda continua rasgo ----------
  await p.evaluate(async () => {
    const m = await import("/src/model.ts");
    const op = await import("/src/esboco/operacoes.ts");
    const ex = await import("/src/esboco/externas.ts");
    const rf = await import("/src/esboco/referencial.ts");
    const base = m.novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
    base.nome = "Base";
    op.retangulo(base, op.ponto(base, { x: -40, y: -50 }), op.ponto(base, { x: 40, y: 50 }));
    const caixa = { ...m.novaFeature("extrusao", 1), esboco: base.id, profundidade: 100 };
    const n = [1, 0, 0];
    const esb = m.novoEsboco(2, { tipo: "face", origem: [40, 0, 0], normal: n, eixoX: rf.eixoXParaNormal(n), face: { geom: "plano", centro: [40, 0, 50], area: 10000, normal: n } });
    esb.nome = "Rasgo";
    const ref = { tipo: "aresta", ass: { geom: "linha", a: [40, 50, 0], b: [40, 50, 100], meio: [40, 50, 50], comprimento: 100 } };
    const g = ex.criarExterna(esb, ex.projetar(ref, rf.referencial(esb.suporte)), ref);
    const ls = op.retangulo(esb, op.ponto(esb, { x: -60, y: 40 }), op.ponto(esb, { x: -40, y: 60 }));
    for (const l of ls.slice(0, 2)) op.restringir(esb, { tipo: "distancia", a: l.id, valor: 20 });
    const baixo = esb.pontos.find((q) => Math.abs(q.y - 40) < 1e-9 && Math.abs(q.x + 60) < 1e-9);
    op.restringir(esb, { tipo: "distancia", a: baixo.id, b: g.id, valor: 10 });
    const corte = { ...m.novaFeature("extrusao", 1), nome: "Corte-Rasgo", esboco: esb.id, operacao: "cortar", profundidade: 10, inverter: true, condicao: { tipo: "passante", dist: 0 } };
    window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Rasgo na borda", features: [base, caixa, esb, corte] });
  });
  await pronto();
  await pronto();
  for (const [k, H] of [100, 140, 60, 100].entries()) {
    if (k) await cotas(80, H);
    const v = await volume();
    ok(`altura ${H}: continua rasgo (tira 16 cm³)`, Math.abs(80 * H * 100 / 1000 - 16 - v) < 0.05 && !(await comErro()).length, `${v} cm³`);
    if (PASTA && H === 140) await p.screenshot({ path: `${PASTA}/2-rasgo-altura-140.png` });
  }
  await cotas(80, 140);
  d = await doc();
  const rasgo = d.features.find((f) => f.nome === "Rasgo");
  const ext = rasgo.geos.find((g) => g.externa);
  ok("documento: a referência da borda ganhou nome e o esboço foi gravado na posição nova", Array.isArray(ext.externa.ass.nome) && rasgo.pontos.some((q) => Math.abs(q.y - 70) < 1e-6), JSON.stringify(ext.externa.ass.nome));
  ok("documento: a face de apoio do esboço tem nome persistente", typeof rasgo.suporte.face?.nome === "string");

  // ---------- 3. relação automática com a aresta da peça (caneta e dedo) ----------
  await cotas(80, 60);
  let cv = await p.locator("#viewport canvas").first().boundingBox();
  await p.locator("#arvore li", { hasText: "Plano Frontal" }).first().tap();
  await aba("Sketch");
  await botao("Esboço").tap();
  await pronto();
  cv = await p.locator("#viewport canvas").first().boundingBox();
  const tela = async (q) => {
    const t = await p.evaluate((x) => window.__cad.viewport.mundoParaTela(x), [q[0], q[1], 0]);
    return [cv.x + t.x, cv.y + t.y];
  };
  const caneta = async (q0, q1, antes) => {
    const [x0, y0] = await tela(q0), [x1, y1] = await tela(q1);
    const ev = (type, x, y, buttons) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType: "pen" });
    await ev("mouseMoved", x0, y0, 0);
    await ev("mousePressed", x0, y0, 1);
    for (let i = 1; i <= 12; i++) await ev("mouseMoved", x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12, 1);
    await p.waitForTimeout(150);
    const r = antes ? await antes() : undefined;
    await ev("mouseReleased", x1, y1, 0);
    await p.waitForTimeout(450);
    return r;
  };
  const esbAberto = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__cad.editor().esb)));
  const dicaAuto = () => p.evaluate(() => [...document.querySelectorAll(".dica-cursor")].map((x) => x.textContent).join(" | "));

  // 3a. linha com a caneta sobre a borda de cima da caixa (y = 30), um pouco ao lado
  await botao("Linha").tap();
  await caneta([-25, 30.3], [20, 30.2]);
  await p.keyboard.press("Escape");
  let e = await esbAberto();
  const linha = e.geos.find((g) => g.tipo === "linha" && !g.externa);
  const externas = new Set(e.geos.filter((g) => g.externa).map((g) => g.id));
  const presa = linha && (e.restricoes.some((r) => r.tipo === "colinear" && [r.a, r.b].includes(linha.id) && (externas.has(r.a) || externas.has(r.b))) ||
    [linha.p1, linha.p2].every((pt) => e.restricoes.some((r) => r.tipo === "coincidente" && r.a === pt && externas.has(r.b))));
  ok("linha desenhada sobre a aresta da peça fica presa a ela (Colinear/Coincidente)", !!presa, e.restricoes.map((r) => `${r.tipo}:${r.a}/${r.b}`).join(" "));
  if (PASTA) await p.screenshot({ path: `${PASTA}/3-linha-sobre-aresta.png` });

  // 3b. ponto solto longe da peça, arrastado com a caneta até a aresta x = 40 (com caneta, o dedo navega)
  await p.locator('#faixa-comandos button[title^="Ponto solto"]').first().tap();
  await caneta([65, 0], [65, 0]);
  await p.keyboard.press("Escape");
  await botao("Selecionar").tap().catch(() => p.keyboard.press("v"));
  await p.waitForTimeout(300);
  e = await esbAberto();
  const solto = e.geos.find((g) => g.tipo === "ponto" && !g.externa);
  const q = e.pontos.find((x) => x.id === solto?.p);
  const dica = await caneta([q.x, q.y], [40.3, 2], dicaAuto);
  ok("arrastando sobre a aresta da peça: símbolo antes de soltar", /Aresta do modelo/.test(dica), dica);
  e = await esbAberto();
  const ext2 = new Set(e.geos.filter((g) => g.externa).map((g) => g.id));
  ok("soltar o ponto na aresta da peça cria Coincidente com a referência", e.restricoes.some((r) => r.tipo === "coincidente" && r.a === solto.p && ext2.has(r.b)), e.restricoes.map((r) => `${r.tipo}:${r.a}/${r.b}`).join(" "));
  ok("o ponto ficou sobre a aresta (x = 40)", Math.abs(e.pontos.find((x) => x.id === solto.p).x - 40) < 1e-6);

  // 3c. sai do esboço e muda a altura: a linha anda com a borda
  await p.locator("#cc-ok").tap();
  await pronto();
  const idEsb = e.id;
  await cotas(80, 100);
  d = await doc();
  const e2 = d.features.find((f) => f.id === idEsb);
  const l2 = e2.geos.find((g) => g.id === linha.id);
  const ys = [l2.p1, l2.p2].map((id) => e2.pontos.find((x) => x.id === id).y);
  ok("altura 60 → 100: a linha presa na borda foi junto (y = 50)", ys.every((y) => Math.abs(y - 50) < 1e-6), ys.join(", "));
  if (PASTA) await p.screenshot({ path: `${PASTA}/4-linha-acompanhou.png` });

  ok("sem erros de JavaScript", !errosJs.length, errosJs.join(" | "));
  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
  await b.close();
  process.exit(falhas ? 1 : 0);
})();

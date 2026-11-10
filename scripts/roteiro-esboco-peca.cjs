// Roteiro do esboço sobre a peça (pedido do Johann, 10/11/2026), no tablet simulado (toque, caneta e mouse):
// 1) esboço antigo abre com a linha de referência criada só por cota já oculta; cota nova até a aresta da peça
//    não cria entidade visível nem selecionável; 2) a linha do esboço sobre a aresta da peça vence na seleção
//    (dedo e caneta) e tocar de novo no mesmo lugar alterna para a aresta da peça; 3) caixa de seleção no
//    Espelhar, Deslocar e Padrão linear (esquerda→direita só o que fica dentro; ao contrário, também o que cruza).
//   pnpm dev --port 5199 e depois: node scripts/roteiro-esboco-peca.cjs [pasta-das-capturas]
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
    for (let i = 0; i < 100; i++) {
      await p.waitForTimeout(150);
      if (!(await p.evaluate(() => /Reconstruindo/i.test(document.body.innerText)))) break;
    }
    await p.waitForTimeout(400);
  };
  let cv;
  const tela = async (q) => {
    const t = await p.evaluate((x) => window.__cad.viewport.mundoParaTela(x), [q[0], q[1], 0]);
    return [cv.x + t.x, cv.y + t.y];
  };
  const dedo = async (q) => {
    const [x, y] = await tela(q);
    await p.touchscreen.tap(x, y);
    await p.waitForTimeout(450);
  };
  /** Traço de caneta de verdade (pointerType "pen") de q0 a q1; q1 omitido = toque. */
  const caneta = async (q0, q1) => {
    const [x0, y0] = await tela(q0);
    const [x1, y1] = q1 ? await tela(q1) : [x0, y0];
    const ev = (type, x, y, buttons) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType: "pen" });
    await ev("mouseMoved", x0, y0, 0);
    await ev("mousePressed", x0, y0, 1);
    if (q1) for (let i = 1; i <= 10; i++) await ev("mouseMoved", x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10, 1);
    await ev("mouseReleased", x1, y1, 0);
    await p.waitForTimeout(400);
  };
  /** Arraste de mouse de q0 a q1. */
  const mouse = async (q0, q1) => {
    const [x0, y0] = await tela(q0), [x1, y1] = await tela(q1);
    await p.mouse.move(x0, y0);
    await p.mouse.down();
    await p.mouse.move(x1, y1, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(400);
  };
  const ed = (f) => p.evaluate(f);
  const sel = () => ed(() => [...window.__cad.editor().selecao]);
  const esb = () => ed(() => JSON.parse(JSON.stringify(window.__cad.editor().esb)));

  // documento: bloco 40 × 20 × 10 no plano frontal e um esboço "antigo" no mesmo plano com
  // retângulo (−10; −5)–(0; 3), uma linha sobre a aresta de baixo da peça (y = −10) e a linha de
  // referência VISÍVEL da aresta x = 20 que uma cota antiga criou
  await ed(async () => {
    const m = await import("/src/model.ts");
    const op = await import("/src/esboco/operacoes.ts");
    const ex = await import("/src/esboco/externas.ts");
    const rf = await import("/src/esboco/referencial.ts");
    const base = m.novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
    op.retangulo(base, op.ponto(base, { x: -20, y: -10 }), op.ponto(base, { x: 20, y: 10 }));
    const bloco = { ...m.novaFeature("extrusao", 1), esboco: base.id, profundidade: 10 };
    const e = m.novoEsboco(2, { tipo: "plano", plano: "XY", deslocamento: 0 });
    const ls = op.retangulo(e, op.ponto(e, { x: -10, y: -5 }), op.ponto(e, { x: 0, y: 3 }));
    const sobre = op.linha(e, op.ponto(e, { x: -15, y: -10 }), op.ponto(e, { x: 5, y: -10 }));
    const ref = { tipo: "aresta", ass: { geom: "linha", a: [20, -10, 0], b: [20, 10, 0], meio: [20, 0, 0], comprimento: 20 } };
    const velha = ex.criarExterna(e, ex.projetar(ref, rf.referencial(e.suporte)), ref);
    e.restricoes.push({ id: "cotaVelha", tipo: "distancia", a: ls[1].p2, b: velha.id, valor: 20 });
    e.nome = "Esboço sobre a peça";
    window.__ids = { sobre: sobre.id, velha: velha.id, topo: ls[2].id, rect: ls.map((l) => l.id) };
    window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Esboço sobre a peça", features: [base, bloco, e] });
  });
  await pronto();
  cv = await p.locator("#viewport canvas").first().boundingBox();
  const ids = await ed(() => window.__ids);
  await p.locator("#arvore li", { hasText: "Esboço sobre a peça" }).last().dispatchEvent("dblclick");
  await pronto();
  ok("esboço abriu para edição", await ed(() => !!window.__cad.editor()));

  // 1a. esboço antigo: a linha de referência criada só pela cota ficou oculta (a cota continua)
  let e = await esb();
  const velha = e.geos.find((g) => g.id === ids.velha);
  ok("esboço antigo: linha da cota antiga agora oculta", !!velha?.oculta);
  ok("esboço antigo: a cota continua", e.restricoes.some((r) => r.id === "cotaVelha"));
  ok("esboço antigo: sem conflito", await ed(() => window.__cad.editor().estado.conflitantes.length === 0));
  await dedo([20, 0]);
  ok("tocar onde estava a linha oculta não seleciona nada dela", !(await sel()).includes(ids.velha));
  await ed(() => window.__cad.editor().limparSelecao());

  // 2. prioridade: linha do esboço sobre a aresta da peça
  await dedo([-8, -10]);
  ok("dedo na linha sobre a aresta: pega a linha do esboço", JSON.stringify(await sel()) === JSON.stringify([ids.sobre]), JSON.stringify(await sel()));
  await dedo([-8, -10]);
  let s = await sel();
  e = await esb();
  const doModelo = s.length === 1 && s[0] !== ids.sobre && e.geos.find((g) => g.id === s[0])?.externa;
  ok("tocar de novo no mesmo lugar: alterna para a aresta da peça", !!doModelo, JSON.stringify(s));
  if (PASTA) await p.screenshot({ path: `${PASTA}/1-aresta-da-peca.png` });
  await dedo([-8, -10]);
  s = await sel();
  e = await esb();
  ok("mais um toque: volta para a linha do esboço", JSON.stringify(s) === JSON.stringify([ids.sobre]), JSON.stringify(s));
  ok("a referência da peça que ficou sem uso sai do esboço", !e.geos.some((g) => g.externa && !g.oculta));
  await ed(() => window.__cad.editor().limparSelecao());
  await caneta([2, -10]);
  ok("caneta na linha sobre a aresta: pega a linha do esboço", JSON.stringify(await sel()) === JSON.stringify([ids.sobre]), JSON.stringify(await sel()));
  await ed(() => window.__cad.editor().limparSelecao());
  // com a caneta em uso o dedo navega; o toque curto do dedo seleciona — e o esboço vence a peça
  await dedo([-12, -10]);
  ok("com caneta, toque do dedo na linha: pega a linha do esboço (não a aresta)", JSON.stringify(await sel()) === JSON.stringify([ids.sobre]), JSON.stringify(await sel()));
  await ed(() => window.__cad.editor().limparSelecao());

  // 1b. cota nova até a aresta da peça (y = 10): nenhuma entidade visível nova
  const visiveisAntes = (await esb()).geos.filter((g) => !g.oculta).length;
  await ed(() => window.__cad.editor().definirFerramenta("cota"));
  await caneta([-5, 3]);
  await caneta([-15, 10]);
  await caneta([-25, 6]);
  await p.waitForTimeout(400);
  e = await esb();
  const cota = e.restricoes.find((r) => r.tipo === "distancia" && r.id !== "cotaVelha");
  const refCota = cota && e.geos.find((g) => g.id === cota.b || g.id === cota.a && g.externa);
  ok("cota até a aresta da peça criada", !!cota, JSON.stringify(cota));
  ok("a cota fica presa a uma referência oculta", !!refCota?.oculta && !!refCota?.externa);
  ok("nenhuma entidade visível nova no esboço", e.geos.filter((g) => !g.oculta).length === visiveisAntes);
  if (PASTA) await p.screenshot({ path: `${PASTA}/2-cota-ate-a-peca.png` });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await ed(() => window.__cad.editor().definirFerramenta("selecionar"));
  await caneta([-15, 10]);
  ok("tocar na aresta da cota não seleciona a referência oculta", !(await sel()).includes(refCota?.id));
  ok("e a referência da cota continua oculta", !!(await esb()).geos.find((g) => g.id === refCota?.id)?.oculta);
  await ed(() => window.__cad.editor().limparSelecao());

  // 3. caixa nos comandos: Espelhar (caneta), Deslocar e Padrão linear (mouse)
  await ed(() => window.__cad.editor().definirFerramenta("espelhar"));
  await caneta([-12, -7], [2, 5]); // esquerda → direita: só o retângulo, que fica todo dentro
  s = await sel();
  ok("Espelhar: caixa da esquerda para a direita pega só o que fica dentro (4 linhas)", s.length === 4 && ids.rect.every((id) => s.includes(id)), JSON.stringify(s));
  if (PASTA) await p.screenshot({ path: `${PASTA}/3-espelhar-caixa.png` });
  await caneta([-11, -8], [-13, -12]); // direita → esquerda, cruzando a linha de baixo
  s = await sel();
  ok("Espelhar: caixa da direita para a esquerda também pega o que cruza", s.length === 5 && s.includes(ids.sobre), JSON.stringify(s));
  await caneta([-5, 3]);
  ok("Espelhar: tocar uma entidade tira da lista", (await sel()).length === 4);
  ok("Espelhar: a caixa não pega referências ocultas", !(await sel()).some((id) => id === ids.velha || id === refCota?.id));
  await ed(() => window.__cad.editor().definirFerramenta("offset"));
  await ed(() => window.__cad.editor().limparSelecao());
  await mouse([-12, -7], [2, 5]);
  ok("Deslocar: caixa de mouse enche a lista (4 linhas)", (await sel()).length === 4, JSON.stringify(await sel()));
  await ed(() => window.__cad.editor().definirFerramenta("padraoLinearEsboco"));
  await ed(() => window.__cad.editor().limparSelecao());
  await mouse([2, 5], [-1, 2]); // direita → esquerda, cruzando o canto do retângulo
  s = await sel();
  ok("Padrão linear: caixa cruzando pega as 2 linhas do canto", s.length === 2, JSON.stringify(s));
  if (PASTA) await p.screenshot({ path: `${PASTA}/4-padrao-caixa.png` });

  ok("sem erro de JavaScript", errosJs.length === 0, errosJs.join(" | "));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : "\nroteiro do esboço sobre a peça: tudo certo");
  process.exit(falhas ? 1 : 0);
})();

// Roteiro do pedido C4 (Johann, 15/11/2026), no tablet simulado (1280×800, toque e caneta):
// 1) 2º esboço SOBRE A FACE de cima da peça extrudada: linha desenhada sobre a aresta da peça (caneta e
//    dedo, arrastando e com dois toques) ganha Colinear/Coincidente com a referência, com o símbolo antes
//    de soltar; Ctrl suprime; nada superdefinido; as relações continuam depois de sair do esboço;
// 2) duplo toque no corpo (depois de um Mover corpo ΔX = −20) mostra o D1 da extrusão e as cotas do
//    esboço; duplo toque no recurso (árvore) e no corpo (pasta Corpos sólidos) também; ΔX negativo aceito
//    no lugar; D1 = 0 recusado;
// 3) botão calculadora em 5 painéis diferentes (Extrusão, Mover corpo, Escala, Plano, Filete), na
//    ⚙ Configurações (passo da roda) e na caixa de valor das cotas sobre o modelo;
// 4) outra face pelo componente comum (WJGoldDiamond): a calculadora muda o campo e dispara o change.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-c4.cjs [pasta-das-capturas]
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
  const doc = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__cad.doc())));
  const rels = (e) => e.restricoes.map((r) => `${r.tipo}:${r.a}/${r.b}`).join(" ");
  const tela3 = async (q) => {
    const cv = await p.locator("#viewport canvas").first().boundingBox();
    const t = await p.evaluate((x) => window.__cad.viewport.mundoParaTela(x), q);
    return [cv.x + t.x, cv.y + t.y];
  };
  /** Traço de caneta (CDP, pointerType pen) ou de dedo (toque), de pts[0] a pts[1]; `mods` 2 = Ctrl. */
  const traco = async (tipo, [[x0, y0], [x1, y1]], antes, mods = 0) => {
    if (tipo === "pen") {
      const ev = (type, x, y, buttons) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType: "pen", modifiers: mods });
      await ev("mouseMoved", x0, y0, 0);
      await ev("mousePressed", x0, y0, 1);
      for (let i = 1; i <= 12; i++) await ev("mouseMoved", x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12, 1);
      await p.waitForTimeout(150);
      const r = antes ? await antes() : undefined;
      await ev("mouseReleased", x1, y1, 0);
      await p.waitForTimeout(450);
      return r;
    }
    const t = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    await t("touchStart", x0, y0);
    for (let i = 1; i <= 12; i++) await t("touchMove", x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
    await p.waitForTimeout(150);
    const r = antes ? await antes() : undefined;
    await t("touchEnd", x1, y1);
    await p.waitForTimeout(450);
    return r;
  };
  const duploToque = async (x, y) => {
    await p.touchscreen.tap(x, y);
    await p.waitForTimeout(120);
    await p.touchscreen.tap(x, y);
    await p.waitForTimeout(900);
  };
  const itemArvore = (nome) => p.locator("#arvore li:not(.corpo)", { has: p.locator(`strong:text-is("${nome}")`) }).first();
  const duploArvore = async (nome) => {
    await itemArvore(nome).dispatchEvent("dblclick");
    await p.waitForTimeout(900);
  };
  const rotulosModelo = () => p.evaluate(() => [...document.querySelectorAll(".cota-modelo")].map((x) => x.textContent.trim()));
  const fecharCotas = async () => {
    await p.touchscreen.tap(1150, 150);
    await p.waitForTimeout(400);
  };
  /** Usa a calculadora aberta: digita a sequência e aplica (✓). */
  const calcular = async (teclas) => {
    for (const k of teclas) await p.locator(`.tc button[data-k="${k}"]`).tap();
    await p.locator(".tc .tc-ok").tap();
    await p.waitForTimeout(500);
  };

  // ---------- modelo: caixa 80 × 60 × 100 (Z para fora do Frontal) com cotas no esboço ----------
  await p.evaluate(async () => {
    const m = await import("/src/model.ts");
    const op = await import("/src/esboco/operacoes.ts");
    const base = m.novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
    base.nome = "Base";
    const ls = op.retangulo(base, op.ponto(base, { x: -40, y: -30 }), op.ponto(base, { x: 40, y: 30 }));
    op.restringir(base, { tipo: "distancia", a: ls[0].id, valor: 80 });
    op.restringir(base, { tipo: "distancia", a: ls[1].id, valor: 60 });
    const ex = { ...m.novaFeature("extrusao", 1), nome: "Extrusão1", esboco: base.id, profundidade: 100 };
    window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "C4", features: [base, ex] });
  });
  await pronto();

  // ---------- 1. 2º esboço sobre a face de cima (z = 100) ----------
  const [fx, fy] = await tela3([5, 5, 100]);
  await p.touchscreen.tap(fx, fy);
  await p.waitForTimeout(400);
  await aba("Sketch");
  await botao("Esboço").tap();
  await pronto();
  let e = await p.evaluate(() => JSON.parse(JSON.stringify(window.__cad.editor()?.esb ?? null)));
  ok("esboço aberto sobre a face de cima da peça", e?.suporte?.tipo === "face", JSON.stringify(e?.suporte?.tipo));
  const esbAberto = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__cad.editor().esb)));
  const dicaAuto = () => p.evaluate(() => [...document.querySelectorAll(".dica-cursor")].map((x) => x.textContent).join(" | "));
  const presaNaAresta = (e, linha) => {
    const externas = new Set(e.geos.filter((g) => g.externa).map((g) => g.id));
    const pontosExt = new Set(e.geos.filter((g) => g.externa).flatMap((g) => [g.p, g.p1, g.p2].filter(Boolean)));
    return !!linha && (e.restricoes.some((r) => r.tipo === "colinear" && [r.a, r.b].includes(linha.id) && (externas.has(r.a) || externas.has(r.b))) ||
      [linha.p1, linha.p2].every((pt) => pontosExt.has(pt) || e.restricoes.some((r) => r.tipo === "coincidente" && r.a === pt && externas.has(r.b))));
  };
  const novasLinhas = (e, antes) => e.geos.filter((g) => g.tipo === "linha" && !g.externa && !antes.has(g.id));

  // 1a. caneta: linha arrastada sobre a borda y = 30
  await botao("Linha").tap();
  let antes = new Set();
  const dica1 = await traco("pen", [await tela3([-25, 30.3, 100]), await tela3([20, 30.2, 100])], dicaAuto);
  ok("caneta sobre a aresta da peça: símbolo antes de soltar", /aresta do modelo/i.test(dica1), dica1);
  await p.keyboard.press("Escape");
  e = await esbAberto();
  let l = novasLinhas(e, antes)[0];
  ok("caneta: linha sobre a aresta fica presa a ela (Colinear/Coincidente)", presaNaAresta(e, l), rels(e));
  if (PASTA) await p.screenshot({ path: `${PASTA}/1-linha-sobre-aresta.png` });

  // 1b. linha fora da peça, na reta da aresta y = −30: Colinear, com o símbolo antes de soltar
  antes = new Set(e.geos.map((g) => g.id));
  await botao("Linha").tap();
  const dica2 = await traco("pen", [await tela3([-62, -30.2, 100]), await tela3([-48, -30.25, 100])], dicaAuto);
  ok("na reta da aresta, fora da peça: prévia \"Colinear com a aresta do modelo\"", /Colinear com a aresta/.test(dica2), dica2);
  await p.keyboard.press("Escape");
  e = await esbAberto();
  l = novasLinhas(e, antes)[0];
  ok("na reta da aresta: Colinear com a referência", presaNaAresta(e, l), rels(e));

  // 1c. dedo (sem caneta registrada): linha sobre a aresta x = 40
  await p.evaluate(() => { window.__cad.editor().dedoDesenha = true; });
  antes = new Set(e.geos.map((g) => g.id));
  await botao("Linha").tap();
  await traco("touch", [await tela3([40.3, -20, 100]), await tela3([40.2, 15, 100])]);
  await p.keyboard.press("Escape");
  e = await esbAberto();
  ok("dedo: linha sobre a aresta x = 40 fica presa a ela", presaNaAresta(e, novasLinhas(e, antes)[0]), rels(e));

  // 1d. dois toques de caneta sobre a aresta x = −40
  antes = new Set(e.geos.map((g) => g.id));
  await botao("Linha").tap();
  for (const q of [[-40.2, -20, 100], [-40.3, 10, 100]]) { const t = await tela3(q); await traco("pen", [t, t]); }
  await p.keyboard.press("Escape");
  e = await esbAberto();
  ok("dois toques: linha sobre a aresta fica presa a ela", presaNaAresta(e, novasLinhas(e, antes)[0]), rels(e));

  // 1e. Ctrl segurado: nenhuma relação com a peça
  antes = new Set(e.geos.map((g) => g.id));
  await botao("Linha").tap();
  await traco("pen", [await tela3([-10, -30.2, 100]), await tela3([10, -30.3, 100])], null, 2);
  await p.keyboard.press("Escape");
  e = await esbAberto();
  l = novasLinhas(e, antes)[0];
  ok("Ctrl: linha sobre a aresta sem relação com a peça", !!l && !presaNaAresta(e, l), rels(e));
  ok("nada superdefinido (sem conflito no esboço)", !/superdefinid|conflit/i.test(await p.evaluate(() => document.body.innerText)));
  const idEsb = e.id;
  const nRel = e.restricoes.length;
  await p.locator("#cc-ok").tap();
  await pronto();
  ok("relações gravadas no documento ao sair do esboço", (await doc()).features.find((x) => x.id === idEsb)?.restricoes.length === nRel);
  await aba("Features");

  // ---------- 2. cotas do recurso: duplo toque no corpo e na árvore ----------
  await p.evaluate(async () => {
    const m = await import("/src/model.ts");
    const d = window.__cad.doc();
    const base = d.features.find((f) => f.nome === "Base"), ex = d.features.find((f) => f.nome === "Extrusão1");
    const mov = { ...m.novaFeature("moverCorpo", 1), nome: "MoverCorpo1", dx: -20 };
    const esc = { ...m.novaFeature("escala", 1), nome: "Escala1", fator: 1 };
    const pl = { ...m.novaFeature("planoRef", 1), nome: "Plano1", ref1: { tipo: "plano", id: "XY" }, distancia: 150 };
    window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "C4 mover", features: [base, ex, mov, esc, pl] });
  });
  await pronto();
  // lateral +X da caixa, já movida 20 para −X: x = 20
  const [cx, cy] = await tela3([19.9, 0, 50]);
  await duploToque(cx, cy);
  let rot = await rotulosModelo();
  ok("duplo toque no corpo depois do Mover corpo: D1 da extrusão aparece", rot.some((t) => /^D1\b/.test(t)), rot.join(" | "));
  ok("duplo toque no corpo: cotas do esboço aparecem (80 e 60)", rot.some((t) => /80/.test(t)) && rot.some((t) => /60/.test(t)), rot.join(" | "));
  if (PASTA) await p.screenshot({ path: `${PASTA}/2-duplo-toque-d1.png` });

  // D1 = 0 recusado no lugar; a calculadora da caixa faz 100 + 20
  await p.locator(".cota-modelo", { hasText: "D1" }).first().dispatchEvent("pointerdown");
  await p.waitForTimeout(200);
  await p.locator(".cota-modelo-edicao").fill("0");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  ok("D1 = 0 recusado (a caixa fica aberta e vermelha)", (await p.locator(".cota-modelo-edicao.invalido").count()) === 1);
  ok("caixa de valor das cotas no modelo tem a calculadora", (await p.locator(".cota-modelo-calc").count()) === 1);
  await p.locator(".cota-modelo-calc").tap();
  await p.waitForTimeout(300);
  await calcular(["C", "1", "0", "0", "+", "2", "0"]);
  await pronto();
  ok("calculadora da caixa: D1 = 100 + 20 = 120", (await doc()).features.find((f) => f.nome === "Extrusão1").profundidade === 120);
  await fecharCotas();

  // duplo toque no recurso (árvore): Mover corpo mostra ΔX…; ΔX = −30 aceito no lugar
  await duploArvore("MoverCorpo1");
  rot = await rotulosModelo();
  ok("duplo toque no recurso (árvore): cotas do Mover corpo", rot.some((t) => /^ΔX/.test(t)), rot.join(" | "));
  ok("o duplo toque no recurso não abre o painel", !(await p.locator("#painel-comando .pc-cabecalho").isVisible().catch(() => false)));
  await p.locator(".cota-modelo", { hasText: "ΔX" }).first().dispatchEvent("pointerdown");
  await p.waitForTimeout(200);
  await p.locator(".cota-modelo-edicao").fill("-30");
  await p.keyboard.press("Enter");
  await pronto();
  ok("ΔX = −30 aceito no lugar (Mover corpo)", (await doc()).features.find((f) => f.nome === "MoverCorpo1").dx === -30);
  await fecharCotas();
  await duploArvore("Plano1");
  rot = await rotulosModelo();
  ok("duplo toque no plano (árvore): a distância aparece (plano não tem faces)", rot.some((t) => /Distância 150/.test(t)), rot.join(" | "));
  await fecharCotas();

  // duplo toque no corpo da pasta Corpos sólidos
  const pasta = p.locator("#arvore li.pasta-corpos");
  if (await pasta.count()) {
    if (!(await p.locator("#arvore li.corpo").count())) await pasta.tap();
    await p.waitForTimeout(300);
    await p.locator("#arvore li.corpo").first().dispatchEvent("dblclick");
    await p.waitForTimeout(900);
    rot = await rotulosModelo();
    ok("duplo toque no corpo (pasta Corpos sólidos): D1 e as cotas do esboço", rot.some((t) => /^D1\b/.test(t)) && rot.length >= 3, rot.join(" | "));
    await fecharCotas();
  } else ok("pasta Corpos sólidos visível", false);

  // ---------- 3. calculadora nos painéis de comando ----------
  const editar = async (nome) => {
    // tocar alterna a seleção: se o recurso já estava selecionado (duplo toque), a barra some; toca de novo
    const bt = p.locator('#barra-contexto button[title="Editar recurso"]');
    for (let i = 0; i < 2 && !(await bt.isVisible()); i++) {
      await itemArvore(nome).tap();
      await p.waitForTimeout(400);
    }
    await bt.tap();
    await p.waitForTimeout(800);
  };
  for (const [nome, campo] of [["Extrusão1", "Profundidade"], ["MoverCorpo1", "ΔX"], ["Escala1", "Fator"], ["Plano1", "Distância"]]) {
    await editar(nome);
    const n = await p.locator("#painel-comando .calc-campo").count();
    ok(`${nome}: painel com calculadora nos campos numéricos (${n})`, n >= 1);
    const lbl = p.locator("#painel-comando label.campo", { has: p.locator(`.campo-rotulo:text-is("${campo}")`) }).first();
    await lbl.locator(".calc-campo").tap();
    await p.waitForTimeout(300);
    const tit = await p.locator(".tc header b").textContent().catch(() => "");
    ok(`${nome}: a calculadora abre com o título do campo`, tit === campo, tit);
    await calcular(["C", "3", "×", "4"]);
    const v = await lbl.locator("input").inputValue();
    ok(`${nome}: ${campo} = 3 × 4 = 12 no campo`, v === "12", v);
    if (PASTA && nome === "MoverCorpo1") await p.screenshot({ path: `${PASTA}/3-calculadora-painel.png` });
    await p.locator("#painel-comando .pc-cancelar").first().tap();
    await pronto();
  }
  await botao("Filete").tap();
  await p.waitForTimeout(800);
  const nFil = await p.locator("#painel-comando .calc-campo").count();
  ok(`Filete: painel com calculadora (${nFil})`, nFil >= 1);
  await p.locator("#painel-comando .pc-cancelar").first().tap();
  await pronto();

  // ⚙ Configurações → Mouse e zoom: passo da roda pela calculadora
  await p.locator('button[title^="Configurações"]').first().tap();
  await p.waitForTimeout(500);
  await p.locator("button", { hasText: "Mouse e zoom" }).first().tap().catch(() => {});
  await p.waitForTimeout(300);
  const nCfg = await p.locator(".cfg-passo .calc-campo").count();
  ok("⚙ Configurações: calculadora no passo da roda", nCfg >= 1);
  if (nCfg) {
    const r = await p.locator(".cfg-passo .calc-campo").first().boundingBox();
    await p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    await p.waitForTimeout(300);
    await calcular(["C", "8"]);
    const t = (await p.locator(".cfg-passo output").first().textContent()).trim();
    ok("⚙ passo da roda = 8 % pela calculadora", t === "8 %", t);
    if (PASTA) await p.screenshot({ path: `${PASTA}/4-configuracoes.png` });
  }

  // ---------- 4. outra face pelo componente comum: WJGoldDiamond (largura no topo) ----------
  const pj = await ctx.newPage();
  pj.on("pageerror", (e) => errosJs.push(`joia: ${e.message}`));
  await pj.goto(URL.replace(/cad\/$/, "joia/"));
  await pj.waitForTimeout(3000);
  const nJ = await pj.locator(".calc-campo").count();
  ok(`WJGoldDiamond: campos numéricos com calculadora (${nJ})`, nJ >= 5);
  const campoJ = pj.locator(".calc-envolve", { has: pj.locator("input") }).nth(1);
  const inpJ = campoJ.locator("input");
  const mudou = pj.evaluate((i) => new Promise((r) => { const el = document.querySelectorAll(".calc-envolve input")[i]; el.addEventListener("change", () => r(true), { once: true }); setTimeout(() => r(false), 4000); }), 1);
  const rJ = await campoJ.locator(".calc-campo").boundingBox();
  await pj.touchscreen.tap(rJ.x + rJ.width / 2, rJ.y + rJ.height / 2);
  await pj.waitForTimeout(300);
  for (const k of ["C", "1", ",", "5", "×", "2"]) await pj.locator(`.tc button[data-k="${k}"]`).tap();
  await pj.locator(".tc .tc-ok").tap();
  await pj.waitForTimeout(300);
  ok("WJGoldDiamond: 1,5 × 2 = 3 no campo, com o evento change (a joia refaz)", (await inpJ.inputValue()) === "3" && (await mudou), await inpJ.inputValue());
  if (PASTA) await pj.screenshot({ path: `${PASTA}/5-joia.png` });

  ok("sem erros de JavaScript", !errosJs.length, errosJs.join(" | "));
  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
  await b.close();
  process.exit(falhas ? 1 : 0);
})();

// Roteiro de interface das relações automáticas do esboço e do filete em canto unido por relação
// (pedido do Johann, 10/11/2026), no tablet simulado (1280×800, toque) e com mouse + Ctrl:
// linha quase horizontal mostra "H" antes de soltar e ganha Horizontal → Ctrl+Z tira linha e relação →
// arrastar a ponta de uma linha sobre a ponta de outra cria Coincidente → arrastar o canto até a origem
// cria Coincidente com a origem → Filete tocando o canto é aceito e o canto continua na origem →
// Configurações → Esboço → "Relações automáticas" desligada não cria relação → Ctrl segurado suprime.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-relacoes-auto.cjs [pasta-das-capturas]
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
  const avisos = [];
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
    await p.waitForTimeout(250);
  };
  const botao = (rot) => p.locator(`#faixa-comandos button[title^="${rot}"], #faixa-comandos button:has(span:text-is("${rot}"))`).first();
  const aba = (rot) => p.locator("#abas button", { hasText: rot }).first().tap();
  const esb = () => p.evaluate(() => window.__cad.doc().features.find((f) => f.tipo === "esboco"));
  let cv;
  const tela = async (q) => {
    const t = await p.evaluate((x) => window.__cad.viewport.mundoParaTela(x), [q[0], q[1], 0]);
    return [cv.x + t.x, cv.y + t.y];
  };
  const tocar = async (q) => {
    const [x, y] = await tela(q);
    await p.touchscreen.tap(x, y);
    await p.waitForTimeout(400);
  };
  /** Toque arrastado de verdade (pointerType "touch"), de q0 a q1 no plano; `antes` roda antes de soltar. */
  const arrastar = async (q0, q1, antes) => {
    const [x0, y0] = await tela(q0), [x1, y1] = await tela(q1);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y: y0 + ((y1 - y0) * i) / 12, id: 1 }] });
      await p.waitForTimeout(25);
    }
    await p.waitForTimeout(150);
    const r = antes ? await antes() : undefined;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(400);
    return r;
  };
  const mapa = (e) => { const m = new Map(e.pontos.map((q) => [q.id, q])); return (id) => m.get(id) ?? { x: 0, y: 0 }; };
  const linhas = (e) => e.geos.filter((g) => g.tipo === "linha");
  const dicaAuto = () => p.evaluate(() => [...document.querySelectorAll(".dica-cursor")].map((d) => d.textContent).join(" | "));
  const status = () => p.locator("footer.status").first().innerText().catch(() => "");

  await p.evaluate(() => window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Relações automáticas", features: [] }));
  await pronto();
  cv = await p.locator("#viewport canvas").first().boundingBox();
  await p.locator("#arvore li", { hasText: "Plano Frontal" }).first().tap();
  await aba("Sketch");
  await botao("Esboço").tap();
  await pronto();
  // avisos do editor (barra/toast): guarda o texto para conferir mensagens
  await p.exposeFunction("__aviso", (t) => avisos.push(t));
  await p.evaluate(() => new MutationObserver(() => window.__aviso(document.body.innerText.match(/(Relação automática[^\n]*|Esse ponto não é um canto[^\n]*)/)?.[0] ?? "")).observe(document.body, { subtree: true, childList: true, characterData: true }));

  // 1. linha quase horizontal arrastada com o dedo: o símbolo H aparece antes de soltar; ao soltar, Horizontal
  await botao("Linha").tap();
  const dica = await arrastar([60, 30.4], [25, 30], async () => {
    if (PASTA) await p.screenshot({ path: `${PASTA}/1-previa-horizontal.png` });
    return dicaAuto();
  });
  ok("prévia mostra o símbolo da relação antes de soltar", /H Horizontal/.test(dica), dica);
  let e = await esb();
  const L1 = linhas(e)[0];
  ok("linha criada com relação Horizontal", linhas(e).length === 1 && e.restricoes.some((r) => r.tipo === "horizontal" && r.a === L1.id));
  // 1b. Ctrl+Z tira a linha e a relação dela juntas
  await p.keyboard.press("Escape");
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(500);
  e = await esb();
  ok("Ctrl+Z tira a linha e a relação automática dela", !e || (!linhas(e).length && !e.restricoes.length), e ? `${linhas(e).length} linhas, ${e.restricoes.length} relações` : "esboço vazio");
  await p.keyboard.press("Control+y");
  await p.waitForTimeout(500);

  // 2. segunda linha quase vertical, solta (sem tocar a primeira)
  await botao("Linha").tap();
  await arrastar([15, 15], [15.3, -40]);
  await p.keyboard.press("Escape");
  e = await esb();
  const [A, B] = linhas(e);
  ok("duas linhas separadas: Horizontal e Vertical", linhas(e).length === 2 && e.restricoes.filter((r) => r.tipo === "horizontal" || r.tipo === "vertical").length === 2,
    e.restricoes.map((r) => r.tipo).join(","));

  // 3. arrastar a ponta de cima da vertical até a ponta esquerda da horizontal → Coincidente
  await botao("Selecionar").tap().catch(() => p.keyboard.press("v"));
  await p.waitForTimeout(300);
  const pt = mapa(e);
  const pontaH = [A.p1, A.p2].reduce((m, id) => (pt(id).x < pt(m).x ? id : m));
  const pontaV = [B.p1, B.p2].reduce((m, id) => (pt(id).y > pt(m).y ? id : m));
  const dica2 = await arrastar([pt(pontaV).x, pt(pontaV).y], [pt(pontaH).x + 0.6, pt(pontaH).y - 0.5], async () => {
    if (PASTA) await p.screenshot({ path: `${PASTA}/2-previa-coincidente.png` });
    return dicaAuto();
  });
  ok("arrastando sobre a outra ponta: símbolo Coincidente antes de soltar", /◉ Coincidente/.test(dica2), dica2);
  e = await esb();
  ok("soltar sobre a outra ponta cria Coincidente", e.restricoes.some((r) => r.tipo === "coincidente" && [r.a, r.b].includes(pontaH) && [r.a, r.b].includes(pontaV)));

  // 4. arrastar o canto até a origem → Coincidente com a origem
  const pt2 = mapa(e);
  // o dedo cai no canto, ao lado do selo ◉ da relação: tem de arrastar o ponto (não selecionar o selo)
  const dica4 = await arrastar([pt2(pontaH).x, pt2(pontaH).y], [0.4, -0.3], dicaAuto);
  ok("arrastando o canto até a origem: símbolo antes de soltar", /Coincidente com a origem/.test(dica4), dica4);
  e = await esb();
  ok("soltar o canto na origem cria Coincidente com a origem", e.restricoes.some((r) => r.tipo === "coincidente" && (r.a === "origem" || r.b === "origem" || /orig/i.test(`${r.a}${r.b}`))),
    e.restricoes.map((r) => `${r.tipo}:${r.a}/${r.b}`).join(" "));

  // 5. Filete tocando o canto (os passos do Johann): aceito e aplicado; o canto continua na origem
  await p.keyboard.press("Escape");
  await botao("Filete").tap().catch(async () => p.locator("#faixa-comandos button", { hasText: "Filete" }).first().tap());
  await p.waitForTimeout(300);
  const itemFilete = p.locator(".menu-sub button, .submenu button", { hasText: "Filete de esboço" }).first();
  if (await itemFilete.isVisible().catch(() => false)) await itemFilete.tap();
  await p.waitForTimeout(300);
  avisos.length = 0;
  await tocar([0, 0]);
  ok("canto unido por relação aceito (sem \"não é um canto\")", !avisos.some((t) => /não é um canto/.test(t)), avisos.filter(Boolean).join(" | "));
  const aplicar = p.locator("button", { hasText: /Aplicar filete/ }).first();
  await aplicar.tap();
  await p.waitForTimeout(600);
  e = await esb();
  const pt3 = mapa(e);
  const arco = e.geos.find((g) => g.tipo === "arco");
  ok("filete criado no canto", !!arco);
  const passaOrigem = linhas(e).filter((l) => !l.construcao).every((l) => {
    const a = pt3(l.p1), c = pt3(l.p2);
    return Math.abs(a.x * c.y - a.y * c.x) / Math.hypot(c.x - a.x, c.y - a.y) < 1e-4;
  });
  ok("as linhas continuam passando pela origem (canto virtual preso)", passaOrigem);
  const st = await status();
  ok("esboço sem conflito depois do filete", /definido/i.test(st) && !/Superdefinido/.test(st), st.replace(/\s+/g, " ").slice(0, 90));
  if (PASTA) await p.screenshot({ path: `${PASTA}/3-filete-canto-origem.png` });

  // 6. Configurações → Esboço → "Relações automáticas" desligada: linha quase horizontal não ganha H
  await p.keyboard.press("Escape");
  const nRel = (await esb()).restricoes.length;
  await p.locator("#btn-config").tap();
  await p.waitForTimeout(400);
  await p.locator(".cfg-secoes button", { hasText: "Esboço" }).tap();
  const chave = p.locator(".cfg-item label.interruptor", { hasText: "Relações automáticas" });
  ok("chave \"Relações automáticas\" na seção Esboço, ligada por padrão", (await chave.count()) === 1 && (await chave.locator("input").isChecked()));
  if (PASTA) await p.screenshot({ path: `${PASTA}/4-configuracoes-esboco.png` });
  await chave.tap();
  await p.waitForTimeout(200);
  ok("desligada fica guardada no aparelho", await p.evaluate(() => JSON.parse(localStorage.getItem("jlscad:interface")).relacoesAuto === false));
  await p.locator(".cfg-fechar").tap();
  await p.waitForTimeout(300);
  const l1 = linhas(await esb()).length;
  await p.keyboard.press("l");
  await p.waitForTimeout(300);
  const dica3 = await arrastar([30, -15], [70, -14.7], dicaAuto);
  await p.keyboard.press("Escape");
  e = await esb();
  ok("desligada: linha criada sem símbolo e sem relação nova", linhas(e).length === l1 + 1 && !/Horizontal/.test(dica3) && e.restricoes.length === nRel, `${dica3} · ${e.restricoes.length - nRel} nova(s)`);

  // 7. religa e confere Ctrl (mouse): segurar Ctrl suprime no gesto
  await p.locator("#btn-config").tap();
  await p.waitForTimeout(300);
  await p.locator(".cfg-secoes button", { hasText: "Esboço" }).tap();
  await p.locator(".cfg-item label.interruptor", { hasText: "Relações automáticas" }).tap();
  await p.locator(".cfg-fechar").tap();
  await p.waitForTimeout(300);
  await p.keyboard.press("l");
  const n2 = (await esb()).restricoes.length, l2 = linhas(await esb()).length;
  const [mx0, my0] = await tela([30, -45]), [mx1, my1] = await tela([70, -44.7]);
  await p.keyboard.down("Control");
  await p.mouse.move(mx0, my0);
  await p.mouse.down();
  await p.mouse.move(mx1, my1, { steps: 8 });
  const dicaCtrl = await dicaAuto();
  await p.mouse.up();
  await p.keyboard.up("Control");
  await p.waitForTimeout(400);
  await p.keyboard.press("Escape");
  e = await esb();
  ok("Ctrl segurado (mouse): linha criada sem símbolo e sem relação nova", linhas(e).length === l2 + 1 && !/Horizontal/.test(dicaCtrl) && e.restricoes.length === n2, `${dicaCtrl} · ${e.restricoes.length - n2} nova(s)`);
  await p.mouse.move(mx0, my0 - 60);
  await p.mouse.down();
  await p.mouse.move(mx1, my1 - 60, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  await p.keyboard.press("Escape");
  e = await esb();
  ok("sem Ctrl (mouse, religada): Horizontal criada", linhas(e).length === l2 + 2 && e.restricoes.length === n2 + 1 && e.restricoes.at(-1).tipo === "horizontal", e.restricoes.slice(n2).map((r) => r.tipo).join(","));

  ok("sem erros de JavaScript", !errosJs.length, errosJs.join(" | "));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : "\nroteiro das relações automáticas: tudo certo");
  process.exit(falhas ? 1 : 0);
})();

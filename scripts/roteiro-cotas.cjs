// Roteiro de interface do esboço (pedido do Johann, 09/11/2026), no tablet simulado:
// L com a Linha → cota pelo teclado-calculadora (normal e científico) → cota angular junto das linhas →
// arrastar geometria com a Cota ativa → ✕ num recurso novo não deixa recurso na árvore.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-cotas.cjs [pasta-das-capturas]
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
  const errosJs = [];
  p.on("pageerror", (e) => errosJs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.addInitScript(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
    localStorage.removeItem("jlscad:tecladoCientifico");
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
    const t = await p.evaluate((x) => window.__cad.viewport.mundoParaTela(x), q);
    return [cv.x + t.x, cv.y + t.y];
  };
  const tocarMundo = async (q) => {
    const [x, y] = await tela(q);
    await p.touchscreen.tap(x, y);
    await p.waitForTimeout(450);
  };
  const tecla = (k) => p.locator(`.tc button[data-k="${k}"]`).tap();

  await p.evaluate(() => window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Cotas", features: [] }));
  await pronto();
  cv = await p.locator("#viewport canvas").first().boundingBox();
  await p.locator("#arvore li", { hasText: "Plano Frontal" }).first().tap();
  await aba("Sketch");
  await botao("Esboço").tap();
  await pronto();

  // 1. L com a Linha (40 × 40, braços de 15)
  await botao("Linha").tap();
  for (const q of [[0, 0], [40, 0], [40, 15], [15, 15], [15, 40], [0, 40], [0, 0]]) await tocarMundo([q[0], q[1], 0]);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  let e = await esb();
  ok("L desenhado com 6 linhas", e && e.geos.filter((g) => g.tipo === "linha").length === 6, `${e?.geos.length} geometrias`);

  // 2. cota na base: aparece a caixa do valor com o botão da calculadora (a calculadora não abre sozinha);
  //    o botão abre a calculadora; 3, 0, ✓ → base de 30
  await botao("Cota").tap();
  await tocarMundo([25, 0, 0]);
  await tocarMundo([25, -10, 0]);
  await p.waitForTimeout(400);
  const tc = p.locator(".tc");
  ok("ao criar a cota aparece a caixa do valor com o botão da calculadora", await p.locator(".cota-edicao .ce-calc").isVisible());
  ok("a calculadora não abre sozinha", (await tc.count()) === 0);
  ok("no tablet a caixa não abre o teclado do sistema sozinha (sem foco)", await p.evaluate(() => document.activeElement?.tagName !== "INPUT"));
  if (PASTA) await p.screenshot({ path: `${PASTA}/caixa-cota.png` });
  await p.locator(".cota-edicao .ce-calc").tap();
  await p.waitForTimeout(300);
  ok("o botão da calculadora abre a calculadora", await tc.isVisible());
  const rTc = await tc.boundingBox(), rCota = await p.locator(".cota-edicao").boundingBox();
  const cobre = rTc && rCota && !(rTc.x > rCota.x + rCota.width || rTc.x + rTc.width < rCota.x || rTc.y > rCota.y + rCota.height || rTc.y + rTc.height < rCota.y);
  ok("teclado ao lado da cota, sem cobrir o número", !!rTc && !!rCota && !cobre);
  ok("teclado não sobe o teclado do sistema (sem campo de texto)", (await tc.locator("input").count()) === 0);
  if (PASTA) await p.screenshot({ path: `${PASTA}/teclado-normal.png` });
  await tecla("3"); await tecla("0");
  ok("visor mostra 30 mm", /30 mm/.test(await tc.locator(".tc-expr").innerText()));
  await p.locator(".tc .tc-ok").tap();
  await p.waitForTimeout(500);
  e = await esb();
  // a ponta presa à origem não fica na lista de pontos do esboço
  const mapa = (es) => { const m = new Map(es.pontos.map((q) => [q.id, q])); return { get: (id) => m.get(id) ?? { x: 0, y: 0 } }; };
  const P = mapa(e);
  const comp = (g) => Math.hypot(P.get(g.p2).x - P.get(g.p1).x, P.get(g.p2).y - P.get(g.p1).y);
  const base = e.geos.filter((g) => g.tipo === "linha").find((g) => Math.abs(P.get(g.p1).y) < 1e-6 && Math.abs(P.get(g.p2).y) < 1e-6);
  ok("base com 30 mm depois do ✓", base && Math.abs(comp(base) - 30) < 1e-6, base ? comp(base).toFixed(3) : "?");

  // 3. científico: cota no lado esquerdo = √(900) = 30
  await tocarMundo([0, 25, 0]);
  await tocarMundo([-10, 25, 0]);
  await p.waitForTimeout(400);
  await p.locator(".cota-edicao .ce-calc").tap();
  await p.waitForTimeout(300);
  await p.locator('.tc button[data-t="modo"]').tap();
  ok("modo científico mostra sen/cos/tan/√", (await tc.locator('button[data-k="sin"]').count()) === 1 && (await tc.locator('button[data-k="√"]').count()) === 1);
  await tecla("√"); await tecla("9"); await tecla("0"); await tecla("0"); await tecla(")");
  ok("resultado ao vivo = 30", /= 30 mm/.test(await tc.locator(".tc-res").innerText()), await tc.locator(".tc-res").innerText());
  if (PASTA) await p.screenshot({ path: `${PASTA}/teclado-cientifico.png` });
  await p.locator(".tc .tc-ok").tap();
  await p.waitForTimeout(500);
  e = await esb();
  const P2 = mapa(e);
  const esq = e.geos.filter((g) => g.tipo === "linha").find((g) => Math.abs(P2.get(g.p1).x) < 1e-6 && Math.abs(P2.get(g.p2).x) < 1e-6);
  ok("lado esquerdo com 30 mm (√900)", esq && Math.abs(Math.hypot(P2.get(esq.p2).y - P2.get(esq.p1).y) - 30) < 1e-6);
  ok("modo científico lembrado na próxima cota", await p.evaluate(() => localStorage.getItem("jlscad:tecladoCientifico") === "1"));

  // 4. cota angular entre a base e uma linha inclinada: arco junto das linhas
  await p.keyboard.press("Escape");
  await botao("Linha").tap();
  await tocarMundo([45, -5, 0]); await tocarMundo([70, 15, 0]);
  await p.keyboard.press("Escape");
  await botao("Cota").tap();
  await tocarMundo([10, 0, 0]);
  await tocarMundo([60, 7, 0]);
  await tocarMundo([52, 6, 0]);
  await p.waitForTimeout(400);
  ok("cota angular: caixa em graus", /°/.test(await p.locator(".cota-edicao .ce-un").innerText()));
  await p.locator(".cota-edicao .ce-calc").tap();
  await p.waitForTimeout(300);
  ok("cota angular: calculadora em graus", /°/.test(await tc.locator(".tc-expr").innerText()));
  if (PASTA) await p.screenshot({ path: `${PASTA}/cota-angular.png` });
  await p.locator(".tc .tc-cancelar").tap();
  await p.waitForTimeout(300);
  // digitar direto na caixa (sem calculadora) e aplicar com o ✓ da caixa
  const caixaAng = p.locator(".cota-edicao input");
  await caixaAng.fill("45");
  await p.locator(".cota-edicao .ce-ok").tap();
  await p.waitForTimeout(500);
  const ang = (await esb()).restricoes.find((r) => r.tipo === "angulo");
  ok("cota angular digitada na caixa: 45°", ang && Math.abs(ang.valor - 45) < 1e-6, ang?.valor);

  // 5. arrastar a geometria com a Cota ainda ativa (desfaz um contorno cruzado sem trocar de ferramenta)
  e = await esb();
  const antes = JSON.stringify(e.pontos.map((q) => [q.x.toFixed(2), q.y.toFixed(2)]));
  const nCotas = (es) => es.restricoes.filter((r) => ["distancia", "angulo", "distanciaH", "distanciaV", "raio", "diametro"].includes(r.tipo)).length;
  const cotasAntes = nCotas(e);
  const [x0, y0] = await tela([15, 28, 0]); // braço interno do L (subdefinido, azul)
  // arraste de dedo de verdade (protocolo do Chrome): toque, move e solta
  const cdp = await ctx.newCDPSession(p);
  const toque = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await toque("touchStart", x0, y0);
  for (let i = 1; i <= 10; i++) { await toque("touchMove", x0 + i * 4, y0); await p.waitForTimeout(16); }
  await toque("touchEnd", x0 + 40, y0);
  await p.waitForTimeout(600);
  e = await esb();
  const depois = JSON.stringify(e.pontos.map((q) => [q.x.toFixed(2), q.y.toFixed(2)]));
  ok("com a Cota ativa, arrastar a linha azul com o dedo move a geometria", antes !== depois);
  ok("arrastar não criou cota nova", nCotas(e) === cotasAntes, `${cotasAntes} → ${nCotas(e)}`);
  if (PASTA) await p.screenshot({ path: `${PASTA}/apos-arrastar.png` });

  // 5b. Filete de esboço com "Entidades a filetar": dois cantos na caixa, um toque em Aplicar, filetes iguais
  e = await esb();
  const usos = new Map();
  for (const g of e.geos) if (g.tipo === "linha" && !g.construcao) for (const q of [g.p1, g.p2]) usos.set(q, (usos.get(q) ?? 0) + 1);
  const cantos = [...usos].filter(([id, n]) => n === 2 && id !== "origem").map(([id]) => e.pontos.find((q) => q.id === id)).filter(Boolean).slice(0, 2);
  await botao("Filete").tap();
  await p.waitForTimeout(300);
  for (const q of cantos) await tocarMundo([q.x, q.y, 0]);
  const chips = await p.locator("#painel-comando .pc-chip, .prop-painel .pc-chip, .pc-refs .pc-chip").allInnerTexts();
  ok("os cantos tocados entram na caixa \"Entidades a filetar\"", chips.length === 2, chips.join(", "));
  if (PASTA) await p.screenshot({ path: `${PASTA}/entidades-filetar.png` });
  const arcos0 = e.geos.filter((g) => g.tipo === "arco").length;
  await p.locator("button", { hasText: /^Aplicar filetes \(2\)$/ }).tap();
  await p.waitForTimeout(600);
  e = await esb();
  const novosArcos = e.geos.filter((g) => g.tipo === "arco").length - arcos0;
  ok("Aplicar faz os 2 filetes de uma vez", novosArcos === 2, `${novosArcos} arcos`);
  ok("filetes iguais: uma cota R só para o grupo", e.restricoes.filter((r) => r.tipo === "raio").length === 1 && e.restricoes.some((r) => r.tipo === "igual"));
  await botao("Selecionar").tap();

  // 6. sair do esboço; Extrusão nova → ✕: nada de recurso novo na árvore, o esboço fica
  await aba("Sketch");
  await p.locator("#faixa-comandos button").first().tap();
  await pronto();
  const n0 = (await p.evaluate(() => window.__cad.doc().features.length));
  await aba("Features");
  await botao("Extrusão").tap();
  await pronto();
  await p.locator("#cc-cancelar").tap();
  await pronto();
  const feats = await p.evaluate(() => window.__cad.doc().features.map((f) => f.tipo));
  ok("✕ na Extrusão nova: nenhum recurso novo fica na árvore", feats.length === n0 && !feats.includes("extrusao"), feats.join(","));
  await aba("Sheet Metal");
  await botao("Flange base").tap();
  await pronto();
  await p.locator("#cc-cancelar").tap();
  await pronto();
  const feats2 = await p.evaluate(() => window.__cad.doc().features.map((f) => f.tipo));
  ok("✕ na Flange base nova: sem FlangeBase com erro, o esboço continua", !feats2.includes("flangeBase") && feats2.includes("esboco"), feats2.join(","));
  const erros = await p.evaluate(() => /recurso com erro/.test(document.body.innerText));
  ok("rodapé sem \"recurso com erro\"", !erros);

  ok("sem erros de JavaScript", !errosJs.length, errosJs.join(" | "));
  console.log(falhas ? `${falhas} FALHA(S)` : "roteiro das cotas: tudo certo");
  await b.close();
  process.exit(falhas ? 1 : 0);
})();

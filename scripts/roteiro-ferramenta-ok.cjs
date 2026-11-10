// Roteiro de interface do esboço (pedido do Johann, 10/11/2026), no tablet simulado:
// 1. cota reabre para edição: criar → Enter → tocar de novo (dedo, caneta, mouse e duplo clique), com a
//    Cota ou a Selecionar ativa → a caixa abre com o valor atual;
// 2. ✓/✕ de cada ferramenta lado a lado no canto superior direito do painel (≥ 44 px): ✓ conclui e mantém,
//    ✕ sai desfazendo o que foi feito na ferramenta (Ctrl+Z traz de volta), Esc seguro nas de desenho,
//    Esc = ✕ e Enter = ✓ (aplica) nos comandos com seleção;
// 3. canto da vista no esboço: Sair do esboço / Descartar lado a lado.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-ferramenta-ok.cjs [pasta-das-capturas]
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
  const cdp = await ctx.newCDPSession(p);
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
  const centro = async (loc) => {
    const r = await loc.boundingBox();
    return [r.x + r.width / 2, r.y + r.height / 2];
  };
  const caneta = async (x, y) => {
    for (const type of ["mousePressed", "mouseReleased"])
      await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, pointerType: "pen" });
    await p.waitForTimeout(400);
  };
  const caixa = p.locator(".cota-edicao");
  const rotulo = () => p.locator(".cota-rotulo").first();
  const fecharCaixa = async () => {
    await p.locator(".cota-edicao .ce-ok").tap();
    await p.waitForTimeout(500);
  };
  const nLinhas = async () => (await esb()).geos.filter((g) => g.tipo === "linha").length;
  const barra = p.locator("#painel-comando .esb-ferr-barra");

  await p.evaluate(() => window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Ferramenta OK", features: [] }));
  await pronto();
  cv = await p.locator("#viewport canvas").first().boundingBox();
  await p.locator("#arvore li", { hasText: "Plano Frontal" }).first().tap();
  await aba("Sketch");
  await botao("Esboço").tap();
  await pronto();

  // ---------- 3. canto da vista: Sair do esboço / Descartar lado a lado ----------
  const rOk = await p.locator("#cc-ok").boundingBox(), rX = await p.locator("#cc-cancelar").boundingBox();
  ok("canto da vista: Sair do esboço e Descartar lado a lado", rOk && rX && Math.abs(rOk.y - rX.y) < 2 && rX.x > rOk.x + rOk.width - 1);
  ok("canto da vista: dicas dizem que é o esboço inteiro",
    /Sair do esboço/.test(await p.locator("#cc-ok").getAttribute("title")) && /Descartar todas as alterações do esboço/.test(await p.locator("#cc-cancelar").getAttribute("title")));
  ok("canto da vista: alvos ≥ 44 px", rOk.height >= 44 && rX.height >= 44 && rOk.width >= 44 && rX.width >= 44);
  ok("sem ferramenta (Selecionar): o painel não mostra o ✓/✕ da ferramenta", (await barra.count()) === 0);

  // ---------- 2. ✓/✕ da ferramenta ----------
  await botao("Linha").tap();
  await p.waitForTimeout(300);
  const bOk = barra.locator(".esb-ferr-ok"), bX = barra.locator(".esb-ferr-cancelar");
  const rbOk = await bOk.boundingBox(), rbX = await bX.boundingBox(), rPainel = await p.locator("#painel-comando").boundingBox();
  ok("Linha ativa: ✓ e ✕ lado a lado no painel", rbOk && rbX && Math.abs(rbOk.y - rbX.y) < 2 && rbX.x > rbOk.x);
  ok("✓/✕ no canto superior direito do painel", rbX && rPainel && rbX.x + rbX.width > rPainel.x + rPainel.width - 40 && rbOk.y < rPainel.y + 60,
    `painel ${Math.round(rPainel.x)}–${Math.round(rPainel.x + rPainel.width)}, ✕ em ${Math.round(rbX.x + rbX.width)}`);
  ok("✓/✕ da ferramenta com alvos ≥ 44 px", rbOk.width >= 44 && rbOk.height >= 44 && rbX.width >= 44 && rbX.height >= 44);
  if (PASTA) await p.screenshot({ path: `${PASTA}/ferramenta-ok-cancelar.png` });
  // ✕ desfaz o que a Linha desenhou
  for (const q of [[0, 0], [40, 0], [40, 30]]) await tocarMundo([q[0], q[1], 0]);
  ok("Linha desenhou 2 linhas", (await nLinhas()) === 2);
  await bX.tap();
  await p.waitForTimeout(400);
  ok("✕ da Linha desfaz as 2 linhas e sai da ferramenta", (await nLinhas()) === 0 && (await barra.count()) === 0);
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(400);
  ok("Ctrl+Z traz de volta o que o ✕ desfez", (await nLinhas()) === 2);
  // ✓ mantém e sai
  await botao("Retângulo").tap();
  await tocarMundo([50, 5, 0]);
  await tocarMundo([65, 20, 0]);
  const comRet = await nLinhas();
  await bOk.tap();
  await p.waitForTimeout(400);
  ok("✓ do Retângulo mantém o retângulo e sai da ferramenta", comRet === 6 && (await nLinhas()) === 6 && (await barra.count()) === 0, `${comRet} linhas`);
  // Esc seguro nas ferramentas de desenho: sai mantendo
  await botao("Linha").tap();
  await tocarMundo([0, 50, 0]);
  await tocarMundo([30, 50, 0]);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  ok("Esc na Linha sai mantendo o desenho (Esc seguro)", (await nLinhas()) === 7 && (await barra.count()) === 0);
  // ---------- 1. cota reabre para edição ----------
  await botao("Cota").tap();
  await tocarMundo([20, 0, 0]);
  await tocarMundo([20, -10, 0]);
  await p.waitForTimeout(300);
  ok("cota nova abre a caixa", await caixa.isVisible());
  await caixa.locator("input").fill("35");
  await caixa.locator("input").press("Enter");
  await p.waitForTimeout(500);
  ok("Enter aplica e fecha a caixa", (await caixa.count()) === 0);
  const valorCota = async () => (await esb()).restricoes.find((r) => r.tipo === "distancia" || r.tipo === "distanciaH")?.valor;
  ok("cota aplicada: 35", Math.abs((await valorCota()) - 35) < 1e-6, await valorCota());
  // dedo, com a Cota ainda ativa
  await rotulo().tap();
  await p.waitForTimeout(400);
  ok("com a Cota ativa, tocar (dedo) na cota abre a caixa", await caixa.isVisible());
  ok("a caixa mostra o valor atual", /^35([.,]0*)?$/.test(await caixa.locator("input").inputValue()), await caixa.locator("input").inputValue());
  if (PASTA) await p.screenshot({ path: `${PASTA}/cota-reaberta.png` });
  await caixa.locator("input").fill("37");
  await fecharCaixa();
  ok("valor novo aplicado: 37", Math.abs((await valorCota()) - 37) < 1e-6);
  // caneta
  await caneta(...(await centro(rotulo())));
  ok("com a Cota ativa, a caneta na cota abre a caixa", await caixa.isVisible());
  await fecharCaixa();
  // mouse
  await p.mouse.click(...(await centro(rotulo())));
  await p.waitForTimeout(400);
  ok("com a Cota ativa, o clique do mouse na cota abre a caixa", await caixa.isVisible());
  await fecharCaixa();
  // duplo clique com outra ferramenta (Linha)
  await botao("Linha").tap();
  await p.mouse.dblclick(...(await centro(rotulo())));
  await p.waitForTimeout(400);
  ok("duplo clique na cota abre a caixa (com a Linha ativa)", await caixa.isVisible());
  await fecharCaixa();
  // Selecionar
  await bOk.tap();
  await p.waitForTimeout(300);
  await rotulo().tap();
  await p.waitForTimeout(400);
  ok("com a Selecionar, tocar na cota abre a caixa", await caixa.isVisible());
  await fecharCaixa();
  ok("nenhuma cota a mais criada ao tocar nas existentes", (await esb()).restricoes.filter((r) => r.tipo === "distancia" || r.tipo === "distanciaH").length === 1);

  // comandos com seleção: Esc = ✕ (cancela sem aplicar), Enter = ✓ (aplica)
  await botao("Deslocar").tap().catch(() => botao("Offset").tap());
  await p.waitForTimeout(300);
  await tocarMundo([15, 50, 0]);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  ok("Esc no Deslocar cancela sem aplicar", (await nLinhas()) === 7 && (await barra.count()) === 0);
  await botao("Deslocar").tap().catch(() => botao("Offset").tap());
  await p.waitForTimeout(300);
  await tocarMundo([15, 50, 0]);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(500);
  ok("Enter no Deslocar aplica e sai", (await nLinhas()) === 8 && (await barra.count()) === 0, `${await nLinhas()} linhas`);

  ok("sem erros de JavaScript", errosJs.length === 0, errosJs.join(" | "));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();

// Roteiro da pintura de cores do WJSlicer3D no tablet simulado (1280×800, toque, perfil tablet): caneta
// pinta e dedo navega, ferramentas (pincel, balde, ângulo, corpo inteiro, borracha), desfazer, filamentos
// editáveis, custo das trocas (trocas, purga, torre, tempo), alvos de toque ≥ 44 px e projeto salvo no
// cofre e reaberto. Não entra no pnpm teste (precisa do navegador).
//   node scripts/roteiro-slicer-cores.cjs   (com `pnpm dev --port 5199 --strictPort` rodando)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const RAIZ = process.env.URL_WJ ?? "http://localhost:5199/";
const SAIDA = process.env.SAIDA ?? ".";
let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` (${extra})` : ""}`);
};

/** STL binário de um cubo de lado L com n × n quadrados por face. */
function stlCubo(L, n) {
  const tris = [];
  const face = (f, inv) => {
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        const p = (i, j) => f(i, j).map((v) => (v * L) / n);
        const p0 = p(a, b), p1 = p(a + 1, b), p2 = p(a + 1, b + 1), p3 = p(a, b + 1);
        tris.push(inv ? [p0, p2, p1] : [p0, p1, p2], inv ? [p0, p3, p2] : [p0, p2, p3]);
      }
  };
  face((a, b) => [a, b, 0], true);
  face((a, b) => [a, b, n], false);
  face((a, b) => [a, 0, b], false);
  face((a, b) => [a, n, b], true);
  face((a, b) => [0, a, b], true);
  face((a, b) => [n, a, b], false);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((q, k) => q.forEach((x, e) => buf.writeFloatLE(x, 84 + i * 50 + 12 + k * 12 + e * 4))));
  return buf;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roteiro-cores-"));
  const fCubo = path.join(dir, "Cubo.stl");
  fs.writeFileSync(fCubo, stlCubo(20, 8));

  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(`${RAIZ}slicer/`);
  await p.evaluate(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.removeItem("wjslicer:preferencias");
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
  });
  await p.reload();
  await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);

  const esperarResultado = async () => {
    await p.waitForTimeout(900);
    await p.waitForFunction(() => document.getElementById("sl-ocupado").hidden && !document.getElementById("sl-resultado").hidden, null, { timeout: 90000 });
    return { tempo: await p.locator("#sl-tempo").textContent(), massa: parseFloat((await p.locator("#sl-massa").textContent()).replace(",", ".")) };
  };
  const porCorOculto = () => p.evaluate(() => document.getElementById("sl-por-cor").hidden);
  const centro = async () => {
    const r = await p.locator("#sl-vista").boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, r };
  };
  /** traço de caneta (ou toque) pelos pontos */
  const traco = async (pts, tipo = "pen") => {
    if (tipo === "touch") {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const [x, y] of pts.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      return;
    }
    const m = (type, x, y, buttons) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1, pointerType: "pen" });
    await m("mouseMoved", pts[0][0], pts[0][1], 0);
    await m("mousePressed", pts[0][0], pts[0][1], 1);
    for (const [x, y] of pts.slice(1)) await m("mouseMoved", x, y, 1);
    await m("mouseReleased", pts[pts.length - 1][0], pts[pts.length - 1][1], 0);
  };

  // peça: cubo de 20 mm com 8 × 8 por face
  await p.locator("#sl-vazio-abrir").tap();
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.getByText("STL do aparelho…").tap()]);
  await fc.setFiles(fCubo);
  const r0 = await esperarResultado();
  ok("cubo fatiado sem pintura", r0.massa > 0, `${r0.tempo}, ${r0.massa} g`);
  ok("sem pintura: nada de tabela de cores", await porCorOculto());

  // painel de pintura
  await p.locator("#sl-pintar").tap();
  ok("modo pintura aberto", await p.locator("#sl-pintura").isVisible() && (await p.locator("#sl-pintar").getAttribute("aria-pressed")) === "true");
  const ferr = await p.locator("[data-ferr]").evaluateAll((l) => l.map((e) => e.dataset.ferr));
  ok("seis ferramentas", ferr.join(",") === "pincel,face,regiao,angulo,corpo,borracha", ferr.join(","));
  ok("4 cores na paleta", (await p.locator("#sl-paleta button").count()) === 4);
  const pequenos = await p.evaluate(() =>
    [...document.querySelectorAll("#sl-ferramentas button, #sl-paleta button, #sl-desfazer-cor, #sl-refazer-cor, #sl-limpar-cor, #sl-pintar, #sl-ferr button, #sl-pintar-fechar, #sl-filamentos input, #sl-filamentos select")]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => e.id || e.dataset.ferr || e.dataset.c || e.textContent));
  ok("alvos de toque ≥ 44 px", pequenos.length === 0, pequenos.join(", "));
  ok("desfazer desligado sem pintura", await p.locator("#sl-desfazer-cor").isDisabled());

  // dedo navega, não pinta
  const c = await centro();
  await p.locator("#sl-paleta [data-cor='1']").tap();
  await traco([[c.x - 60, c.y], [c.x - 20, c.y + 10], [c.x + 40, c.y + 20]], "touch");
  await p.waitForTimeout(300);
  ok("dedo gira a vista e não pinta", await p.locator("#sl-desfazer-cor").isDisabled());

  // caneta pinta: pincel grande passando pelo cubo
  await p.locator("#sl-pincel").fill("30");
  await p.locator("#sl-pincel").dispatchEvent("input");
  await traco([[c.x - 20, c.y - 20], [c.x, c.y], [c.x + 20, c.y + 20], [c.x + 30, c.y - 10]]);
  await p.waitForTimeout(400);
  ok("caneta pinta (desfazer liga)", await p.locator("#sl-desfazer-cor").isEnabled());
  const r1 = await esperarResultado();
  ok("tabela de cores e trocas aparecem", !(await porCorOculto()) && (await p.locator("#sl-por-cor tbody tr").count()) === 2, `${r1.tempo}, ${r1.massa} g`);
  const trocas = await p.locator("#sl-por-cor dl").textContent();
  // a aba Prévia mostra o resultado com a tabela por cor (a pintura segue ligada ao voltar à mesa)
  await p.locator("#sl-aba-previa").tap();
  ok("Prévia: tabela por cor visível", await p.locator("#sl-por-cor").isVisible());
  await p.locator("#sl-aba-preparar").tap();
  ok("trocas, purga e torre no resultado", /Trocas de cor/.test(trocas) && /Purga/.test(trocas) && /Torre de purga/.test(trocas) && /Tempo das trocas/.test(trocas), trocas.replace(/\s+/g, " ").slice(0, 160));
  ok("a pintura soma tempo e material", r1.massa > r0.massa);
  await p.screenshot({ path: path.join(SAIDA, "slicer-cores-tablet.png") });

  // desfazer volta ao orçamento sem pintura
  await p.locator("#sl-desfazer-cor").tap();
  const r2 = await esperarResultado();
  ok("desfazer: volta à peça sem pintura", Math.abs(r2.massa - r0.massa) < 0.02 && (await porCorOculto()), `${r2.massa} g`);

  // refazer traz a pintura de volta; pintar de novo descarta o refazer
  ok("refazer ligado depois de desfazer", await p.locator("#sl-refazer-cor").isEnabled());
  await p.locator("#sl-refazer-cor").tap();
  const rR = await esperarResultado();
  ok("refazer: volta a pintura", Math.abs(rR.massa - r1.massa) < 0.02 && !(await porCorOculto()) && (await p.locator("#sl-refazer-cor").isDisabled()), `${rR.massa} g`);
  await p.locator("#sl-desfazer-cor").tap();
  await esperarResultado();

  // corpo inteiro com a cor 3: sem troca, material da cor 3
  await p.locator("[data-ferr=corpo]").tap();
  await p.locator("#sl-paleta [data-cor='2']").tap();
  await traco([[c.x, c.y], [c.x + 1, c.y + 1]]);
  await p.waitForTimeout(300);
  ok("corpo inteiro pinta tudo", await p.locator("#sl-desfazer-cor").isEnabled());
  await esperarResultado();
  ok("peça de uma cor só: sem trocas", await porCorOculto());
  // balde por face e preencher por ângulo: aparecem os controles certos
  await p.locator("[data-ferr=angulo]").tap();
  ok("ângulo: controle do ângulo aparece e o do pincel some", await p.locator("#sl-campo-angulo").isVisible() && await p.locator("#sl-campo-pincel").isHidden());
  await p.locator("[data-ferr=borracha]").tap();
  ok("borracha: controle do pincel", await p.locator("#sl-campo-pincel").isVisible());
  // limpar pintura
  await p.locator("#sl-limpar-cor").tap();
  await esperarResultado();
  ok("limpar pintura", await porCorOculto());

  // filamentos editáveis: material e preço da cor 2
  const linha2 = p.locator(".sl-filamento[data-i='1']");
  await linha2.locator("[data-c=nome]").fill("Verde");
  await linha2.locator("[data-c=nome]").dispatchEvent("change");
  await linha2.locator("[data-c=material]").selectOption("petg");
  await linha2.locator("[data-c=preco]").fill("200");
  await linha2.locator("[data-c=preco]").dispatchEvent("change");
  const pf = await p.evaluate(() => JSON.parse(localStorage.getItem("wjslicer:preferencias")).filamentos[1]);
  ok("filamento 2 guardado (nome, material, R$/kg)", pf.nome === "Verde" && pf.material === "petg" && pf.precoKg === 200, JSON.stringify(pf));

  // custo da troca editável
  await p.locator("#sl-det-troca summary").tap();
  await p.locator("#sl-purga").fill("500");
  await p.locator("#sl-purga").dispatchEvent("change");
  const t = await p.evaluate(() => JSON.parse(localStorage.getItem("wjslicer:preferencias")).trocas);
  ok("purga editada por impressora", t["bbl-p1s"]?.purgaMm3 === 500, JSON.stringify(t));
  await p.locator("#sl-torre").uncheck();
  ok("torre desligável", (await p.evaluate(() => JSON.parse(localStorage.getItem("wjslicer:preferencias")).trocas["bbl-p1s"].torre)) === false);
  await p.locator("#sl-troca-padrao").tap();
  ok("padrão de fábrica volta", (await p.locator("#sl-purga").inputValue()) === "280" && await p.locator("#sl-torre").isChecked());

  // pinta de novo e salva o projeto no cofre
  await p.locator("[data-ferr=pincel]").tap();
  await p.locator("#sl-paleta [data-cor='1']").tap();
  await traco([[c.x - 20, c.y - 20], [c.x, c.y], [c.x + 20, c.y + 20]]);
  const rP = await esperarResultado();
  await p.locator("#sl-salvar").tap();
  await p.waitForSelector('.wjc-fundo [data-a="ok"]', { timeout: 15000 });
  await p.locator('.wjc-fundo [data-a="ok"]').tap();
  await p.waitForFunction(() => /Salvo/.test(document.getElementById("sl-aviso").textContent), null, { timeout: 30000 });
  ok("projeto salvo no cofre (.wjslc)", /Cubo\.wjslc/.test(await p.locator("#sl-aviso").textContent()), (await p.locator("#sl-aviso").textContent()).slice(0, 90));

  // tira a peça e abre o projeto do cofre
  await p.locator("#sl-lista li[data-id] [data-acao=remover]").last().tap();
  await p.waitForTimeout(500);
  ok("mesa vazia", (await p.locator("#sl-lista li[data-id]").count()) === 0);
  await p.locator("#sl-aba-bancada").tap();
  await p.locator("#sl-abrir-projeto").tap();
  await p.waitForSelector(".wje-lista li[data-k^='a:']", { timeout: 15000 });
  await p.locator(".wje-lista li[data-k^='a:']").first().dblclick();
  await p.waitForLoadState("load");
  await p.waitForTimeout(2500);
  await p.waitForFunction(() => document.getElementById("sl-ocupado").hidden && !document.getElementById("sl-resultado").hidden, null, { timeout: 90000 });
  const rA = { massa: parseFloat((await p.locator("#sl-massa").textContent()).replace(",", ".")) };
  ok("projeto reaberto: peça pintada e orçamento igual", Math.abs(rA.massa - rP.massa) < 0.02 && (await p.locator("#sl-por-cor tbody tr").count()) === 2, `${rA.massa} g contra ${rP.massa} g`);
  const nomeFil = await p.locator(".sl-filamento[data-i='1'] [data-c=nome]").inputValue();
  ok("projeto reaberto: filamentos do projeto", nomeFil === "Verde");
  ok("projeto reaberto: desfazer zerado", await p.locator("#sl-desfazer-cor").isDisabled());

  ok("sem erros na página", erros.length === 0, erros.join(" | "));
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} falha(s)` : "\nroteiro de cores do WJSlicer3D: tudo certo");
  process.exit(falhas ? 1 : 0);
})();

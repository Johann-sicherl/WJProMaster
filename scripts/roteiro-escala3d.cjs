// Roteiro da Escala real 1:1 na vista 3D (tablet 1280×800, toque; mouse também) com o Playwright.
// Calibração simulada (TCL TAB A1 Plus: 4,6541 px/mm). Não entra no pnpm teste.
//   node scripts/roteiro-escala3d.cjs   (com `pnpm dev --port 5199 --strictPort` rodando)
const { chromium } = require("playwright");
const RAIZ = process.env.URL_WJ ?? "http://localhost:5199/";
const PX = 4.6541;
let falhas = 0;
const ok = (n, c, x = "") => { if (!c) falhas++; console.log(`${c ? "ok  " : "FALHA"} ${n}${x ? ` (${x})` : ""}`); };
const perto = (a, b, t = 1e-3) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const erros = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erros.push(e.message));
  await p.goto(`${RAIZ}cad/`);
  await p.evaluate(() => localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false })));
  await p.reload();
  await p.waitForTimeout(2000);
  await p.evaluate(() => window.__cad.abrirExemplo());
  await p.waitForTimeout(2500);
  const zoom = () => p.evaluate(() => window.__cad.viewport.camera.zoom);
  const z0 = await zoom();
  const abrirBarra = async () => { if ((await p.locator("#barra-vistas .caixa-vistas").count()) === 0) await p.locator("#barra-vistas .seta-vistas").tap(); };
  const botaoEscala = () => p.locator('#barra-vistas button[aria-label^="Escala real 1:1"]');

  // sem calibração, aparelho fora da lista: pede calibração (tela de calibração abre)
  await abrirBarra();
  await botaoEscala().tap();
  await p.waitForTimeout(600);
  ok("sem calibração: abre a tela de calibração", (await p.locator(".er-regua, .er-tela, [class*='er-']").count()) > 0 && (await zoom()) === z0);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await p.reload();
  await p.waitForTimeout(2000);
  await p.evaluate((px) => localStorage.setItem("jlscad:pxPorMm", String(px)), PX);
  await p.reload();
  await p.waitForTimeout(2000);
  await p.evaluate(() => window.__cad.abrirExemplo());
  await p.waitForTimeout(2500);
  const z1 = await zoom();

  await abrirBarra();
  await botaoEscala().tap();
  await p.waitForTimeout(800);
  ok("liga: botão pressionado", (await botaoEscala().getAttribute("aria-pressed")) === "true");
  ok("liga: zoom da câmera = px/mm calibrado", perto(await zoom(), PX), String(await zoom()));
  // 50 mm na peça = 50 mm na tela (medido em px CSS entre dois pontos do mundo, vista frontal)
  await p.evaluate(() => window.__cad.viewport.definirVista("frontal", false));
  await p.waitForTimeout(400);
  const medida = await p.evaluate(() => {
    const v = window.__cad.viewport, a = v.mundoParaTela([0, 0, 0]), c = v.mundoParaTela([50, 0, 0]);
    return Math.hypot(a.x - c.x, a.y - c.y);
  });
  ok("50 mm do modelo = 50 mm na tela", perto(medida, 50 * PX, 2e-3), `${medida.toFixed(2)} px (esperado ${(50 * PX).toFixed(2)})`);

  // roda e pinça: zoom travado + aviso
  const cv = await p.locator("#viewport canvas").first().boundingBox();
  await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
  await p.mouse.wheel(0, -300);
  await p.waitForTimeout(400);
  ok("roda: zoom não muda", perto(await zoom(), PX));
  ok("roda: aviso 'Escala real ligada'", /Escala real ligada/.test(await p.locator("#aviso, .aviso, [role=status]").allInnerTexts().then((t) => t.join(" "))));

  // giro livre com toque (CDP) e pan com 2 dedos
  const cdp = await ctx.newCDPSession(p);
  const toque = async (tipo, pts) => cdp.send("Input.dispatchTouchEvent", { type: tipo, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
  const dir0 = await p.evaluate(() => window.__cad.viewport.camera.position.toArray());
  await toque("touchStart", [[cx, cy]]);
  for (let i = 1; i <= 10; i++) await toque("touchMove", [[cx + i * 12, cy + i * 4]]);
  await toque("touchEnd", []);
  await p.waitForTimeout(400);
  const dir1 = await p.evaluate(() => window.__cad.viewport.camera.position.toArray());
  ok("um dedo gira a vista (giro livre)", dir0.some((v, i) => Math.abs(v - dir1[i]) > 1), `${dir0.map((v) => v.toFixed(0))} → ${dir1.map((v) => v.toFixed(0))}`);
  ok("giro não muda o zoom", perto(await zoom(), PX));

  const alvo0 = await p.evaluate(() => window.__cad.viewport.controles.target.toArray());
  await toque("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 10; i++) await toque("touchMove", [[cx - 40 + i * 10, cy + i * 6], [cx + 40 + i * 10, cy + i * 6]]);
  await toque("touchEnd", []);
  await p.waitForTimeout(500);
  const alvo1 = await p.evaluate(() => window.__cad.viewport.controles.target.toArray());
  ok("dois dedos arrastam (pan livre)", alvo0.some((v, i) => Math.abs(v - alvo1[i]) > 1), `${alvo0.map((v) => v.toFixed(0))} → ${alvo1.map((v) => v.toFixed(0))}`);
  ok("pan arrastando em paralelo não muda o zoom", perto(await zoom(), PX));

  // pinça: zoom travado e aviso
  await p.waitForTimeout(2600);
  await toque("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 10; i++) await toque("touchMove", [[cx - 40 - i * 10, cy], [cx + 40 + i * 10, cy]]);
  await toque("touchEnd", []);
  await p.waitForTimeout(500);
  ok("pinça: zoom travado", perto(await zoom(), PX));
  ok("pinça: aviso", /Escala real ligada/.test(await p.locator("#aviso, .aviso, [role=status]").allInnerTexts().then((t) => t.join(" "))));

  // F: enquadrar centraliza sem mudar a escala
  await p.keyboard.press("f");
  await p.waitForTimeout(900);
  ok("F: zoom continua = escala real", perto(await zoom(), PX));

  // por janela: recarregar mantém ligada (sessionStorage)
  await p.reload();
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__cad.abrirExemplo());
  await p.waitForTimeout(2500);
  ok("recarregar a janela mantém a escala real", perto(await zoom(), PX), String(await zoom()));

  // desligar volta ao zoom anterior
  await abrirBarra();
  await botaoEscala().tap();
  await p.waitForTimeout(900);
  ok("desliga: botão solto", (await botaoEscala().getAttribute("aria-pressed")) === "false");
  ok("desliga: volta ao zoom anterior", (await zoom()) !== PX && (await zoom()) > 0, String(await zoom()));
  await p.mouse.move(cx, cy);
  const za = await zoom();
  await p.mouse.wheel(0, -300);
  await p.waitForTimeout(400);
  ok("desligada: roda aproxima de novo", (await zoom()) > za);

  ok("sem erros de página", erros.length === 0, erros.join(" | "));
  await b.close();
  if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
  console.log("\nRoteiro da escala 3D: tudo ok");
})();

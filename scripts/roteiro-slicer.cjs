// Roteiro do WJSlicer3D no tablet simulado (1280×800, toque, perfil tablet) com o Playwright do
// ambiente (não entra no pnpm teste): adicionar STL do aparelho, fatiar sem travar a tela (tarefas
// longas na thread da página), cópias, segunda peça, Kobra 3 com suporte em árvore e giroide, prévia
// das camadas com o deslizante, tempo por tipo de caminho, calibração e preferências lembradas.
//   node scripts/roteiro-slicer.cjs   (com `pnpm dev --port 5199 --strictPort` rodando)
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

/** STL binário de caixas (x0, y0, z0, x1, y1, z1). */
function stlCaixas(lista) {
  const tris = [];
  for (const [x0, y0, z0, x1, y1, z1] of lista) {
    const v = [];
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) v.push([x, y, z]);
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) tris.push([v[a], v[b], v[c]], [v[a], v[c], v[d]]);
  }
  return stl(tris);
}
function stlCilindro(R, H, n = 96) {
  const tris = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n, b = (2 * Math.PI * (k + 1)) / n;
    const p0 = [R * Math.cos(a), R * Math.sin(a)], p1 = [R * Math.cos(b), R * Math.sin(b)];
    tris.push([[0, 0, 0], [...p1, 0], [...p0, 0]], [[0, 0, H], [...p0, H], [...p1, H]], [[...p0, 0], [...p1, 0], [...p1, H]], [[...p0, 0], [...p1, H], [...p0, H]]);
  }
  return stl(tris);
}
function stl(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((x, e) => buf.writeFloatLE(x, 84 + i * 50 + 12 + k * 12 + e * 4))));
  return buf;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roteiro-slicer-"));
  const fT = path.join(dir, "Suporte T.stl"), fC = path.join(dir, "Cilindro.stl");
  fs.writeFileSync(fT, stlCaixas([[10, 0, 0, 20, 10, 20], [0, 0, 20, 30, 10, 23]]));
  fs.writeFileSync(fC, stlCilindro(10, 20));

  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));
  await p.goto(`${RAIZ}slicer/`);
  await p.evaluate(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.removeItem("wjslicer:preferencias");
  });
  await p.reload();
  await p.waitForTimeout(1500);
  // tarefas longas na thread da página (a tela travada passa de 50 ms; aceitamos até 200 ms)
  await p.evaluate(() => {
    window.__longas = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longas.push(e.duration))).observe({ type: "longtask", buffered: false });
  });
  ok("perfil tablet", await p.evaluate(() => document.body.classList.contains("disp-tablet")));
  const opcoes = await p.locator("#sl-maquina option").allTextContents();
  ok("só duas impressoras", opcoes.join("|") === "Bambu Lab P1S|Anycubic Kobra 3", opcoes.join(", "));

  const abaProc = (nome) => p.locator(`#sl-pabs [data-pab=${nome}]`).tap();
  const irPara = (aba) => p.locator(`#sl-aba-${aba}`).tap();
  const adicionar = async (arquivo, botao = "#sl-adicionar") => {
    await p.locator(botao).tap();
    const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.getByText("STL do aparelho…").tap()]);
    await fc.setFiles(arquivo);
  };
  const esperarResultado = async () => {
    await p.waitForTimeout(400);
    await p.waitForFunction(() => document.getElementById("sl-ocupado").hidden && !document.getElementById("sl-resultado").hidden, null, { timeout: 60000 });
    return { tempo: await p.locator("#sl-tempo").textContent(), massa: parseFloat((await p.locator("#sl-massa").textContent()).replace(",", ".")) };
  };

  await adicionar(fT, "#sl-vazio-abrir");
  const r1 = await esperarResultado();
  ok("peça com balanço fatiada", r1.massa > 0, `${r1.tempo}, ${r1.massa} g`);
  const partes = await p.locator("#sl-partes tbody tr").allTextContents();
  ok("tempo por tipo de caminho", partes.some((t) => t.includes("Parede externa")) && partes.some((t) => t.includes("Pontes")), `${partes.length} linhas`);

  // cópias: + na lista
  await p.locator("#sl-lista [data-acao=mais]").tap();
  const r2 = await esperarResultado();
  ok("duas cópias: material dobra", Math.abs(r2.massa / r1.massa - 2) < 0.1, `${r1.massa} → ${r2.massa} g`);
  ok("duas cópias na lista", (await p.locator("#sl-lista b").first().textContent()) === "2×");

  // segunda peça
  await adicionar(fC);
  const r3 = await esperarResultado();
  ok("segunda peça na mesa", (await p.locator("#sl-lista li[data-id]").count()) === 2 && r3.massa > r2.massa, `${r3.tempo}, ${r3.massa} g`);

  // Kobra 3, suporte em árvore, giroide
  await p.locator("#sl-maquina").selectOption("acu-k3");
  await esperarResultado();
  await abaProc("resistencia");
  ok("Kobra 3: padrão de fábrica linhas cruzadas", (await p.locator("[data-campo=padrao]").inputValue()) === "cruzado");
  await abaProc("suporte");
  await p.locator("[data-campo=suporte]").selectOption("arvore");
  await abaProc("resistencia");
  await p.locator("[data-campo=padrao]").selectOption("giroide");
  const r4 = await esperarResultado();
  const partes4 = await p.locator("#sl-partes tbody tr").allTextContents();
  ok("árvore: suporte no tempo por caminho", partes4.some((t) => t.startsWith("Suporte") || t.includes("Interface")), r4.tempo);
  const longas = await p.evaluate(() => window.__longas);
  ok("fatiamento no worker: a tela não trava", Math.max(0, ...longas) < 200, `maior tarefa ${Math.round(Math.max(0, ...longas))} ms`);

  // prévia das camadas (aba Prévia liga as camadas sozinha)
  await irPara("previa");
  await p.waitForTimeout(700);
  const txt0 = await p.locator("#sl-camada-v").textContent();
  await p.locator("[data-camada='-1']").tap();
  for (let k = 0; k < 4; k++) await p.locator("[data-camada='-1']").tap();
  await p.waitForTimeout(400);
  const txt1 = await p.locator("#sl-camada-v").textContent();
  ok("prévia: deslizante muda a camada", txt0 !== txt1 && /mm$/.test(txt1), `${txt0} → ${txt1}`);
  await p.locator("#sl-camada").fill("40");
  await p.locator("#sl-camada").dispatchEvent("input");
  await p.waitForTimeout(500);
  ok("prévia: camada 41", (await p.locator("#sl-camada-v").textContent()).startsWith("41 /"));
  ok("legenda da prévia", (await p.locator("#sl-legenda span").count()) >= 3);
  await p.screenshot({ path: path.join(SAIDA, "slicer-previa-tablet.png") });

  // alvos de toque ≥ 44 px
  const pequenos = await p.evaluate(() =>
    [...document.querySelectorAll(".sl-copias button, .sl-remover, .sl-deslizante button, #sl-abas button, #sl-arquivo, #sl-salvar, #sl-calibrar")]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => e.id || e.className || e.textContent));
  ok("alvos de toque ≥ 44 px", pequenos.length === 0, pequenos.join(", "));

  // calibração (menu Calibrar ▾)
  await p.locator("#sl-calibrar").tap();
  await p.getByText("Calibrar tempo…").tap();
  await p.locator("#sl-cal-h").fill("1");
  await p.getByRole("button", { name: "Calibrar", exact: true }).tap();
  await p.waitForTimeout(300);
  const cal = await p.locator("#sl-calibrado").textContent();
  ok("calibração guardada para o Kobra 3", cal.includes("×"), cal);
  ok("tempo calibrado = 1 h", (await p.locator("#sl-tempo").textContent()).startsWith("1 h 00"), await p.locator("#sl-tempo").textContent());

  // remover peça e preferências lembradas
  await irPara("preparar");
  await p.locator("#sl-lista li[data-id] [data-acao=remover]").last().tap();
  await esperarResultado();
  ok("remover peça", (await p.locator("#sl-lista li[data-id]").count()) === 1);
  const pref = await p.evaluate(() => JSON.parse(localStorage.getItem("wjslicer:preferencias")));
  ok("preferências lembradas", pref.maquina === "acu-k3" && pref.ajustes.suporte === "arvore" && pref.ajustes.padrao === "giroide" && pref.calibracao["acu-k3"] > 0);

  ok("sem erros na página", erros.length === 0, erros.join(" | "));
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} falha(s)` : "\nroteiro do WJSlicer3D: tudo certo");
  process.exit(falhas ? 1 : 0);
})();

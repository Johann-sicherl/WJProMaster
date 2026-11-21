// Roteiro do J9a (WJGoldDiamond, 21/11/2026) nos perfis Celular, Tablet 1280×800 com toque e Computador:
// abrir o modelo "Anel folhas com oval", conferir 9 pedras e o peso, mover uma navete pelo toque/clique na
// vista ("Posicionar tocando na vista"), aro 10 → 12 → 10 e exportar STL.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-joia-livres.cjs [pasta-das-capturas] [perfil]
const { chromium } = require("playwright");
const URL = process.env.URL_JOIA ?? "http://localhost:5199/joia/";
const PASTA = process.argv[2];
const SO = process.argv[3];
let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` (${extra})` : ""}`);
};
const PERFIS = {
  celular: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  tablet: { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true },
  computador: { viewport: { width: 1366, height: 768 }, hasTouch: false, isMobile: false },
};

async function perfil(b, nome) {
  const cfg = PERFIS[nome], toque = cfg.hasTouch;
  const ctx = await b.newContext({ ...cfg, deviceScaleFactor: 1, acceptDownloads: true });
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.addInitScript((disp) => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: disp, caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
  }, nome);
  await p.goto(URL);
  const tocar = (loc) => (toque ? loc.tap() : loc.click());
  const status = () => p.locator(".wj-status-texto").innerText();
  const esperarPronto = async (ms = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (/Pronto em/.test(await status())) return Date.now() - t0;
      await p.waitForTimeout(500);
    }
    return -1;
  };
  const aba = (t) => tocar(p.locator(".wj-aba", { hasText: t }).first());
  const cmd = (titulo) => tocar(p.locator(`.wj-cmd[title="${titulo}"]`).first());
  const doc = () => p.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("wjgd:documento")) try { const d = JSON.parse(localStorage.getItem(k)); return d.valor ?? d; } catch { /* outro formato */ }
    return null;
  });
  ok(`${nome}: kernel pronto`, (await esperarPronto(120000)) >= 0, await status());

  // modelo
  await aba("Joia");
  await cmd("Começar de um modelo pronto");
  await tocar(p.locator(".gd-modelos button", { hasText: "Anel folhas com oval" }));
  const ms = await esperarPronto();
  const st = await status();
  const peso = Number(((await p.locator(".wj-status .wj-direita").innerText()).match(/([\d,]+) g/) ?? [])[1]?.replace(",", "."));
  ok(`${nome}: modelo aberto com 9 pedras e Ø 15,92`, /9 pedra\(s\)/.test(st) && /Ø 15,92/.test(st), st);
  ok(`${nome}: peso ${peso} g na faixa 2,5–3,5 g (reconstrução ${(ms / 1000).toFixed(1)} s no navegador do teste)`, peso >= 2.5 && peso <= 3.5);
  if (PASTA) await p.screenshot({ path: `${PASTA}/${nome}-modelo.jpg`, type: "jpeg", quality: 70 });

  // mover a navete do meio do leque pelo toque na vista
  await aba("Joia");
  await cmd("Gema de qualquer lapidação num ponto livre, com garras próprias ou inglesa");
  await tocar(p.locator("[data-livre]", { hasText: "Navete 2,5" }));
  const antes = (await doc()).gemasLivres.find((g) => g.nome.startsWith("Navete 2,5"));
  await tocar(p.locator('[data-acao="livre-posicionar"]'));
  await aba("Vista");
  await cmd("Frente");
  await p.waitForTimeout(400);
  const cv = await p.locator("#gd-vista canvas").boundingBox();
  let movida = null;
  for (let f = 0.52; f < 0.95 && !movida; f += 0.012) {
    const x = cv.x + cv.width / 2, y = cv.y + cv.height * f;
    if (toque) await p.touchscreen.tap(x, y);
    else await p.mouse.click(x, y);
    await p.waitForTimeout(150);
    const g = (await doc()).gemasLivres.find((q) => q.nome.startsWith("Navete 2,5"));
    if (Math.abs(g.th - antes.th) > 1) movida = g;
  }
  ok(`${nome}: navete movida pelo ${toque ? "toque" : "clique"} (θ ${antes.th}° → ${movida?.th}°)`, !!movida && Math.abs(Math.abs(movida.th) - 180) < 30);
  await p.waitForTimeout(600);
  if (PASTA) await p.screenshot({ path: `${PASTA}/${nome}-navete-movida.jpg`, type: "jpeg", quality: 70 });
  await tocar(p.locator('[data-acao="livre-posicionar"]'));

  // aro 10 → 12 → 10
  const tamanho = async (v) => {
    await aba("Joia");
    await cmd("Aro");
    await p.locator('[data-k="aro.tamanho"]').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
    await p.waitForTimeout(400);
    return status();
  };
  const s12 = await tamanho(12);
  ok(`${nome}: aro 12 → Ø 16,55`, /Ø 16,55/.test(s12), s12);
  const s10 = await tamanho(10);
  ok(`${nome}: de volta ao aro 10 → Ø 15,92`, /Ø 15,92/.test(s10), s10);
  ok(`${nome}: joia refeita no aro 10`, (await esperarPronto()) >= 0, await status());

  // exportar STL
  await aba("Fabricação");
  const baixa = p.waitForEvent("download", { timeout: 120000 });
  await cmd("STL");
  const dl = await baixa;
  const caminho = await dl.path();
  const tam = require("node:fs").statSync(caminho).size;
  ok(`${nome}: STL exportado (${(tam / 1024).toFixed(0)} kB, ${dl.suggestedFilename()})`, tam > 50000 && dl.suggestedFilename().endsWith(".stl"));
  ok(`${nome}: sem erros de JavaScript`, !erros.length, erros.join(" | "));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  for (const nome of SO ? [SO] : ["celular", "tablet", "computador"]) await perfil(b, nome);
  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
  await b.close();
  process.exit(falhas ? 1 : 0);
})();

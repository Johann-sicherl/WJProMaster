// Roteiro do J9b (WJGoldDiamond, 25/11/2026) nos perfis Celular, Tablet 1280×800 com toque e Computador:
// modelo "Anel folhas com oval" (folhas e fios avançados, concordância), foto de teste gerada pelo próprio
// app (render em perspectiva por uma câmera conhecida; nenhuma imagem de terceiros), câmera alinhada por 4
// pares e sobreposição conferida, escala pela oval (8 mm), decalque de um fio no esboço, folha posta tocando
// na vista e STL com a concordância.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-joia-j9b.cjs [pasta-das-capturas] [perfil]
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
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
  p.on("pageerror", (e) => erros.push(process.env.PILHA ? e.stack : e.message));
  let resposta = "8";
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? resposta : undefined));
  await p.addInitScript((disp) => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: disp, caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
  }, nome);
  await p.goto(URL);
  const tocar = (loc) => (toque ? loc.tap() : loc.click());
  const tocarEm = (x, y) => (toque ? p.touchscreen.tap(x, y) : p.mouse.click(x, y));
  const status = () => p.locator(".wj-status-texto").innerText();
  const esperarPronto = async (ms = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (/Pronto em/.test(await status())) return Date.now() - t0;
      await p.waitForTimeout(250);
    }
    return -1;
  };
  const aba = (t) => tocar(p.locator(".wj-aba", { hasText: t }).first());
  const cmd = (titulo) => tocar(p.locator(`.wj-cmd[title="${titulo}"]`).first());
  const doc = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__wjgd.doc())));
  const painelItem = async (id) => {
    // celular: a árvore some; o painel abre pela faixa (aba Joia/Vista) ou direto pelo item
    if (await p.locator(`[data-sel=${id}]`).isVisible()) await tocar(p.locator(`[data-sel=${id}]`));
    else await p.evaluate((i) => document.querySelector(`[data-sel=${i}]`)?.click(), id);
  };
  const botao = async (sel) => {
    const l = p.locator(sel).first();
    await l.scrollIntoViewIfNeeded();
    await tocar(l);
  };
  ok(`${nome}: kernel pronto`, (await esperarPronto(120000)) >= 0, await status());
  await p.waitForFunction(() => !!window.__wjgd);

  // 1) modelo com folhas, fios avançados e concordância
  await aba("Joia");
  await cmd("Começar de um modelo pronto");
  const t0 = Date.now();
  await tocar(p.locator(".gd-modelos button", { hasText: "Anel folhas com oval" }));
  let tPrevia = -1;
  while (Date.now() - t0 < 20000) { if (/Calculando|Pronto em/.test(await status())) { tPrevia = Date.now() - t0; break; } await p.waitForTimeout(40); }
  const ms = await esperarPronto();
  const st = await status();
  const peso = Number(((await p.locator(".wj-status .wj-direita").innerText()).match(/([\d,]+) g/) ?? [])[1]?.replace(",", "."));
  const d0 = await doc();
  ok(`${nome}: modelo com 9 pedras, ${d0.folhas.length} folhas e concordância`, /9 pedra\(s\)/.test(st) && d0.folhas.length === 2 && d0.concordancia.ativo, st);
  ok(`${nome}: peso ${peso} g na faixa 2,5–3,5 g; prévia em ${tPrevia} ms (< 2 s), final em ${(ms / 1000).toFixed(1)} s`, peso >= 2.5 && peso <= 3.5 && tPrevia >= 0 && tPrevia < 2000);
  if (PASTA) await p.screenshot({ path: `${PASTA}/${nome}-modelo.jpg`, type: "jpeg", quality: 72 });

  // 2) foto de teste: render em perspectiva por uma câmera conhecida (o próprio app gera)
  const W = 1200, H = 900;
  const teste = await p.evaluate(([W2, H2]) => {
    const g = window.__wjgd, m = g.montagem();
    const pos = [13, 27, 21], alvo = [0, m.cabeca.ref.p[1], 0];
    const cam = { pos, rot: g.olharPara(pos, alvo), f: 2400 };
    const url = g.vista.fotoDeTeste(cam, W2, H2);
    const c = m.cabeca, L = c.gema.comprimento / 2;
    // pontas da oval (eixo longo ao longo do dedo) e centros das redondas (gemas livres 1 e 2)
    const cin = c.ref.p[1] + 0;
    const pts = g.notaveis();
    const perto = (q) => pts.reduce((a, b) => (Math.hypot(b[0] - q[0], b[1] - q[1], b[2] - q[2]) < Math.hypot(a[0] - q[0], a[1] - q[1], a[2] - q[2]) ? b : a));
    const alvos = [perto([0, cin, L]), perto([0, cin, -L]), perto(m.livres[0].gema.ref.p), perto(m.livres[1].gema.ref.p)];
    return { url, cam, alvos, fotos: alvos.map((q) => g.projetar(cam, W2, H2, q)) };
  }, [W, H]);
  const arq = path.join(require("node:os").tmpdir(), `j9b-foto-${nome}.jpg`);
  fs.writeFileSync(arq, Buffer.from(teste.url.split(",")[1], "base64"));
  if (PASTA) fs.copyFileSync(arq, `${PASTA}/${nome}-foto-de-teste.jpg`);
  await painelItem("foto");
  const [escolha] = await Promise.all([p.waitForEvent("filechooser"), botao('[data-acao="foto-galeria"]')]);
  await escolha.setFiles(arq);
  await p.waitForFunction(() => !!window.__wjgd.doc().referencia, null, { timeout: 15000 });
  const r0 = (await doc()).referencia;
  ok(`${nome}: foto carregada no arquivo (${r0.largura} × ${r0.altura} px, fixa na vista de cima)`, r0.largura === W && r0.altura === H && r0.modo === "vista");

  // 3) escala pela oval: duas pontas na foto e 8 mm
  const naFoto = async ([u, v]) => {
    const bb = await p.locator("#gd-foto-quadro img").boundingBox();
    await tocarEm(bb.x + (u / W) * bb.width, bb.y + (v / H) * bb.height);
  };
  await botao('[data-acao="foto-medir"]');
  await naFoto(teste.fotos[0]);
  resposta = "8";
  await naFoto(teste.fotos[1]);
  await p.waitForTimeout(300);
  const r1 = (await doc()).referencia;
  const dpx = Math.hypot(teste.fotos[0][0] - teste.fotos[1][0], teste.fotos[0][1] - teste.fotos[1][1]);
  ok(`${nome}: escala pela oval = 8 mm / ${dpx.toFixed(1)} px = ${(r1.escala * 1000).toFixed(2)} µm/px`, Math.abs(r1.escala - 8 / dpx) / (8 / dpx) < 0.02);

  // 4) alinhar a câmera: 4 pares foto ↔ joia
  await aba("Vista");
  await cmd("Isométrica");
  await painelItem("foto");
  for (let i = 0; i < 4; i++) {
    await botao('[data-acao="foto-par"]');
    await naFoto(teste.fotos[i]);
    await p.waitForTimeout(150);
    const [x, y] = await p.evaluate((q) => window.__wjgd.vista.naTela(q), teste.alvos[i]);
    const bb = await p.locator("#gd-vista canvas").boundingBox();
    await tocarEm(bb.x + x, bb.y + y);
    await p.waitForTimeout(250);
  }
  const r2 = (await doc()).referencia;
  ok(`${nome}: 4 pares marcados e encaixados nas gemas`, r2.pares.length === 4 && r2.pares.every((q, i) => Math.hypot(...q.modelo.map((v, k) => v - teste.alvos[i][k])) < 1e-3));
  await botao('[data-acao="foto-alinhar"]');
  await p.waitForTimeout(500);
  const r3 = (await doc()).referencia;
  const c = r3.camera, dPos = c ? Math.hypot(...c.pos.map((v, k) => v - teste.cam.pos[k])) / Math.hypot(...teste.cam.pos) : 1;
  const texto = await p.locator("#gd-props").innerText();
  const erroPx = Number((texto.match(/alinhamento: ([\d,]+) px/) ?? [])[1]?.replace(",", "."));
  ok(`${nome}: câmera alinhada à foto (posição a ${(dPos * 100).toFixed(3)} % da real, erro ${erroPx} px)`, r3.modo === "camera" && dPos < 0.01 && erroPx < 1);
  // sobreposição: pontos do modelo projetados pela vista da câmera caem sobre os da foto
  const sobre = await p.evaluate(([alvos, fotos, W2, H2]) => {
    const v = window.__wjgd.vista, ret = v.retanguloFoto();
    return alvos.map((q, i) => { const [x, y] = v.naTela(q); return Math.hypot(x - (ret.x + (fotos[i][0] / W2) * ret.w), y - (ret.y + (fotos[i][1] / H2) * ret.h)); });
  }, [teste.alvos, teste.fotos, W, H]);
  ok(`${nome}: sobreposição modelo × foto (desvio máx. ${Math.max(...sobre).toFixed(2)} px na tela)`, Math.max(...sobre) < 2);
  await botao('[data-acao="foto-alternar"]');
  await p.locator("[data-comparar]").first().evaluate((e) => { e.value = "0.5"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.waitForTimeout(300);
  if (PASTA) await p.screenshot({ path: `${PASTA}/${nome}-foto-alinhada.jpg`, type: "jpeg", quality: 72 });
  await botao('[data-acao="foto-comparar-fim"]');
  // volta à foto fixa na vista de cima (decalque no esboço)
  await p.locator('[data-k="referencia.modo"]').first().selectOption("vista");
  await p.waitForTimeout(300);

  // 5) decalque: a foto aparece no esboço do ornamento e um fio novo é desenhado por cima
  await aba("Joia");
  await cmd("Desenhar filigrana, volutas e molduras (esboço do WJCAD envolvido no aro)");
  await p.waitForSelector(".gd-decalque", { timeout: 20000 });
  const nGeos = (await doc()).ornamentos[0].esboco.geos.length;
  await tocar(p.locator(".wj-cmd", { hasText: "Linha" }).first());
  const vp = await p.locator("#gd-vp").boundingBox();
  const ax = vp.x + vp.width * 0.3, ay = vp.y + vp.height * 0.5, bx = vp.x + vp.width * 0.4, by = vp.y + vp.height * 0.52;
  if (toque) {
    // caneta desenha (eventos de ponteiro "pen"), como no tablet
    for (const [x, y] of [[ax, ay], [bx, by]]) {
      await p.locator("#gd-vp canvas").first().dispatchEvent("pointerdown", { pointerType: "pen", clientX: x, clientY: y, button: 0, buttons: 1, isPrimary: true, pointerId: 7 });
      await p.locator("#gd-vp canvas").first().dispatchEvent("pointerup", { pointerType: "pen", clientX: x, clientY: y, button: 0, buttons: 0, isPrimary: true, pointerId: 7 });
      await p.waitForTimeout(120);
    }
  } else {
    await p.mouse.click(ax, ay);
    await p.mouse.click(bx, by);
  }
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  if (PASTA) await p.screenshot({ path: `${PASTA}/${nome}-decalque.jpg`, type: "jpeg", quality: 72 });
  const nGeos2 = (await doc()).ornamentos[0].esboco.geos.length;
  ok(`${nome}: fio decalcado sobre a foto no esboço (${nGeos} → ${nGeos2} entidades)`, nGeos2 > nGeos);
  await tocar(p.locator(".gd-concluir").first());
  await esperarPronto();

  // 6) folha nova posta tocando na vista
  await painelItem("folhas");
  await botao('[data-acao="folha-nova"]');
  await botao('[data-acao="folha-posicionar"]');
  await aba("Vista");
  await cmd("Frente");
  await p.waitForTimeout(300);
  const antes = (await doc()).folhas.at(-1);
  const cv = await p.locator("#gd-vista canvas").boundingBox();
  let posta = null;
  for (let f = 0.55; f < 0.95 && !posta; f += 0.015) {
    await tocarEm(cv.x + cv.width * 0.5 + cv.width * 0.12, cv.y + cv.height * f);
    await p.waitForTimeout(120);
    const g = (await doc()).folhas.at(-1);
    if (Math.abs(g.th - antes.th) > 1) posta = g;
  }
  ok(`${nome}: folha posta tocando na vista (θ ${antes.th}° → ${posta?.th}°)`, !!posta);
  await esperarPronto();

  // 7) concordância ligada e STL
  await painelItem("fabricacao");
  const chk = p.locator('[data-k="concordancia.ativo"]').first();
  ok(`${nome}: concordância ligada no painel`, await chk.isChecked());
  const res = await p.locator("#gd-resultados").innerText();
  ok(`${nome}: resultado mostra o acréscimo da concordância`, /Concordância[\s\S]*mm³ ✓/.test(res), res.replace(/\s+/g, " ").slice(150, 420));
  const [down] = await Promise.all([p.waitForEvent("download"), botao('[data-acao="stl"]')]);
  const destino = path.join(require("node:os").tmpdir(), `j9b-${nome}.stl`);
  await down.saveAs(destino);
  const tam = fs.statSync(destino).size;
  ok(`${nome}: STL com concordância (${(tam / 1e6).toFixed(1)} MB)`, tam > 84 && (tam - 84) % 50 === 0);
  if (PASTA) await p.screenshot({ path: `${PASTA}/${nome}-final.jpg`, type: "jpeg", quality: 72 });
  ok(`${nome}: sem erros de JS`, !erros.length, erros.join(" | "));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  try {
    for (const n of SO ? [SO] : ["celular", "tablet", "computador"]) await perfil(b, n);
  } finally {
    await b.close();
  }
  console.log(falhas ? `${falhas} falha(s)` : "roteiro J9b: tudo certo");
  process.exit(falhas ? 1 : 0);
})();

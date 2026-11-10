// Roteiro do Dividir com corpos resultantes (pedido do Johann, 10/11/2026), no tablet simulado (toque):
// 1) peça em "S": Plano Lateral + Dividir → o painel lista 4 regiões; tocar no nome destaca a região na vista;
//    "Juntar todas" + marcar só a ponta de cima à direita → ✓ → 2 corpos, escolha guardada no recurso;
// 2) corpo de malha (STL): o Dividir pede converter; "forma exata" converte e as regiões aparecem.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-dividir.cjs [pasta-das-capturas]
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
    for (let i = 0; i < 300; i++) {
      await p.waitForTimeout(150);
      if (!(await p.evaluate(() => /Reconstruindo/i.test(document.body.innerText)))) break;
    }
    await p.waitForTimeout(500);
  };
  const foto = async (nome) => { if (PASTA) await p.screenshot({ path: `${PASTA}/${nome}.png` }); };
  /** Abre o Dividir pelo ▾ do grupo de corpos da aba Features. */
  const abrirDividir = async () => {
    await p.locator("#arvore li", { hasText: "Plano Lateral" }).first().tap();
    await p.waitForTimeout(300);
    await p.locator('button.cmd-seta[title="Mover corpo: outras opções"]').first().tap();
    await p.waitForTimeout(300);
    await p.locator(".popover button", { hasText: "Dividir" }).first().tap();
    await p.waitForTimeout(400);
    await pronto();
  };

  // ---------- 1) o "S": 3 barras ligadas por conectores alternados, 10 mm de altura ----------
  await p.evaluate(async () => {
    const m = await import("/src/model.ts");
    const op = await import("/src/esboco/operacoes.ts");
    const d = m.documentoVazio();
    d.nome = "S do roteiro";
    const s = m.novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
    const v = [[-30, 0], [40, 0], [40, 30], [-30, 30], [-30, 40], [30, 40], [30, 50], [-40, 50], [-40, 20], [30, 20], [30, 10], [-30, 10]];
    const pts = v.map(([x, y]) => op.ponto(s, { x, y }));
    pts.forEach((q, i) => op.linha(s, q, pts[(i + 1) % pts.length]));
    d.features.push(s, { ...m.novaFeature("extrusao", 1), esboco: s.id, profundidade: 10 });
    window.__cad.abrir(d);
  });
  await pronto();
  await abrirDividir();
  for (let i = 0; i < 40 && (await p.locator(".lista-regioes .regiao").count()) < 4; i++) await p.waitForTimeout(250);
  const linhas = p.locator(".lista-regioes .regiao");
  ok("o painel lista 4 regiões (o plano cruza o S 3 vezes)", (await linhas.count()) === 4, String(await linhas.count()));
  const alvo44 = await linhas.first().locator(".regiao-nome").boundingBox();
  ok("linha da região com alvo ≥ 44 px no tablet", !!alvo44 && alvo44.height >= 44, alvo44 ? `${Math.round(alvo44.height)} px` : "");

  // tocar em cada nome destaca a região; acha a ponta de cima à direita pelo centro do destaque
  let ponta = -1;
  for (let i = 0; i < 4; i++) {
    await linhas.nth(i).locator(".regiao-nome").tap();
    await p.waitForTimeout(250);
    const c = await p.evaluate(() => {
      const g = window.__cad.viewport.grupoRegiao;
      const malha = g.children.find((o) => o.isMesh);
      if (!malha) return null;
      malha.geometry.computeBoundingBox();
      const bb = malha.geometry.boundingBox;
      return [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2];
    });
    if (i === 0) {
      ok("tocar no nome destaca a região na vista", !!c);
      ok("linha tocada fica marcada como ativa", await linhas.nth(0).evaluate((el) => el.classList.contains("ativa")));
      await foto("dividir-1-regiao-destacada");
    }
    if (c && c[0] > 0 && c[1] > 40) ponta = i;
  }
  ok("ponta de cima à direita encontrada pelo destaque", ponta >= 0, String(ponta));

  await p.locator(".lista-regioes button", { hasText: "Juntar todas" }).tap();
  await pronto();
  await linhas.nth(ponta).locator("input").tap();
  await pronto();
  const marcadas = await p.$$eval(".lista-regioes .regiao input", (l) => l.map((x) => x.checked));
  ok("só a ponta marcada (vira corpo separado)", marcadas.filter(Boolean).length === 1 && marcadas[ponta], JSON.stringify(marcadas));
  ok("resumo: 1 corpo separado, 3 juntas", /1 vira corpo separado; 3 ficam juntas/.test(await p.locator(".lista-regioes").innerText()));
  await foto("dividir-2-escolha");
  await p.locator("#painel-comando .pc-ok").first().tap();
  await pronto();
  const arvore = await p.locator("#arvore").innerText();
  ok("depois do ✓: Corpos sólidos (2)", /Corpos sólidos \(2\)/.test(arvore));
  const guardado = await p.evaluate(() => window.__cad.doc().features.find((f) => f.tipo === "dividir")?.regioes);
  ok("escolha guardada no recurso (4 regiões, 1 separada)", guardado?.length === 4 && guardado.filter((r) => r.separar).length === 1);
  ok("destaque some ao fechar o comando", await p.evaluate(() => window.__cad.viewport.grupoRegiao.children.length === 0));
  await foto("dividir-3-dois-corpos");

  // ---------- 2) corpo de malha (STL): converter em sólido na forma exata ----------
  await p.evaluate(async () => {
    const m = await import("/src/model.ts");
    const W = 60, L = 10;
    const v = [[-W / 2, 0, 0], [W / 2, 0, 0], [W / 2, L, 0], [-W / 2, L, 0], [-W / 2, 0, L], [W / 2, 0, L], [W / 2, L, L], [-W / 2, L, L]];
    const t = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    const buf = new ArrayBuffer(84 + 50 * t.length);
    const dv = new DataView(buf);
    dv.setUint32(80, t.length, true);
    t.forEach((tr, i) => tr.forEach((iv, j) => v[iv].forEach((c, e) => dv.setFloat32(84 + 50 * i + 12 + 12 * j + 4 * e, c, true))));
    const d = m.documentoImportado("barra.stl", new Uint8Array(buf));
    Object.assign(d.features[0], { malha: true, nome: "Malha1" });
    window.__cad.abrir(d);
  });
  await pronto();
  ok("STL entrou como corpo de malha", /Corpo de malha|Malha1/.test(await p.locator("#arvore").innerText()));
  await abrirDividir();
  const erro = await p.locator("#painel-comando .prop-erro").innerText().catch(() => "");
  ok("Dividir no corpo de malha pede converter em sólido", /Converta a malha em sólido/.test(erro), erro);
  const exato = p.locator("#painel-comando button", { hasText: "forma exata" });
  ok("botão Converter … em sólido — forma exata", (await exato.count()) === 1);
  await foto("dividir-4-malha");
  await exato.tap();
  await pronto();
  for (let i = 0; i < 40 && (await p.locator(".lista-regioes .regiao").count()) < 2; i++) await p.waitForTimeout(250);
  ok("convertido: o Dividir lista 2 regiões", (await p.locator(".lista-regioes .regiao").count()) === 2);
  ok("o recurso deixou de ser malha", await p.evaluate(() => !window.__cad.doc().features[0].malha));
  await p.locator("#painel-comando .pc-ok").first().tap();
  await pronto();
  ok("depois do ✓: Corpos sólidos (2)", /Corpos sólidos \(2\)/.test(await p.locator("#arvore").innerText()));

  ok("sem erros de JavaScript", !errosJs.length, errosJs.join(" | "));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : "\nRoteiro do Dividir: tudo certo");
  process.exit(falhas ? 1 : 0);
})();

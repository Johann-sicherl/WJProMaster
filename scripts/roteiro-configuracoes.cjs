// Roteiro da ⚙ Configurações do WJCAD com o Playwright do ambiente (não entra no pnpm teste):
// computador (mouse): passo e sentido da roda na Peça, na Montagem e no Desenho, escala 1:1 travada,
// aplicação em outra janela aberta; tablet (toque, 1280×800) e celular: alvos ≥ 44 px, seções e capturas.
//   node scripts/roteiro-configuracoes.cjs   (com `pnpm dev --port 5199 --strictPort` rodando)
const { chromium } = require("playwright");

const RAIZ = process.env.URL_WJ ?? "http://localhost:5199/";
const SAIDA = process.env.SAIDA ?? ".";
let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` (${extra})` : ""}`);
};
const perto = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const erros = [];

  // ---------- computador: mouse ----------
  {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => erros.push(`peça: ${e.message}`));
    // preferências gravadas uma vez só (as outras abas do roteiro leem o que a Peça gravar)
    await p.goto(`${RAIZ}cad/`);
    await p.evaluate(() => localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "computador", caixaFlutuante: false })));
    await p.reload();
    await p.waitForTimeout(2000);
    ok("engrenagem visível sem documento", await p.locator("#btn-config").isVisible());
    await p.evaluate(() => window.__cad.abrirExemplo());
    await p.waitForTimeout(2500);
    const cv = await p.locator("#viewport canvas").first().boundingBox();
    await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    const zoom = () => p.evaluate(() => window.__cad.viewport.camera.zoom);
    const roda = async (dy) => {
      const z0 = await zoom();
      await p.mouse.wheel(0, dy);
      await p.waitForTimeout(250);
      return (await zoom()) / z0;
    };
    ok("padrão: rolar para a frente aproxima 5 %", perto(await roda(-100), 1 / 0.95), String(await zoom()));
    ok("padrão: rolar para trás afasta 5 %", perto(await roda(100), 0.95));

    // menu antigo vira atalho para a tela
    await p.locator("#btn-menu").click();
    ok("menu Ferramentas → Configurações…", await p.locator('#menu-arquivo [data-acao="configuracoes"]').isVisible());
    ok("menu sem o item antigo Dispositivo", (await p.locator('#menu-arquivo [data-acao="dispositivo"]').count()) === 0);
    await p.locator('#menu-arquivo [data-acao="configuracoes"]').click();
    ok("tela de Configurações abriu", await p.locator(".cfg").isVisible());
    const secoes = await p.locator(".cfg-secoes button").allInnerTexts();
    ok("seções", secoes.join("|") === "Dispositivo|Mouse e zoom|Esboço|Exibição|Cofre (WJPDM)", secoes.join("|"));
    await p.locator(".cfg-secoes button", { hasText: "Mouse e zoom" }).click();
    ok("padrão marcado: frente aproxima", (await p.locator('.cfg-opcoes [aria-checked="true"]').innerText()) === "Rolar para a frente aproxima");
    ok("passo padrão 5 %", (await p.locator(".cfg-valor").innerText()) === "5 %");
    await p.locator(".cfg-opcoes button", { hasText: "Rolar para a frente afasta" }).click();
    await p.locator(".cfg-passo input").fill("20");
    ok("passo mostra 20 %", (await p.locator(".cfg-valor").innerText()) === "20 %");
    await p.screenshot({ path: `${SAIDA}/config-computador.png` });
    await p.keyboard.press("Escape");
    ok("Esc fecha a tela", (await p.locator(".cfg").count()) === 0);
    const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem("jlscad:interface")));
    ok("guardado no aparelho", guardado.rodaFrenteAfasta === true && guardado.passoZoom === 20 && guardado.dispositivo === "computador", JSON.stringify(guardado));
    await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    ok("invertida: frente afasta 20 %", perto(await roda(-100), 0.8));
    ok("invertida: trás aproxima 20 %", perto(await roda(100), 1 / 0.8));
    await p.evaluate(() => window.__cad.viewport.travarEscala(3.78, null));
    ok("escala 1:1: roda não muda o zoom", perto(await roda(-100), 1) && perto(await zoom(), 3.78));
    await p.evaluate(() => window.__cad.viewport.travarEscala(null));

    // Desenho aberto em outra janela: segue a mudança feita na Peça
    const d = await ctx.newPage();
    d.on("pageerror", (e) => erros.push(`desenho: ${e.message}`));
    await d.goto(`${RAIZ}cad/desenho/`);
    await d.bringToFront();
    await d.waitForTimeout(1500);
    await d.evaluate(() => window.__drw.abrir({ formato: "wjdrw", folhas: [{ nome: "Folha1", formato: "A3", vistas: [], notas: [] }], modelos: [] }));
    await d.waitForTimeout(800);
    const folha = await d.locator("#folha").boundingBox();
    await d.mouse.move(folha.x + folha.width / 2, folha.y + folha.height / 2);
    const largura = () => d.evaluate(() => document.getElementById("folha").viewBox.baseVal.width);
    const rodaD = async (dy) => {
      const w0 = await largura();
      await d.mouse.wheel(0, dy);
      await d.waitForTimeout(150);
      return w0 / (await largura()); // ampliação
    };
    const a1 = await rodaD(-100);
    ok("Desenho: invertida, frente afasta 20 %", perto(a1, 0.8), String(a1));
    await d.locator("#btn-config").click();
    await d.locator(".cfg-secoes button", { hasText: "Mouse e zoom" }).click();
    await d.locator(".cfg-opcoes button", { hasText: "Rolar para a frente aproxima" }).click();
    await d.locator(".cfg-padrao").click();
    ok("Desenho: Padrão volta a 5 %", (await d.locator(".cfg-valor").innerText()) === "5 %");
    await d.locator(".cfg-fechar").click();
    await d.mouse.move(folha.x + folha.width / 2, folha.y + folha.height / 2);
    ok("Desenho: padrão, frente aproxima 5 %", perto(await rodaD(-100), 1 / 0.95));
    await d.locator("#btn-config").click();
    await d.locator(".cfg-secoes button", { hasText: "Exibição" }).click();
    ok("Desenho: Exibição explica que o estilo é por vista", /cada vista/.test(await d.locator(".cfg-conteudo").innerText()));
    await d.locator(".cfg-fechar").click();
    await p.bringToFront();
    await p.waitForTimeout(300);
    await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    ok("Peça segue a mudança feita no Desenho (5 %, frente aproxima)", perto(await roda(-100), 1 / 0.95));

    // Montagem
    const m = await ctx.newPage();
    m.on("pageerror", (e) => erros.push(`montagem: ${e.message}`));
    await m.goto(`${RAIZ}cad/montagem/`);
    await m.bringToFront();
    await m.waitForTimeout(1500);
    await m.locator("#btn-config").click();
    await m.locator(".cfg-secoes button", { hasText: "Mouse e zoom" }).click();
    await m.locator(".cfg-passo input").fill("10");
    await m.locator(".cfg-secoes button", { hasText: "Exibição" }).click();
    await m.locator(".cfg-opcoes button", { hasText: "Só arestas" }).click();
    ok("Montagem: estilo aplicado na vista", (await m.evaluate(() => window.__asm.viewport.estiloExibicao)) === "arestas");
    await m.locator(".cfg-fechar").click();
    ok("Montagem: velocidade do zoom para 10 %", perto(await m.evaluate(() => window.__asm.viewport.controles.zoomSpeed), Math.log(0.9) / Math.log(0.95)));
    await p.bringToFront();
    await p.waitForTimeout(300);
    await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    ok("Peça segue a Montagem (10 %)", perto(await roda(100), 0.9));
    await ctx.close();
  }

  // ---------- tablet (toque) e celular ----------
  for (const [perfil, tam] of [["tablet", { width: 1280, height: 800 }], ["celular", { width: 412, height: 860 }]]) {
    const ctx = await b.newContext({ viewport: tam, hasTouch: true, isMobile: true });
    await ctx.addInitScript((dsp) => localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: dsp, caixaFlutuante: false })), perfil);
    for (const pag of ["cad/", "cad/montagem/", "cad/desenho/"]) {
      const p = await ctx.newPage();
      p.on("pageerror", (e) => erros.push(`${perfil} ${pag}: ${e.message}`));
      await p.goto(RAIZ + pag);
      await p.waitForTimeout(1800);
      await p.locator("#btn-config").tap();
      ok(`${perfil} ${pag}: tela abriu`, await p.locator(".cfg").isVisible());
      const largura = await p.evaluate(() => document.querySelector(".cfg").getBoundingClientRect().width);
      ok(`${perfil} ${pag}: cabe na tela`, largura <= tam.width + 0.5, `${largura}px`);
      for (const s of ["Dispositivo", "Mouse e zoom", "Esboço", "Exibição", "Cofre (WJPDM)"]) {
        await p.locator(".cfg-secoes button", { hasText: s }).tap();
        const pequenos = await p.evaluate(() => [...document.querySelectorAll(".cfg button, .cfg input[type=checkbox]")]
          .filter((x) => x.offsetParent && x.type !== "checkbox")
          .map((x) => x.getBoundingClientRect()).filter((r) => r.height < 44 - 0.5 || r.width < 44 - 0.5).length);
        ok(`${perfil} ${pag} ${s}: alvos ≥ 44 px`, pequenos === 0, `${pequenos} pequenos`);
        if (pag === "cad/" && (s === "Mouse e zoom" || s === "Dispositivo")) await p.screenshot({ path: `${SAIDA}/config-${perfil}-${s === "Dispositivo" ? "dispositivo" : "mouse"}.png` });
      }
      if (pag === "cad/") {
        await p.locator(".cfg-secoes button", { hasText: "Dispositivo" }).tap();
        await p.locator(".cfg-opcoes button", { hasText: "0,6 s (padrão)" }).tap();
        await p.locator(".cfg-opcoes button", { hasText: "1 s" }).first().tap();
        ok(`${perfil}: toque longo aplicado na vista`, (await p.evaluate(() => window.__cad.viewport.tempoToqueLongo)) === 1000);
      }
      await p.locator(".cfg-fechar").tap();
      ok(`${perfil} ${pag}: fechou`, (await p.locator(".cfg").count()) === 0);
      await p.close();
    }
    await ctx.close();
  }

  ok("sem erros de JavaScript", erros.length === 0, erros.join(" | "));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : "\nConfigurações do WJCAD: tudo certo");
  process.exit(falhas ? 1 : 0);
})();

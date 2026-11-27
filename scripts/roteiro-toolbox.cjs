// Roteiro de interface (C5, 27/11/2026): faixa de comandos rolável em computador (1280×720 e 1024×600, mouse),
// tablet (1280×800, toque) e celular (390×844) na Peça, na Montagem e no Desenho, e a aba Toolbox (ordem das
// abas, Engrenagem na Peça, Biblioteca só na Montagem). Uso: pnpm dev --port 5199 e depois
//   node scripts/roteiro-toolbox.cjs
const { chromium } = require("playwright");
const BASE = process.env.URL_BASE ?? "http://localhost:5199/";
const falhas = [];
const conferir = (ok, texto) => {
  console.log(`${ok ? "✓" : "✗"} ${texto}`);
  if (!ok) falhas.push(texto);
};

async function abrir(b, pagina, perfil, viewport, toque) {
  const ctx = await b.newContext({ viewport, hasTouch: toque, isMobile: toque });
  await ctx.addInitScript((d) => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: d, caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
  }, perfil);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("erro na página:", e.message));
  await p.goto(BASE + pagina + "#novo");
  await p.waitForTimeout(2000);
  return { ctx, p };
}

/** O último comando da aba aparece inteiro na faixa e o clique cai nele (não numa seta/barra). */
async function ultimoAcessivel(p, tocar) {
  await p.evaluate(() => {
    const bs = [...document.querySelectorAll("#faixa-comandos button")];
    bs[bs.length - 1].scrollIntoView({ inline: "end" });
  });
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => {
    const f = document.querySelector("#faixa-comandos");
    const bs = [...f.querySelectorAll("button")];
    const u = bs[bs.length - 1];
    const a = u.getBoundingClientRect();
    const alvo = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
    return { ok: !!alvo && (alvo === u || u.contains(alvo)), dentro: a.right <= innerWidth + 1 && a.left >= 0, nome: u.textContent };
  });
  return r.ok && r.dentro;
}

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });

  // ---------- computador: roda, arrastar, barra, setas, último comando ----------
  for (const [w, h] of [[1280, 720], [1024, 600]]) {
    const { ctx, p } = await abrir(b, "cad/", "computador", { width: w, height: h }, false);
    const rot = `computador ${w}×${h}`;
    const info = () => p.evaluate(() => {
      const f = document.querySelector("#faixa-comandos");
      const barra = document.querySelector(".faixa-barra");
      return { max: f.scrollWidth - f.clientWidth, x: f.scrollLeft, barra: barra && !barra.hidden ? barra.getBoundingClientRect().height : 0,
        esq: !document.querySelector(".faixa-seta-esq").hidden, dir: !document.querySelector(".faixa-seta-dir").hidden };
    });
    let i = await info();
    conferir(i.max > 10, `${rot}: a faixa de Features não cabe (${i.max}px escondidos)`);
    conferir(i.barra >= 14, `${rot}: barra de rolagem visível (${i.barra}px)`);
    conferir(i.dir && !i.esq, `${rot}: só a seta › no início`);
    const bx = await p.locator("#faixa-comandos").boundingBox();
    await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
    await p.mouse.wheel(0, 300);
    await p.waitForTimeout(250);
    i = await info();
    conferir(i.x >= 250, `${rot}: roda do mouse rola na horizontal (${i.x}px)`);
    // arrastar o dedo da barra até o fim
    const dedo = await p.locator(".faixa-dedo").boundingBox();
    await p.mouse.move(dedo.x + dedo.width / 2, dedo.y + dedo.height / 2);
    await p.mouse.down();
    await p.mouse.move(dedo.x + dedo.width / 2 + 2000, dedo.y + dedo.height / 2, { steps: 8 });
    await p.mouse.up();
    i = await info();
    conferir(i.x >= i.max - 2 && !i.dir && i.esq, `${rot}: arrastar a barra leva ao fim (seta ‹ aparece, › some)`);
    conferir(await ultimoAcessivel(p), `${rot}: último comando de Features visível e clicável`);
    // arrastar com o mouse em área sem botão (separador entre grupos)
    await p.evaluate(() => { document.querySelector("#faixa-comandos").scrollLeft = 0; });
    const sep = await p.evaluate(() => { const s = document.querySelector("#faixa-comandos .sep").getBoundingClientRect(); return { x: s.left + s.width / 2, y: s.top + s.height / 2 }; });
    await p.mouse.move(sep.x, sep.y);
    await p.mouse.down();
    await p.mouse.move(sep.x - 200, sep.y, { steps: 6 });
    await p.mouse.up();
    i = await info();
    conferir(i.x >= 150, `${rot}: arrastar com o mouse em área sem botão rola (${i.x}px)`);
    await p.locator(".faixa-seta-esq").click();
    await p.waitForTimeout(500);
    conferir((await info()).x < i.x, `${rot}: seta ‹ rola para trás`);
    // abas: Toolbox logo depois de Avaliar
    const abas = await p.locator("#abas button").allTextContents();
    conferir(JSON.stringify(abas) === JSON.stringify(["Features", "Sketch", "Sheet Metal", "Avaliar", "Toolbox"]), `${rot}: abas ${abas.join(" · ")}`);
    for (const aba of abas) {
      await p.locator("#abas button", { hasText: aba }).first().click();
      await p.waitForTimeout(150);
      conferir(await ultimoAcessivel(p), `${rot}: aba ${aba}: último comando acessível`);
    }
    await ctx.close();
  }

  // ---------- tablet: toque, barra ≥ 44 px, Toolbox na Peça ----------
  {
    const { ctx, p } = await abrir(b, "cad/", "tablet", { width: 1280, height: 800 }, true);
    const barra = await p.locator(".faixa-barra").boundingBox();
    conferir(barra && barra.height >= 44, `tablet: barra de rolagem com ${barra?.height}px de altura`);
    const antes = await p.evaluate(() => document.querySelector("#faixa-comandos").scrollLeft);
    await p.locator(".faixa-seta-dir").tap();
    await p.waitForTimeout(600);
    conferir((await p.evaluate(() => document.querySelector("#faixa-comandos").scrollLeft)) > antes, "tablet: seta › por toque rola");
    conferir(await ultimoAcessivel(p), "tablet: último comando de Features acessível");
    // Features já não tem Engrenagem; Toolbox tem Biblioteca (desabilitada na Peça) e Engrenagem
    const feat = await p.locator("#faixa-comandos button.cmd").allTextContents();
    conferir(!feat.some((t) => /Engrenagem/.test(t)), "tablet: Features sem o botão Engrenagem");
    await p.locator("#abas button", { hasText: "Toolbox" }).tap();
    await p.waitForTimeout(200);
    const tool = await p.locator("#faixa-comandos button.cmd").allTextContents();
    conferir(tool.length === 2 && /Biblioteca de componentes/.test(tool[0]) && /Engrenagem/.test(tool[1]), `tablet: Toolbox = ${tool.join(" | ")}`);
    const bib = p.locator("#faixa-comandos button.cmd", { hasText: "Biblioteca de componentes" });
    conferir((await bib.getAttribute("aria-disabled")) === "true", "tablet: Biblioteca desabilitada na Peça (selo Montagem)");
    await bib.tap({ force: true });
    await p.waitForTimeout(300);
    conferir(/disponível na Montagem/.test(await p.locator("#aviso").innerText()), "tablet: toque na Biblioteca avisa que é da Montagem");
    const tamanho = await p.locator("#faixa-comandos button.cmd").first().boundingBox();
    conferir(tamanho.height >= 44 && tamanho.width >= 44, `tablet: alvo do comando ${Math.round(tamanho.width)}×${Math.round(tamanho.height)}`);
    // Engrenagem cria o recurso na árvore e abre o painel
    await p.locator("#faixa-comandos button.cmd", { hasText: "Engrenagem" }).tap();
    await p.waitForTimeout(2500);
    const painel = await p.locator("#painel-comando, .painel-comando").first().innerText().catch(() => "");
    conferir(/Engrenagem/.test(painel) && /Módulo/.test(painel), "tablet: Toolbox › Engrenagem abre o painel do recurso");
    await ctx.close();
  }

  // ---------- celular ----------
  {
    const { ctx, p } = await abrir(b, "cad/", "celular", { width: 390, height: 844 }, true);
    const barra = await p.locator(".faixa-barra").boundingBox();
    conferir(barra && barra.height >= 24, `celular: barra de rolagem visível (${barra?.height}px)`);
    conferir(await ultimoAcessivel(p), "celular: último comando de Features acessível");
    await p.locator("#abas button", { hasText: "Toolbox" }).tap();
    conferir(await ultimoAcessivel(p), "celular: aba Toolbox acessível");
    await ctx.close();
  }

  // ---------- Montagem e Desenho ----------
  for (const [pagina, nome] of [["cad/montagem/", "Montagem"], ["cad/desenho/", "Desenho"]]) {
    const { ctx, p } = await abrir(b, pagina, "computador", { width: 1024, height: 600 }, false);
    const abas = await p.locator("#abas button").allTextContents();
    if (nome === "Montagem") conferir(JSON.stringify(abas) === JSON.stringify(["Montagem", "Avaliar", "Toolbox"]), `${nome}: abas ${abas.join(" · ")}`);
    for (const aba of abas) {
      await p.locator("#abas button", { hasText: aba }).first().click();
      await p.waitForTimeout(150);
      conferir(await ultimoAcessivel(p), `${nome}: aba ${aba}: último comando acessível`);
    }
    const bx = await p.locator("#faixa-comandos").boundingBox();
    await p.locator("#abas button").first().click();
    await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
    const antes = await p.evaluate(() => document.querySelector("#faixa-comandos").scrollLeft);
    await p.mouse.wheel(0, 200);
    await p.waitForTimeout(250);
    const depois = await p.evaluate(() => document.querySelector("#faixa-comandos").scrollLeft);
    conferir(depois > antes || (await p.evaluate(() => { const f = document.querySelector("#faixa-comandos"); return f.scrollWidth <= f.clientWidth; })), `${nome}: roda rola a faixa (ou ela cabe)`);
    if (nome === "Montagem") {
      const tb = p.locator("#abas button", { hasText: "Toolbox" });
      await tb.click();
      const cmds = await p.locator("#faixa-comandos button.cmd").allTextContents();
      conferir(cmds.length === 2 && /Biblioteca/.test(cmds[0]) && /Engrenagem/.test(cmds[1]), `Montagem: Toolbox = ${cmds.join(" | ")}`);
    }
    await ctx.close();
  }

  await b.close();
  console.log(falhas.length ? `\n${falhas.length} falha(s)` : "\nTudo certo");
  process.exit(falhas.length ? 1 : 0);
})();

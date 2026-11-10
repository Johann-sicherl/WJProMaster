// Roteiro de interface: GO-OUT / GO-IN / Desfazer GO-OUT por componente na Montagem (10/11/2026).
// Montagem com duas peças do cofre: "Eixo" em GO-OUT com o usuário (com trabalho não publicado) e
// "Mancal" livre. Confere o menu do componente (botão direito / toque longo), o menu do fundo
// (montagem principal), a lista de componentes do painel Cofre, o comentário do GO-IN e a
// confirmação do Desfazer GO-OUT. Tablet simulado. Uso: pnpm dev --port 5199 e depois
//   node scripts/roteiro-cofre-montagem.cjs
const { chromium } = require("playwright");
const BASE = process.env.URL_BASE ?? "http://localhost:5199/";
const falhas = [];
const conferir = (ok, texto) => {
  console.log(`${ok ? "✓" : "✗"} ${texto}`);
  if (!ok) falhas.push(texto);
};

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("erro na página:", e.message));

  await p.goto(BASE + "cad/montagem/");
  await p.waitForTimeout(1500);
  await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const { montagemVazia, embutirPeca, inserirComponente } = await import("/src/montagem/modelo.ts");
    const db = await Armazem.abrir();
    const t = new Date().toISOString();
    const peca = (nome) => ({ formato: "wjcad", versao: 3, nome, features: [] });
    const arquivo = (id, nome, blob, extra = {}) => ({ id, nome, pasta: "raiz", revisao: "", estado: "trabalho", cartao: {}, mod: t, historico: [],
      versoes: [{ n: 1, blob, tamanho: 10, autor: "Usuário", data: t, comentario: "Criado no WJCAD", revisao: "", estado: "trabalho" }], ...extra });
    await db.porBlob("b-eixo", new Blob([JSON.stringify(peca("Eixo"))]));
    await db.porBlob("b-eixo-t", new Blob([JSON.stringify({ ...peca("Eixo"), features: [] , obs: "alterado" })]));
    await db.porBlob("b-mancal", new Blob([JSON.stringify(peca("Mancal"))]));
    await db.por("arquivos", arquivo("eixo", "Eixo.wjcad", "b-eixo", { checkout: { usuario: "Usuário", data: t }, trabalho: { blob: "b-eixo-t", tamanho: 12, data: t, autor: "Usuário" } }));
    await db.por("arquivos", arquivo("mancal", "Mancal.wjcad", "b-mancal"));
    const m = montagemVazia("Conjunto");
    inserirComponente(m, embutirPeca(m, peca("Eixo"), { arquivo: "eixo", versao: 1 }));
    inserirComponente(m, embutirPeca(m, peca("Mancal"), { arquivo: "mancal", versao: 1 }));
    await db.porBlob("b-conj", new Blob([JSON.stringify(m)]));
    await db.por("arquivos", arquivo("conj", "Conjunto.wjasm", "b-conj", { checkout: { usuario: "Usuário", data: t } }));
    const cofre = await import("/src/comum/cofre.ts");
    await cofre.abrirArquivoNoApp(await db.ler("arquivos", "conj"), db);
  });
  await p.waitForTimeout(3500);

  const menuDe = async (nome) => {
    await p.locator(`#arvore li:has-text("${nome}")`).first().dispatchEvent("contextmenu");
    await p.waitForTimeout(300);
    return (await p.locator("#barra-contexto button").allTextContents()).join(" | ");
  };
  const tocarNoMenu = (rotulo) => p.locator("#barra-contexto button", { hasText: rotulo }).first().tap();
  const lerArquivo = (id) => p.evaluate(async (id) => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const a = await (await Armazem.abrir()).ler("arquivos", id);
    return { goOut: a.checkout?.usuario ?? "", versoes: a.versoes.length, comentario: a.versoes[a.versoes.length - 1].comentario, trabalho: !!a.trabalho };
  }, id);

  // 1) menu de cada componente coerente com o estado
  let m = await menuDe("Eixo");
  conferir(/GO-IN/.test(m) && /Desfazer GO-OUT/.test(m) && !/(^|\| )GO-OUT( \||$)/.test(m), `menu do Eixo (em GO-OUT comigo): ${m}`);
  m = await menuDe("Mancal");
  conferir(/(^|\| )GO-OUT( \||$)/.test(m) && !/GO-IN/.test(m), `menu do Mancal (livre): ${m}`);

  // 2) GO-OUT do Mancal pelo menu
  await tocarNoMenu("GO-OUT");
  await p.waitForTimeout(800);
  conferir((await lerArquivo("mancal")).goOut === "Usuário", "GO-OUT do Mancal pelo menu do componente");
  m = await menuDe("Mancal");
  conferir(/GO-IN/.test(m) && /Desfazer GO-OUT/.test(m), `menu do Mancal depois do GO-OUT: ${m}`);

  // 3) GO-IN do Eixo pelo menu, com comentário
  await menuDe("Eixo");
  await tocarNoMenu("GO-IN");
  await p.waitForSelector(".wjc-goin textarea", { timeout: 5000 });
  await p.locator(".wjc-goin textarea").fill("Rasgo de chaveta");
  await p.locator(".wjc-goin [data-ok]").tap();
  await p.waitForTimeout(1200);
  let e = await lerArquivo("eixo");
  conferir(e.versoes === 2 && e.comentario === "Rasgo de chaveta" && !e.goOut, `GO-IN do Eixo: versão 2 com comentário, livre (${JSON.stringify(e)})`);

  // 4) Desfazer GO-OUT do Mancal: pede confirmação; Cancelar não muda nada
  await menuDe("Mancal");
  await tocarNoMenu("Desfazer GO-OUT");
  await p.waitForSelector(".wjc-pergunta", { timeout: 5000 });
  await p.locator(".wjc-pergunta [data-r=nao]").tap();
  conferir((await lerArquivo("mancal")).goOut === "Usuário", "Desfazer GO-OUT cancelado: continua em GO-OUT");
  await menuDe("Mancal");
  await tocarNoMenu("Desfazer GO-OUT");
  await p.waitForSelector(".wjc-pergunta", { timeout: 5000 });
  await p.locator(".wjc-pergunta [data-r=sim]").tap();
  await p.waitForTimeout(1200);
  conferir((await lerArquivo("mancal")).goOut === "", "Desfazer GO-OUT confirmado: Mancal livre");

  // 5) painel Cofre: montagem + componentes, cada um com estado e botões
  await p.locator(".wjc-aba").tap();
  await p.waitForSelector(".wjc-painel .wjc-comp", { timeout: 5000 }).catch(() => {});
  const itens = await p.locator(".wjc-painel .wjc-comp li").allTextContents();
  conferir(itens.length === 2 && itens.every((t) => /GO-OUT/.test(t)), `painel: componentes com estado e botões (${itens.map((t) => t.replace(/\s+/g, " ").trim()).join(" / ")})`);
  conferir((await p.locator('.wjc-painel [data-b="goin"]').count()) === 1, "painel: GO-IN da montagem principal");
  // GO-OUT do Eixo pelo painel
  await p.locator('.wjc-painel .wjc-comp li:has-text("Eixo") [data-c="goout"]').tap();
  await p.waitForTimeout(1000);
  conferir((await lerArquivo("eixo")).goOut === "Usuário", "GO-OUT do Eixo pelo painel");
  const botoesOk = await p.evaluate(() => [...document.querySelectorAll(".wjc-painel button")].every((b) => !b.disabled));
  conferir(botoesOk, "painel com os botões ativos depois do GO-OUT do componente");
  await p.screenshot({ path: process.env.FOTO ?? "/tmp/roteiro-cofre-montagem.png" });
  await p.locator('.wjc-painel [data-b="fechar"]').tap();

  // 6) montagem principal: menu da raiz da árvore e menu do fundo (sem componente selecionado)
  await p.locator("#arvore li.raiz").dispatchEvent("contextmenu");
  await p.waitForTimeout(300);
  const raiz = (await p.locator("#barra-contexto button").allTextContents()).join(" | ");
  conferir(/GO-IN/.test(raiz) && /Desfazer GO-OUT/.test(raiz), `menu da raiz (montagem em GO-OUT comigo): ${raiz}`);
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector("#barra-contexto")?.setAttribute("hidden", ""));
  // esvazia a seleção tocando no vazio da vista
  await p.locator("#viewport canvas").first().tap({ position: { x: 1100, y: 600 } }).catch(() => {});
  await p.waitForTimeout(300);
  await p.locator("#viewport canvas").first().dispatchEvent("contextmenu", { clientX: 1100, clientY: 600, button: 2 });
  await p.waitForTimeout(400);
  const fundo = (await p.locator("#barra-contexto button").allTextContents()).join(" | ");
  conferir(/GO-IN/.test(fundo) && !/Posicionar/.test(fundo), `menu do fundo com o cofre da montagem: ${fundo}`);

  console.log(falhas.length ? `${falhas.length} FALHA(S)` : "cofre por componente na Montagem: tudo certo");
  await b.close();
  process.exit(falhas.length ? 1 : 0);
})();

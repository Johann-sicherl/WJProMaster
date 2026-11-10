// Roteiro de interface: GO-IN no painel Cofre (WJCAD) com a janela do Google abrindo.
// Reproduz o defeito de 10/11/2026 (botões esmaecidos para sempre depois do GO-IN) com um Google
// simulado: acesso vencido, a renovação automática do primeiro toque e o toque do GO-IN pedem a
// janela juntos e o Google responde só ao primeiro pedido (o segundo nunca volta). Confere também o
// comentário do GO-IN (vai para a versão e aparece no histórico do painel), o "manter GO-OUT", a
// pergunta ao abrir (GO-OUT ou só consulta) e o salvar em consulta (pede GO-OUT antes).
// Tablet simulado. Uso: pnpm dev --port 5199 e depois
//   node scripts/roteiro-cofre-goin.cjs [google: primeiro|nenhum|normal]
const { chromium } = require("playwright");
const BASE = process.env.URL_BASE ?? "http://localhost:5199/";
const MODO_GOOGLE = process.argv[2] ?? "primeiro";
const falhas = [];
const conferir = (ok, texto) => {
  console.log(`${ok ? "✓" : "✗"} ${texto}`);
  if (!ok) falhas.push(texto);
};

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript((modo) => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
    // Google autorizado antes, acesso vencido: a janela do Google precisa abrir no toque
    localStorage.setItem("wjgoogle:autorizado", "1");
    if (!sessionStorage.getItem("roteiro:token")) localStorage.setItem("wjgoogle:acesso", JSON.stringify({ token: "velho", expira: Date.now() - 1000 }));
    let aberto = null;
    window.__pedidosGoogle = 0;
    window.google = { accounts: { oauth2: { initTokenClient(o) {
      return { requestAccessToken() {
        window.__pedidosGoogle++;
        if (modo === "nenhum") return; // janela fechada sem o Google avisar
        if (aberto && modo === "primeiro") return; // a janela já aberta responde só ao primeiro pedido
        aberto = o;
        setTimeout(() => {
          aberto = null;
          sessionStorage.setItem("roteiro:token", "1");
          o.callback({ access_token: "novo", expires_in: 3600 });
        }, 400);
      } };
    } } } };
  }, MODO_GOOGLE);
  // Drive: responde rápido com erro (sem rede de verdade no teste)
  await ctx.route(/googleapis\.com/, (r) => r.fulfill({ status: 503, body: "{}" }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("erro na página:", e.message));
  p.on("dialog", (d) => d.accept());

  // arquivo no cofre, em GO-OUT com o usuário, aberto na Peça
  await p.goto(BASE + "cad/");
  await p.waitForTimeout(1500);
  await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const db = await Armazem.abrir();
    const t = new Date().toISOString();
    const doc = { formato: "wjcad", versao: 3, nome: "Suporte", features: [] };
    await db.porBlob("b-suporte", new Blob([JSON.stringify(doc)]));
    await db.por("arquivos", { id: "suporte", nome: "Suporte.wjcad", pasta: "raiz", revisao: "", estado: "trabalho", cartao: {}, checkout: { usuario: "Usuário", data: t }, mod: t,
      versoes: [{ n: 1, blob: "b-suporte", tamanho: 10, autor: "Usuário", data: t, comentario: "Criado no WJCAD", revisao: "", estado: "trabalho" }], historico: [] });
    const cofre = await import("/src/comum/cofre.ts");
    await cofre.abrirArquivoNoApp(await db.ler("arquivos", "suporte"), db);
  });
  await p.waitForTimeout(2500);

  // 1) GO-IN pelo painel (toque): janela do comentário, OK, botões voltam
  await p.locator(".wjc-aba").tap();
  await p.waitForSelector('.wjc-painel [data-b="goin"]');
  await p.locator('.wjc-painel [data-b="goin"]').tap();
  const temJanela = await p.waitForSelector(".wjc-goin textarea", { timeout: 5000 }).then(() => 1, () => 0);
  conferir(temJanela === 1, "GO-IN abre a janela com o comentário");
  if (temJanela) {
    await p.locator(".wjc-goin textarea").fill("Furo de fixação ajustado");
    await p.locator(".wjc-goin [data-manter]").tap();
    await p.locator('.wjc-goin [data-ok]').tap();
    // Android: a janela do Google fecha sem avisar; o app volta ao foco
    if (MODO_GOOGLE === "nenhum") await p.evaluate(() => dispatchEvent(new Event("focus")));
  }
  let voltou = false;
  for (let i = 0; i < 40 && !voltou; i++) {
    await p.waitForTimeout(250);
    voltou = await p.evaluate(() => [...document.querySelectorAll(".wjc-painel button")].every((b) => !b.disabled));
  }
  conferir(voltou, `botões do painel voltam depois do GO-IN (Google: ${MODO_GOOGLE})`);
  const msg = await p.locator(".wjc-painel .wjc-msg").textContent();
  conferir(/GO-IN/.test(msg ?? ""), `mensagem do GO-IN: "${(msg ?? "").slice(0, 90)}"`);
  conferir((await p.locator('.wjc-painel [data-b="goin"]').count()) === 1, "manter GO-OUT: o GO-IN continua disponível");
  const hist = await p.locator(".wjc-painel .wjc-versoes").textContent().catch(() => "");
  conferir(/Furo de fixação ajustado/.test(hist ?? ""), "comentário aparece no histórico de versões do painel");
  const v = await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const a = await (await Armazem.abrir()).ler("arquivos", "suporte");
    return { n: a.versoes.length, comentario: a.versoes[a.versoes.length - 1].comentario, goOut: !!a.checkout };
  });
  conferir(v.n === 2 && v.comentario === "Furo de fixação ajustado" && v.goOut, `versão 2 com o comentário e ainda em GO-OUT (${JSON.stringify(v)})`);

  // 2) GO-IN sem manter: botões coerentes (GO-OUT de volta, sem GO-IN)
  await p.locator('.wjc-painel [data-b="goin"]').tap();
  await p.waitForSelector(".wjc-goin [data-ok]", { timeout: 5000 });
  await p.locator('.wjc-goin [data-ok]').tap();
  let livre = false;
  for (let i = 0; i < 40 && !livre; i++) {
    await p.waitForTimeout(250);
    livre = (await p.locator('.wjc-painel [data-b="goout"]').count()) === 1 && (await p.evaluate(() => [...document.querySelectorAll(".wjc-painel button")].every((b) => !b.disabled)));
  }
  conferir(livre, "GO-IN sem manter: o painel mostra GO-OUT e os botões estão ativos");
  console.log(`  (pedidos de janela do Google: ${await p.evaluate(() => window.__pedidosGoogle)})`);

  // 3) Salvar em consulta: pede o GO-OUT antes
  await p.locator('.wjc-painel [data-b="salvar"]').tap();
  const pergunta = await p.waitForSelector(".wjc-pergunta", { timeout: 5000 }).then(() => 1, () => 0);
  conferir(pergunta === 1, "salvar sem GO-OUT pergunta pelo GO-OUT");
  if (pergunta) await p.locator(".wjc-pergunta [data-r=nao]").tap();
  await p.locator('.wjc-painel [data-b="fechar"]').tap();

  // 4) Abrir do cofre: a mesma janela pergunta GO-OUT ou consulta
  await p.evaluate(async () => {
    const cofre = await import("/src/comum/cofre.ts");
    const { Armazem } = await import("/src/comum/armazem.ts");
    const db = await Armazem.abrir();
    void cofre.abrirArquivoNoApp(await db.ler("arquivos", "suporte"), db);
  });
  const abrir = await p.waitForSelector(".wjc-pergunta [data-r=goout]", { timeout: 5000 }).then(() => 1, () => 0);
  conferir(abrir === 1, "abrir arquivo livre pergunta: GO-OUT ou só consulta");
  if (abrir) {
    await p.locator(".wjc-pergunta [data-r=goout]").tap();
    await p.waitForTimeout(2500);
    const go = await p.evaluate(async () => {
      const { Armazem } = await import("/src/comum/armazem.ts");
      return (await (await Armazem.abrir()).ler("arquivos", "suporte")).checkout?.usuario ?? "";
    });
    conferir(go === "Usuário", "abrir com GO-OUT deixa o arquivo em GO-OUT com você");
  }
  // 5) em GO-OUT com outra pessoa: avisa e abre só para consulta
  await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const db = await Armazem.abrir();
    const a = await db.ler("arquivos", "suporte");
    a.checkout = { usuario: "Maria", data: new Date().toISOString() };
    await db.por("arquivos", a);
    const cofre = await import("/src/comum/cofre.ts");
    void cofre.abrirArquivoNoApp(a, db);
  });
  await p.waitForSelector(".wjc-pergunta", { timeout: 5000 }).catch(() => {});
  const txt = (await p.locator(".wjc-pergunta").textContent().catch(() => "")) ?? "";
  conferir(/Maria/.test(txt) && (await p.locator(".wjc-pergunta [data-r=goout]").count()) === 0, "GO-OUT com outra pessoa: avisa e só oferece consulta");
  await p.screenshot({ path: process.env.FOTO ?? "/tmp/roteiro-cofre-goin.png" });

  console.log(falhas.length ? `${falhas.length} FALHA(S)` : "GO-IN no painel do cofre: tudo certo");
  await b.close();
  process.exit(falhas.length ? 1 : 0);
})();

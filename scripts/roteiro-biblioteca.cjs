// Roteiro de interface: Biblioteca de componentes de fixação na Montagem (C2, 21/11/2026), tablet simulado.
// Chapa com 2 furos Ø6,6 no cofre → montagem → Biblioteca: árvore (5 grupos), busca, escolha do Allen M6,
// toque no furo (espessura e compatibilidade), arma e encaixa com "repetir em todos os furos iguais",
// arruela lisa por ARRASTO, porca pelo lado oposto, lista de materiais com norma e massa, peças no cofre
// (CAD › Biblioteca) e reaproveitadas ao repetir. Uso: pnpm dev --port 5199 e depois
//   node scripts/roteiro-biblioteca.cjs
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

  console.log("abrindo…");
  await p.goto(BASE + "cad/montagem/");
  console.log("aberto");
  await p.waitForTimeout(1500);
  await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const { novaFeature, novoEsboco } = await import("/src/model.ts");
    const op = await import("/src/esboco/operacoes.ts");
    const { montagemVazia, embutirPeca, inserirComponente } = await import("/src/montagem/modelo.ts");
    const db = await Armazem.abrir();
    const t = new Date().toISOString();
    // chapa 60 × 40 × 10 com dois furos passantes Ø6,6 em x = ±15
    const retang = novoEsboco(1, { tipo: "plano", plano: "XZ", deslocamento: 0 });
    op.retangulo(retang, op.ponto(retang, { x: -30, y: -20 }), op.ponto(retang, { x: 30, y: 20 }));
    const base = { ...novaFeature("extrusao", 1), esboco: retang.id, profundidade: 10 };
    const furos = novoEsboco(2, { tipo: "plano", plano: "XZ", deslocamento: 10 });
    for (const x of [-15, 15]) op.circulo(furos, op.ponto(furos, { x, y: 0 }), 3.3);
    const corte = { ...novaFeature("extrusao", 2), esboco: furos.id, operacao: "cortar", profundidade: 10, inverter: true };
    const chapa = { formato: "wjcad", versao: 3, nome: "Chapa", features: [retang, base, furos, corte], material: "aco-1045" };
    const arquivo = (id, nome, blob, extra = {}) => ({ id, nome, pasta: "raiz", revisao: "", estado: "trabalho", cartao: {}, mod: t, historico: [],
      versoes: [{ n: 1, blob, tamanho: 10, autor: "Usuário", data: t, comentario: "Criado no WJCAD", revisao: "", estado: "trabalho" }], ...extra });
    await db.porBlob("b-chapa", new Blob([JSON.stringify(chapa)]));
    await db.por("arquivos", arquivo("chapa", "Chapa.wjcad", "b-chapa"));
    const m = montagemVazia("Conjunto");
    inserirComponente(m, embutirPeca(m, chapa, { arquivo: "chapa", versao: 1 }));
    await db.porBlob("b-conj", new Blob([JSON.stringify(m)]));
    await db.por("arquivos", arquivo("conj", "Conjunto.wjasm", "b-conj", { checkout: { usuario: "Usuário", data: t } }));
    const cofre = await import("/src/comum/cofre.ts");
    await cofre.abrirArquivoNoApp(await db.ler("arquivos", "conj"), db);
  });
  await p.waitForTimeout(5000);
  // vista isométrica (as paredes dos furos ficam visíveis)
  await p.keyboard.press("Control+7").catch(() => {});
  await p.waitForTimeout(500);

  const comTempo = (pr, rotulo, ms = 20000) => { let t; return Promise.race([pr, new Promise((r) => { t = setTimeout(() => { console.log("TEMPO ESGOTADO:", rotulo); r("tempo"); }, ms); })]).finally(() => clearTimeout(t)); };
  // 700 ms entre toques no mesmo ponto: dois toques em até 380 ms contam como duplo toque (enquadra) e não chegam ao comando
  const tocar = async (x, y) => { await p.waitForTimeout(700); return comTempo(p.touchscreen.tap(x, y), `touchscreen.tap(${x},${y})`); };
  const esperarPergunta = async () => {
    try {
      await p.waitForSelector(".wjc-pergunta", { timeout: 25000 });
    } catch (e) {
      const limite = (pr) => Promise.race([pr, new Promise((r) => setTimeout(() => r("(página não respondeu em 8 s)"), 8000))]);
      console.log("sem pergunta; aviso:", await limite(p.evaluate(() => document.querySelector("#aviso")?.textContent + " | " + document.querySelector("#painel-comando")?.textContent.slice(0, 200))));
      await limite(p.screenshot({ path: "/tmp/claude-0/biblioteca-erro.png" }));
      throw e;
    }
  };
  // 1) comando e árvore
  await p.locator("#abas button", { hasText: "Toolbox" }).first().tap();
  await p.locator("button.cmd", { hasText: "Biblioteca de componentes" }).first().tap();
  await p.waitForSelector(".bib-grupo", { timeout: 5000 });
  const grupos = await p.locator(".bib-grupo").allTextContents();
  conferir(grupos.length === 5 && /Parafusos/.test(grupos[0]) && /Pinos/.test(grupos[4]), `árvore com 5 grupos: ${grupos.join(" | ")}`);
  await p.locator(".bib-grupo", { hasText: "Porcas" }).tap();
  conferir((await p.locator(".bib-familia").allTextContents()).some((x) => /Castelo/.test(x)), "grupo Porcas abre com Sextavada, Autotravante, Castelo, Borboleta");

  // 2) busca e escolha do Allen M6
  await p.locator(".campo-busca").fill("allen");
  await p.locator(".bib-familia", { hasText: "ISO 4762" }).first().tap();
  await p.waitForSelector("select");
  await p.locator("label:has-text('Tamanho') select").selectOption("M6");
  conferir(/Parafuso ISO 4762 M/.test((await p.locator(".bib-nome").textContent()) ?? ""), `nome padronizado: ${await p.locator(".bib-nome").textContent()}`);

  // 3) toque no furo (varre a região central até achar a parede de um furo)
  const achar = async () => {
    await p.screenshot({ path: "/tmp/claude-0/biblioteca-antes.png" });
    // o furo de trás fica perto de (735, 394) na vista isométrica; varre ali primeiro (passo 3), depois a tela toda
    const pontos = [];
    for (let y = 384; y <= 406; y += 3) for (let x = 714; x <= 756; x += 3) pontos.push([x, y]);
    for (let y = 260; y <= 640; y += 16) for (let x = 440; x <= 960; x += 16) pontos.push([x, y]);
    for (const [x, y] of pontos) {
      console.log("toque em", x, y);
      await p.touchscreen.tap(x, y);
      await p.waitForTimeout(30);
      const t = await p.evaluate(() => document.querySelector("#painel-comando")?.textContent ?? "");
      if (/Furo Ø/.test(t)) return { x, y };
    }
    return null;
  };
  const pt = await achar();
  conferir(!!pt, `parede de furo encontrada em ${JSON.stringify(pt)}`);
  const info = (await p.locator("#painel-comando .dica").allTextContents()).find((x) => /Furo Ø/.test(x)) ?? "";
  conferir(/Ø6,6/.test(info) && /10 mm/.test(info) && /folga/.test(info), `informação do furo: ${info}`);
  const optC = await p.locator("label:has-text('Comprimento') select option").first().textContent();
  conferir(/Sugerido pela espessura \(\d+/.test(optC ?? ""), `comprimento sugerido: ${optC}`);

  // 4) arruela lisa por ARRASTO (mouse) até o furo, repetindo em todos os furos iguais
  await p.locator(".campo-busca").fill("arruela lisa");
  await p.locator(".bib-familia").first().tap();
  await p.locator("label:has-text('Tamanho') select").selectOption("M6");
  const alvo = p.locator(".bib-arrastar");
  const caixa = await alvo.boundingBox();
  await p.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await p.mouse.down();
  await p.mouse.move(pt.x - 40, pt.y - 40, { steps: 8 });
  await p.mouse.move(pt.x, pt.y, { steps: 6 });
  await p.mouse.up();
  await esperarPergunta();
  const pergunta = await p.locator(".wjc-pergunta").textContent();
  conferir(/Repetir em todos os furos iguais/.test(pergunta) && /1 furo/.test(pergunta), `pergunta de repetição (arrasto): ${pergunta.slice(0, 120)}`);
  await p.locator(".wjc-pergunta button", { hasText: "Em todos" }).tap();
  await p.waitForFunction(() => /Arruela lisa ISO 7089 M6<2>/.test(document.querySelector("#arvore")?.textContent ?? ""), null, { timeout: 40000 });
  conferir(true, "2 arruelas lisas ISO 7089 M6 encaixadas por arrasto");

  // 5) parafuso Allen M6: toque no fixador já no furo vale o furo; arma e encaixa sobre a arruela (comprimento sugerido considera a arruela)
  await p.locator(".campo-busca").fill("allen");
  await p.locator(".bib-familia", { hasText: "ISO 4762" }).first().tap();
  await p.locator("label:has-text('Tamanho') select").selectOption("M6");
  console.log("armando o Allen…");
  await comTempo(p.locator(".bib-arrastar").tap(), "tap em .bib-arrastar");
  await tocar(pt.x, pt.y);
  await esperarPergunta();
  conferir(/Repetir em todos os furos iguais/.test(await p.locator(".wjc-pergunta").textContent()), "pergunta de repetição do parafuso");
  await p.locator(".wjc-pergunta button", { hasText: "Em todos" }).tap();
  await p.waitForFunction(() => /Parafuso ISO 4762 M6x\d+<2>/.test(document.querySelector("#arvore")?.textContent ?? ""), null, { timeout: 40000 });
  const arvore = await p.locator("#arvore").textContent();
  const nomes = [...new Set(arvore.match(/Parafuso ISO 4762 M6x\d+/g) ?? [])];
  conferir(nomes.length === 1 && /M6x22$/.test(nomes[0]), `2 parafusos iguais, comprimento sugerido 22 (10 + arruela 1,6 + porca 5,2 + arruela 1,6 + 2 passos): ${nomes.join(", ")}`);
  const lista = await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const db = await Armazem.abrir();
    const pastas = await db.todos("pastas");
    const arq = await db.todos("arquivos");
    const bib = pastas.find((x) => x.nome === "Biblioteca");
    const meus = arq.filter((a) => a.pasta === bib?.id);
    return { pasta: !!bib, arquivos: meus.map((a) => a.nome), cartao: meus.find((a) => /4762/.test(a.nome))?.cartao };
  });
  conferir(lista.pasta && lista.arquivos.some((n) => /^Parafuso ISO 4762 M6x22\.wjcad$/.test(n)) && lista.arquivos.filter((n) => /4762/.test(n)).length === 1, `peça salva uma vez em CAD › Biblioteca: ${lista.arquivos.join(", ")}`);
  conferir(/allen/i.test(lista.cartao?.descricao ?? "") && /Aço/.test(lista.cartao?.material ?? ""), `cartão do cofre: ${JSON.stringify(lista.cartao)}`);

  // 6) porca pelo lado oposto (toque no parafuso vale o furo), só neste furo
  await p.locator(".campo-busca").fill("ISO 4032");
  await p.locator(".bib-familia").first().tap();
  await p.locator("label:has-text('Tamanho') select").selectOption("M6");
  await p.locator("label:has-text('lado oposto') input").check();
  await comTempo(p.locator(".bib-arrastar").tap(), "tap em .bib-arrastar (porca)");
  await tocar(pt.x, pt.y);
  await esperarPergunta();
  await p.locator(".wjc-pergunta button", { hasText: "Só neste furo" }).tap();
  await p.waitForFunction(() => /Porca ISO 4032 M6<1>/.test(document.querySelector("#arvore")?.textContent ?? ""), null, { timeout: 40000 });
  conferir(true, "porca ISO 4032 M6 encaixada pelo lado oposto");

  // 7) posicionamentos criados e sem erro
  const sem = await p.locator("#arvore").textContent();
  conferir(!/\(\+\)/.test(sem), "nenhum componente com erro de posicionamento ((+) na árvore)");
  conferir(/Concêntrico/.test(sem) && /Coincidente|Distância/.test(sem), "posicionamentos concêntrico + coincidente/distância na árvore");

  // 8) lista de materiais com norma e massa
  await p.locator("#painel-comando .pc-cancelar").tap();
  await p.locator("button.tab, [role=tab]", { hasText: "Avaliar" }).first().tap().catch(() => {});
  await p.locator("button.cmd", { hasText: "Lista de materiais" }).first().tap();
  await p.waitForSelector("table.tabela", { timeout: 15000 });
  const tabela = await p.locator("table.tabela").textContent();
  conferir(/ISO 4762/.test(tabela) && /ISO 7089/.test(tabela) && /ISO 4032/.test(tabela), "lista de materiais com NORMA ISO 4762, ISO 7089 e ISO 4032");
  conferir(/MASSA/.test(tabela) && /Aço 1045/.test(tabela), "lista de materiais com material e coluna de massa");
  await p.screenshot({ path: process.env.SAIDA ?? "/tmp/claude-0/biblioteca.png" });
  await b.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : "\nTudo certo.");
  process.exit(falhas.length ? 1 : 0);
})();

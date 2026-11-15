// Roteiro da caixa de seleção ativa e da seleção rápida de arestas (pedido do Johann, 15/11/2026), no tablet
// simulado (1280×800, toque e caneta; mouse por eventos de ponteiro "mouse"):
// 1) Filete (caneta): abre com "Arestas e faces" ativa (rosa); tocar a borda do bolsão abre a barra de seleção
//    rápida; "Arestas do Corte1" soma as 12 do bolsão (prévia refeita), Desfazer volta a 1; ✕ cancela;
// 2) Chanfro (dedo): "Todas as convexas" soma as 16 convexas; "Todas as côncavas" a partir da borda do fundo;
// 3) Furo (dedo): toque na face de cima abre o painel; nenhuma caixa vazia fica sem estar ativa;
// 4) Padrão linear (mouse): a direção 1 abre ativa; tocar uma aresta enche a caixa e a vez passa (Direção 2
//    desligada: nenhuma ativa);
// 5) Espelhar (caneta): o plano (padrão Direito) abre ativo; tocar a face lateral troca o plano;
// 6) Plano (dedo): a 1ª referência (padrão Superior) abre ativa; tocar a face de cima troca; Plano médio faz a
//    2ª referência aparecer já ativa; com pré-seleção da face, a face entra na 1ª.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-selecao.cjs [pasta-das-capturas]
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
  const cdp = await ctx.newCDPSession(p);
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
    for (let i = 0; i < 120; i++) {
      await p.waitForTimeout(150);
      if (!(await p.evaluate(() => /Reconstruindo/i.test(document.body.innerText)))) break;
    }
    await p.waitForTimeout(700);
  };
  const doc = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__cad.doc())));
  const comando = (tipo) => doc().then((d) => d.features.filter((f) => f.tipo === tipo).pop());
  const comErro = () => p.evaluate(() => [...document.querySelectorAll("#arvore li.com-erro")].map((li) => li.title || li.textContent));
  /** Rótulos das caixas de seleção: ativa e vazias. */
  const caixas = () => p.evaluate(() => [...document.querySelectorAll("#painel-comando .pc-refs")].map((a) => ({
    rot: a.parentElement.querySelector(".campo-rotulo")?.textContent ?? "",
    ativa: a.classList.contains("ativo"),
    vazia: !!a.querySelector(".pc-vazio"),
  })));
  const ativa = async () => (await caixas()).find((c) => c.ativa)?.rot ?? null;
  const barra = () => p.evaluate(() => {
    const el = document.getElementById("barra-contexto");
    return el.hidden ? [] : [...el.querySelectorAll("button")].map((x) => x.textContent.trim());
  });
  const tocarBarra = (texto) => p.locator("#barra-contexto button", { hasText: texto }).first().tap();
  const abrir = async (grupo, item) => {
    await p.locator("#abas button", { hasText: "Features" }).first().tap();
    await p.locator(`#faixa-comandos button.cmd-seta[title^="${grupo}:"]`).first().tap();
    await p.locator(".popover button", { hasText: item }).first().tap();
    await p.waitForTimeout(400);
  };
  const cancelar = async () => {
    await p.locator("#painel-comando .pc-cancelar").first().tap();
    await pronto();
  };
  let cv;
  const tela = async (q) => {
    cv = await p.locator("#viewport canvas").first().boundingBox();
    const t = await p.evaluate((x) => window.__cad.viewport.mundoParaTela(x), q);
    return [cv.x + t.x, cv.y + t.y];
  };
  /** Toque no ponto 3D: caneta ou mouse (eventos de ponteiro pelo CDP) ou dedo (toque). */
  const tocar = async (q, tipo) => {
    const [x, y] = await tela(q);
    if (tipo === "dedo") await p.touchscreen.tap(x, y);
    else {
      const pointerType = tipo === "caneta" ? "pen" : "mouse";
      const ev = (type, buttons) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType });
      await ev("mouseMoved", 0);
      await ev("mousePressed", 1);
      await ev("mouseReleased", 0);
    }
    await p.waitForTimeout(500);
  };

  // peça: bloco 80 × 100 × 100 com bolsão 20 × 20 × 10 no topo (Corte1)
  await p.evaluate(async () => {
    const m = await import("/src/model.ts");
    const op = await import("/src/esboco/operacoes.ts");
    const base = m.novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
    op.retangulo(base, op.ponto(base, { x: -40, y: -50 }), op.ponto(base, { x: 40, y: 50 }));
    const ex = { ...m.novaFeature("extrusao", 1), esboco: base.id, profundidade: 100 };
    const esb2 = m.novoEsboco(2, { tipo: "plano", plano: "XY", deslocamento: 100 });
    op.retangulo(esb2, op.ponto(esb2, { x: -10, y: -10 }), op.ponto(esb2, { x: 10, y: 10 }));
    const corte = { ...m.novaFeature("extrusao", 2), nome: "Corte1", esboco: esb2.id, profundidade: 10, operacao: "cortar", inverter: true };
    window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Seleção", features: [base, ex, esb2, corte] });
  });
  await pronto();
  ok("peça sem erro", !(await comErro()).length);
  // vista frontal-superior inclinada: o topo e a frente aparecem
  await p.evaluate(() => window.__cad.viewport.enquadrar?.());
  await p.waitForTimeout(300);

  // ---------- 1. Filete com a caneta ----------
  await abrir("Filete", "Filete");
  ok("Filete abre com a caixa das arestas ativa (rosa)", (await ativa()) === "Arestas e faces", JSON.stringify(await caixas()));
  await tocar([0, -10, 100], "caneta"); // borda do bolsão (lado da frente)
  let fil = await comando("filete");
  ok("caneta: a borda do bolsão entrou na caixa", fil.itens.length === 1, `${fil.itens.length}`);
  let bt = await barra();
  ok("barra de seleção rápida aparece com as opções", bt.some((t) => /Arestas do Corte1 \(12\)/.test(t)) && bt.some((t) => /Arestas da face plana/.test(t)) && bt.some((t) => /Todas as côncavas \(8\)/.test(t)), bt.join(" | "));
  if (PASTA) await p.screenshot({ path: `${PASTA}/1-filete-barra.png` });
  await tocarBarra("Arestas do Corte1");
  await pronto();
  fil = await comando("filete");
  ok("Arestas do Corte1: 12 na lista (sem repetir a tocada)", fil.itens.length === 12, `${fil.itens.length}`);
  ok("prévia do filete sem erro", !(await comErro()).length, (await comErro()).join(" | "));
  bt = await barra();
  ok("a barra passa a oferecer Desfazer", bt.length === 1 && /Desfazer/.test(bt[0]), bt.join(" | "));
  if (PASTA) await p.screenshot({ path: `${PASTA}/2-filete-corte1.png` });
  await tocarBarra("Desfazer");
  await pronto();
  fil = await comando("filete");
  ok("Desfazer volta a lista de antes (1 aresta)", fil.itens.length === 1, `${fil.itens.length}`);
  await cancelar();
  ok("✕: o filete não fica na árvore e a barra some", !(await comando("filete")) && !(await barra()).length);

  // ---------- 2. Chanfro com o dedo ----------
  await abrir("Filete", "Chanfro");
  ok("Chanfro abre com a caixa ativa", (await ativa()) === "Arestas e faces");
  await tocar([0, -50, 100], "dedo"); // borda de fora, frente de cima
  let ch = await comando("chanfro");
  ok("dedo: a borda de fora entrou na caixa", ch.itens.length === 1, `${ch.itens.length}`);
  bt = await barra();
  ok("barra: todas as convexas (16)", bt.some((t) => /Todas as convexas \(16\)/.test(t)), bt.join(" | "));
  await tocarBarra("Todas as convexas");
  await pronto();
  ch = await comando("chanfro");
  ok("Todas as convexas: 16 na lista", ch.itens.length === 16, `${ch.itens.length}`);
  ok("prévia do chanfro sem erro", !(await comErro()).length, (await comErro()).join(" | "));
  if (PASTA) await p.screenshot({ path: `${PASTA}/3-chanfro-convexas.png` });
  await cancelar();

  // ---------- 3. Furo com o dedo ----------
  await abrir("Furo assistido", "Furo assistido");
  await tocar([25, 30, 100], "dedo");
  await pronto();
  const cf = await caixas();
  ok("Furo: painel aberto e nenhuma caixa vazia fica sem estar ativa", !!(await comando("furo")) && cf.filter((c) => c.vazia).every((c, i) => i > 0 || c.ativa), JSON.stringify(cf));
  await cancelar();

  // ---------- 4. Padrão linear com o mouse ----------
  await abrir("Padrão", "Padrão linear");
  ok("Padrão linear abre com a direção 1 ativa", /Direção/.test((await ativa()) ?? ""), JSON.stringify(await caixas()));
  await tocar([40, 0, 100], "mouse"); // borda de cima do lado direito
  const pad = await comando("padraoLinear");
  ok("mouse: a aresta entrou na direção 1", pad.dir1.ref?.tipo === "aresta");
  ok("caixa de um item cheia: a vez passa (Direção 2 desligada → nenhuma ativa)", (await ativa()) === null, JSON.stringify(await caixas()));
  await cancelar();

  // ---------- 5. Espelhar com a caneta ----------
  await abrir("Padrão", "Espelhar").catch(() => {});
  if (!(await comando("espelhar"))) {
    await p.locator("#faixa-comandos button", { hasText: "Espelhar" }).first().tap();
    await p.waitForTimeout(400);
  }
  ok("Espelhar abre com o plano (padrão Direito) ativo", (await ativa()) === "Plano", JSON.stringify(await caixas()));
  await tocar([40, 0, 50], "caneta"); // face lateral direita
  const esp = await comando("espelhar");
  ok("caneta: a face lateral trocou o plano padrão", esp.plano?.tipo === "face", JSON.stringify(esp.plano));
  ok("plano cheio: nenhuma caixa ativa", (await ativa()) === null);
  await cancelar();

  // ---------- 6. Plano com o dedo ----------
  await abrir("Geometria de referência", "Plano");
  ok("Plano abre com a 1ª referência (padrão Superior) ativa", (await ativa()) === "Plano / face", JSON.stringify(await caixas()));
  await tocar([25, 30, 100], "dedo");
  let pl = await comando("planoRef");
  ok("dedo: a face de cima trocou o padrão", pl.ref1?.tipo === "face", JSON.stringify(pl.ref1));
  ok("1ª cheia (Distância): nenhuma ativa", (await ativa()) === null);
  await p.locator("#painel-comando select").first().selectOption("medio");
  await p.waitForTimeout(400);
  ok("Plano médio: a 2ª referência aparece já ativa", /2º plano/.test((await ativa()) ?? ""), JSON.stringify(await caixas()));
  await tocar([0, -50, 50], "dedo"); // face da frente
  pl = await comando("planoRef");
  ok("dedo: a face da frente entrou na 2ª", pl.ref2?.tipo === "face");
  if (PASTA) await p.screenshot({ path: `${PASTA}/4-plano-medio.png` });
  await cancelar();
  // com pré-seleção: tocar a face de cima fora do comando e abrir o Plano
  await tocar([25, 30, 100], "dedo");
  await abrir("Geometria de referência", "Plano");
  pl = await comando("planoRef");
  ok("pré-seleção: a face entra na 1ª referência", pl.ref1?.tipo === "face", JSON.stringify(pl.ref1));
  await cancelar();

  ok("sem erros de JavaScript", !errosJs.length, errosJs.join(" | "));
  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
  await b.close();
  process.exit(falhas ? 1 : 0);
})();

// Roteiro de desempenho do WJCAD (P1, 24/11/2026: "filete lento na 2ª feature", Caixa 60×60 do Johann), no
// tablet simulado (1280×800, toque, perfil Tablet). Mede com as marcas de tempo do app (src/comum/medicao.ts):
// toque/✓ → envio ao worker → volta → aplicado → peça desenhada na tela; o tempo e as etapas do kernel
// (recursos, prévia, malha, topologia) e o salvamento automático. Falha acima dos limites:
//   ✓ → peça na tela ≤ 500 ms · prévia por toque (toque → peça com o recurso na tela) ≤ 300 ms · material
//   removido (vermelho, que vem numa 2ª mensagem do worker) ≤ 500 ms · nenhuma reconstrução repetida no ✓.
// Casos: esboço 60×60 → Extrusão 12,5 (✓) → Filete R6 nas 4 arestas verticais tocadas (✓); Filete R6 nas 4
// bordas de cima; Chanfro 1 mm nas 4 bordas de cima; Corte extrudado (círculo Ø20 no topo, 5 mm); Furo
// assistido na face de cima.
//   pnpm dev --port 5199 e depois: node scripts/roteiro-desempenho.cjs
//   FOLGA=2 multiplica os limites (máquina lenta/CI); LENTO=4 freia a CPU da página 4× (perto do tablet).
const { chromium } = require("playwright");
const URL = process.env.URL_WJCAD ?? "http://localhost:5199/cad/";
const FOLGA = Number(process.env.FOLGA ?? 1);
const LENTO = Number(process.env.LENTO ?? 1);
const LIM_OK = 500 * FOLGA, LIM_TOQUE = 300 * FOLGA, LIM_VERMELHO = 500 * FOLGA;
let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` (${extra})` : ""}`);
};
const tabela = [];

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const errosJs = [];
  p.on("pageerror", (e) => errosJs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.addInitScript(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.setItem("wjpdm:semAvisoConexoes", "1");
    // programas de shader compilados (cada um custa 50–300 ms numa GPU de tablet)
    window.__programas = 0;
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
      const lp = C.prototype.linkProgram;
      C.prototype.linkProgram = function (...a) {
        window.__programas++;
        return lp.apply(this, a);
      };
    }
  });
  await p.goto(URL);
  await p.waitForTimeout(2500);
  if (LENTO > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: LENTO });

  /** Espera o kernel e a tela sossegarem (nada em voo e 250 ms sem marca nova). */
  const sossegar = async () => {
    let ultima = -1, parado = 0;
    for (let i = 0; i < 400 && parado < 5; i++) {
      await p.waitForTimeout(50);
      const s = await p.evaluate(() => ({ n: performance.getEntriesByType("mark").length, ocupado: window.__cad.kernel().ocupado }));
      parado = !s.ocupado && s.n === ultima ? parado + 1 : 0;
      ultima = s.n;
    }
  };
  const agora = () => p.evaluate(() => performance.now());
  const contagem = () => p.evaluate(() => window.__cad.kernel().contagem);
  const programas = () => p.evaluate(() => window.__programas);
  /**
   * Mede uma ação a partir da marca `inicio` (toque ou cmd:ok): até a última peça desenhada; também o
   * envio ao worker, a volta, o kernel e o salvamento automático no meio.
   */
  const medir = async (nome, inicio, acao, limite) => {
    const t0 = await agora();
    const c0 = await contagem(), g0 = await programas();
    await acao();
    await sossegar();
    const r = await p.evaluate(([t0, inicio]) => {
      const ms = performance.getEntriesByType("mark").filter((m) => m.startTime >= t0);
      const ini = ms.find((m) => m.name === inicio)?.startTime;
      const de = (n) => ms.filter((m) => m.name === n && m.startTime >= ini).map((m) => m.startTime - ini);
      const salvar = ms.filter((m) => m.name === "salvar:ini" && m.startTime >= ini).reduce((s, m) => {
        const fim = ms.find((x) => x.name === "salvar:fim" && x.startTime >= m.startTime);
        return s + (fim ? fim.startTime - m.startTime : 0);
      }, 0);
      const k = window.__cad.kernel();
      return { achou: ini !== undefined, envio: de("kernel:envio"), volta: de("kernel:volta"), aplicado: de("kernel:aplicado"), tela: de("peca:tela"), vermelho: de("previa:tela"), salvar, kernelMs: k.ms, etapas: k.etapas };
    }, [t0, inicio]);
    const c1 = await contagem(), g1 = await programas();
    const total = r.tela.length ? r.tela[r.tela.length - 1] : NaN;
    const linha = {
      nome, total, vermelho: r.vermelho[r.vermelho.length - 1], envio: r.envio[0], volta: r.volta[r.volta.length - 1], aplicado: r.aplicado[r.aplicado.length - 1], kernel: r.kernelMs,
      etapas: r.etapas, salvar: r.salvar, enviadas: c1.enviadas - c0.enviadas, reaproveitadas: c1.reaproveitadas - c0.reaproveitadas,
      descartadas: c1.descartadas - c0.descartadas, programas: g1 - g0,
    };
    tabela.push(linha);
    if (limite) ok(`${nome}: ${total.toFixed(0)} ms ≤ ${limite} ms`, r.achou && total <= limite, JSON.stringify({ envio: linha.envio?.toFixed(0), volta: linha.volta?.toFixed(0), kernel: linha.kernel?.toFixed(0), prog: linha.programas }));
    return linha;
  };

  let cv;
  const tela = async (q) => {
    cv = await p.locator("#viewport canvas").first().boundingBox();
    const t = await p.evaluate((x) => window.__cad.viewport.mundoParaTela(x), q);
    return [cv.x + t.x, cv.y + t.y];
  };
  /** O que está visível no ponto 3D (face/aresta/vértice) pelo picador da vista. */
  const visivel = async (q) => {
    const [x, y] = await tela(q);
    return p.evaluate(([x, y]) => window.__cad.viewport.picarEntidade(x, y, new Set(["face", "aresta", "vertice"]), 10), [x, y]);
  };
  /** Gira a vista com um dedo (arrasto horizontal). */
  const girar = async (dx) => {
    const [x, y] = [cv.x + cv.width * 0.75, cv.y + cv.height * 0.75];
    const t = (type, px) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y, id: 1 }] });
    await t("touchStart", x);
    for (let i = 1; i <= 12; i++) await t("touchMove", x + (dx * i) / 12);
    await t("touchEnd", x + dx);
    await p.waitForTimeout(500);
  };
  const tap = async (q) => {
    const [x, y] = await tela(q);
    await p.touchscreen.tap(x, y);
  };
  const abrir = async (item) => {
    await p.locator("#abas button", { hasText: "Features" }).first().tap();
    const direto = p.locator(`#faixa-comandos button:not(.cmd-seta)[title^="${item}"], #faixa-comandos button:has(span:text-is("${item}"))`).first();
    if (await direto.count()) await direto.tap();
    else {
      for (const seta of await p.locator("#faixa-comandos button.cmd-seta").all()) {
        await seta.tap();
        const it = p.locator(".popover button", { hasText: item }).first();
        if (await it.count()) {
          await it.tap();
          break;
        }
        await p.keyboard.press("Escape");
      }
    }
    await sossegar();
  };
  const campo = async (rot, v) => {
    const i = p.locator("#painel-comando .campo", { hasText: rot }).locator("input").first();
    await i.fill(String(v));
    await i.press("Enter");
    await sossegar();
  };
  const confirmar = (nome) => medir(`${nome}: ✓ → peça na tela`, "cmd:ok", () => p.locator("#painel-comando .pc-ok").first().tap(), LIM_OK);
  const toque = async (nome, q) => {
    const l = await medir(`${nome}: toque → prévia na tela`, "toque", () => tap(q), LIM_TOQUE);
    if (l.vermelho !== undefined) ok(`${nome}: material removido (vermelho) na tela ${l.vermelho.toFixed(0)} ms ≤ ${LIM_VERMELHO} ms`, l.vermelho <= LIM_VERMELHO);
    return l;
  };
  const volume = () => p.evaluate(() => {
    const m = document.getElementById("st-volume").textContent.match(/([\d.,]+)/);
    return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : NaN;
  });
  const ultimo = (tipo) => p.evaluate((t) => JSON.parse(JSON.stringify(window.__cad.doc().features.filter((f) => f.tipo === t).pop() ?? null)), tipo);
  const comErro = () => p.evaluate(() => [...document.querySelectorAll("#arvore li.com-erro")].map((li) => li.textContent));
  /** Documento novo: só o esboço 60×60 no Plano Superior, ou já com a extrusão de 12,5 mm. */
  const abrirCaixa = async (comExtrusao) => {
    await p.evaluate(async (comExtrusao) => {
      const m = await import("/src/model.ts");
      const op = await import("/src/esboco/operacoes.ts");
      const base = m.novoEsboco(1, { tipo: "plano", plano: "XZ", deslocamento: 0 });
      op.retangulo(base, op.ponto(base, { x: -30, y: -30 }), op.ponto(base, { x: 30, y: 30 }));
      const feats = [base];
      if (comExtrusao) feats.push({ ...m.novaFeature("extrusao", 1), esboco: base.id, profundidade: 12.5 });
      window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Caixa 60x60", features: feats });
    }, comExtrusao);
    await sossegar();
    await p.evaluate(() => window.__cad.viewport.definirVista("iso", false));
    await p.waitForTimeout(400);
  };
  const ALTURA = 12.5, VOL_CAIXA = (60 * 60 * ALTURA) / 1000;

  // ---------- 1. Caso do Johann: Extrusão 12,5 e Filete R6 nas 4 arestas verticais ----------
  await abrirCaixa(false);
  await p.locator("#arvore li", { hasText: "Esboço1" }).first().tap();
  await abrir("Extrusão");
  if (process.env.CAPTURA) await p.screenshot({ path: process.env.CAPTURA });
  await campo("Profundidade", ALTURA);
  await confirmar("Extrusão 12,5");
  ok("extrusão: volume 45 cm³", Math.abs((await volume()) - VOL_CAIXA) < 0.01, `${await volume()}`);

  await abrir("Filete");
  await campo("Raio", 6);
  const verticais = [[30, ALTURA / 2, 30], [30, ALTURA / 2, -30], [-30, ALTURA / 2, 30], [-30, ALTURA / 2, -30]];
  for (const [i, a] of verticais.entries()) {
    if ((await visivel(a))?.tipo !== "aresta") await girar(-260); // aresta de trás: o dedo gira a vista
    await toque(`Filete R6, aresta vertical ${i + 1}`, a);
  }
  const fil = await ultimo("filete");
  ok("filete: as 4 arestas verticais na caixa", fil?.itens?.length === 4 && fil.itens.every((r) => r.tipo === "aresta"), JSON.stringify(fil?.itens?.map((r) => r.tipo)));
  const conf = await confirmar("Filete R6 (verticais)");
  const volFil = VOL_CAIXA - (4 * (36 - 9 * Math.PI) * ALTURA) / 1000;
  ok("filete R6: volume = caixa − 4 cantos", Math.abs((await volume()) - volFil) < 0.01, `${await volume()} × ${volFil.toFixed(2)}`);
  ok("✓ do filete reaproveita a prévia (nenhuma reconstrução nova)", conf.enviadas === 0 && conf.reaproveitadas === 1, `enviadas ${conf.enviadas}, reaproveitadas ${conf.reaproveitadas}`);
  ok("sem recurso com erro", !(await comErro()).length, (await comErro()).join(" | "));

  // ---------- 2. Filete R6 nas 4 bordas de cima ----------
  await abrirCaixa(true);
  await abrir("Filete");
  await campo("Raio", 6);
  const topo = [[0, ALTURA, 30], [30, ALTURA, 0], [0, ALTURA, -30], [-30, ALTURA, 0]];
  for (const [i, a] of topo.entries()) {
    if ((await visivel(a))?.tipo !== "aresta") await girar(-260);
    await toque(`Filete R6, borda de cima ${i + 1}`, a);
  }
  ok("filete: as 4 bordas de cima na caixa", (await ultimo("filete"))?.itens?.length === 4);
  const conf2 = await confirmar("Filete R6 (bordas de cima)");
  ok("✓ reaproveita a prévia (bordas de cima)", conf2.enviadas === 0, `enviadas ${conf2.enviadas}`);
  ok("filete nas bordas: volume menor que a caixa", (await volume()) < VOL_CAIXA - 0.1, `${await volume()}`);

  // ---------- 3. Chanfro 1 mm nas 4 bordas de cima ----------
  await abrirCaixa(true);
  await abrir("Chanfro");
  await campo("Distância", 1);
  for (const [i, a] of topo.entries()) {
    if ((await visivel(a))?.tipo !== "aresta") await girar(-260);
    await toque(`Chanfro 1, borda de cima ${i + 1}`, a);
  }
  const conf3 = await confirmar("Chanfro 1 (bordas de cima)");
  ok("✓ do chanfro reaproveita a prévia", conf3.enviadas === 0, `enviadas ${conf3.enviadas}`);
  ok("chanfro: volume = caixa − 4 × 0,5 × 1² × 60", Math.abs((await volume()) - (VOL_CAIXA - (4 * 0.5 * 60) / 1000)) < 0.01, `${await volume()}`);

  // ---------- 4. Corte extrudado: círculo Ø20 no topo, 5 mm ----------
  await abrirCaixa(true);
  await p.evaluate(async () => {
    const m = await import("/src/model.ts");
    const op = await import("/src/esboco/operacoes.ts");
    const d = window.__cad.doc();
    const e = m.novoEsboco(2, { tipo: "plano", plano: "XZ", deslocamento: 12.5 });
    op.circulo(e, op.ponto(e, { x: 0, y: 0 }), 10);
    window.__cad.abrir({ ...JSON.parse(JSON.stringify(d)), features: [...d.features, e] });
  });
  await sossegar();
  await p.locator("#arvore li", { hasText: "Esboço2" }).first().tap();
  await abrir("Corte extrudado");
  await campo("Profundidade", 5);
  await confirmar("Corte extrudado Ø20 × 5");
  ok("corte: volume = caixa − π·10²·5", Math.abs((await volume()) - (VOL_CAIXA - (Math.PI * 100 * 5) / 1000)) < 0.01, `${await volume()}`);

  // ---------- 5. Furo assistido na face de cima ----------
  await abrirCaixa(true);
  await abrir("Furo assistido");
  await tap([10, ALTURA, 10]);
  await sossegar();
  const furo = await ultimo("furo");
  ok("furo: painel aberto pelo toque na face de cima", !!furo);
  if (furo) {
    await confirmar("Furo assistido");
    ok("furo: volume menor que a caixa", (await volume()) < VOL_CAIXA - 0.01, `${await volume()}`);
  }

  ok("sem erro de JavaScript", !errosJs.length, errosJs.join(" | "));
  console.log(`\nTabela (ms; CPU ${LENTO}×, limites ×${FOLGA})`);
  console.log("| Ação | total | vermelho | envio | volta | kernel (recursos/prévia/malha/topologia) | salvar | ao worker | reaproveitada | descartada | shaders |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  const f = (x) => (x === undefined || Number.isNaN(x) ? "—" : x.toFixed(0));
  for (const l of tabela) {
    const e = l.etapas;
    const k = l.enviadas ? `${f(l.kernel)} (${e ? [e.recursos, e.previa, e.malha, e.topologia].map(f).join("/") : "—"})` : "—";
    console.log(`| ${l.nome} | ${f(l.total)} | ${f(l.vermelho)} | ${f(l.envio)} | ${f(l.volta)} | ${k} | ${f(l.salvar)} | ${l.enviadas} | ${l.reaproveitadas} | ${l.descartadas} | ${l.programas} |`);
  }
  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo");
  process.exit(falhas ? 1 : 0);
})();

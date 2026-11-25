// Roteiro de interface: gerador de engrenagens (C3, 25/11/2026), tablet simulado (1280×800, toque).
// Montagem vazia do cofre → Biblioteca de componentes → aba Engrenagens: valores calculados mudam com os
// campos (Ø primitivo, externo, raiz), erro claro de entrada, par reto 24/36 (distância 60, razão 1,5) inserido
// engrenado e travado, peças em CAD › Biblioteca › Engrenagens e reaproveitadas, helicoidal à esquerda inserida
// solta e engrenada com "Engrenar as 2 selecionadas" (com uma à direita), e a peça aberta na Peça com o recurso
// Engrenagem editável (duplo toque → painel, 24 → 30 dentes muda o volume). Uso: pnpm dev --port 5199 e depois
//   node scripts/roteiro-engrenagens.cjs
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
    const { montagemVazia } = await import("/src/montagem/modelo.ts");
    const db = await Armazem.abrir();
    const t = new Date().toISOString();
    await db.porBlob("b-conj", new Blob([JSON.stringify(montagemVazia("Redutor"))]));
    await db.por("arquivos", { id: "conj", nome: "Redutor.wjasm", pasta: "raiz", revisao: "", estado: "trabalho", cartao: {}, mod: t, historico: [], checkout: { usuario: "Usuário", data: t },
      versoes: [{ n: 1, blob: "b-conj", tamanho: 10, autor: "Usuário", data: t, comentario: "Criado no WJCAD", revisao: "", estado: "trabalho" }] });
    const cofre = await import("/src/comum/cofre.ts");
    await cofre.abrirArquivoNoApp(await db.ler("arquivos", "conj"), db);
  });
  await p.waitForTimeout(4000);

  const painel = () => p.evaluate(() => document.querySelector("#painel-comando")?.textContent ?? "");
  const valor = async (rotulo) => p.evaluate((r) => {
    for (const dt of document.querySelectorAll("#painel-comando .eng-valores dt")) if (dt.textContent === r) return dt.nextElementSibling?.textContent ?? "";
    return "";
  }, rotulo);
  const campo = (rotulo) => p.locator("#painel-comando label.campo", { hasText: rotulo }).locator("input").first();
  const digitar = async (rotulo, v) => {
    const c = campo(rotulo);
    await c.tap();
    await c.fill(String(v));
    await c.press("Enter").catch(() => {});
    await c.evaluate((e) => e.dispatchEvent(new Event("change", { bubbles: true })));
    await p.waitForTimeout(200);
  };

  // 1) aba Engrenagens e valores calculados
  await p.locator("button.cmd", { hasText: "Biblioteca de componentes" }).first().tap();
  await p.waitForSelector(".bib-abas", { timeout: 5000 });
  await p.locator(".bib-abas button", { hasText: "Engrenagens" }).tap();
  await p.waitForSelector("#painel-comando .eng-valores", { timeout: 5000 });
  conferir(/Tipo de engrenagem/.test(await painel()), "aba Engrenagens aberta com o tipo, os dentes e os valores calculados");
  const tipos = await p.locator("#painel-comando label.campo", { hasText: "Tipo de engrenagem" }).locator("option").allTextContents();
  conferir(tipos.length === 7 && tipos.includes("Cremalheira") && tipos.includes("Sem-fim") && tipos.some((x) => /Interna/.test(x)), `7 tipos: ${tipos.join(", ")}`);
  await p.locator("#painel-comando label.campo", { hasText: "Tipo de engrenagem" }).locator("select").selectOption("reta");
  await digitar("Módulo m", 2.5);
  await digitar("Nº de dentes z", 24);
  conferir((await valor("Diâmetro primitivo d")) === "60 mm", `d = 60 com m2,5 z24: ${await valor("Diâmetro primitivo d")}`);
  conferir((await valor("Diâmetro externo da")) === "65 mm" && (await valor("Diâmetro de raiz df")) === "53,75 mm", `da = 65 e df = 53,75: ${await valor("Diâmetro externo da")} / ${await valor("Diâmetro de raiz df")}`);
  conferir((await valor("Espessura do dente no primitivo")) === "3,927 mm", `espessura no primitivo = π·m/2 = 3,927: ${await valor("Espessura do dente no primitivo")}`);
  await digitar("Deslocamento de perfil x", 1.4);
  conferir(/pontudo/.test(await p.locator("#painel-comando .eng-erro").first().textContent().catch(() => "")), "deslocamento exagerado mostra o erro claro (dente pontudo)");
  await digitar("Deslocamento de perfil x", 0);

  // 2) par reto 24/36
  await digitar("Dentes da 2ª engrenagem", 36);
  conferir((await valor("Distância entre centros")) === "75 mm" && (await valor("Razão i = n1/n2")) === "1,5", `par 24/36 m2,5: a = 75, i = 1,5: ${await valor("Distância entre centros")} / ${await valor("Razão i = n1/n2")}`);
  await p.locator("#painel-comando button", { hasText: "Inserir o par engrenado" }).tap();
  await p.waitForFunction(() => /Engrenamento1/.test(document.querySelector("#arvore")?.textContent ?? "") && /z36/.test(document.querySelector("#arvore")?.textContent ?? ""), null, { timeout: 60000 });
  const arv = await p.locator("#arvore").textContent();
  conferir(/Engrenagem reta m2,5 z24 b20<1>/.test(arv) && /Engrenagem reta m2,5 z36 b20<1>/.test(arv), "par inserido: Engrenagem reta m2,5 z24 e z36");
  const dist = await p.evaluate(() => {
    const d = window.__asm.doc();
    const [a, c] = d.componentes;
    return Math.hypot(a.t.pos[0] - c.t.pos[0], a.t.pos[1] - c.t.pos[1], a.t.pos[2] - c.t.pos[2]);
  });
  conferir(Math.abs(dist - 75) < 1e-6, `centros a 75 mm na montagem: ${dist}`);
  conferir(!/\(\+\)/.test(arv) && (await p.evaluate(() => window.__asm.solucao()?.erros.size ?? 0)) === 0, "posicionamento Travar resolvido, sem erro");
  const cofre = async () => p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const db = await Armazem.abrir();
    const pastas = await db.todos("pastas");
    const bib = pastas.find((x) => x.nome === "Biblioteca");
    const eng = pastas.find((x) => x.nome === "Engrenagens" && x.pai === bib?.id);
    return (await db.todos("arquivos")).filter((a) => a.pasta === eng?.id && !a.lixeira).map((a) => a.nome).sort();
  });
  conferir(JSON.stringify(await cofre()) === JSON.stringify(["Engrenagem reta m2,5 z24 b20.wjcad", "Engrenagem reta m2,5 z36 b20.wjcad"]), `peças em CAD › Biblioteca › Engrenagens: ${(await cofre()).join(", ")}`);

  // 3) helicoidal: inserir duas soltas (uma à direita, outra à esquerda) e engrenar as selecionadas
  await p.locator("#painel-comando label.campo", { hasText: "Tipo de engrenagem" }).locator("select").selectOption("helicoidal");
  await p.waitForTimeout(300);
  conferir((await valor("Ângulo de pressão transversal αt")) !== "", `helicoidal mostra mt e αt (β = ${await campo("Ângulo de hélice β").inputValue()}°)`);
  await digitar("Nº de dentes z", 18);
  await p.locator("#painel-comando button", { hasText: "Inserir engrenagem" }).tap();
  await p.waitForFunction(() => /helicoidal m2,5 z18 b20 β15 dir<1>/.test(document.querySelector("#arvore")?.textContent ?? ""), null, { timeout: 60000 });
  await p.locator("#painel-comando label.campo", { hasText: "Sentido" }).locator("select").selectOption("esquerda");
  await digitar("Nº de dentes z", 29);
  await p.locator("#painel-comando button", { hasText: "Inserir engrenagem" }).tap();
  await p.waitForFunction(() => /helicoidal m2,5 z29 b20 β15 esq<1>/.test(document.querySelector("#arvore")?.textContent ?? ""), null, { timeout: 60000 });
  conferir(true, "helicoidais z18 (direita) e z29 (esquerda) inseridas soltas");
  await p.evaluate(() => {
    const d = window.__asm.doc();
    window.__asm.selecionar(d.componentes.slice(-2).map((c) => c.id));
  });
  await p.locator("#painel-comando button", { hasText: "Engrenar as 2 selecionadas" }).tap();
  await p.waitForTimeout(800);
  const d2 = await p.evaluate(() => {
    const d = window.__asm.doc();
    const [a, c] = d.componentes.slice(-2);
    return { dist: Math.hypot(a.t.pos[0] - c.t.pos[0], a.t.pos[1] - c.t.pos[1], a.t.pos[2] - c.t.pos[2]), travas: d.posicionamentos.filter((m) => m.tipo === "travar").length };
  });
  const esperado = (47 * 2.5) / Math.cos((15 * Math.PI) / 180) / 2;
  conferir(Math.abs(d2.dist - esperado) < 1e-6 && d2.travas === 2, `helicoidais engrenadas a ${d2.dist.toFixed(3)} mm (esperado ${esperado.toFixed(3)}) e travadas`);
  await p.screenshot({ path: process.env.SAIDA ?? "/tmp/claude-0/engrenagens-montagem.png" });

  // 4) erro de par: duas à direita
  await p.locator("#painel-comando label.campo", { hasText: "Sentido" }).locator("select").selectOption("direita");
  await p.evaluate(() => {
    const d = window.__asm.doc();
    window.__asm.selecionar([d.componentes[2].id, d.componentes[2].id]);
  });
  conferir(/2ª engrenagem/.test(await painel()), "caixa Par mostra a 2ª engrenagem sugerida (hélice oposta)");

  // 5) a peça na Peça: recurso Engrenagem editável (duplo toque abre o painel)
  const docEng = await p.evaluate(() => window.__asm.doc().pecas.find((x) => /z24/.test(x.nome)).doc);
  const peca = await ctx.newPage();
  peca.on("pageerror", (e) => console.log("erro na Peça:", e.message));
  await peca.goto(BASE + "cad/");
  await peca.waitForTimeout(1500);
  await peca.evaluate((d) => window.__cad.abrir(d), docEng);
  const volume = async () => {
    const t = await peca.locator("footer").last().innerText();
    const m = t.match(/Volume: ([\d.,]+)/);
    return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : NaN;
  };
  await peca.waitForFunction(() => /Volume: \d/.test(document.querySelector("footer:last-of-type")?.textContent ?? document.body.textContent ?? ""), null, { timeout: 60000 }).catch(() => {});
  await peca.waitForTimeout(2000);
  const v1 = await volume();
  const item = peca.locator("#arvore li", { hasText: "Engrenagem reta" }).last();
  await item.tap();
  await peca.waitForTimeout(150);
  await item.tap();
  await peca.waitForSelector("#painel-comando .eng-valores", { timeout: 8000 }).catch(() => {});
  const txt = await peca.evaluate(() => document.querySelector("#painel-comando")?.textContent ?? "");
  conferir(/Engrenagem/.test(txt) && /Módulo m/.test(txt) && /Valores calculados/.test(txt), "duplo toque no recurso abre o painel Engrenagem com os valores");
  const dentes = peca.locator("#painel-comando label.campo", { hasText: "Nº de dentes z" }).locator("input").first();
  await dentes.tap();
  await dentes.fill("30");
  await dentes.evaluate((e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await peca.waitForTimeout(500);
  await peca.locator("#painel-comando .pc-ok").tap();
  await peca.waitForTimeout(6000);
  const doc2 = await peca.evaluate(() => window.__cad.doc().features[0].dentes);
  const v2 = await volume();
  // volume (cm³) cresce na proporção da área do perfil: z24 → z30 com m2,5 e b20 ≈ (30/24)² do disco
  conferir(doc2 === 30 && v2 > v1 * 1.4 && v2 < v1 * 1.65, `recurso editado: 24 → ${doc2} dentes; volume ${v1} → ${v2} cm³`);
  await peca.screenshot({ path: process.env.SAIDA_PECA ?? "/tmp/claude-0/engrenagens-peca.png" });

  await b.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : "\nTudo certo.");
  process.exit(falhas.length ? 1 : 0);
})();

// Roteiro de interface: mudanças feitas FORA do app no Google Drive (12/11/2026) e reorganização pelo
// WJPDM. Drive simulado (API REST v3 com o escopo drive.file: o que o Johann cria à mão no Drive é
// invisível para o app). O Johann renomeia a pasta CAD à mão, move o Mancal para Projetos e põe a Tampa
// numa pasta criada à mão; a janela "Mudanças feitas fora do app" abre sozinha no WJPDM; ele escolhe
// Trazer (pasta), Desfazer (Mancal) e Levar para Projetos (Tampa). Depois: mover pasta inteira e
// mover vários arquivos marcados. Tablet simulado (toque, 1280×800).
// Uso: pnpm dev --port 5199 e depois  node scripts/roteiro-mudancas-fora.cjs [pasta-das-capturas]
const { chromium } = require("playwright");
const BASE = process.env.URL_BASE ?? "http://localhost:5199/";
const CAPTURAS = process.argv[2];
const falhas = [];
const conferir = (ok, texto) => {
  console.log(`${ok ? "✓" : "✗"} ${texto}`);
  if (!ok) falhas.push(texto);
};

// ---------- Drive simulado ----------
const PASTA = "application/vnd.google-apps.folder";
const itens = new Map();
let n = 0;
const apagados = [];
const meta = (x) => ({ id: x.id, name: x.name, parents: x.parents, mimeType: x.mimeType, modifiedTime: x.mod, trashed: !!x.lixo });
const visivel = (x) => !!x && !x.mao;
const naLixeira = (x) => {
  for (let p = x; p; p = itens.get(p.parents[0])) if (p.lixo) return true;
  return false;
};
const caminho = (x) => {
  const c = [x.name];
  for (let p = itens.get(x.parents[0]); p; p = itens.get(p.parents[0])) c.unshift(p.name);
  return c.join("/");
};
const arquivos = () => [...itens.values()].filter((x) => x.mimeType !== PASTA && !naLixeira(x)).map(caminho).filter((c) => !c.includes(".wjpdm") && !c.includes("versões")).sort();
const pastaEm = (c) => [...itens.values()].find((x) => x.mimeType === PASTA && !naLixeira(x) && caminho(x) === c);
const arquivoEm = (c) => [...itens.values()].find((x) => x.mimeType !== PASTA && !naLixeira(x) && caminho(x) === c);
const json = (r, corpo, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(corpo) });

async function responder(r) {
  const req = r.request();
  const u = new URL(req.url());
  const m = req.method();
  if (!u.hostname.endsWith("googleapis.com")) return r.fulfill({ status: 404, body: "" });
  const id = u.pathname.match(/\/files\/([^/]+)$/)?.[1];
  const agora = new Date().toISOString();
  if (m === "GET" && !id) {
    const q = u.searchParams.get("q");
    const nome = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
    const pais = [...q.matchAll(/'([^']+)' in parents/g)].map((x) => x[1]).map((p) => (p === "root" ? "root" : p));
    const soPasta = q.includes(`mimeType='${PASTA}'`);
    const files = [...itens.values()].filter((x) => visivel(x) && !x.lixo && x.parents.some((p) => pais.includes(p)) && (nome === undefined || x.name === nome) && (!soPasta || x.mimeType === PASTA)).map(meta);
    return json(r, { files });
  }
  if (m === "GET" && id) {
    const x = itens.get(id);
    if (!visivel(x)) return r.fulfill({ status: 404, body: "nf" });
    return u.searchParams.get("alt") === "media" ? r.fulfill({ status: 200, body: x.dados }) : json(r, meta(x));
  }
  if (m === "POST" && u.pathname === "/drive/v3/files") {
    const b = JSON.parse(req.postData());
    if (b.parents.some((p) => itens.get(p)?.mao)) return r.fulfill({ status: 404, body: "nf" });
    const x = { id: `d${++n}`, name: b.name, parents: b.parents, mimeType: b.mimeType, dados: "", mod: agora };
    itens.set(x.id, x);
    return json(r, { id: x.id });
  }
  if (m === "POST" && u.pathname === "/upload/drive/v3/files") {
    const fronteira = /boundary=(\S+)/.exec(req.headers()["content-type"])[1];
    const corpo = req.postDataBuffer().toString("latin1");
    const partes = corpo.split(`--${fronteira}`).slice(1, -1).map((p) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""));
    const b = JSON.parse(Buffer.from(partes[0], "latin1").toString("utf8"));
    const x = { id: `d${++n}`, name: b.name, parents: b.parents, mimeType: "file", dados: Buffer.from(partes[1], "latin1"), mod: agora };
    itens.set(x.id, x);
    return json(r, { id: x.id });
  }
  if (m === "PATCH" && id) {
    const x = itens.get(id);
    if (!visivel(x)) return r.fulfill({ status: 404, body: "nf" });
    if ((req.headers()["content-type"] ?? "").includes("application/json")) {
      const b = JSON.parse(req.postData());
      const add = u.searchParams.get("addParents"), rem = u.searchParams.get("removeParents");
      if (add && itens.get(add)?.mao) return r.fulfill({ status: 404, body: "sem acesso" });
      if (b.trashed) x.lixo = true;
      if (b.name) x.name = b.name;
      if (rem) x.parents = x.parents.filter((p) => !rem.split(",").includes(p));
      if (add) x.parents = [...new Set([...x.parents, add])];
      return json(r, { id });
    }
    x.dados = req.postDataBuffer();
    x.mod = agora;
    return json(r, { id });
  }
  if (m === "DELETE" && id) {
    apagados.push(itens.get(id)?.name ?? id);
    itens.delete(id);
    return r.fulfill({ status: 204, body: "" });
  }
  return r.fulfill({ status: 400, body: "?" });
}

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: CAPTURAS ? 2 : 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    localStorage.setItem("wjgoogle:autorizado", "1");
    localStorage.setItem("wjgoogle:acesso", JSON.stringify({ token: "ok", expira: Date.now() + 3600000 }));
  });
  await ctx.route(/googleapis\.com|accounts\.google\.com/, responder);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("erro na página:", e.message));
  p.on("dialog", (d) => d.accept());

  // 1) cofre com CAD (Eixo, Mancal, Sub/Tampa) e Projetos; a sincronia ao abrir monta Meu Drive/WJPDM
  await p.goto(BASE + "pdm/");
  await p.waitForTimeout(800);
  await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const db = await Armazem.abrir();
    const t = new Date().toISOString();
    await db.por("meta", { id: "meta", nome: "Cofre", usuario: "Johann", mascara: "12-####", mod: t });
    for (const [id, nome, pai] of [["p1", "CAD", null], ["p2", "Projetos", null], ["p3", "Sub", "p1"]]) await db.por("pastas", { id, nome, pai, mod: t });
    for (const [id, nome, pasta] of [["a1", "Eixo.wjcad", "p1"], ["a2", "Mancal.wjcad", "p1"], ["a3", "Tampa.wjcad", "p3"], ["a4", "Pino.wjcad", "p2"], ["a5", "Bucha.wjcad", "p2"]]) {
      await db.porBlob(`b-${id}`, new Blob([`conteúdo de ${nome}`]));
      await db.por("arquivos", { id, nome, pasta, revisao: "", estado: "trabalho", cartao: {}, mod: t, historico: [],
        versoes: [{ n: 1, blob: `b-${id}`, tamanho: 20, autor: "Johann", data: t, comentario: "", revisao: "", estado: "trabalho" }] });
    }
  });
  await p.reload();
  // espera a sincronia terminar (pastas.json é a última coisa gravada no espelho)
  for (let k = 0; k < 80 && !arquivoEm("WJPDM/.wjpdm/pastas.json"); k++) await p.waitForTimeout(250);
  await p.waitForTimeout(1500);
  conferir(!!arquivoEm("WJPDM/CAD/Mancal.wjcad") && !!arquivoEm("WJPDM/CAD/Sub/Tampa.wjcad"), "a sincronia ao abrir montou Meu Drive/WJPDM");

  // 2) o Johann mexe direto no Drive
  pastaEm("WJPDM/CAD").name = "CAD 2026";
  arquivoEm("WJPDM/CAD 2026/Mancal.wjcad").parents = [pastaEm("WJPDM/Projetos").id];
  const mao = { id: `m${++n}`, name: "Arquivo morto", parents: [pastaEm("WJPDM").id], mimeType: PASTA, mao: true, mod: new Date().toISOString() };
  itens.set(mao.id, mao);
  arquivoEm("WJPDM/CAD 2026/Sub/Tampa.wjcad").parents = [mao.id];
  const nAntes = n;

  // 3) abrir o WJPDM de novo: a janela abre sozinha com as três mudanças, e nada mudou ainda
  await p.reload();
  const abriu = await p.waitForSelector(".wjc-fora li", { timeout: 15000 }).then(() => true, () => false);
  if (process.env.DEPURAR) {
    console.log("DRIVE", [...itens.values()].filter((x) => !naLixeira(x)).map((x) => `${x.id}:${caminho(x)}${x.mao ? "(mão)" : ""}`).join(" | "));
    console.log("FAIXA", await p.locator(".wjc-faixa").innerText().catch(() => "-"));
    console.log("FORA", JSON.stringify(await p.evaluate(async () => (await import("/src/comum/cofre.ts")).mudancasForaDoApp())));
  }
  conferir(abriu, "a janela \"Mudanças feitas fora do app\" abre sozinha no WJPDM");
  const linhas = await p.$$eval(".wjc-fora li", (ls) => ls.map((l) => l.querySelector(".wjc-fora-txt").innerText.replace(/\s+/g, " ").trim()));
  console.log("  " + linhas.join("\n  "));
  conferir(linhas.length === 3, "três mudanças: pasta renomeada, arquivo movido, arquivo numa pasta criada à mão");
  conferir(linhas.some((l) => /Pasta renomeada no Drive.*de CAD para CAD 2026/.test(l)), "pasta renomeada: de CAD para CAD 2026");
  conferir(linhas.some((l) => /Mancal.*movido no Drive.*de CAD\/Mancal\.wjcad para Projetos\/Mancal\.wjcad/.test(l)), "arquivo movido: de → para");
  conferir(linhas.some((l) => /Tampa.*pasta criada fora do app/.test(l)), "pasta criada à mão: explica que o Google não mostra o nome");
  conferir(n === nAntes && !pastaEm("WJPDM/CAD"), "nada muda sozinho no Drive (sem pasta CAD recriada)");
  if (CAPTURAS) await p.screenshot({ path: `${CAPTURAS}/mudancas-fora.png` });

  // 4) escolhas por item, com toque: Trazer (pasta), Desfazer (Mancal), Levar para Projetos (Tampa)
  const item = (txt) => p.locator(".wjc-fora li", { hasText: txt });
  await item("CAD 2026").first().locator('[data-a="trazer"]').tap();
  await p.waitForFunction(() => !document.querySelector(".wjc-fora button[disabled]"), null, { timeout: 20000 });
  if (process.env.DEPURAR) console.log("JANELA", (await p.locator(".wjc-fora").innerText()).replace(/\s+/g, " "));
  await item("Mancal").locator('[data-a="desfazer"]').tap();
  await p.waitForFunction(() => !document.querySelector(".wjc-fora button[disabled]"), null, { timeout: 20000 });
  await item("Tampa").locator("[data-destino]").selectOption({ label: /Projetos/ }).catch(async () => {
    const v = await item("Tampa").locator("[data-destino] option", { hasText: "Projetos" }).getAttribute("value");
    await item("Tampa").locator("[data-destino]").selectOption(v);
  });
  await item("Tampa").locator('[data-a="levar"]').tap();
  await p.waitForFunction(() => !document.querySelector(".wjc-fora button[disabled]") && !document.querySelector(".wjc-fora li"), null, { timeout: 20000 }).catch(() => {});
  const restam = await p.locator(".wjc-fora li").count();
  conferir(restam === 0, "depois das três escolhas a lista fica vazia");
  const faixa = await p.locator(".wjc-faixa").innerText().catch(() => "");
  conferir(!/Mudanças fora do app/.test(faixa), "a faixa \"Cofre:\" deixa de mostrar as mudanças resolvidas");
  await p.locator(".wjc-fora [data-depois]").tap().catch(() => {});
  await p.waitForTimeout(800);
  const drive = arquivos();
  console.log("  Drive: " + drive.join(", "));
  conferir(drive.includes("WJPDM/CAD 2026/Mancal.wjcad"), "Desfazer: o Mancal voltou para a pasta do cofre no Drive");
  conferir(drive.includes("WJPDM/Projetos/Tampa.wjcad"), "Levar para Projetos: a Tampa foi para Projetos no Drive");
  conferir(!pastaEm("WJPDM/CAD") && drive.includes("WJPDM/CAD 2026/Eixo.wjcad"), "sem pasta CAD duplicada");
  conferir(!apagados.some((x) => x.endsWith(".wjcad")), "nenhum arquivo visível apagado de vez");
  const est = await p.evaluate(() => window.__pdm.estado());
  const nomeP = (id) => est.pastas.find((x) => x.id === id)?.nome;
  conferir(nomeP("p1") === "CAD 2026", "a pasta foi renomeada no cofre (Trazer)");
  const tampa = est.arquivos.find((a) => a.id === "a3");
  if (process.env.DEPURAR) console.log("TAMPA", tampa.pasta, JSON.stringify(tampa.historico));
  conferir(tampa.pasta === "p2" && /Movido no Drive de CAD( 2026)?\/Sub\/Tampa\.wjcad para uma pasta criada fora do app; levado para Projetos/.test(tampa.historico.at(-1)?.texto ?? ""), "histórico da Tampa diz o que aconteceu");
  conferir(await p.locator(".pd-arvore", { hasText: "CAD 2026" }).count() === 1, "a árvore mostra CAD 2026");

  // 5) mover pasta inteira (pasta selecionada → Mover) — Sub para dentro de Projetos
  await p.locator(`.pd-no[data-pasta="p1"]`).tap();
  await p.waitForTimeout(300);
  await p.locator('tr[data-pasta="p3"]').tap();
  await p.locator('.wj-cmd[title^="Mover o arquivo"]').tap();
  await p.waitForSelector("#mv-p");
  const vMov = await p.locator('#mv-p option', { hasText: "Projetos" }).first().getAttribute("value");
  await p.locator("#mv-p").selectOption(vMov);
  await p.locator(".wj-janela footer button", { hasText: "Mover" }).tap();
  await p.waitForTimeout(500);
  const est2 = await p.evaluate(() => window.__pdm.estado());
  conferir(est2.pastas.find((x) => x.id === "p3")?.pai === "p2", "mover pasta: Sub foi para dentro de Projetos");

  // 6) marcar vários (toque nas caixinhas) e mover de uma vez para CAD 2026
  await p.locator(`.pd-no[data-pasta="p2"]`).tap();
  await p.waitForTimeout(300);
  for (const id of ["a4", "a5"]) await p.locator(`tr[data-arquivo="${id}"] .pd-marca`).tap();
  const barra = await p.locator("#pd-marcados").innerText().catch(() => "");
  conferir(/2 arquivo\(s\) marcado\(s\)/.test(barra), "barra dos marcados: 2 arquivos");
  if (CAPTURAS) await p.screenshot({ path: `${CAPTURAS}/marcados.png` });
  await p.locator('#pd-marcados [data-m="mover"]').tap();
  await p.waitForSelector("#mv-p");
  const vCad = await p.locator('#mv-p option', { hasText: "CAD 2026" }).first().getAttribute("value");
  await p.locator("#mv-p").selectOption(vCad);
  await p.locator(".wj-janela footer button", { hasText: "Mover" }).tap();
  await p.waitForTimeout(500);
  const est3 = await p.evaluate(() => window.__pdm.estado());
  conferir(["a4", "a5"].every((id) => est3.arquivos.find((a) => a.id === id)?.pasta === "p1"), "mover vários: Pino e Bucha foram para CAD 2026");
  conferir(await p.locator("#pd-marcados").count() === 0, "a barra some depois de mover");

  await b.close();
  console.log(falhas.length ? `\n${falhas.length} falha(s)` : "\nroteiro: tudo certo");
  process.exit(falhas.length ? 1 : 0);
})();

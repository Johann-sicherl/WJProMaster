// Roteiro de interface (15/11/2026): Importar pasta, Zerar cofre com dois aparelhos e o login do
// Google com uma renovação só. Drive simulado (API REST v3, escopo drive.file) compartilhado pelos dois
// aparelhos (dois contextos do navegador = dois bancos). Tablet simulado (toque, 1280×800).
// 1) Aparelho A importa a pasta "PDM TEMP" (seletor de pastas simulado): subpastas, nome repetido
//    (Manter os dois), .wjpdm/"(versões)"/desktop.ini ignorados, vídeo como mídia; tudo chega ao Drive.
// 2) Aparelho B abre o WJPDM e recebe o cofre.
// 3) A zera o cofre (confirma digitando ZERAR): Drive vazio (lixeira do Drive), usuário mantido.
// 4) B abre de novo: o banco dele é limpo, com aviso, e nada antigo volta ao Drive.
// 5) Login: duas janelas do mesmo aparelho, acesso vencido; uma abre a janela do Google (sem seletor,
//    com a conta), a outra espera e usa o mesmo token; o registro mostra 1 aberta e 1 evitada.
// Uso: pnpm dev --port 5199 e depois  node scripts/roteiro-zerar-importar.cjs [pasta-das-capturas]
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
const md5 = (d) => require("crypto").createHash("md5").update(d ?? "").digest("hex");
const lixoDe = (x) => {
  for (let p = x; p; p = itens.get(p.parents[0])) if (p.lixo) return p;
  return undefined;
};
// como na API: dentro de uma pasta na lixeira também está na lixeira; arquivos têm md5
const meta = (x) => {
  const l = lixoDe(x);
  return { id: x.id, name: x.name, parents: x.parents, mimeType: x.mimeType, modifiedTime: x.mod, trashed: !!l, ...(l ? { trashedTime: l.lixoEm } : {}), ...(x.mimeType !== PASTA ? { md5Checksum: md5(x.dados) } : {}) };
};
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
  if (u.pathname.endsWith("/about")) return json(r, { user: { emailAddress: "conta@exemplo.com" } });
  const id = u.pathname.match(/\/files\/([^/]+)$/)?.[1];
  const agora = new Date().toISOString();
  if (m === "GET" && !id) {
    const q = u.searchParams.get("q");
    const nome = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
    const pais = [...q.matchAll(/'([^']+)' in parents/g)].map((x) => x[1]).map((p) => (p === "root" ? "root" : p));
    const soPasta = q.includes(`mimeType='${PASTA}'`);
    const files = [...itens.values()].filter((x) => visivel(x) && !lixoDe(x) && (!pais.length || x.parents.some((p) => pais.includes(p))) && (nome === undefined || x.name === nome) && (!soPasta || x.mimeType === PASTA)).map(meta);
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
    return json(r, { id: x.id, md5Checksum: md5(x.dados) });
  }
  if (m === "PATCH" && id) {
    const x = itens.get(id);
    if (!visivel(x)) return r.fulfill({ status: 404, body: "nf" });
    if (!u.pathname.startsWith("/upload/")) {
      const b = JSON.parse(req.postData());
      const add = u.searchParams.get("addParents"), rem = u.searchParams.get("removeParents");
      if (add && itens.get(add)?.mao) return r.fulfill({ status: 404, body: "sem acesso" });
      if (b.trashed) (x.lixo = true), (x.lixoEm = agora);
      if (b.name) x.name = b.name;
      if (rem) x.parents = x.parents.filter((p) => !rem.split(",").includes(p));
      if (add) x.parents = [...new Set([...x.parents, add])];
      return json(r, { id });
    }
    x.dados = req.postDataBuffer();
    x.mod = agora;
    return json(r, { id, md5Checksum: md5(x.dados) });
  }
  if (m === "DELETE" && id) {
    apagados.push(itens.get(id)?.name ?? id);
    itens.delete(id);
    return r.fulfill({ status: 204, body: "" });
  }
  return r.fulfill({ status: 400, body: "?" });
}

// seletor de pastas do navegador simulado: a pasta "PDM TEMP" do computador
const PASTA_ESCOLHIDA = () => {
  const arq = (name, texto, type = "") => ({ kind: "file", name, getFile: async () => new File([texto], name, { type }) });
  const dir = (name, filhos) => ({ kind: "directory", name, async *values() { yield* filhos; } });
  window.showDirectoryPicker = async () =>
    dir("PDM TEMP", [
      dir("CAD", [arq("Eixo.wjcad", "eixo novo"), dir("Sub", [arq("Tampa.wjcad", "tampa")]), dir("Eixo (versões)", [arq("Eixo v1.wjcad", "v1")])]),
      dir("Vídeos", [arq("clipe.mp4", "video", "video/mp4")]),
      dir(".wjpdm", [arq("indice.json", "{}")]),
      arq("desktop.ini", "x"),
    ]);
};
// janela do Google simulada: conta as aberturas (comuns às janelas do aparelho) e responde em 1,5 s
const GOOGLE_FALSO = () => {
  window.google = { accounts: { oauth2: { initTokenClient: (o) => ({ requestAccessToken: (r) => {
    localStorage.setItem("teste:aberturas", String(Number(localStorage.getItem("teste:aberturas") ?? 0) + 1));
    localStorage.setItem("teste:pedido", JSON.stringify({ prompt: r?.prompt, hint: r?.login_hint ?? o.login_hint }));
    setTimeout(() => o.callback({ access_token: "ok", expires_in: 3600 }), 1500);
  } }) } } };
};

async function aparelho(b, nome) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: CAPTURAS ? 2 : 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }));
    if (!localStorage.getItem("wjgoogle:autorizado")) {
      localStorage.setItem("wjgoogle:autorizado", "1");
      localStorage.setItem("wjgoogle:acesso", JSON.stringify({ token: "ok", expira: Date.now() + 3600000 }));
    }
  });
  await ctx.addInitScript(PASTA_ESCOLHIDA);
  await ctx.addInitScript(GOOGLE_FALSO);
  await ctx.route(/googleapis\.com|accounts\.google\.com/, responder);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log(`erro na página (${nome}):`, e.message));
  return { ctx, p };
}
const esperarSincronia = async (p) => {
  await p.waitForTimeout(2500);
  for (let k = 0; k < 40 && /Sincronizando/.test(await p.locator("body").innerText()); k++) await p.waitForTimeout(500);
};
const foto = (p, nome) => CAPTURAS && p.screenshot({ path: `${CAPTURAS}/${nome}.png` });

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const A = await aparelho(b, "A");
  const p = A.p;

  // cofre de A: CAD/Eixo.wjcad (o nome que vai se repetir)
  await p.goto(BASE + "pdm/");
  await p.waitForTimeout(800);
  await p.evaluate(async () => {
    const { Armazem } = await import("/src/comum/armazem.ts");
    const db = await Armazem.abrir();
    const t = new Date().toISOString();
    await db.por("meta", { id: "meta", nome: "Cofre", usuario: "Johann", mascara: "12-####", mod: t });
    await db.por("pastas", { id: "p1", nome: "CAD", pai: null, mod: t });
    await db.porBlob("b1", new Blob(["eixo antigo"]));
    await db.por("arquivos", { id: "a1", nome: "Eixo.wjcad", pasta: "p1", revisao: "", estado: "trabalho", cartao: {}, mod: t, historico: [], versoes: [{ n: 1, blob: "b1", tamanho: 11, autor: "Johann", data: t, comentario: "", revisao: "", estado: "trabalho" }] });
  });
  await p.reload();
  await esperarSincronia(p);
  conferir(arquivos().includes("WJPDM/CAD/Eixo.wjcad"), "A: cofre inicial no Drive");

  // 1) Importar pasta… (na raiz), só o conteúdo de PDM TEMP
  await p.locator(".wj-aba", { hasText: "Cofre" }).first().tap().catch(() => {});
  await p.locator('.wj-cmd[title^="Uma pasta do computador"]').first().tap();
  await p.waitForSelector(".wj-janela", { timeout: 5000 });
  const pre = (await p.locator(".wj-janela .wj-corpo").innerText()).replace(/\s+/g, " ");
  conferir(/3 arquivo\(s\) em 3 subpasta\(s\)/.test(pre) && /3 ignorado/.test(pre), `pré-importação: ${pre.slice(0, 120)}`);
  await foto(p, "01-importar-pasta");
  await p.locator("#ip-raiz").tap();
  await p.locator(".wj-janela footer button", { hasText: "Importar" }).tap();
  await p.waitForSelector(".wjc-pergunta", { timeout: 5000 });
  conferir(/1 arquivo já existe/.test(await p.locator(".wjc-pergunta").innerText()), "nome repetido: uma pergunta só");
  await foto(p, "02-nome-repetido");
  await p.locator('.wjc-pergunta [data-r="manter"]').tap();
  await p.waitForSelector(".wj-janela header span:text('Importação')", { timeout: 15000 });
  const resumo = (await p.locator(".wj-janela .wj-corpo").innerText()).replace(/\s+/g, " ");
  conferir(/3 arquivos, 2 pastas, 3 ignorados/.test(resumo), `resumo: ${resumo.slice(0, 110)}`);
  await foto(p, "03-resumo");
  await p.locator(".wj-janela footer button", { hasText: "Fechar" }).tap();
  await esperarSincronia(p);
  const est = await p.evaluate(() => window.__pdm.estado());
  const nomes = est.arquivos.map((a) => a.nome).sort();
  conferir(JSON.stringify(nomes) === JSON.stringify(["Eixo (2).wjcad", "Eixo.wjcad", "Tampa.wjcad", "clipe.mp4"]), `no cofre: ${nomes.join(", ")}`);
  const clipe = est.arquivos.find((a) => a.nome === "clipe.mp4");
  conferir(clipe?.midia === true && clipe.versoes.length === 1 && !clipe.checkout && !clipe.soLocal, "vídeo entrou como mídia, publicado (v1, sem GO-OUT)");
  conferir(["WJPDM/CAD/Eixo (2).wjcad", "WJPDM/CAD/Sub/Tampa.wjcad", "WJPDM/Vídeos/clipe.mp4"].every((c) => arquivos().includes(c)), "importados chegaram ao Drive");
  conferir(![...itens.values()].some((x) => x.name === "clipe (versões)" && !naLixeira(x)), "mídia sem pasta (versões) no Drive");

  // 2) aparelho B recebe o cofre
  const B = await aparelho(b, "B");
  await B.p.goto(BASE + "pdm/");
  await esperarSincronia(B.p);
  await B.p.waitForTimeout(800);
  const estB = await B.p.evaluate(() => window.__pdm.estado());
  conferir(estB.arquivos.length === 4, `B recebeu o cofre (${estB.arquivos.length} arquivos)`);

  // 3) A zera o cofre
  await p.locator(".wj-aba", { hasText: "Ferramentas" }).tap();
  await p.locator('.wj-cmd[title^="Apagar tudo do cofre"]').tap();
  await p.locator("#zr-v").fill("zerar");
  await p.locator(".wj-janela footer button", { hasText: "Zerar cofre" }).tap();
  conferir(await p.locator("#zr-v").count() === 1, "sem digitar ZERAR exatamente, nada acontece");
  await p.locator("#zr-v").fill("ZERAR");
  await foto(p, "04-zerar");
  await p.locator(".wj-janela footer button", { hasText: "Zerar cofre" }).tap();
  await esperarSincronia(p);
  await p.waitForTimeout(1500);
  const estZ = await p.evaluate(() => window.__pdm.estado());
  conferir(estZ.arquivos.length === 0 && estZ.pastas.length === 0 && estZ.meta.usuario === "Johann", `A zerado, usuário mantido (${estZ.arquivos.length} arquivos, usuário ${estZ.meta.usuario})`);
  conferir(arquivos().length === 0, `Drive sem arquivos visíveis (${arquivos().join(", ")})`);
  conferir(apagados.length === 0 && [...itens.values()].some((x) => x.lixo), "no Drive, tudo pela lixeira (nada apagado de vez)");
  const indiceDrive = JSON.parse(String(arquivoEm("WJPDM/.wjpdm/indice.json").dados));
  conferir(!!indiceDrive.cofre?.id && indiceDrive.arquivos.length === 0, "índice do Drive: identidade nova e vazio");

  // 4) B abre de novo: limpo, com aviso, sem reenviar o antigo
  await B.p.reload();
  await esperarSincronia(B.p);
  await B.p.waitForTimeout(1500);
  const estB2 = await B.p.evaluate(() => window.__pdm.estado());
  const avisoB = await B.p.locator("body").innerText();
  conferir(estB2.arquivos.length === 0 && estB2.pastas.length === 0, `B limpo (${estB2.arquivos.length} arquivos)`);
  conferir(/zerado em outro aparelho/.test(avisoB), "B avisa que o cofre foi zerado em outro aparelho");
  await foto(B.p, "05-b-limpo");
  conferir(arquivos().length === 0 && JSON.parse(String(arquivoEm("WJPDM/.wjpdm/indice.json").dados)).arquivos.length === 0, "nada antigo voltou ao Drive");

  // 5) login: duas janelas de A, acesso vencido; uma janela do Google só
  await p.evaluate(() => {
    localStorage.setItem("wjgoogle:acesso", JSON.stringify({ token: "ok", expira: Date.now() - 1000 }));
    localStorage.setItem("wjgoogle:conta", "conta@exemplo.com");
    localStorage.removeItem("wjgoogle:ultimaAuto");
    localStorage.removeItem("wjgoogle:aberturas");
    localStorage.setItem("teste:aberturas", "0");
  });
  const p2 = await A.ctx.newPage();
  await p2.goto(BASE + "pdm/");
  await p2.waitForTimeout(2500);
  await p.bringToFront();
  await p.locator(".pd-lista-area, #pd-lista-area, body").first().tap({ position: { x: 600, y: 500 } }).catch(() => p.mouse.click(600, 500));
  await p.waitForTimeout(200);
  await p2.bringToFront();
  // a outra janela mostra a faixa "Cofre:" (acesso vencido): "Conectar agora" com a trava ocupada
  await p2.locator(".wjc-faixa [data-s]").tap();
  await p2.waitForTimeout(4000);
  const ab = await p.evaluate(() => ({ n: localStorage.getItem("teste:aberturas"), pedido: JSON.parse(localStorage.getItem("teste:pedido") ?? "{}"), reg: JSON.parse(localStorage.getItem("wjgoogle:aberturas") ?? "[]") }));
  conferir(ab.n === "1", `uma janela do Google só para as duas janelas (${ab.n})`);
  conferir(ab.pedido.prompt === "none" && ab.pedido.hint === "conta@exemplo.com", `sem seletor, com a conta (prompt ${ab.pedido.prompt}, hint ${ab.pedido.hint})`);
  conferir(ab.reg.filter((x) => x.resultado === "ok").length === 1 && ab.reg.filter((x) => x.resultado === "evitada").length === 1, `registro: ${ab.reg.map((x) => `${x.pagina}/${x.resultado}`).join(", ")}`);
  await p.bringToFront();
  await p.locator(".wj-aba", { hasText: "Ferramentas" }).tap();
  await p.locator('.wj-cmd[title^="Quantas vezes"]').tap();
  const login = (await p.locator(".wj-janela .wj-corpo").innerText()).replace(/\s+/g, " ");
  conferir(/1 janela\(s\) do Google aberta\(s\) \(1 sem seletor de conta\)/.test(login) && /1 evitada/.test(login), `Login do Google: ${login.slice(0, 140)}`);
  await foto(p, "06-login-google");

  await b.close();
  console.log(falhas.length ? `\n${falhas.length} falha(s)` : "\nroteiro zerar/importar/login: tudo certo");
  process.exit(falhas.length ? 1 : 0);
})();

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL(".", import.meta.url));
const versaoPacote = (JSON.parse(readFileSync(resolve(raiz, "package.json"), "utf8")) as { version: string }).version;
/** Versão mostrada no início e em cada app: <package.json>.<nº da publicação no GitHub Actions>. */
const VERSAO = `${versaoPacote}.${process.env.GITHUB_RUN_NUMBER ?? "dev"}`;
/** Nas páginas HTML, %WJ_VERSAO% vira o número da versão. */
const versaoNoHtml = (): Plugin => ({ name: "wj-versao", transformIndexHtml: (html) => html.replaceAll("%WJ_VERSAO%", VERSAO) });
import { defineConfig, type Plugin } from "vite";

/**
 * Uso offline: lista os arquivos do build em precache.json, separados em `pequenos` (o service
 * worker guarda na instalação) e `grandes` (o kernel .wasm de ~23 MB: guardado só quando o
 * WJCAD é aberto, aproveitando o download que a página já fez). Carimba no sw.js uma versão que
 * muda a cada build, para o app instalado se atualizar sozinho.
 */
function offline(): Plugin {
  let arquivos: string[] = [];
  let pasta = "dist";
  const LIMITE = 2 * 1024 * 1024;
  return {
    name: "wj-offline",
    apply: "build",
    configResolved(c) {
      pasta = c.build.outDir;
    },
    generateBundle(_, bundle) {
      arquivos = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const tamanho = (f: string) => {
        const x = bundle[f];
        return x.type === "asset" ? (typeof x.source === "string" ? x.source.length : x.source.byteLength) : x.code.length;
      };
      const pequenos = arquivos.filter((f) => tamanho(f) <= LIMITE);
      const grandes = arquivos.filter((f) => tamanho(f) > LIMITE);
      this.emitFile({ type: "asset", fileName: "precache.json", source: JSON.stringify({ pequenos, grandes }) });
    },
    closeBundle() {
      const sw = resolve(pasta, "sw.js");
      const versao = createHash("sha1").update(arquivos.sort().join("|")).digest("hex").slice(0, 10);
      writeFileSync(sw, readFileSync(sw, "utf8").replace('"jlscad-__VERSAO__"', `"jlscad-${versao}"`));
    },
  };
}

// base: "/" no Cloudflare Pages (site na raiz); o workflow do GitHub Pages passa
// BASE_PATH=/<nome do repositório>/ (johann-sicherl.github.io/WJProMaster/).
// Duas páginas: index.html = início do WJProMaster (leve); cad/index.html = WJCAD.
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? process.env.BASE_PATH || "/" : "/",
  plugins: [offline(), versaoNoHtml()],
  define: { __VERSAO__: JSON.stringify(VERSAO) },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["replicad-opencascadejs"] },
  server: { host: true }, // permite abrir no tablet pela rede local durante o desenvolvimento
  // mesmos cabeçalhos do public/_headers (Cloudflare): isolamento de origem → SharedArrayBuffer,
  // necessário para o kernel com várias threads
  preview: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { inicio: resolve(raiz, "index.html"), cad: resolve(raiz, "cad/index.html"), montagem: resolve(raiz, "cad/montagem/index.html"), desenho: resolve(raiz, "cad/desenho/index.html"), planilha: resolve(raiz, "planilha/index.html"), documento: resolve(raiz, "documento/index.html"), apresentacao: resolve(raiz, "apresentacao/index.html"), cronograma: resolve(raiz, "cronograma/index.html"), pdm: resolve(raiz, "pdm/index.html"), erp: resolve(raiz, "erp/index.html"), flow: resolve(raiz, "flow/index.html"), flowAparelho: resolve(raiz, "flow/aparelho/index.html"), tarefas: resolve(raiz, "tarefas/index.html") } },
  },
}));

// WJWrite — exportação para .docx (OOXML, formato aberto): zip próprio (sem compressão, sem dependência), parágrafos
// com estilo/alinhamento/negrito/itálico/sublinhado/cor/tamanho, títulos, listas, tabelas, imagens PNG/JPEG e quebra de
// página. `gerarDocx` é puro (testado em Node, scripts/teste-orcamento.ts); `htmlParaBlocos` lê o HTML da folha (navegador).

export interface Corrida {
  texto: string;
  negrito?: boolean;
  italico?: boolean;
  sublinhado?: boolean;
  tachado?: boolean;
  /** pt */
  tamanho?: number;
  /** hexadecimal sem # */
  cor?: string;
  /** quebra de linha antes do texto */
  quebra?: boolean;
}

export type Alinhamento = "left" | "center" | "right" | "both";

export interface Paragrafo {
  tipo: "p";
  corridas: Corrida[];
  alinhamento?: Alinhamento;
  estilo?: "titulo" | "subtitulo" | "h1" | "h2" | "h3" | "codigo" | "citacao";
  /** recuo à esquerda, mm */
  recuo?: number;
}
export interface Imagem {
  tipo: "img";
  dados: Uint8Array;
  ext: "png" | "jpeg";
  /** tamanho no papel, mm */
  larguraMm: number;
  alturaMm: number;
  alinhamento?: Alinhamento;
  alt?: string;
}
export interface Tabela {
  tipo: "tabela";
  linhas: { celulas: Paragrafo[][]; cabecalho?: boolean }[];
}
export interface QuebraDePagina {
  tipo: "pagina";
}
export type Bloco = Paragrafo | Imagem | Tabela | QuebraDePagina;

export interface PaginaDocx {
  larguraMm: number;
  alturaMm: number;
  margens: { sup: number; inf: number; esq: number; dir: number };
}

export const PAGINA_A4: PaginaDocx = { larguraMm: 210, alturaMm: 297, margens: { sup: 25, inf: 20, esq: 30, dir: 20 } };

// ---------- zip (armazenado) ----------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipar(arquivos: { nome: string; dados: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let posicao = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome);
    const crc = crc32(a.dados);
    const local = new Uint8Array(30 + nome.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true);
    v.setUint16(8, 0, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, 0x0021, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, a.dados.length, true);
    v.setUint32(22, a.dados.length, true);
    v.setUint16(26, nome.length, true);
    v.setUint16(28, 0, true);
    local.set(nome, 30);
    partes.push(local, a.dados);
    const c = new Uint8Array(46 + nome.length);
    const w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint16(10, 0, true);
    w.setUint16(12, 0, true);
    w.setUint16(14, 0x0021, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, a.dados.length, true);
    w.setUint32(24, a.dados.length, true);
    w.setUint16(28, nome.length, true);
    w.setUint32(42, posicao, true);
    c.set(nome, 46);
    central.push(c);
    posicao += local.length + a.dados.length;
  }
  const tamCentral = central.reduce((s, x) => s + x.length, 0);
  const fim = new Uint8Array(22);
  const f = new DataView(fim.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, arquivos.length, true);
  f.setUint16(10, arquivos.length, true);
  f.setUint32(12, tamCentral, true);
  f.setUint32(16, posicao, true);
  const tudo = [...partes, ...central, fim];
  const out = new Uint8Array(tudo.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const p of tudo) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Lê o índice de um zip simples (os arquivos "armazenados" que `zipar` gera): nomes e conteúdo. Para teste e conferência. */
export function lerZip(b: Uint8Array): { nome: string; dados: Uint8Array }[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fim = b.length - 22;
  while (fim >= 0 && v.getUint32(fim, true) !== 0x06054b50) fim--;
  if (fim < 0) throw new Error("Zip sem diretório central.");
  const n = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const out: { nome: string; dados: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("Entrada do diretório central inválida.");
    const tam = v.getUint32(p + 24, true), nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lp = v.getUint32(p + 42, true);
    const nome = dec.decode(b.subarray(p + 46, p + 46 + nl));
    const ln = v.getUint16(lp + 26, true), le = v.getUint16(lp + 28, true);
    const dados = b.subarray(lp + 30 + ln + le, lp + 30 + ln + le + tam);
    if (crc32(dados) !== v.getUint32(p + 16, true)) throw new Error(`CRC diferente em ${nome}.`);
    out.push({ nome, dados });
    p += 46 + nl + el + cl;
  }
  return out;
}

// ---------- imagens ----------

/** Largura e altura em pixels de um PNG ou JPEG (lidas do cabeçalho). */
export function tamanhoDaImagem(b: Uint8Array): { ext: "png" | "jpeg"; largura: number; altura: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { ext: "png", largura: v.getUint32(16), altura: v.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { ext: "jpeg", largura: (b[i + 7] << 8) | b[i + 8], altura: (b[i + 5] << 8) | b[i + 6] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

export function deDataUrl(url: string): { dados: Uint8Array; tipo: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  if (!m[2]) return { tipo: m[1], dados: new TextEncoder().encode(decodeURIComponent(m[3])) };
  const bin = atob(m[3]);
  const dados = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) dados[i] = bin.charCodeAt(i);
  return { tipo: m[1], dados };
}

// ---------- document.xml ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// eslint-disable-next-line no-control-regex
const limpar = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const EMU_MM = 36000;
const twips = (mm: number) => Math.round((mm / 25.4) * 1440);
const ESTILO: Record<NonNullable<Paragrafo["estilo"]>, string> = { titulo: "Title", subtitulo: "Subtitle", h1: "Heading1", h2: "Heading2", h3: "Heading3", codigo: "Code", citacao: "Quote" };

function xmlCorrida(c: Corrida): string {
  const pr = `${c.negrito ? "<w:b/>" : ""}${c.italico ? "<w:i/>" : ""}${c.tachado ? "<w:strike/>" : ""}${c.cor && /^[0-9a-f]{6}$/i.test(c.cor) ? `<w:color w:val="${c.cor}"/>` : ""}${c.tamanho ? `<w:sz w:val="${Math.round(c.tamanho * 2)}"/><w:szCs w:val="${Math.round(c.tamanho * 2)}"/>` : ""}${c.sublinhado ? '<w:u w:val="single"/>' : ""}`;
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}${c.quebra ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(limpar(c.texto))}</w:t></w:r>`;
}

function xmlParagrafo(p: Paragrafo): string {
  const pr = `${p.estilo ? `<w:pStyle w:val="${ESTILO[p.estilo]}"/>` : ""}${p.alinhamento ? `<w:jc w:val="${p.alinhamento}"/>` : ""}${p.recuo ? `<w:ind w:left="${twips(p.recuo)}"/>` : ""}`;
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ""}${p.corridas.map(xmlCorrida).join("")}</w:p>`;
}

function xmlImagem(im: Imagem, rid: string, n: number): string {
  const cx = Math.round(im.larguraMm * EMU_MM), cy = Math.round(im.alturaMm * EMU_MM);
  return `<w:p><w:pPr>${im.alinhamento ? `<w:jc w:val="${im.alinhamento}"/>` : ""}</w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Imagem ${n}" descr="${esc(im.alt ?? "")}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="imagem${n}.${im.ext === "png" ? "png" : "jpeg"}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function xmlTabela(t: Tabela, largura: number): string {
  const cols = Math.max(1, ...t.linhas.map((l) => l.celulas.length));
  const w = Math.floor(largura / cols);
  const borda = ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join("");
  const linhas = t.linhas
    .map((l) => {
      const cel = Array.from({ length: cols }, (_, i) => l.celulas[i] ?? [{ tipo: "p" as const, corridas: [{ texto: "" }] }]);
      return `<w:tr>${l.cabecalho ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cel
        .map((c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${(c.length ? c : [{ tipo: "p" as const, corridas: [{ texto: "" }] }]).map((p) => xmlParagrafo(l.cabecalho ? { ...p, corridas: p.corridas.map((x) => ({ ...x, negrito: true })) } : p)).join("")}</w:tc>`)
        .join("")}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${w * cols}" w:type="dxa"/><w:tblBorders>${borda}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${linhas}</w:tbl><w:p/>`;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="555555"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

/** O arquivo .docx (bytes) com os blocos na página dada. */
export function gerarDocx(blocos: Bloco[], pagina: PaginaDocx = PAGINA_A4, titulo = "Documento"): Uint8Array {
  const enc = new TextEncoder();
  const largura = twips(pagina.larguraMm - pagina.margens.esq - pagina.margens.dir);
  const midias: { nome: string; dados: Uint8Array }[] = [];
  const rels: string[] = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  ];
  let corpo = "";
  for (const b of blocos) {
    if (b.tipo === "p") corpo += xmlParagrafo(b);
    else if (b.tipo === "pagina") corpo += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    else if (b.tipo === "tabela") corpo += xmlTabela(b, largura);
    else {
      const n = midias.length + 1;
      const arquivo = `image${n}.${b.ext === "png" ? "png" : "jpeg"}`;
      midias.push({ nome: `word/media/${arquivo}`, dados: b.dados });
      rels.push(`<Relationship Id="rIdImg${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${arquivo}"/>`);
      corpo += xmlImagem(b, `rIdImg${n}`, n);
    }
  }
  const sect = `<w:sectPr><w:pgSz w:w="${twips(pagina.larguraMm)}" w:h="${twips(pagina.alturaMm)}"/><w:pgMar w:top="${twips(pagina.margens.sup)}" w:right="${twips(pagina.margens.dir)}" w:bottom="${twips(pagina.margens.inf)}" w:left="${twips(pagina.margens.esq)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${corpo}${sect}</w:body></w:document>`;
  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const raiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(limpar(titulo))}</dc:title><dc:creator>WJWrite</dc:creator></cp:coreProperties>`;
  const relDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;
  return zipar([
    { nome: "[Content_Types].xml", dados: enc.encode(tipos) },
    { nome: "_rels/.rels", dados: enc.encode(raiz) },
    { nome: "docProps/core.xml", dados: enc.encode(core) },
    { nome: "word/document.xml", dados: enc.encode(documento) },
    { nome: "word/_rels/document.xml.rels", dados: enc.encode(relDoc) },
    { nome: "word/styles.xml", dados: enc.encode(ESTILOS) },
    ...midias,
  ]);
}

// ---------- HTML da folha → blocos (navegador) ----------

const PT_POR_PX = 0.75;
const MM_POR_PX = 25.4 / 96;

function tamanhoCss(v: string): number | undefined {
  const m = /^([\d.]+)(pt|px)?$/.exec(v.trim());
  if (!m) return undefined;
  return m[2] === "px" || !m[2] ? parseFloat(m[1]) * PT_POR_PX : parseFloat(m[1]);
}

function corCss(v: string): string | undefined {
  const h = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (h) return h[1];
  const r = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(v.trim());
  return r ? [r[1], r[2], r[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("") : undefined;
}

type Estilos = Omit<Corrida, "texto" | "quebra">;

function corridasDe(no: Node, base: Estilos, saida: Corrida[], imagens: (img: HTMLImageElement) => void) {
  if (no.nodeType === 3) {
    const t = (no.textContent ?? "").replace(/\s+/g, " ");
    if (t) saida.push({ ...base, texto: t });
    return;
  }
  if (no.nodeType !== 1) return;
  const e = no as HTMLElement;
  const tag = e.tagName;
  if (tag === "BR") return void saida.push({ ...base, texto: "", quebra: true });
  if (tag === "IMG") return imagens(e as HTMLImageElement);
  const est: Estilos = { ...base };
  if (tag === "B" || tag === "STRONG") est.negrito = true;
  if (tag === "I" || tag === "EM") est.italico = true;
  if (tag === "U" || tag === "A") est.sublinhado = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") est.tachado = true;
  const st = e.style;
  if (st) {
    if (st.fontWeight === "bold" || Number(st.fontWeight) >= 600) est.negrito = true;
    if (st.fontStyle === "italic") est.italico = true;
    if (st.textDecoration?.includes("underline")) est.sublinhado = true;
    if (st.textDecoration?.includes("line-through")) est.tachado = true;
    const cor = st.color ? corCss(st.color) : undefined;
    if (cor) est.cor = cor;
    const tam = st.fontSize ? tamanhoCss(st.fontSize) : undefined;
    if (tam) est.tamanho = tam;
  }
  for (const f of Array.from(e.childNodes)) corridasDe(f, est, saida, imagens);
}

const alinhamentoDe = (e: HTMLElement): Alinhamento | undefined => {
  const a = e.style?.textAlign || e.getAttribute("align") || "";
  return a === "center" ? "center" : a === "right" ? "right" : a === "justify" ? "both" : a === "left" ? "left" : undefined;
};

function imagemDe(img: HTMLImageElement, pagina: PaginaDocx): Imagem | null {
  const d = deDataUrl(img.getAttribute("src") ?? "");
  const t = d && tamanhoDaImagem(d.dados);
  if (!d || !t) return null;
  const util = pagina.larguraMm - pagina.margens.esq - pagina.margens.dir;
  const pct = /^([\d.]+)%$/.exec(img.style?.width ?? "");
  const px = /^([\d.]+)px$/.exec(img.style?.width ?? "") ?? /^(\d+)$/.exec(img.getAttribute("width") ?? "");
  let l = pct ? (util * parseFloat(pct[1])) / 100 : px ? parseFloat(px[1]) * MM_POR_PX : t.largura * MM_POR_PX;
  l = Math.min(util, Math.max(5, l));
  const al = img.dataset?.alinhar;
  return { tipo: "img", dados: d.dados, ext: t.ext, larguraMm: l, alturaMm: (l * t.altura) / t.largura, alinhamento: al === "centro" ? "center" : al === "direita" ? "right" : al === "esquerda" ? "left" : undefined, alt: img.alt };
}

/** Converte o HTML da folha do WJWrite em blocos do .docx. */
export function htmlParaBlocos(raiz: HTMLElement, pagina: PaginaDocx = PAGINA_A4): Bloco[] {
  const blocos: Bloco[] = [];
  const paragrafo = (e: HTMLElement, extra: Partial<Paragrafo> = {}, base: Estilos = {}) => {
    let corridas: Corrida[] = [];
    const solta = () => {
      if (corridas.some((c) => c.texto || c.quebra)) blocos.push({ tipo: "p", corridas, alinhamento: alinhamentoDe(e), ...extra });
      corridas = [];
    };
    corridasDe(e, base, corridas, (img) => {
      solta();
      const im = imagemDe(img, pagina);
      if (im) blocos.push({ ...im, alinhamento: im.alinhamento ?? alinhamentoDe(e) });
      else corridas.push({ ...base, texto: "[imagem]" });
    });
    if (corridas.length || !blocos.length) solta();
  };
  const visitar = (e: HTMLElement, nivelLista = 0) => {
    const tag = e.tagName;
    if (tag === "HR") return void (e.classList.contains("dc-pagina") ? blocos.push({ tipo: "pagina" }) : blocos.push({ tipo: "p", corridas: [{ texto: "─".repeat(40), cor: "999999" }] }));
    if (tag === "P" || tag === "DIV") {
      if (tag === "DIV" && Array.from(e.children).some((c) => /^(P|H[1-6]|UL|OL|TABLE|DIV|HR|BLOCKQUOTE|PRE)$/.test(c.tagName))) return void Array.from(e.children).forEach((c) => visitar(c as HTMLElement, nivelLista));
      const cls = e.className || "";
      return paragrafo(e, cls.includes("titulo") && !cls.includes("sub") ? { estilo: "titulo" } : cls.includes("subtitulo") ? { estilo: "subtitulo" } : {});
    }
    if (/^H[1-6]$/.test(tag)) return paragrafo(e, { estilo: tag === "H1" ? "h1" : tag === "H2" ? "h2" : "h3" });
    if (tag === "BLOCKQUOTE") return paragrafo(e, { estilo: "citacao" });
    if (tag === "PRE") return paragrafo(e, { estilo: "codigo" });
    if (tag === "UL" || tag === "OL") {
      let n = 0;
      for (const li of Array.from(e.children) as HTMLElement[]) {
        if (li.tagName !== "LI") continue;
        n++;
        const inicio = blocos.length;
        const marca = tag === "UL" ? "•" : `${n}.`;
        const corridas: Corrida[] = [{ texto: `${marca} ` }];
        const aninhadas: HTMLElement[] = [];
        const imagens: HTMLImageElement[] = [];
        for (const f of Array.from(li.childNodes)) {
          if (f.nodeType === 1 && /^(UL|OL)$/.test((f as HTMLElement).tagName)) aninhadas.push(f as HTMLElement);
          else corridasDe(f, {}, corridas, (img) => imagens.push(img));
        }
        blocos.push({ tipo: "p", corridas, recuo: 8 * (nivelLista + 1) });
        for (const im of imagens) {
          const b = imagemDe(im, pagina);
          if (b) blocos.push(b);
        }
        for (const a of aninhadas) visitar(a, nivelLista + 1);
        if (blocos.length === inicio) blocos.push({ tipo: "p", corridas: [{ texto: marca }] });
      }
      return;
    }
    if (tag === "TABLE") {
      const linhas: Tabela["linhas"] = [];
      for (const tr of Array.from(e.querySelectorAll("tr")) as HTMLElement[]) {
        const celulas = (Array.from(tr.children) as HTMLElement[]).filter((c) => c.tagName === "TD" || c.tagName === "TH").map((c) => {
          const cs: Corrida[] = [];
          corridasDe(c, {}, cs, () => {});
          return [{ tipo: "p" as const, corridas: cs.length ? cs : [{ texto: "" }], alinhamento: alinhamentoDe(c) }];
        });
        if (celulas.length) linhas.push({ celulas, cabecalho: (tr.firstElementChild as HTMLElement | null)?.tagName === "TH" });
      }
      if (linhas.length) blocos.push({ tipo: "tabela", linhas });
      return;
    }
    if (tag === "IMG") {
      const im = imagemDe(e as HTMLImageElement, pagina);
      if (im) blocos.push(im);
      return;
    }
    if (/^(SCRIPT|STYLE)$/.test(tag)) return;
    paragrafo(e);
  };
  for (const f of Array.from(raiz.childNodes)) {
    if (f.nodeType === 1) visitar(f as HTMLElement);
    else if ((f.textContent ?? "").trim()) blocos.push({ tipo: "p", corridas: [{ texto: f.textContent!.trim() }] });
  }
  return blocos;
}

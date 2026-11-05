# WJVideoMaker — edição de vídeo avançada

Face do WJProMaster para **editar vídeos e fotos** numa linha do tempo com várias pistas: cortar,
montar, títulos, transições, efeitos, cor, áudio e exportação. Pedido do Johann em 05/11/2026.
Roda no **celular, tablet e computador** (navegador Chrome/Edge e PWA), tudo **no aparelho**
(sem servidor), e usa mídia do **Google Drive, da pasta do dispositivo, do pendrive e da galeria**.

- Página: `video/` · código: `src/video/` · motor puro testado: `src/video/linha.ts`, `tempo.ts`,
  `quadros.ts` (`scripts/teste-video.ts`) · teste do aparelho em `video/aparelho/`
- Arquivo: **`.wjvid`** (projeto: linha do tempo + vínculos para a mídia) no cofre do WJPDM, pasta
  **"Vídeos"** · autosave no IndexedDB `wjvideo` · cache de mídia, miniaturas e proxies no **OPFS**
- Status: **especificação** (este documento). Nada implementado ainda. Primeira entrega: **V0**
  (teste do aparelho), depois **V1** (§12).

Legenda: ✅ existe · 🟡 parcial · **V0…V6** fase deste documento · ⏸ registrado, fora do escopo atual ·
❓ depende de decisão do Johann (§14).

---

## 1. Resumo da decisão

| Pergunta | Resposta |
|---|---|
| Inspiração funcional | **Wondershare Filmora** (editor de vídeo de consumo avançado): biblioteca de mídia → linha do tempo com pistas → títulos, transições, efeitos, cor, áudio → exportar. Fluxo parecido; **nada copiado** (§2). |
| Dá para editar vídeo no navegador do tablet? | **Sim.** O Chrome tem **WebCodecs** (decodificador e codificador de vídeo/áudio **do próprio aparelho, com aceleração de hardware**), **WebGL2** para compor os quadros e **Web Audio** para mixar. É o mesmo caminho dos editores web atuais. |
| O que limita no tablet do Johann? | O **TCL Tab A1 Plus** (Snapdragon 4 Gen 2) decodifica/codifica em hardware **até 1080p60**. Vídeo 4K abre, mas a edição usa **proxy** (cópia leve em 720p, §6.3) e a exportação fica em **até 1080p**. Duas ou três pistas de vídeo ao mesmo tempo (transição, sobreposição) em 1080p é o limite prático: o **V0 mede** o número real. |
| Mídia fica onde? | **Onde já está** (Drive, pasta, pendrive, galeria). O projeto `.wjvid` guarda **vínculos** e a "impressão digital" de cada arquivo, não o vídeo. Assim o cofre não se enche de GB nem duplica vídeos a cada GO-IN (§7). ❓ confirmar. |
| Formato de saída padrão | **MP4 (H.264 + AAC)**, que toca em tudo. Também WebM (VP9/AV1 + Opus), GIF, só áudio, quadro em PNG/JPEG (§9). |
| Dependência nova | **Uma**: `mediabunny` (MPL-2.0, sem dependências, TypeScript) para **ler e gravar contêineres** MP4/MOV/WebM/MKV/MP3/WAV. Codificar/decodificar é do navegador (WebCodecs): não vai codec no app (§10). |
| Onde fica no ecossistema | **Face separada e local** (como WJFlow e WJTaskPlan): não depende do servidor (G5). Integra com WJPDM (cofre), WJCAD/WJFlow (animações viram clipes) e WJApresentation (vídeo no slide) (§11). |

## 2. Inspiração sem cópia (regras do projeto aplicadas a vídeo)

- **Proibido na UI e no código**: o nome "Filmora" e nomes de produto/recurso da Wondershare
  (ex.: "Filmstock", nomes de pacotes de efeitos, "AI Copilot"), ícones, cores, telas, textos de ajuda,
  efeitos/modelos/títulos prontos deles, músicas e figurinhas do acervo deles, formato de projeto
  `.wfp` (proprietário: não abrir nem gravar) e engenharia reversa.
- **Também proibido na UI**: nomes de redes sociais/marcas nas predefinições de exportação
  ("YouTube", "Instagram", "TikTok", "WhatsApp"). As predefinições têm nomes genéricos: "Horizontal
  16:9 1080p", "Vertical 9:16 (vídeo curto)", "Quadrado 1:1", "Pequeno para mensagem". O
  **Compartilhar** do sistema (Web Share) leva o arquivo para qualquer app sem citar marca.
- **Permitido**: conceitos genéricos de edição (biblioteca, linha do tempo, pistas, aparar, dividir,
  pista magnética, quadros-chave, croma, LUT, transições, títulos, mixagem, *ducking*) e formatos
  abertos (MP4/ISO-BMFF, WebM/Matroska, MP3, WAV, FLAC, Ogg/Opus, PNG, JPEG, WebP, GIF, AVIF,
  SRT, WebVTT, LUT `.cube`).
- Efeitos, transições, títulos e elementos: **nossos** (shaders e SVG próprios), com nomes em
  português.
- Sem acervo de músicas/vídeos de terceiros embutido. Aviso de direitos autorais na exportação
  quando houver música importada (o usuário é responsável pelo que usa).

## 3. Casos de uso (para validar cada fase)

1. **Vídeo técnico de produto**: filmagens da peça/máquina + telas do WJCAD (animação girando) +
   títulos de cotas e setas + narração → MP4 1080p para cliente ou treinamento.
2. **Tutorial**: gravação de tela do computador + câmera no canto (sobreposição) + legendas SRT.
3. **Vídeo curto vertical (9:16)**: clipes do celular, cortes rápidos no ritmo da música (marcas de
   batida), textos animados, transições.
4. **Apresentação de fotos**: dezenas de fotos com zoom suave (pan & zoom), música com *fade*,
   duração por foto igual para todas.
5. **Registro de obra/fabricação**: vídeos do pendrive da câmera, acelerados (timelapse), com data
   e legenda, exportados pequenos para mandar por mensagem.

## 4. Fontes de mídia (pedido do Johann)

| Fonte | Como entra | Abrir de novo depois | Limites |
|---|---|---|---|
| **Pasta do dispositivo** (Documentos, Câmera, Downloads) | **Procurar pasta** (`showDirectoryPicker`, como o cofre já faz): a biblioteca lista os vídeos, fotos e áudios dela, com miniaturas; ou **Escolher arquivos** (`showOpenFilePicker` / `<input type=file multiple>`) | Pasta escolhida com o seletor: o navegador lembra a permissão (pede um toque ao reabrir). Arquivo escolhido pelo `<input>`: **não** dá para reabrir sozinho → fica "mídia offline" com **Localizar…** (§7.3) | — |
| **Pendrive** (USB-OTG no tablet/celular; USB no computador) | Igual à pasta (o Android mostra o pendrive no seletor) | Igual à pasta; desconectado → "mídia offline" até religar | Leitura de pendrive é lenta: **Copiar para o aparelho** (cache OPFS) é oferecido para clipes usados na linha do tempo |
| **Galeria / câmera** (celular e tablet) | **Galeria** (`<input accept="video/*,image/*" multiple>`) e **Gravar agora** (`capture`) | Como arquivo escolhido: guardado no cache OPFS na importação (vídeos da câmera não têm caminho reabrível no Android) | Ocupa espaço do app: mostrar o tamanho do cache e **Limpar cache** |
| **Google Drive** | **Escolher do Drive** abre o **seletor do Google (Google Picker)**: o usuário navega em todo o Meu Drive / Compartilhados comigo e escolhe vídeos/fotos; o arquivo escolhido passa a ser visível ao app no escopo atual `drive.file` | Pelo ID do arquivo no Drive (acesso renovado como no cofre, §5.3 das regras) | Leitura por partes (HTTP Range) sem baixar tudo; para editar sem internet ou com rede ruim: **Baixar para o aparelho** (OPFS). Precisa de **chave de API do navegador** no projeto Google `wjpromaster` ❓ |
| **Cofre do WJPDM** | Explorador do cofre (mesmo de todos os apps): imagens, PDFs (1ª página como imagem ⏸), exportações de outras faces | Pelo URI `wj://pdm/...` | — |
| **Outras faces** | WJCAD: **Gravar animação da peça** (giro 360°, explosão de montagem ⏸) → clipe; WJFlow: animação do escoamento → clipe; WJApresentation: slides como imagens (§11) | Pelo URI | ⏸ depois da V2 |

**Por que o Google Picker e não ampliar o escopo do Drive:** o escopo atual (`drive.file`) só enxerga o
que o app criou. Ampliar para `drive.readonly` dá acesso a **todo** o Drive e é escopo "restrito" do
Google (exige verificação de segurança para sair do modo de teste). O Picker mantém o menor acesso:
o app só vê o arquivo que o usuário escolheu. Precisa de uma **chave de API do navegador** (pública,
restrita à origem `https://johann-sicherl.github.io` e só à Picker API) e do número do projeto — não é a
chave secreta. **Criar essa chave é acesso que a sessão não tem** (§14).

### 4.1 Formatos de entrada

Decodificar depende do aparelho (o V0 lista o que o aparelho do Johann aceita). Esperado no Chrome:

| Tipo | Contêiner | Codecs | Observação |
|---|---|---|---|
| Vídeo | MP4, MOV, M4V, WebM, MKV | **H.264** (todos), **H.265/HEVC** (Android e a maioria dos PCs com hardware; Windows às vezes não), VP8, VP9, AV1 (decodificação na maioria) | 10 bits/HDR: abre com conversão para SDR (mapa de tons simples); edição em HDR ⏸ |
| Áudio | MP3, M4A/AAC, WAV, FLAC, Ogg/Opus, WebM | AAC, MP3, Opus, Vorbis, FLAC, PCM | — |
| Imagem | JPEG, PNG, WebP, GIF (animado vira clipe), AVIF, SVG | — | **HEIC/HEIF (fotos de iPhone e de alguns Android) o Chrome não decodifica**: aviso claro com a dica de exportar como JPEG; decodificador próprio ⏸ |
| Legenda | SRT, WebVTT | — | — |
| LUT | `.cube` (1D/3D) | — | — |

Arquivo que o aparelho não decodifica: mensagem útil ("Este vídeo é H.265 e este computador não tem
o decodificador; converta para H.264 ou abra no tablet"), nunca falha silenciosa. Conversão com
`ffmpeg.wasm` como plano B foi **avaliada e descartada por ora** (§10).

## 5. Interface

Mesma casca das outras faces (`src/comum/casca.ts`): barra superior, faixa de comandos por abas,
painel de comando à esquerda com ✓/✕, barra de contexto ao selecionar, menu de contexto (botão
direito / toque longo 0,6 s), status embaixo, aba **Cofre** na lateral direita, desfazer por
fotografias, autosave, várias janelas, faixa "Cofre:" ao abrir.

### 5.1 Áreas (tablet e computador, paisagem)

```
┌ barra superior: logo · Arquivo · nome do projeto · ↶ ↷ · 💾 · Exportar ─────────────────┐
├ abas: Mídia · Editar · Texto · Áudio · Transições · Efeitos · Cor · Exportar ────────────┤
├ faixa de ícones da aba ativa ─────────────────────────────────────────────────────────────┤
│ Biblioteca / painel de    │            VISUALIZADOR (quadro do projeto)    │ Propriedades │
│ comando (esquerda,        │   ▶ ⏸ ⏮ ⏭  00:01:12;05 / 00:03:40  qualidade │ do clipe     │
│ recolhível)               │                                                │ (direita)    │
├───────────────────────────┴────────────────────────────────────────────────┴──────────────┤
│ LINHA DO TEMPO: régua · cursor · marcadores · pistas V3 V2 V1 (vídeo/foto/texto)          │
│                 A1 A2 (áudio) com forma de onda · zoom · ímã · dividir · excluir         │
├ status: resolução · fps · duração · uso do cache · aceleração de hardware ────────────────┤
```

- **Celular (retrato)**: visualizador em cima, linha do tempo embaixo, ferramentas numa **gaveta
  inferior** (padrão dos editores de celular); biblioteca em tela cheia ao tocar em "+".
  Projeto vertical 9:16 é o padrão no celular.
- **Tablet**: alvos ≥ 44 px; alças de aparar grandes; **lupa de precisão** ao aparar com o dedo;
  a caneta apara com precisão de quadro.
- **Computador**: botões compactos, atalhos completos (§5.4), arrastar e soltar da área de trabalho
  para a biblioteca, segundo monitor com o visualizador em tela cheia ⏸.

### 5.2 Abas e comandos

| Aba | Comandos | Fase |
|---|---|---|
| **Mídia** | Importar (pasta, arquivos, pendrive, galeria, Drive, cofre), Gravar (câmera, microfone, tela no computador), pastas da biblioteca, filtros (vídeo/foto/áudio/em uso), ordenar, Localizar mídia offline, Copiar para o aparelho, Criar proxy | V1 (gravar V3) |
| **Editar** | Dividir no cursor, Aparar início/fim até o cursor, Excluir, Excluir e fechar o vão, Duplicar, Congelar quadro, Separar áudio, Agrupar, Velocidade, Inverter, Cortar e ampliar (recorte), Girar/espelhar, Transformar (posição, escala, rotação, opacidade), Sobreposição (imagem sobre imagem), Tela dividida, Pan & zoom em foto, Estabilizar ⏸, Rastrear movimento ⏸ | V1–V2 |
| **Texto** | Título, Subtítulo/legenda, Rótulo inferior (nome/cargo), Créditos rolando, Texto com contorno/sombra/fundo, animação de entrada/saída, Legendas (importar/exportar SRT/VTT), Seta e cota (para vídeo técnico) | V2 (legendas V5) |
| **Áudio** | Volume, *fade* in/out, quadros-chave de volume, Normalizar (LUFS), Abafar música sob a voz (*ducking*), Equalizador, Redução de ruído simples, Mudo/solo da pista, Narração (gravar no cursor), Marcar batidas, Detectar silêncios | V3 |
| **Transições** | Dissolver, Pelo preto/branco, Deslizar, Empurrar, Cortina (linear, circular, diagonal), Ampliar, Desfocar, Girar; duração e alinhamento (no fim, centro, início do corte) | V2 |
| **Efeitos** | Desfoque (inteiro, área, fundo de vídeo vertical), Mosaico/pixelar (esconder placa/rosto, com área que segue quadros-chave), Nitidez, Vinheta, Granulado, Preto e branco, Sépia, Espelho, Croma (fundo verde/azul), Máscara (retângulo, elipse, desenho à mão com a caneta, invertida, suavizada), Modos de mesclagem | V4 |
| **Cor** | Correção básica (exposição, contraste, realces, sombras, branco/preto, saturação, vibração, temperatura, matiz), Curvas RGB, HSL por faixa de cor, **LUT `.cube`**, Copiar/colar cor entre clipes, Comparar antes/depois, Escopos (histograma, forma de onda) ⏸ | V4 |
| **Exportar** | Predefinições genéricas, resolução, fps, qualidade/taxa, faixa (tudo ou entre marcas), só áudio, GIF, quadro atual como imagem, salvar no cofre/pasta/pendrive/Drive, Compartilhar | V1 (GIF e extras V5) |

### 5.3 Linha do tempo (núcleo do app)

- **Pistas**: vídeo/imagem/texto em cima (a de cima cobre a de baixo), áudio embaixo. Sem número
  fixo; o app avisa quando o projeto pede mais decodificações simultâneas do que o aparelho aguenta
  (número medido no V0).
- **Pista principal magnética** (opcional, ligada por padrão): excluir ou encurtar um clipe fecha o
  vão; clipes das outras pistas ficam **presos** ao clipe principal em que começam e andam com ele.
- **Operações**: mover (arrastar), aparar pelas bordas, dividir (no cursor ou com a caneta sobre o
  clipe), *ripple* (aparar empurrando o resto), *roll* (mover o corte entre dois clipes), *slip*
  (trocar o trecho mostrado sem mudar a posição) — V2, deslizar, copiar/colar atributos.
- **Ímã** (encaixe) no cursor, nas bordas dos clipes, marcadores e batidas; tecla para desligar
  temporariamente.
- **Precisão de quadro**: todo tempo é **inteiro em microssegundos** (a unidade do WebCodecs) e as
  edições caem em fronteiras de quadro do projeto (fps racional: 24, 25, 29,97, 30, 50, 59,94, 60).
- **Quadros-chave** em qualquer propriedade numérica (posição, escala, rotação, opacidade, volume,
  intensidade de efeito, cor), com interpolação linear, suave (Bézier com alças) e degrau.
- **Marcadores** no projeto e no clipe (nome, cor, nota), navegar entre eles, exportar como capítulos
  do MP4 ⏸.
- **Miniaturas** ao longo do clipe e **forma de onda** do áudio, geradas em segundo plano (Worker) e
  guardadas no cache OPFS.
- **Zoom** da linha do tempo: pinça com 2 dedos, roda com Ctrl, `+`/`−`; rolar com 2 dedos ou roda.
- **Toque**: 1 dedo arrasta o clipe tocado / rola o fundo; 2 dedos pinça e rola; toque longo = menu.
  Caneta: apara/divide com precisão; dedo nunca move clipe por engano durante a rolagem (limiar de
  movimento, como na Montagem do WJCAD).

### 5.4 Atalhos (computador e teclado do tablet)

Comuns a todas as faces: Ctrl+Z/Y/S/C/V/X/F/P. Próprios desta face (propostos, padrão do mercado de
edição, não nome registrado):

| Tecla | Ação |
|---|---|
| Espaço | tocar/pausar |
| J / K / L | trás / pausa / frente (repetir acelera) |
| ← / → | um quadro; Shift: 1 s |
| ↑ / ↓ | corte anterior / próximo |
| Home / End | início / fim |
| I / O | marca de entrada / saída (exportar faixa) |
| Ctrl+B ou S | dividir no cursor |
| Q / W | aparar o início / o fim até o cursor |
| Delete / Shift+Delete | excluir / excluir e fechar o vão |
| M | marcador |
| N | ímã liga/desliga |
| `+` / `−` | zoom da linha do tempo |
| Ctrl+E | exportar |

## 6. Motor (arquitetura)

### 6.1 Peças

| Parte | Onde roda | Tecnologia |
|---|---|---|
| Modelo do projeto e operações da linha do tempo (dividir, aparar, *ripple*, ímã, quadros-chave, "o que está na tela no tempo t") | thread da UI, **puro e testado em Node** (`src/video/linha.ts`, `tempo.ts`) | TypeScript |
| Leitura de contêiner e amostras | Worker | `mediabunny` (`BlobSource` para arquivo/pasta/pendrive/OPFS; `UrlSource` com cabeçalho de acesso para o Drive) |
| Decodificação | Worker | WebCodecs `VideoDecoder`/`AudioDecoder` (hardware); `ImageDecoder` para fotos e GIF |
| Composição dos quadros (pistas, transformações, transições, efeitos, cor, texto) | Worker com `OffscreenCanvas` | **WebGL2** (shaders próprios); `VideoFrame` vai direto para textura, sem cópia na CPU. WebGPU ⏸ (o WebGL2 é mais garantido nos Android de entrada) |
| Texto | Worker | Canvas 2D → textura (fontes do sistema + poucas fontes livres OFL embutidas) |
| Áudio no visualizador | thread de áudio | Web Audio (`AudioWorklet` com o mixador) sincronizado ao relógio de áudio |
| Áudio na exportação | Worker | mixador puro (mesmo código) gerando PCM → `AudioEncoder` |
| Exportação | Worker | composição quadro a quadro → `VideoEncoder` (hardware) → `mediabunny` grava MP4/WebM direto no arquivo de destino (`FileSystemWritableFileStream`) ou no OPFS |
| Miniaturas, forma de onda, proxies, detecção de cenas/silêncios/batidas | Worker de fundo, baixa prioridade | WebCodecs + funções puras testadas |

Regra do projeto mantida: **nada pesado na thread da UI**; o visualizador recebe o quadro pronto
(`ImageBitmap`/`VideoFrame` transferido) e só desenha.

### 6.2 Reprodução em tempo real

- Pré-busca: o Worker decodifica à frente do cursor (fila pequena; **todo `VideoFrame` é fechado
  logo após o uso** — vazamento de quadro trava o decodificador no Android).
- **Qualidade do visualizador**: Automática / Completa / Metade / Um quarto. Na automática, se o
  aparelho não acompanha, baixa a resolução da prévia e, por último, pula quadros (o áudio nunca
  engasga).
- **Pré-renderizar trecho** (barra colorida sobre a régua: verde = pronto, amarelo = pode engasgar,
  vermelho = pesado): trechos com muitos efeitos podem ser renderizados para o cache e tocados lisos.
- Busca (arrastar o cursor): mostra o quadro-chave mais próximo na hora e o quadro exato logo depois.

### 6.3 Proxies e cache

- **Proxy**: cópia em 720p (ou 540p no celular) H.264 com quadros-chave frequentes, criada em
  segundo plano para vídeos acima do que o aparelho edita liso (4K, HEVC 10 bits, taxa muito alta).
  A edição usa o proxy; **a exportação sempre usa o original**. Liga/desliga por projeto.
- Tudo no **OPFS** (`wjvideo/cache/<impressão digital>/`): proxies, miniaturas, formas de onda,
  cópias de mídia do Drive/pendrive/galeria, trechos pré-renderizados. Tela "Cache" com tamanho por
  projeto e **Limpar**. Pedir armazenamento persistente (`navigator.storage.persist`).

### 6.4 Exportação

- Composição no mesmo motor do visualizador, mas **sem pular quadros** e na resolução final.
- Progresso com tempo restante real; **mantém a tela ligada** (Wake Lock) e avisa que o Android pode
  pausar a exportação se o app for para segundo plano; **retomar** de onde parou ⏸.
- Destino: cofre (pasta "Vídeos/Exportados", **sem histórico de versões** do arquivo de vídeo ❓),
  pasta do dispositivo, pendrive, Drive (envio em partes, retomável) ou Compartilhar.

## 7. Projeto `.wjvid` e o cofre

### 7.1 Formato

JSON versionado (como os demais), pequeno — a mídia não vai dentro:

```
{ versao, nome,
  config: { largura, altura, fps: [num, den], amostragemAudio, corFundo },
  midias: [ { id, nome, tipo, origem: { kind: "drive"|"pasta"|"pendrive"|"cofre"|"cache"|"face",
             idDrive?, caminho?, uri? }, digital: { tamanho, duracaoUs, hashInicioFim },
             largura, altura, fps, temAudio } ],
  pistas: [ { id, tipo: "video"|"audio", nome, mudo, travada, oculta } ],
  clipes: [ { id, pista, midia?, inicioUs, duracaoUs, entradaUs, velocidade, preso?,
             transformar, efeitos: [], cor, audio, texto?, chaves: { <prop>: [[tUs, valor, curva]] } } ],
  transicoes: [ { entre: [clipeA, clipeB], tipo, duracaoUs, alinhamento } ],
  marcadores: [], legendas: [] }
```

- Autosave contínuo (IndexedDB `wjvideo`, por janela como nas outras faces) e desfazer por
  fotografias (leve, porque o JSON é pequeno).
- **Impressão digital** (tamanho + duração + hash do primeiro e do último MB): reencontra a mídia se
  ela mudar de lugar, e recusa trocar por outro arquivo com o mesmo nome.

### 7.2 Cofre

- `.wjvid` salvo no cofre (pasta da face **"Vídeos"**), com o fluxo de sempre: primeiro salvar abre o
  explorador do cofre e publica a versão 1; GO-OUT/GO-IN; cópias no Drive/pendrive/pasta.
- **Mídia não entra no cofre por padrão** ❓ (recomendação): vídeos têm centenas de MB a GB e cada
  GO-IN guarda uma cópia na pasta "(versões)" das três cópias; o Drive e o pendrive se encheriam. A
  mídia continua onde está e o projeto aponta para ela.
- **Empacotar projeto** (opcional): copia projeto + mídia usada (só os trechos usados, com margem ⏸)
  para uma pasta escolhida — para levar o projeto para outro aparelho ou arquivar.

### 7.3 Mídia offline

Ao abrir o projeto, cada mídia é procurada: cache OPFS → origem (Drive/pasta/pendrive) → pastas
lembradas. Não achou: o clipe fica com faixa "mídia offline" e a biblioteca mostra **Localizar…**
(escolher o arquivo ou a pasta; a impressão digital confere; achar uma reencontra as outras da mesma
pasta). O projeto abre e edita normalmente; só a exportação exige tudo presente.

## 8. Requisitos não funcionais (metas, conferidas no V0 no TCL Tab A1 Plus)

| Item | Meta |
|---|---|
| Abrir o app (sem projeto) | < 2 s; o motor de vídeo só carrega ao abrir/criar projeto |
| Tamanho baixado da página | < 400 kB comprimido além da casca (sem `ffmpeg.wasm`, sem framework) |
| Interação na linha do tempo (arrastar, aparar, zoom) | 60 qps com 200 clipes |
| Reprodução 1080p30, 1 pista de vídeo + títulos | tempo real, qualidade completa |
| Transição/sobreposição 1080p (2 vídeos) | tempo real em metade da resolução |
| Exportar 1 min de 1080p30 simples | ≤ 2 min no tablet (medir); ≤ tempo real no computador |
| Memória | sem crescer durante reprodução longa (quadros fechados, cache com limite) |
| Offline | tudo funciona sem internet, exceto Drive e Picker |
| Falhas | erro de decodificação de um clipe não derruba o projeto: o clipe fica marcado e o resto toca |

## 9. Exportação — formatos e predefinições

| Predefinição (nome genérico) | Contêiner | Vídeo | Áudio |
|---|---|---|---|
| Horizontal 16:9 1080p (padrão) | MP4 | H.264, 1920×1080, fps do projeto, ~12 Mbit/s | AAC 192 kbit/s |
| Horizontal 16:9 4K (só computador/aparelho que codifica 4K) | MP4 | H.264 ou H.265 | AAC |
| Vertical 9:16 (vídeo curto) | MP4 | H.264 1080×1920 | AAC |
| Quadrado 1:1 / Retrato 4:5 | MP4 | H.264 | AAC |
| Pequeno para mensagem | MP4 | H.264 720p, taxa calculada para caber no tamanho alvo (ex.: 16 MB) | AAC 96 kbit/s |
| Web aberto | WebM | VP9 ou AV1 | Opus |
| Animação curta | GIF | paleta otimizada, até 480 px | — |
| Só áudio | M4A (AAC) / WAV / Opus | — | — |
| Quadro atual | PNG / JPEG | — | — |

- Se o aparelho não tiver codificador **AAC** (alguns Linux), o app avisa e oferece Opus em MP4 ou
  WebM. O V0 lista os codificadores do aparelho.
- Taxa: constante ou "qualidade" (variável); quadro-chave a cada 2 s; legendas embutidas no MP4 ⏸ ou
  queimadas no vídeo; capítulos a partir dos marcadores ⏸.

## 10. Dependências e alternativas avaliadas

| Opção | Decisão | Motivo |
|---|---|---|
| **WebCodecs** (navegador) | ✅ usar | aceleração de hardware, sem baixar codec, licença dos codecs coberta pelo sistema/navegador |
| **mediabunny** (MPL-2.0, projeto conhecido, TS, zero dependências, *tree-shaking*) | ✅ proposta (única dependência nova) | lê e grava MP4/MOV/WebM/MKV/MP3/WAV/Ogg com acesso por partes (não carrega o vídeo inteiro na memória); escrever um demuxador/muxador próprio seria semanas de trabalho com muitos casos de borda (MOV de celular, edit lists, rotação). Revisar `pnpm-lock.yaml` e respeitar os 3 dias de `minimumReleaseAge` |
| mp4box.js + mp4-muxer + webm-muxer | ✕ | três bibliotecas para o que a mediabunny faz sozinha (é a sucessora das duas últimas, do mesmo autor) |
| ffmpeg.wasm | ✕ por ora (⏸ plano B para formatos exóticos) | ~25–30 MB, sem aceleração de hardware (10–50× mais lento), multithread exige COOP/COEP (que quebra o login do Google) e a licença depende do build (LGPL/GPL) |
| Editores/frameworks web prontos (com licença comercial ou de outro produto) | ✕ | licença, peso, e a interface tem de ser a nossa |
| Fontes | ✅ fontes do sistema + 3–5 fontes livres (OFL) embutidas sob demanda | sem baixar fontes da internet em tempo de uso |
| IA local (recorte de fundo, legenda automática) | ⏸ | modelos de dezenas de MB; avaliar depois (V6), opcional e com download sob demanda |

## 11. Integrações

| Com | O quê | Fase |
|---|---|---|
| **WJPDM** | projeto `.wjvid` no cofre; exportação no cofre; mídia de imagens do cofre; "Usado em" (o vídeo usa a revisão B da peça) | V1 |
| **WJCAD** | menu Arquivo → **Gravar animação** (giro 360° da peça na vista atual, duração e fundo escolhidos) gera um clipe e abre no WJVideoMaker; atalho de navegação, o WJCAD não ganha comandos de vídeo | V5 |
| **WJFlow** | animação do corte do escoamento (velocidade/pressão) como clipe | V5 |
| **WJApresentation** | inserir vídeo exportado no slide (com corte de início/fim no slide) | V5 |
| **WJWrite** | quadro do vídeo como figura; link para o vídeo no cofre | ⏸ |
| **WJTaskPlan** | — | — |

## 12. Roteiro do WJVideoMaker

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **V0** | **Teste do aparelho** (`video/aparelho/`, como o do WJFlow): lista codecs de decodificação e codificação com aceleração (H.264/HEVC/VP9/AV1/AAC/Opus) e resoluções aceitas; mede decodificação simultânea (1, 2, 3 vídeos 1080p), composição WebGL2 e exportação de 10 s; espaço do OPFS; seletores de pasta/pendrive | números do TCL anotados aqui (§8) e decisões de proxy/limites ajustadas |
| **V1** | **Núcleo utilizável**: página `video/` e caixa no início; projeto 16:9 ou 9:16; **importar de pasta, pendrive, galeria e Drive (Picker)**; biblioteca com miniaturas; linha do tempo com pista principal magnética + 1 pista de sobreposição + 1 de áudio; mover, aparar, dividir, excluir, fechar vão; fotos com duração; volume e *fade*; visualizador com qualidade automática; **exportar MP4 1080p**; `.wjvid` no cofre; mídia offline/Localizar; autosave e desfazer | caso 4 (fotos + música) e caso 5 (cortes de vídeos do pendrive) feitos no tablet do início ao fim |
| **V2** | **Montagem completa**: pistas ilimitadas, transformar (posição/escala/rotação/opacidade), recorte, girar/espelhar, sobreposição e tela dividida, pan & zoom em foto, **quadros-chave**, velocidade (constante, inverter, congelar), **títulos** e rótulos com animação, **transições**, marcadores, *roll*/*slip*, agrupar, copiar atributos | caso 1 (vídeo técnico) e caso 3 sem áudio avançado |
| **V3** | **Áudio**: várias pistas, forma de onda, quadros-chave de volume, normalizar (LUFS), *ducking*, equalizador, redução de ruído simples, **gravar narração**, detectar silêncios (cortar automaticamente), marcar batidas | caso 3 completo (cortes no ritmo) |
| **V4** | **Cor e efeitos**: correção básica, curvas, HSL, **LUT `.cube`**, croma, máscaras (inclusive desenhadas com a caneta), desfoque/mosaico de área com quadros-chave, vinheta, modos de mesclagem, antes/depois | croma e LUT conferidos com imagem de referência |
| **V5** | **Acabamento**: proxies automáticos, pré-renderizar trecho, legendas SRT/VTT (importar, editar, exportar, queimar), GIF, só áudio, quadro como imagem, WebM, "pequeno para mensagem", detecção de cenas, empacotar projeto, integrações WJCAD/WJFlow/WJApresentation, gravação de tela (computador) | caso 2 (tutorial com legendas) |
| **V6** ⏸ | **Avançado** (decidir com o Johann): estabilização, rastreamento de movimento (texto/mosaico seguindo um objeto), recorte de fundo sem croma (IA local), legenda automática por fala (servidor G5 ou modelo local), reenquadrar automático 16:9 → 9:16, modelos de projeto, escopos de cor, HDR, rampas de velocidade, retomar exportação | — |

Cada fase é entregue utilizável no tablet, testada simulando o tablet (1280×800, toque, perfil
Tablet) e publicada na hora (regras 6, 7 e 9).

## 13. Testes

- **Node** (`scripts/teste-video.ts`, entra no `pnpm teste`): aritmética de tempo em µs e quadros
  (24/25/29,97/30/60), dividir/aparar/*ripple*/*roll*/*slip*, pista magnética e clipes presos, ímã,
  interpolação de quadros-chave, "camadas visíveis no tempo t" com transições, mixador de áudio
  (ganho, *fade*, *ducking*), normalização LUFS, detecção de silêncio e de batidas em sinais
  sintéticos, cálculo de taxa para tamanho alvo, leitura/gravação de SRT/VTT e `.cube`, validação e
  migração do `.wjvid`.
- **Navegador** (Playwright, perfil Tablet): importar vídeos de teste **gerados pelo próprio teste**
  (sem arquivo de terceiros no repositório), editar, exportar MP4 curto e conferir duração, resolução
  e alguns quadros por cor; mídia offline → Localizar.
- O Chromium do Playwright no Linux não tem codificador H.264/AAC: os testes de exportação usam
  VP9/Opus ali e a exportação MP4 é conferida no tablet (V0 e cada entrega).

## 14. Perguntas ao Johann (decisões antes da V1)

1. **Mídia no cofre?** Recomendação: **não** (vínculos + cache no aparelho + "Empacotar projeto"
   quando quiser levar tudo). Alternativa: pasta "Vídeos/Mídia" no cofre **sem versões**, copiada só
   para a pasta do dispositivo e o pendrive (não para o Drive).
2. **Chave de API para o seletor do Google Drive**: criar no projeto Google `wjpromaster` uma chave de
   API do navegador, restrita a `https://johann-sicherl.github.io` e à Picker API (passo a passo vai
   no PR da V1). Sem ela, a V1 sai com pasta, pendrive e galeria, e o Drive entra quando a chave
   existir.
3. **Uso principal** (define a ordem de V2–V4): vídeo técnico de produto/treinamento, vídeo curto
   vertical, ou fotos/registro de obra?
4. **Resolução máxima**: no tablet, **1080p** é o teto do hardware; 4K fica só no computador. Ok?
5. **Exportação no cofre com versões ou sem?** Recomendação: sem (o vídeo é refeito a partir do
   projeto, que é versionado).
6. **Extensão `.wjvid`** e pasta da face **"Vídeos"** no cofre: ok?

## 15. Nome

**WJVideoMaker**, definido pelo Johann em 05/11/2026. "Video" e "Maker" são palavras genéricas, mas
"Movie Maker" é marca da Microsoft e há apps com "Video Maker" no nome: fazer a busca no INPI antes
de registrar (README §6). Na UI nunca aparece o nome do software de referência.

## 16. Estado (05/11/2026)

- Especificação e levantamento de requisitos: este documento.
- Caixa **"WJVideoMaker — Em breve · V1"** na página inicial do WJProMaster.
- Nada do motor implementado. Próximo passo: respostas do §14 → **V0** (teste do aparelho).

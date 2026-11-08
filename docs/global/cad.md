# WJCAD dentro do WJProMaster

O WJCAD é o antigo JLSCAD (arquivos `.wjcad`; abre `.jlscad` e `.cadt`). A especificação funcional completa do CAD continua em `docs/funcional/`:
- [features](../funcional/features.md)
- [sketch](../funcional/sketch.md)
- [chapa](../funcional/chapa.md)
- [avaliar](../funcional/avaliar.md)
- [referência do guia](../funcional/referencia-introducao.md)

Aqui fica só o que o CAD precisa **expor ou receber** para fazer parte do ecossistema.

## 1. Migração para o monorepo (G0)
- `src/` atual → `apps/cad/src/`. Núcleo de UI comum (abas, painel ✓/✕, árvore, menus, barra de
  status, perfis de dispositivo, gaveta, lupa) extraído para `packages/nucleo`. Ícones vão para
  `packages/icones`.
- O kernel (replicad/OpenCascade) continua só no CAD, carregado sob demanda. As outras faces nunca
  o baixam.
- Testes atuais (`teste-kernel`, `teste-esboco`, `teste-recursos`) continuam passando sem mudança
  de comportamento.

## 2. O que o CAD expõe (G1/G5)
- **Propriedades da peça** (janela Arquivo → Propriedades): padrão e personalizadas.
  - Padrão: código, descrição, material, massa, volume, área, caixa delimitadora.
  - Personalizadas: valores ou fórmulas como `=Massa*1,1`.
  - Por configuração.
- **Objetos endereçáveis** `wj://cad/<arquivo>/…`: propriedade, cota (`D1@Esboço1`), parâmetro de
  recurso, configuração, vista salva, planificado, lista de corte.
- **Funções para o motor comum**: `WJ.CAD(arquivo; nome)`.
- **Exportações de liberação** (chamadas pelo PDM, em Worker, sem UI):
  - STEP, STL;
  - DXF do planificado;
  - PDF/PNG de vistas;
  - malha leve (glTF) para o visualizador 3D.
- **Cotas de inspeção** (G7+): marcar cota como característica crítica, com tolerância. Alimenta o
  plano de inspeção do ERP.

## 3. O que o CAD recebe
- Material com densidade e custo do cadastro do ERP. A lista de materiais atual vira o fallback offline.
- Itens comprados (parafusos, perfis, componentes) para inserir quando houver montagens ⏸.
- Valores de células da Planilha para variáveis globais e tabela de configurações.
- Estado do WJPDM (o diretório do WJCAD, ver [pdm.md](pdm.md)): estado/revisão no título, travado quando liberado, check-out/check-in pelo menu
  Arquivo.

## 4. Pendências do CAD que entram na G1
- Chapa: (canto automático, itens da árvore e dobra esboçada, junta e meia-esquadria ✅)
  cantos, desdobrar/dobrar, converter em chapa.
- Fase 5: propriedades de seção.
- Fase 3: filete variável/de face, furo avançado.

## 5. Imagem → modelo 3D (pedido do Johann em 07/11/2026)

- **O que é:** gerar um modelo 3D a partir de **até 8 fotos das vistas** (frente, trás, esquerda,
  direita, cima, baixo, frente-esquerda e frente-direita a 45°), com a **quantidade de faces: 1,5 M,
  1 M, 500 mil e 50 mil**. Abre em **aba nova** (página `cad/imagem3d/`, pelo menu da Peça →
  "Imagens → modelo 3D"), sem mudar as quatro áreas de comando da Peça.
- **Decisão (07/11/2026):** **gerador próprio, em duas camadas**. Treinar uma IA do zero não cabe no
  projeto. Os pesos abertos da Tencent (Hunyuan3D até 2.1) têm licença não comercial e precisam de
  NVIDIA, que o Johann não tem; as 8 vistas e a faixa de faces só existem no 3.x, como serviço pago.
  - **Fase 1 — casco visual (✅ 08/11/2026)**: todo nosso, offline, roda no tablet. Fotos com **fundo
    liso sempre** (decisão do Johann).
  - **Fase 2 — acabamento por IA (⏸ G5)**: modelo aberto e com licença conferida (ex.: TripoSR, MIT),
    num servidor com GPU usado só na hora; refina superfícies orgânicas e cavidades.
- **Como a fase 1 funciona** (`src/imagem3d/casco.ts`, no worker):
  1. **Silhueta:** a cor do fundo é a mediana da borda da foto; um pixel é peça quando fica mais longe
     dela que a **tolerância** (controle deslizante, com prévia em vermelho). Manchas menores que 1% e
     reflexos internos menores que 0,2% são limpos; furos passantes ficam.
  2. **Medidas:** as proporções das caixas das silhuetas, combinadas por mínimos quadrados em log,
     dão a largura (X), a altura (Y) e a profundidade (Z). Uma **medida conhecida** em mm fixa a escala,
     e cada foto pode ter sido tirada a uma distância diferente.
  3. **Escultura:** grade de voxels com a **fração coberta** (0–255) de cada vista ortogonal, calculada
     pela soma acumulada interpolada (área exata, antisserrilhada). Cada ponto da grade fica com o
     mínimo entre as vistas. As diagonais tiram a escala da altura e o centro do que já foi esculpido.
  4. **Superfície:** redes de superfície (surface nets) com posição sub-voxel, fechada e orientada,
     mais 2 passadas de suavização de Taubin (o volume muda menos de 1%).
  5. **Quantidade de faces:** a resolução da grade é escolhida para passar um pouco do pedido (até
     ~420 células, 48 M pontos). Só se passou de 8% a malha é reduzida (`simplificarStl`). Medido no
     servidor: 500 mil faces em ~1,5 s; 1,5 M em ~4 s sem a redução, ~11 s com ela.
- **Resultado:** vista 3D na própria página, **Abrir na Peça** (o STL vai para uma janela da Peça, que
  oferece simplificar para sólido editável ou abrir como corpo de malha) e **Salvar STL…** (explorador
  do cofre, ou no dispositivo). Eixos do WJCAD: frente = XY olhando de +Z, peça apoiada em Y = 0.
- **Limites da fase 1:** cavidades que não aparecem no contorno de nenhuma vista (bolsão cego, rebaixo)
  não saem; a foto em perspectiva (câmera perto) distorce — a dica "Como fotografar" pede distância
  com zoom.

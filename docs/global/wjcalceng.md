# WJCalcEng — cálculos de engenharia do curso

Face do WJProMaster pedida pelo Johann em 07/11/2026: um lugar para **guardar as formas de calcular**
o que ele aprende no curso de engenharia. Cada cálculo é uma **calculadora** (módulo) da lista à
esquerda; o documento `.wjcalc` vive no cofre do WJPDM (pasta padrão **Cálculos**), como os
arquivos de todos os apps. Página `calceng/`, código em `src/calceng/`, motor testado em Node
(`scripts/teste-calceng.ts`, dentro do `pnpm teste`).

## 1. Calculadoras pedidas (roteiro)

| Calculadora | Estado |
|---|---|
| Centro de gravidade em 2D (esboço, cotas, massa, momento de inércia) | ✅ C1 (07/11/2026) |
| Equação do 1º grau | C2 |
| Equação do 2º grau | C2 |
| Equações com mais de 2 variáveis (sistemas) | C2 |
| Inequações | C2 |
| Matriz 3×3 por Cramer e por Gauss | C3 |
| Multiplicação de matrizes | C3 |
| Leis de Newton | C4 |
| Plano inclinado | C4 |
| Força de atrito | C4 |
| Trabalho | C4 |

A ordem C2–C4 é sugestão (álgebra → matrizes → física); muda quando o Johann pedir.

## 2. Centro de gravidade em 2D (C1)

### 2.1 Esboço
- Aba **Esboço**: Selecionar (V/Esc), **Retângulo** (R; arrastar de canto a canto ou dois toques),
  **Círculo** (C; centro e raio), **Setor circular** (A; centro e arraste para o lado da curva: nasce
  semicírculo; abertura 90°/180°/270° ou qualquer ângulo no painel, botão "↺ 90°"), **Triângulo**
  (T; três toques), **Polígono** (P; toques, fecha no primeiro vértice, toque duplo ou Enter),
  **Cota** (D), Ajuste à grade (G), Enquadrar (F), Excluir (Delete), Memória de cálculo, Exemplo.
- Grade adaptável ao zoom (1/2/5 × 10ⁿ mm) com ajuste à grade e aos pontos notáveis (cantos,
  centros, vértices, extremos de arco, origem). Origem com eixos x (vermelho) e y (verde), y para cima.
- Entrada como no resto do WJProMaster: caneta e mouse desenham; com caneta, o dedo navega
  (1 dedo arrasta, 2 dedos aproximam); sem caneta o dedo também desenha e 2 dedos navegam. Mouse:
  meio arrasta, roda aproxima no cursor, direito abre o menu. Toque longo (0,6 s) = menu.
- Selecionar: toque seleciona, arrastar move (passo da grade). Cada figura pode ser **sólida** ou
  **furo (vazio)** (menu ou painel); furos aparecem hachurados e entram com área e massa negativas.
- Campos do painel aceitam vírgula e contas simples (`100/3`, `2*pi*15`, `3^2`).

### 2.2 Cotas
- Dois toques em pontos notáveis → cota **horizontal**, **vertical** ou **alinhada** (automática
  pela direção; troca no painel). Toque na borda de um círculo → **diâmetro**; de um setor → **raio**.
- Ao criar, o painel abre com o **valor** pronto para digitar. Cota **dirigida** (padrão) comanda a
  geometria: move a figura do segundo ponto (se o segundo ponto for a origem, a do primeiro); com os
  dois pontos na mesma figura, muda o tamanho dela (canto oposto fixo). Cota de **referência**
  (entre parênteses) só mostra a medida.
- As cotas são reaplicadas a cada mudança, na ordem de criação: mover uma figura arrasta as cotadas a
  partir dela. Cota nova que contradiz as existentes entra como referência (aviso); conflito fica em
  vermelho. Arrastar a cota muda o afastamento; "Outro lado" no painel ou no menu.

### 2.3 Massa
- **Mesmo material** (padrão): densidade ρ (kg/m³, padrão aço 7850) e espessura t (mm);
  m = ρ·t·A. O CG coincide com o centroide da área.
- **Massa de cada figura**: a massa (kg) é informada em cada figura (furo = massa retirada). O CG é a
  média ponderada pelas massas; o centroide da área aparece à parte (✕ no desenho) quando difere.

### 2.4 Resultados (painel e desenho)
- CG de **cada figura** (símbolo azul com o nome) e do **conjunto** (símbolo preto com X; Y).
- Por figura: área, massa, x̄, ȳ, Ix', Iy', Ixy' nos eixos do próprio centroide.
- Conjunto: massa total, área líquida; **momento de inércia de área** nos eixos pelo centroide
  (Ix, Iy, Ixy, J, principais I₁/I₂ e ângulo θ) e nos eixos da origem; **momento de inércia de
  massa** pelo CG (Ix, Iy, Iz polar; placa fina de massa uniforme em cada figura), em kg·mm² e kg·m².
- **Memória de cálculo**: tabela Figura | A | m | x̄ | ȳ | A·x̄ (ou m·x̄) | … | Ix'+A·dy² | Iy'+A·dx²,
  com X = ΣA·x̄/ΣA (ou Σm·x̄/Σm) e o teorema dos eixos paralelos escritos com os números.
  **Copiar tabela** (texto com tabulações) cola direto no WJPlan.
- Fórmulas: polígono pela fórmula de Green (shoelace) com momentos de 2ª ordem; setor circular pelas
  integrais fechadas em θ (cobre círculo, semicírculo e quarto de círculo). Testadas contra as tabelas
  (b·h³/12, b·h³/36, π·r⁴/4, (π/8 − 8/9π)·r⁴, 4r/3π, −b²h²/72, placa m(b²+h²)/12).

### 2.5 Arquivo
`.wjcalc` = JSON `{ versao: 1, nome, modulo: "cg2d", cg2d: { figuras, cotas, material } }`; unidades mm e kg.
Salvamento automático no aparelho (`wjcalc:documento`), desfazer/refazer, salvar no cofre (Ctrl+S).

## 3. Pendente / ideias
- Cotas de ângulo e relações (paralelo, igual…) — só se o Johann pedir; hoje as medidas de forma
  vêm do painel e as de posição, das cotas.
- Figuras de massa pontual e eixo de referência escolhido pelo usuário (hoje: origem e CG).

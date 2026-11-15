// WJSlicer3D: vista isométrica automática de uma peça (JPEG sobre fundo branco) para a proposta comercial.
// Câmera ortográfica a 45° em volta de Z (Z para cima, como na mesa) e 35° de elevação, enquadrada pela caixa da
// peça; as cores pintadas da peça aparecem; arestas vivas em traço fino. Só roda no navegador (WebGL).

import * as THREE from "three";

export function vistaIsometrica(pos: Float32Array, tri: Uint32Array, cores: Uint8Array | null, hexCores: string[], largura = 800, altura = 600): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(largura, altura, false);
  renderer.setClearColor(0xffffff, 1);
  try {
    const cena = new THREE.Scene();
    cena.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.25));
    const sol = new THREE.DirectionalLight(0xffffff, 1.7);
    sol.position.set(1.2, -2, 3);
    cena.add(sol);
    const nt = tri.length / 3;
    const p = new Float32Array(nt * 9), c = new Float32Array(nt * 9);
    const base = new THREE.Color(hexCores[0] ?? "#2f7fd0");
    const paleta = hexCores.map((h) => new THREE.Color(h));
    for (let t = 0; t < nt; t++) {
      const cor = (cores && paleta[cores[t]]) || base;
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k] * 3;
        p.set([pos[v], pos[v + 1], pos[v + 2]], t * 9 + k * 3);
        c.set([cor.r, cor.g, cor.b], t * 9 + k * 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
    geo.computeVertexNormals();
    const malha = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }));
    cena.add(malha);
    cena.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), new THREE.LineBasicMaterial({ color: 0x2b3440 })));
    geo.computeBoundingBox();
    const caixa = geo.boundingBox!;
    const centro = caixa.getCenter(new THREE.Vector3());
    const tamanho = caixa.getSize(new THREE.Vector3()).length() || 1;
    const dir = new THREE.Vector3(1, -1, 0.85).normalize();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -tamanho * 10, tamanho * 10);
    cam.up.set(0, 0, 1);
    cam.position.copy(centro).addScaledVector(dir, tamanho * 2);
    cam.lookAt(centro);
    cam.updateMatrixWorld(true);
    // enquadra a caixa: cantos no espaço da câmera
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [caixa.min.x, caixa.max.x]) for (const y of [caixa.min.y, caixa.max.y]) for (const z of [caixa.min.z, caixa.max.z]) {
      const q = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    const margem = 1.12;
    let w = (x1 - x0) * margem, h = (y1 - y0) * margem;
    const aspecto = largura / altura;
    if (w / h < aspecto) w = h * aspecto;
    else h = w / aspecto;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    cam.left = cx - w / 2; cam.right = cx + w / 2; cam.top = cy + h / 2; cam.bottom = cy - h / 2;
    cam.updateProjectionMatrix();
    renderer.render(cena, cam);
    const url = renderer.domElement.toDataURL("image/jpeg", 0.88);
    geo.dispose();
    return url;
  } finally {
    renderer.dispose();
  }
}

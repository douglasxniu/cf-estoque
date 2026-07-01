// Fundo animado tipo "rede neural" que reage ao mouse — puramente decorativo, atrás do conteúdo.
(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'neuralBg';
  canvas.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.55';
  document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext('2d');

  const COLOR_NODE = '124,92,255';
  const COLOR_LINE = '91,140,255';
  const LINK_DIST = 140;
  const MOUSE_DIST = 200;
  let W, H, nodes = [];
  const mouse = { x: -9999, y: -9999 };

  function contarNos() {
    const area = W * H;
    return Math.max(30, Math.min(90, Math.round(area / 18000)));
  }

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    const alvo = contarNos();
    if (nodes.length < alvo) {
      for (let i = nodes.length; i < alvo; i++) nodes.push(criarNo());
    } else {
      nodes.length = alvo;
    }
  }

  function criarNo() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 1
    };
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

  function passo() {
    ctx.clearRect(0, 0, W, H);

    nodes.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;

      const dxm = n.x - mouse.x, dym = n.y - mouse.y;
      const distM = Math.hypot(dxm, dym);
      if (distM < MOUSE_DIST) {
        const forca = (1 - distM / MOUSE_DIST) * 0.02;
        n.vx += (dxm / (distM || 1)) * forca;
        n.vy += (dym / (distM || 1)) * forca;
      }
      const vmax = 0.9;
      n.vx = Math.max(-vmax, Math.min(vmax, n.vx));
      n.vy = Math.max(-vmax, Math.min(vmax, n.vy));
    });

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK_DIST) {
          ctx.strokeStyle = `rgba(${COLOR_LINE},${(1 - d / LINK_DIST) * 0.35})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      const n = nodes[i];
      const dm = Math.hypot(n.x - mouse.x, n.y - mouse.y);
      if (dm < MOUSE_DIST) {
        ctx.strokeStyle = `rgba(${COLOR_LINE},${(1 - dm / MOUSE_DIST) * 0.6})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
      }
    }

    nodes.forEach(n => {
      ctx.fillStyle = `rgba(${COLOR_NODE},.8)`;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    });

    requestAnimationFrame(passo);
  }

  resize();
  requestAnimationFrame(passo);
})();

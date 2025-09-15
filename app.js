(() => {
  const fileInput = document.getElementById('fileInput');
  const baseCanvas = document.getElementById('baseCanvas');
  const baseCtx = baseCanvas.getContext('2d');
  const pickInfo = document.getElementById('pickInfo');

  const hueRangeEl = document.getElementById('hueRange');
  const satRangeEl = document.getElementById('satRange');
  const lightRangeEl = document.getElementById('lightRange');
  const toleranceEl = document.getElementById('tolerance');
  const variantCountEl = document.getElementById('variantCount');
  const mirrorModeEl = document.getElementById('mirrorMode');

  const gradientTypeEl = document.getElementById('gradientType');
  const gradientAngleEl = document.getElementById('gradientAngle');
  const addStopBtn = document.getElementById('addStopBtn');
  const randomizeGradientBtn = document.getElementById('randomizeGradientBtn');
  const gradientPreview = document.getElementById('gradientPreview');
  const gradientPreviewCtx = gradientPreview.getContext('2d');
  const stopsOverlay = document.getElementById('stopsOverlay');

  const generateBtn = document.getElementById('generateBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const progressEl = document.getElementById('progress');
  const previewGrid = document.getElementById('previewGrid');

  let imageBitmap = null;
  let baseImageData = null;
  let pickedColor = null; // {r,g,b,a}
  let gradientStops = [
    { id: crypto.randomUUID(), offset: 0.0, color: '#6aa6ff' },
    { id: crypto.randomUUID(), offset: 1.0, color: '#7bdaaf' },
  ];

  let worker = null;
  let lastResults = [];

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  async function loadWorker() {
    if (worker) return worker;
    worker = new Worker('worker.js', { type: 'module' });
    worker.addEventListener('error', (e) => {
      alert('Worker error: ' + (e.message || 'Unknown error')); 
      generateBtn.disabled = false; 
      downloadZipBtn.disabled = previewGrid.children.length === 0;
    });
    return worker;
  }

  function fitAndDrawImage(img) {
    const w = img.width, h = img.height;
    const size = Math.max(w, h, 1);
    baseCanvas.width = size;
    baseCanvas.height = size;
    baseCtx.clearRect(0, 0, size, size);
    const dx = (size - w) / 2;
    const dy = (size - h) / 2;
    baseCtx.drawImage(img, dx, dy);
    baseImageData = baseCtx.getImageData(0, 0, size, size);
  }

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'image/png') {
      alert('Please upload a PNG file with a transparent background.');
      return;
    }
    let img;
    try {
      img = await createImageBitmap(file);
    } catch (err) {
      alert('Failed to load image. Make sure it is a valid PNG.');
      return;
    }
    imageBitmap = img;
    fitAndDrawImage(img);
    generateBtn.disabled = true;
    progressEl.textContent = '';
    previewGrid.innerHTML = '';
    pickedColor = null;
    pickInfo.textContent = 'No color selected';
  });

  baseCanvas.addEventListener('click', () => {
    if (!baseImageData) return;
    // pick color at cursor
  });

  baseCanvas.addEventListener('pointerdown', (ev) => {
    if (!baseImageData) return;
    const rect = baseCanvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) * (baseCanvas.width / rect.width));
    const y = Math.floor((ev.clientY - rect.top) * (baseCanvas.height / rect.height));
    const idx = (y * baseCanvas.width + x) * 4;
    const d = baseImageData.data;
    pickedColor = { r: d[idx], g: d[idx+1], b: d[idx+2], a: d[idx+3] };
    const hex = '#' + [pickedColor.r, pickedColor.g, pickedColor.b].map(v=>v.toString(16).padStart(2,'0')).join('');
    pickInfo.textContent = `Picked ${hex} (rgba ${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b}, ${pickedColor.a})`;
    generateBtn.disabled = false;
  });

  function renderGradientPreview() {
    const w = gradientPreview.width;
    const h = gradientPreview.height;
    gradientPreviewCtx.clearRect(0,0,w,h);
    const type = gradientTypeEl.value;
    let grad;
    if (type === 'linear') {
      const angle = (parseInt(gradientAngleEl.value, 10) || 0) * Math.PI / 180;
      const cx = w/2, cy = h/2;
      const dx = Math.cos(angle) * w/2;
      const dy = Math.sin(angle) * h/2;
      grad = gradientPreviewCtx.createLinearGradient(cx-dx, cy-dy, cx+dx, cy+dy);
    } else {
      grad = gradientPreviewCtx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h)/2);
    }
    const sorted = [...gradientStops].sort((a,b)=>a.offset-b.offset);
    for (const s of sorted) grad.addColorStop(clamp(s.offset,0,1), s.color);
    gradientPreviewCtx.fillStyle = grad;
    gradientPreviewCtx.fillRect(0,0,w,h);
  }

  function drawStopsOverlay() {
    stopsOverlay.innerHTML = '';
    const rect = gradientPreview.getBoundingClientRect();
    for (const s of gradientStops) {
      const handle = document.createElement('div');
      handle.className = 'stop-handle';
      handle.style.left = `${s.offset * 100}%`;
      handle.style.background = s.color;

      const picker = document.createElement('div');
      picker.className = 'picker';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = s.color;
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.value = s.color;
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.background = 'var(--danger)';
      delBtn.style.color = '#071014';
      delBtn.style.padding = '6px 8px';
      delBtn.style.borderRadius = '6px';
      delBtn.style.fontWeight = '700';
      picker.appendChild(colorInput);
      picker.appendChild(textInput);
      picker.appendChild(delBtn);
      handle.appendChild(picker);

      let dragging = false;
      handle.addEventListener('pointerdown', (ev) => { dragging = true; handle.setPointerCapture(ev.pointerId); });
      handle.addEventListener('pointerup', (ev) => { dragging = false; handle.releasePointerCapture(ev.pointerId); });
      handle.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        const r = gradientPreview.getBoundingClientRect();
        const nx = clamp((ev.clientX - r.left) / r.width, 0, 1);
        s.offset = nx;
        handle.style.left = `${nx * 100}%`;
        renderGradientPreview();
      });

      colorInput.addEventListener('input', () => { s.color = colorInput.value; textInput.value = s.color; handle.style.background = s.color; renderGradientPreview(); });
      textInput.addEventListener('change', () => { if (isValidHex(textInput.value)) { s.color = textInput.value; colorInput.value = s.color; handle.style.background = s.color; renderGradientPreview(); } else { textInput.value = s.color; } });
      delBtn.addEventListener('click', () => {
        if (gradientStops.length <= 2) return; // keep at least 2 stops
        gradientStops = gradientStops.filter(gs => gs.id !== s.id);
        renderGradientPreview();
        drawStopsOverlay();
      });

      stopsOverlay.appendChild(handle);
    }
  }

  function randomColor() {
    const h = Math.floor(Math.random()*360);
    const s = 50 + Math.floor(Math.random()*40);
    const l = 40 + Math.floor(Math.random()*20);
    return `hsl(${h} ${s}% ${l}%)`;
  }

  function randomizeGradient() {
    const stopCount = 2 + Math.floor(Math.random()*3);
    gradientStops = Array.from({length: stopCount}, (_, i) => ({ id: crypto.randomUUID(), offset: i/(stopCount-1), color: randomColorToHex(randomColor()) }));
    gradientTypeEl.value = Math.random() < 0.5 ? 'linear' : 'radial';
    gradientAngleEl.value = String(Math.floor(Math.random()*360));
    renderGradientPreview();
    drawStopsOverlay();
  }

  function hslToHex(h, s, l){
    s/=100; l/=100;
    const k = (n) => (n + h/30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const r = Math.round(255 * f(0));
    const g = Math.round(255 * f(8));
    const b = Math.round(255 * f(4));
    return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
  }
  function randomColorToHex(hslStr){
    const m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(hslStr);
    if (!m) return '#ffffff';
    return hslToHex(parseInt(m[1],10), parseInt(m[2],10), parseInt(m[3],10));
  }

  function isValidHex(v) {
    return /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v);
  }

  addStopBtn.addEventListener('click', () => {
    const last = gradientStops[gradientStops.length-1];
    const newOffset = clamp((last?.offset ?? 0.5) - 0.1 + Math.random()*0.2, 0, 1);
    gradientStops.push({ id: crypto.randomUUID(), offset: newOffset, color: '#ffffff' });
    renderGradientPreview();
    drawStopsOverlay();
  });
  randomizeGradientBtn.addEventListener('click', randomizeGradient);
  gradientTypeEl.addEventListener('change', renderGradientPreview);
  gradientAngleEl.addEventListener('input', renderGradientPreview);

  function buildGradientSpec() {
    return {
      type: gradientTypeEl.value,
      angle: parseInt(gradientAngleEl.value, 10) || 0,
      stops: [...gradientStops].sort((a,b)=>a.offset-b.offset).map(s=>({ offset: clamp(s.offset,0,1), color: s.color }))
    };
  }

  function generateSeeds(n) {
    const seeds = [];
    for (let i=0;i<n;i++) seeds.push(crypto.getRandomValues(new Uint32Array(1))[0]);
    return seeds;
  }

  async function generateVariants() {
    if (!imageBitmap || !baseImageData || !pickedColor) {
      alert('Upload an image and pick a color first.');
      return;
    }
    const count = clamp(parseInt(variantCountEl.value, 10) || 0, 1, 500);
    const payload = {
      width: baseCanvas.width,
      height: baseCanvas.height,
      base: baseImageData,
      pickedColor,
      hRange: parseInt(hueRangeEl.value, 10) || 0,
      sRange: parseInt(satRangeEl.value, 10) || 0,
      lRange: parseInt(lightRangeEl.value, 10) || 0,
      tolerance: parseInt(toleranceEl.value, 10) || 0,
      gradient: buildGradientSpec(),
      mirrorMode: mirrorModeEl.value,
      seeds: generateSeeds(count)
    };

    generateBtn.disabled = true;
    downloadZipBtn.disabled = true;
    progressEl.textContent = 'Rendering...';
    previewGrid.innerHTML = '';

    const w = await loadWorker();
    lastResults = [];

    const onMessage = async (ev) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        progressEl.textContent = `Rendering ${msg.index+1}/${count}`;
        const bitmap = msg.bitmap;
        const canvas = document.createElement('canvas');
        canvas.width = payload.width; canvas.height = payload.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        previewGrid.appendChild(canvas);
        lastResults.push({ bitmap, meta: msg.meta });
      } else if (msg.type === 'done') {
        w.removeEventListener('message', onMessage);
        progressEl.textContent = 'Done';
        downloadZipBtn.disabled = false;
        generateBtn.disabled = false;
        // restore baseImageData by re-reading from canvas after transfer neutered buffer
        baseImageData = baseCtx.getImageData(0, 0, payload.width, payload.height);
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'render', payload }, [payload.base.data.buffer]);
  }

  generateBtn.addEventListener('click', generateVariants);

  async function downloadZip() {
    if (!lastResults.length) return;
    const seeds = lastResults.map(r => r.meta.seed);
    const payload = {
      width: baseCanvas.width,
      height: baseCanvas.height,
      base: baseImageData,
      pickedColor,
      hRange: parseInt(hueRangeEl.value, 10) || 0,
      sRange: parseInt(satRangeEl.value, 10) || 0,
      lRange: parseInt(lightRangeEl.value, 10) || 0,
      tolerance: parseInt(toleranceEl.value, 10) || 0,
      gradient: buildGradientSpec(),
      mirrorMode: mirrorModeEl.value,
      seeds
    };
    const w = await loadWorker();
    progressEl.textContent = 'Preparing ZIP...';
    const zip = new JSZip();
    const meta = [];
    let doneCount = 0;
    const onMessage = async (ev) => {
      const msg = ev.data;
      if (msg.type === 'blob') {
        const i = msg.index;
        const name = `variant_${String(i+1).padStart(3,'0')}.png`;
        zip.file(name, msg.blob);
        meta.push({ name, ...msg.meta });
        doneCount++;
        progressEl.textContent = `Preparing ZIP ${doneCount}/${seeds.length}`;
      } else if (msg.type === 'doneBlobs') {
        w.removeEventListener('message', onMessage);
        zip.file('metadata.json', JSON.stringify(meta.sort((a,b)=>a.name.localeCompare(b.name)), null, 2));
        const out = await zip.generateAsync({ type: 'blob' });
        saveAs(out, 'variants.zip');
        progressEl.textContent = 'Ready';
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'renderBlobs', payload }, [payload.base.data.buffer]);
  }
  downloadZipBtn.addEventListener('click', downloadZip);

  // initial
  renderGradientPreview();
  drawStopsOverlay();
})();



// worker.js - module

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function rgbToHsl(r, g, b) {
  r/=255; g/=255; b/=255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h*360, s*100, l*100];
}
function hslToRgb(h, s, l) {
  h/=360; s/=100; l/=100;
  let r, g, b;
  if (s === 0) { r=g=b=l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr*dr + dg*dg + db*db);
}

function buildGradient(ctx, spec, w, h) {
  if (spec.type === 'linear') {
    const angle = (spec.angle || 0) * Math.PI / 180;
    const cx = w/2, cy = h/2;
    const dx = Math.cos(angle) * w/2;
    const dy = Math.sin(angle) * h/2;
    const g = ctx.createLinearGradient(cx-dx, cy-dy, cx+dx, cy+dy);
    for (const s of spec.stops) g.addColorStop(clamp(s.offset,0,1), s.color);
    return g;
  }
  const g = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h)/2);
  for (const s of spec.stops) g.addColorStop(clamp(s.offset,0,1), s.color);
  return g;
}

// Precompute mask of pixels to recolor and their HSL values
function buildRecolorMask(baseData, target, tolerance) {
  const data = baseData.data;
  const maskIndexes = [];
  const hslValues = [];
  for (let i=0;i<data.length;i+=4) {
    const a = data[i+3];
    if (a === 0) continue;
    const r = data[i], g = data[i+1], b = data[i+2];
    if (colorDistance({r,g,b}, target) <= tolerance) {
      maskIndexes.push(i);
      hslValues.push(rgbToHsl(r,g,b));
    }
  }
  return { maskIndexes, hslValues };
}

function applyVariant(imageData, mask, hRange, sRange, lRange, seed) {
  const data = imageData.data;
  let x = seed || 123456789;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0xffffffff; };
  const hueDelta = (rnd()*2-1) * hRange;
  const satDelta = (rnd()*2-1) * sRange;
  const lightDelta = (rnd()*2-1) * lRange;
  for (let m=0; m<mask.maskIndexes.length; m++) {
    const idx = mask.maskIndexes[m];
    let [h, s, l] = mask.hslValues[m];
    h = (h + hueDelta + 360) % 360;
    s = clamp(s + satDelta, 0, 100);
    l = clamp(l + lightDelta, 0, 100);
    const [nr, ng, nb] = hslToRgb(h, s, l);
    data[idx] = nr; data[idx+1] = ng; data[idx+2] = nb;
  }
  return { hueDelta, satDelta, lightDelta };
}

self.onmessage = async (ev) => {
  const { type, payload } = ev.data || {};
  if (type === 'render') {
    const { width, height, base, pickedColor, hRange, sRange, lRange, tolerance, gradient, mirrorMode, seeds } = payload;
    const oc = new OffscreenCanvas(width, height);
    const ctx = oc.getContext('2d');
    ctx.fillStyle = buildGradient(ctx, gradient, width, height);
    ctx.fillRect(0,0,width,height);
    const bg = ctx.getImageData(0,0,width,height);
    const mask = buildRecolorMask(base, pickedColor, tolerance);
    for (let index=0; index<seeds.length; index++) {
      ctx.putImageData(bg, 0, 0);
      const img = new ImageData(new Uint8ClampedArray(base.data), width, height);
      const deltas = applyVariant(img, mask, hRange, sRange, lRange, seeds[index]);
      const tmp = new OffscreenCanvas(width, height);
      const tctx = tmp.getContext('2d');
      tctx.putImageData(img, 0, 0);
      const mirror = mirrorMode === 'on' || (mirrorMode === 'random' && Math.random() < 0.5);
      if (mirror) {
        ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1); ctx.drawImage(tmp, 0, 0); ctx.restore();
      } else { ctx.drawImage(tmp, 0, 0); }
      let [ph, ps, pl] = rgbToHsl(pickedColor.r, pickedColor.g, pickedColor.b);
      ph = (ph + deltas.hueDelta + 360) % 360; ps = clamp(ps + deltas.satDelta, 0, 100); pl = clamp(pl + deltas.lightDelta, 0, 100);
      const [pr, pg, pb] = hslToRgb(ph, ps, pl);
      const hex = '#' + [pr,pg,pb].map(v=>v.toString(16).padStart(2,'0')).join('');
      const bitmap = oc.transferToImageBitmap();
      const meta = { index, body_color: hex, gradient, mirrored: mirror, seed: seeds[index], hsl_deltas: deltas };
      self.postMessage({ type: 'progress', index, bitmap, meta }, [bitmap]);
    }
    self.postMessage({ type: 'done' });
    return;
  }
  if (type === 'renderBlobs') {
    const { width, height, base, pickedColor, hRange, sRange, lRange, tolerance, gradient, mirrorMode, seeds } = payload;
    const oc = new OffscreenCanvas(width, height);
    const ctx = oc.getContext('2d');
    ctx.fillStyle = buildGradient(ctx, gradient, width, height);
    ctx.fillRect(0,0,width,height);
    const bg = ctx.getImageData(0,0,width,height);
    const mask = buildRecolorMask(base, pickedColor, tolerance);
    for (let index=0; index<seeds.length; index++) {
      ctx.putImageData(bg, 0, 0);
      const img = new ImageData(new Uint8ClampedArray(base.data), width, height);
      const deltas = applyVariant(img, mask, hRange, sRange, lRange, seeds[index]);
      const tmp = new OffscreenCanvas(width, height);
      const tctx = tmp.getContext('2d');
      tctx.putImageData(img, 0, 0);
      const mirror = mirrorMode === 'on' || (mirrorMode === 'random' && Math.random() < 0.5);
      if (mirror) { ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1); ctx.drawImage(tmp, 0, 0); ctx.restore(); }
      else { ctx.drawImage(tmp, 0, 0); }
      let [ph, ps, pl] = rgbToHsl(pickedColor.r, pickedColor.g, pickedColor.b);
      ph = (ph + deltas.hueDelta + 360) % 360; ps = clamp(ps + deltas.satDelta, 0, 100); pl = clamp(pl + deltas.lightDelta, 0, 100);
      const [pr, pg, pb] = hslToRgb(ph, ps, pl);
      const hex = '#' + [pr,pg,pb].map(v=>v.toString(16).padStart(2,'0')).join('');
      const blob = await oc.convertToBlob({ type: 'image/png' });
      const meta = { index, body_color: hex, gradient, mirrored: mirror, seed: seeds[index], hsl_deltas: deltas };
      self.postMessage({ type: 'blob', index, blob, meta });
    }
    self.postMessage({ type: 'doneBlobs' });
  }
};



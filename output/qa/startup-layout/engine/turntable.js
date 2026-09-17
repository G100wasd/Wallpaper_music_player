(function () {
  'use strict';

  // All dimensions are in one shared, top-down 1,000-unit drawing space.
  // The tonearm rotates independently around its fixed pivot.
  const TAU = Math.PI * 2;
  const SIZE = 1000;
  const PARKED_ARM = -0.48;
  const DISC = { x: 434, y: 500, r: 360 };
  const PLAY_SPEED = 1.6; // Radians/second: one clearly visible revolution in about four seconds.

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function circle(x, y, radius, alpha, width, spacing) {
    return { type: 'circle', x, y, radius, alpha, width: width || 1.8, spacing: spacing || 4.8 };
  }

  function path(points, alpha, width, closed, spacing) {
    return { type: 'path', points, alpha, width: width || 1.8, closed: !!closed, spacing: spacing || 4.6 };
  }

  function roundedRectangle(x, y, w, h, radius) {
    const points = [];
    const centers = [
      [x + w - radius, y + radius, -Math.PI / 2],
      [x + w - radius, y + h - radius, 0],
      [x + radius, y + h - radius, Math.PI / 2],
      [x + radius, y + radius, Math.PI]
    ];
    for (const corner of centers) {
      for (let step = 0; step <= 10; step += 1) {
        const angle = corner[2] + step * Math.PI / 20;
        points.push([corner[0] + Math.cos(angle) * radius, corner[1] + Math.sin(angle) * radius]);
      }
    }
    return path(points, 0.9, 2, true, 3.8);
  }

  function arcPoints(radius, start, length) {
    const points = [];
    for (let step = 0; step <= 14; step += 1) {
      const angle = start + length * step / 14;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return points;
  }

  function createGeometry() {
    const base = [roundedRectangle(56, 72, 888, 856, 20)];
    for (const x of [94, 906]) {
      for (const y of [112, 889]) base.push(circle(x, y, 15.5, 0.84, 1.9, 4));
    }

    const record = [circle(0, 0, 360, 0.93, 2), circle(0, 0, 350, 0.75, 1.8)];
    for (let radius = 161; radius <= 340; radius += 8.2) {
      record.push(circle(0, 0, radius, 0.24 + 0.07 * Math.sin(radius), 1.1, 6.8));
    }
    record.push(circle(0, 0, 123, 0.94, 1.8, 4));
    record.push(circle(0, 0, 14.5, 0.97, 1.8, 3.6));
    // Asymmetric marks rotate with the record and share its startup stroke reveal.
    record.push(path(arcPoints(329, -0.8, 0.25), 0.76, 2.6));
    record.push(path(arcPoints(263, 1.85, 0.19), 0.64, 2.4));
    record.push(path(arcPoints(198, 3.6, 0.22), 0.55, 2.2));
    record.push(circle(-40, -70, 7, 0.98, 3));
    record.push(path([[-17, -70], [31, -70]], 0.88, 2.6));
    record.push(path([[-17, -57], [10, -57]], 0.55, 1.8));

    const top = [
      circle(837, 217, 82, 0.9, 1.9, 4.3),
      circle(837, 217, 58, 0.79, 1.8, 4.4),
      circle(837, 217, 33, 0.77, 1.8, 4),
      path([[875, 288], [901, 346]], 0.8, 1.9),
      path([[891, 324], [901, 346]], 0.95, 5, false, 2.6),
      path([[831, 212], [723, 558], [699, 594]], 0.96, 2.2, false, 3.3),
      path([[845, 217], [737, 565], [713, 606]], 0.96, 2.2, false, 3.3),
      path([[835, 190], [840, 170], [859, 179], [850, 201]], 0.92, 2, true, 3.6),
      path([[696, 586], [715, 603], [697, 624], [678, 607]], 0.93, 1.9, true, 3.6),
      path([[674, 602], [706, 630], [651, 691], [620, 663]], 0.98, 2, true, 3.4),
      path([[625, 670], [643, 686], [639, 691], [621, 675]], 0.8, 1.5, true, 3.6),
      circle(837, 217, 16, 0.98, 1.8, 3.4),
      circle(641, 658, 5.1, 0.88, 1.7, 3),
      circle(660, 674, 5.1, 0.88, 1.7, 3),
      path([[681, 624], [685, 628], [681, 632], [677, 628]], 0.92, 1.5, true, 3),
      circle(840, 833, 44, 0.92, 1.9, 3.8),
      path([[840, 789], [840, 811]], 0.96, 2),
      path([[840, 765], [840, 778]], 0.86, 1.8)
    ];
    const moving = new Set([5, 6, 7, 8, 9, 10, 12, 13, 14]);
    return { base, record, top: top.filter((_, i) => !moving.has(i)), arm: top.filter((_, i) => moving.has(i)) };
  }

  function strokeGeometry(context, shapes) {
    context.strokeStyle = '#ffffff';
    context.lineJoin = 'round';
    context.lineCap = 'round';
    for (const shape of shapes) {
      context.beginPath();
      if (shape.type === 'circle') {
        context.arc(shape.x, shape.y, shape.radius, 0, TAU);
      } else {
        const points = shape.points;
        context.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i += 1) context.lineTo(points[i][0], points[i][1]);
        if (shape.closed) context.closePath();
      }
      context.globalAlpha = shape.alpha;
      context.lineWidth = shape.width;
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  function maskArm(context, pivot = true) {
    context.fillStyle = '#000000';
    context.beginPath();
    if (pivot) context.arc(837, 217, 81, 0, TAU);
    context.fill();
    context.beginPath();
    context.moveTo(831, 212);
    context.lineTo(845, 217);
    context.lineTo(737, 565);
    context.lineTo(713, 606);
    context.lineTo(699, 594);
    context.lineTo(723, 558);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(674, 602);
    context.lineTo(706, 630);
    context.lineTo(651, 691);
    context.lineTo(620, 663);
    context.closePath();
    context.fill();
  }

  function growingStroke(context, shape, progress, branches) {
    const p = clamp(progress, 0, 1);
    if (!p) return;
    context.strokeStyle = '#fff'; context.fillStyle = '#fff';
    context.lineWidth = shape.width; context.lineCap = 'round'; context.lineJoin = 'round'; context.globalAlpha = shape.alpha;
    const tips = [];
    context.beginPath();
    if (shape.type === 'circle') {
      for (let branch = 0; branch < 2; branch++) {
        const start = -Math.PI / 2 + branch * Math.PI, end = start + Math.PI * p;
        context.moveTo(shape.x + Math.cos(start) * shape.radius, shape.y + Math.sin(start) * shape.radius);
        context.arc(shape.x, shape.y, shape.radius, start, end);
        tips.push([shape.x + Math.cos(end) * shape.radius, shape.y + Math.sin(end) * shape.radius]);
      }
    } else {
      const vertices = shape.points, segments = shape.closed ? vertices.length : vertices.length - 1;
      const count = shape.closed ? branches : 1;
      for (let branch = 0; branch < count; branch++) {
        const first = Math.floor(branch * segments / count), last = Math.floor((branch + 1) * segments / count);
        let length = 0;
        for (let j = first; j < last; j++) { const a = vertices[j], b = vertices[(j + 1) % vertices.length]; length += Math.hypot(b[0] - a[0], b[1] - a[1]); }
        let remaining = length * p, tip = vertices[first]; context.moveTo(tip[0], tip[1]);
        for (let j = first; j < last && remaining > 0; j++) {
          const a = vertices[j], b = vertices[(j + 1) % vertices.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const fraction = Math.min(1, remaining / (length || 1));
          tip = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]; context.lineTo(tip[0], tip[1]); remaining -= length;
        }
        tips.push(tip);
      }
    }
    context.stroke();
    if (p < 1) { context.globalAlpha = (1 - p) * .72; for (const tip of tips) { context.beginPath(); context.arc(tip[0], tip[1], 2.8, 0, TAU); context.fill(); } }
    context.globalAlpha = 1;
  }

  class TurntableRenderer {
    constructor(canvas) {
      if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas element is required.');
      this.canvas = canvas;
      this.context = canvas.getContext('2d', { alpha: true });
      if (!this.context) throw new Error('The turntable requires a 2D canvas context.');
      this.style = 'line';
      this.transitioning = false;
      this.playing = false;
      this.paused = false;
      this.energy = 0;
      this.fps = 30;
      this.angle = 0;
      this.speed = 0;
      this.speedFrom = 0;
      this.speedTarget = 0;
      this.speedElapsed = 0;
      this.speedDuration = 0;
      this.armAngle = PARKED_ARM;
      this.motionTime = 0;
      this.destroyed = false;
      this.frameId = 0;
      this.lastFrame = 0;
      this.lastMotion = 0;
      this.width = 1;
      this.height = 1;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.cache = null;
      this.geometry = createGeometry();
      this.introProgress = 0;
      this.introActive = true;
      this._tick = this._tick.bind(this);
      this._onResize = this.resize.bind(this);
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(this._onResize);
        this.observer.observe(canvas);
      }
      window.addEventListener('resize', this._onResize);
      this.resize();

    }

    startIntro(){this.introProgress=matchMedia('(prefers-reduced-motion: reduce)').matches?1:0;this.introActive=this.introProgress<1;this._draw();this._syncAnimation();}

    drawReveal(context, progress) {
      const p = clamp(progress, 0, 1);
      this.geometry.base.forEach((shape, i) => growingStroke(context, shape, (p - (i ? .16 : 0)) / (i ? .48 : .75), i ? 1 : 4));
      context.save(); context.translate(DISC.x, DISC.y); context.rotate(this.angle);
      this.geometry.record.forEach((shape, i) => growingStroke(context, shape, (p - (.07 + Math.min(i, 25) * .008)) / .66, 1));
      context.restore();
      context.fillStyle = '#000'; context.beginPath(); context.arc(837,217,81,0,TAU); context.fill();
      this.geometry.top.forEach((shape, i) => growingStroke(context, shape, (p - (.07 + i * .009)) / .65, 1));
      this.drawArm(context, p);
    }

    drawArm(context, progress = 1) {
      context.save(); context.translate(837,217); context.rotate(this.armAngle); context.translate(-837,-217);
      maskArm(context, false);
      if (progress < 1) this.geometry.arm.forEach((shape, i) => growingStroke(context, shape, (progress - (.12 + i * .009)) / .65, 1));
      else strokeGeometry(context, this.geometry.arm);
      context.restore();
    }

    setPlaying(playing) {
      if (this.destroyed) return;
      const next = !!playing;
      if (next === this.playing) return;
      this.playing = next;
      // Reverse a transition from its current speed, without snapping the record angle.
      this.speedFrom = this.speed;
      this.speedTarget = next ? PLAY_SPEED : 0;
      this.speedElapsed = 0;
      this.speedDuration = next ? 0.8 : 1;
      this.lastMotion = 0;
      this._syncAnimation();
    }

    setEnergy(energy) {
      if (this.destroyed) return;
      const next = clamp(Number(energy) || 0, 0, 1);
      const wasActive = this.energy > 0.008;
      this.energy = next;
    }

    setPaused(paused) {
      if (this.destroyed) return;
      this.paused = !!paused;
      if (this.paused) this._draw();
      this.lastMotion = 0;
      this._syncAnimation();
    }

    setFps(fps) {
      this.fps = clamp(Number(fps) || 30, 1, 240);
    }

    resize() {
      if (this.destroyed) return;
      const bounds = this.canvas.getBoundingClientRect();
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const width = Math.max(1, Math.round(bounds.width * dpr));
      const height = Math.max(1, Math.round(bounds.height * dpr));
      if (width === this.width && height === this.height && this.cache) return;
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.scale = Math.min(width, height) / SIZE;
      this.offsetX = (width - SIZE * this.scale) / 2;
      this.offsetY = (height - SIZE * this.scale) / 2;
      this._buildCache();
      this._draw();
    }

    _newLayer() {
      const layer = document.createElement('canvas');
      layer.width = Math.max(1, Math.ceil(SIZE * this.scale));
      layer.height = layer.width;
      const context = layer.getContext('2d');
      context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      return { canvas: layer, context };
    }

    _buildCache() {
      const base = this._newLayer();
      const record = this._newLayer();
      const top = this._newLayer();
      strokeGeometry(base.context, this.geometry.base);
      record.context.translate(SIZE / 2, SIZE / 2);strokeGeometry(record.context, this.geometry.record);
      top.context.fillStyle='#000'; top.context.beginPath(); top.context.arc(837,217,81,0,TAU); top.context.fill(); strokeGeometry(top.context, this.geometry.top);
      this.cache = { base: base.canvas, record: record.canvas, top: top.canvas };
    }

    _needsAnimation() {
      return !this.destroyed && !this.paused && !this.transitioning &&
        (this.playing || this.speed > 0 || this.introActive || Math.abs(this.armAngle - (this.playing ? 0 : PARKED_ARM)) > .0001);
    }

    _syncAnimation() {
      if (this._needsAnimation()) {
        if (!this.frameId) {
          this.lastFrame = 0;
          this.lastMotion = 0;
          this.frameId = requestAnimationFrame(this._tick);
        }
      } else if (this.frameId) {
        cancelAnimationFrame(this.frameId);
        this.frameId = 0;
        this.lastMotion = 0;
      }
    }

    _tick(timestamp) {
      this.frameId = 0;
      if (!this._needsAnimation()) return;
      const interval = 1000 / this.fps;
      const elapsed = timestamp - this.lastFrame;
      if (!this.lastFrame || elapsed >= interval - 0.5) {
        const delta = this.lastMotion ? Math.min((timestamp - this.lastMotion) / 1000, 0.15) : 0;
        const previousSpeed = this.speed;
        this.speedElapsed = Math.min(this.speedDuration, this.speedElapsed + delta);
        const progress = this.speedDuration ? this.speedElapsed / this.speedDuration : 1;
        const eased = progress * progress * (3 - 2 * progress);
        this.speed = this.speedFrom + (this.speedTarget - this.speedFrom) * eased;
        if (progress === 1) this.speed = this.speedTarget;
        this.angle = (this.angle + delta * (previousSpeed + this.speed) / 2) % TAU;
        const armTarget = this.playing ? 0 : PARKED_ARM;
        this.armAngle += (armTarget - this.armAngle) * (1 - Math.exp(-delta * 7));
        if (Math.abs(this.armAngle - armTarget) < .0001) this.armAngle = armTarget;
        if(this.introActive){this.introProgress=Math.min(1,this.introProgress+delta/2.4);this.introActive=this.introProgress<1;this.canvas.dataset.intro=this.introActive?'drawing':'complete';}
        this.motionTime += delta;
        this.lastMotion = timestamp;
        this.lastFrame = timestamp - (elapsed % interval);
        this._draw();
      }
      this.frameId = requestAnimationFrame(this._tick);
    }

    _draw() {
      if (this.destroyed || !this.cache) return;
      const context = this.context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.width, this.height);
      context.save();
      context.translate(this.offsetX, this.offsetY);
      if(this.introActive && !this.paused){context.scale(this.scale,this.scale);this.drawReveal(context,this.introProgress);context.restore();return;}
      context.drawImage(this.cache.base, 0, 0);
      context.save();
      context.translate(DISC.x * this.scale, DISC.y * this.scale);
      context.rotate(this.angle);
      context.drawImage(this.cache.record, -SIZE / 2 * this.scale, -SIZE / 2 * this.scale);
      context.restore();
      context.drawImage(this.cache.top, 0, 0);
      context.scale(this.scale, this.scale); this.drawArm(context);
      context.restore();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.frameId) cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      if (this.observer) this.observer.disconnect();
      window.removeEventListener('resize', this._onResize);
      this.cache = null;
    }
  }

  window.TurntableRenderer = TurntableRenderer;
}());

{const Original=TurntableRenderer;window.qaIntros=0;window.TurntableRenderer=class extends Original{startIntro(){qaIntros++;super.startIntro();}};}
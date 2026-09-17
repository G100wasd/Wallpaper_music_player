(function () {
  'use strict';
  function smooth(buffer, index, input) {
    const target = Math.max(0, Math.min(1, Number(input) || 0));
    buffer[index] += (target - buffer[index]) * (target > buffer[index] ? .55 : .18);
    if (buffer[index] < .0005) buffer[index] = 0;
    return buffer[index];
  }
  class AudioWave {
    constructor() {
      this.left = new Float32Array(64);
      this.right = new Float32Array(64);
    }
    update(data, stereo, fallback) {
      let sum = 0;
      for (let i = 0; i < 64; i++) {
        const mono = fallback && fallback.length ? fallback[Math.floor(i * fallback.length / 64)] / 255 : 0;
        const l = stereo ? data[i] : mono, r = stereo ? data[i + 64] : mono;
        sum += smooth(this.left, i, l) + smooth(this.right, i, r);
      }
      return sum / 128;
    }
    draw(context, width, height, now, gain, stereo) {
      context.clearRect(0, 0, width, height);
      context.strokeStyle = 'rgba(255,255,255,.92)'; context.lineWidth = 1;
      const trace = (offset, span, channel) => {
        context.beginPath();
        const steps = Math.ceil(span / 2);
        for (let step = 0; step <= steps; step++) {
          const u = step / steps, x = u * span;
          const bin = Math.min(63, Math.floor(Math.abs(u - .5) * 126));
          const level = channel ? channel[bin] : (this.left[bin] + this.right[bin]) / 2;
          const amplitude = Math.min(1, level * gain * 2) * height * .41 * Math.pow(Math.sin(u * Math.PI), 1.4);
          const y = height / 2 + Math.sin(x * .33 + now * .005) * amplitude;
          if (!step) context.moveTo(offset + x, y); else context.lineTo(offset + x, y);
        }
        context.stroke();
      };
      // Two traces meet on the same baseline, inside the existing single border.
      if (stereo) { trace(0, width / 2, this.left); trace(width / 2, width / 2, this.right); }
      else trace(0, width, null);
    }
    drawPCM(context, width, height, snapshot, gain, stereo) {
      context.clearRect(0, 0, width, height);
      context.strokeStyle = 'rgba(255,255,255,.92)'; context.lineWidth = 1;
      const left = snapshot ? snapshot.left : [0, 0], right = snapshot ? snapshot.right : [0, 0];
      const length = Math.min(left.length, right.length);
      const sample = value => Math.max(-1, Math.min(1, (Number(value) || 0) * gain));
      const trace = (offset, span, channel) => {
        context.beginPath();
        for (let i = 0; i < length; i++) {
          const value = channel === 0 ? left[i] : channel === 1 ? right[i] : (left[i] + right[i]) * .5;
          const x = offset + i / Math.max(1, length - 1) * span, y = height / 2 - sample(value) * height * .45;
          if (!i) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      };
      if (stereo) { trace(0, width / 2, 0); trace(width / 2, width / 2, 1); }
      else trace(0, width, -1);
    }
  }
  window.AudioWave = AudioWave;
})();

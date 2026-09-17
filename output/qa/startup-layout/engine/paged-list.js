(function () {
  'use strict';
  const PAGE_SIZE = 5;
  window.PagedList = class PagedList {
    constructor(key, makeRow, emptyText, onLayout) {
      this.root = document.getElementById(key + '-list');
      this.previous = document.getElementById(key + '-page-prev');
      this.next = document.getElementById(key + '-page-next');
      this.label = document.getElementById(key + '-page-number');
      this.makeRow = makeRow; this.emptyText = emptyText; this.onLayout = onLayout;
      this.items = []; this.page = 0; this.animations = []; this.revision = 0;
      this.motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.motion.addEventListener('change', () => { if (this.motion.matches) this.finish(); });
      this.previous.addEventListener('click', () => this.move(-1));
      this.next.addEventListener('click', () => this.move(1));
    }
    get pages() { return Math.max(1, Math.ceil(this.items.length / PAGE_SIZE)); }
    update(items, signature, identity) {
      if (this.signature === signature && this.identity === identity) return;
      this.signature = signature;
      if (this.identity !== identity) this.page = 0;
      this.identity = identity; this.items = items;
      this.page = Math.min(this.page, this.pages - 1);
      this.finish();
    }
    controls() {
      this.previous.disabled = this.busy || this.page === 0;
      this.next.disabled = this.busy || this.page === this.pages - 1;
      this.label.textContent = this.items.length ? `${this.page + 1} / ${this.pages}` : '0 / 0';
      this.root.setAttribute('aria-busy', String(Boolean(this.busy)));
    }
    draw() {
      const start = this.page * PAGE_SIZE;
      const rows = this.items.slice(start, start + PAGE_SIZE).map((item, index) => this.makeRow(item, start + index));
      rows.forEach((row, index) => { row.setAttribute('aria-posinset', start + index + 1); row.setAttribute('aria-setsize', this.items.length); });
      if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = this.emptyText; rows.push(empty); }
      this.root.replaceChildren(...rows);
      // Keep the final partial page the same height so other regions do not jump.
      this.root.style.height = (Math.max(1, Math.min(PAGE_SIZE, this.items.length)) * 40) + 'px';
      this.controls(); this.onLayout();
    }
    finish() {
      ++this.revision;
      this.animations.forEach(animation => animation.cancel()); this.animations = [];
      this.busy = false; this.root.removeAttribute('inert'); this.draw();
    }
    setPaused(paused) {
      this.paused = paused;
      if (paused && this.busy) this.finish();
    }
    async slide(entering, direction) {
      this.animations = [...this.root.children].map((row, index) => {
        const outside = `translateX(${(entering ? direction : -direction) * 110}%)`;
        const animation = row.animate(entering
          ? [{ transform: outside, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }]
          : [{ transform: 'translateX(0)', opacity: 1 }, { transform: outside, opacity: 0 }],
        { duration: entering ? 280 : 200, delay: index * 32, easing: entering ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.4,0,1,1)', fill: 'both' });
        if (this.paused) animation.pause();
        return animation;
      });
      await Promise.all(this.animations.map(animation => animation.finished.catch(() => {})));
    }
    async move(direction) {
      if (this.busy || this.page + direction < 0 || this.page + direction >= this.pages) return;
      this.page += direction;
      if (this.paused || this.motion.matches || typeof this.root.animate !== 'function') { this.finish(); return; }
      const revision = ++this.revision;
      this.busy = true; this.root.setAttribute('inert', ''); this.controls();
      await this.slide(false, direction);
      if (revision !== this.revision) return;
      this.animations.forEach(animation => animation.cancel());
      this.draw();
      await this.slide(true, direction);
      if (revision === this.revision) this.finish();
    }
  };
})();

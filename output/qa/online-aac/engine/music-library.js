(function () {
  'use strict';

  const DB_NAME = 'mono-wallpaper-music';
  const STORE_NAME = 'assets';
  const AUDIO_FILE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|aif|aiff|weba|webm|mp4)$/i;

  function makeId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function safeSource(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('这首歌曲没有可用的音频地址。');
    const source = value.trim();
    if (/[\u0000-\u001f\u007f]/.test(source)) throw new Error('音频地址包含无效字符。');

    if (/^[a-z]:[\\/]/i.test(source)) {
      const pieces = source.replace(/\\/g, '/').split('/');
      return 'file:///' + pieces[0] + '/' + pieces.slice(1).map(encodeURIComponent).join('/');
    }
    if (/^\\\\/.test(source)) {
      const pieces = source.slice(2).replace(/\\/g, '/').split('/');
      const host = pieces.shift();
      if (!host || /[\s@?#:]/.test(host)) throw new Error('网络文件路径无效。');
      return 'file://' + host + '/' + pieces.map(encodeURIComponent).join('/');
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(source)) {
      let parsed;
      try { parsed = new URL(source); } catch (_) { throw new Error('音频地址格式无效。'); }
      if (!['http:', 'https:', 'file:', 'blob:'].includes(parsed.protocol)) {
        throw new Error('仅支持本地文件、壁纸内音频和 HTTP/HTTPS 音频地址。');
      }
      return parsed.href;
    }

    const relative = source.replace(/\\/g, '/');
    if (relative.startsWith('//')) throw new Error('请为网络音频填写完整的 HTTP 或 HTTPS 地址。');
    let resolved;
    try { resolved = new URL(relative, document.baseURI || window.location.href); }
    catch (_) { throw new Error('音频文件路径无效。'); }
    if (!['http:', 'https:', 'file:'].includes(resolved.protocol)) throw new Error('当前环境不支持此音频路径。');
    return resolved.href;
  }

  class MusicLibrary {
    constructor() {
      this.warning = '';
      this.importWarnings = [];
      this._database = null;
      this._sessionAssets = new Map();
      this._initializing = null;
    }

    async init() {
      if (this._initializing) return this._initializing;
      this._initializing = new Promise((resolve) => {
        let settled = false;
        const finish = (database, message) => {
          if (settled) {
            if (database) database.close();
            return;
          }
          settled = true;
          window.clearTimeout(timer);
          this._database = database;
          this.warning = message || '';
          if (database) database.onversionchange = () => {
            database.close();
            this._database = null;
            this.warning = '本地音乐存储已关闭，请重新打开壁纸后再导入音乐。';
          };
          resolve(this);
        };
        const temporaryMessage = '当前环境无法持久保存本地音频；新导入的歌曲仅在本次打开期间可用。';
        const timer = window.setTimeout(() => finish(null, temporaryMessage), 4000);
        try {
          if (!window.indexedDB) return finish(null, temporaryMessage);
          const request = window.indexedDB.open(DB_NAME, 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
              request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
          };
          request.onsuccess = () => finish(request.result, '');
          request.onerror = () => finish(null, temporaryMessage);
          request.onblocked = () => finish(null, '本地音乐存储正被其他壁纸页面占用；新导入的歌曲暂时仅在本次打开期间可用。');
        } catch (_) { finish(null, temporaryMessage); }
      });
      return this._initializing;
    }

    _storeAsset(asset) {
      return new Promise((resolve, reject) => {
        try {
          const transaction = this._database.transaction(STORE_NAME, 'readwrite');
          transaction.objectStore(STORE_NAME).put(asset);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error('本地音频保存失败。'));
          transaction.onabort = () => reject(transaction.error || new Error('本地音频保存中断。'));
        } catch (error) { reject(error); }
      });
    }

    async importFiles(fileList) {
      await this.init();
      this.importWarnings = [];
      const tracks = [];
      for (const file of Array.from(fileList || [])) {
        if (!(file instanceof Blob)) continue;
        const filename = file.name || '未命名音频';
        if (file.name && !file.type.startsWith('audio/') && !AUDIO_FILE.test(filename)) {
          this.importWarnings.push('已跳过不支持的文件：' + filename);
          continue;
        }
        const id = makeId();
        const asset = { id, blob: file, filename, createdAt: Date.now() };
        let sourceType = 'stored';
        let warning = '';
        try {
          if (!this._database) throw new Error('Storage unavailable');
          await this._storeAsset(asset);
        } catch (_) {
          this._sessionAssets.set(id, asset);
          sourceType = 'session';
          warning = '“' + filename + '”未能保存到本地存储，关闭或刷新壁纸后需要重新导入。';
          this.warning = '部分音频仅在本次打开期间可用，请注意导入提示。';
          this.importWarnings.push(warning);
        }
        const track = {
          id,
          title: filename.replace(/\.[^.]+$/, '') || filename,
          artist: '本地音乐',
          duration: 0,
          sourceType,
          assetId: id,
          filename
        };
        if (warning) track.warning = warning;
        tracks.push(track);
      }
      return tracks;
    }

    async resolveSource(track) {
      if (!track || typeof track !== 'object') throw new Error('没有可播放的歌曲。');
      if (track.sourceType === 'bilibili') {
        const result = await LocalConfig.call('bilibili/audio','POST',JSON.stringify({bvid:track.bvid,cid:track.cid}));
        return {url:safeSource(result.src),revoke:false,online:!!result.online,codec:result.codec,mimeType:result.mimeType};
      }
      if (track.sourceType === 'stored' || track.sourceType === 'session') {
        await this.init();
        let asset = this._sessionAssets.get(track.assetId);
        if (!asset && this._database && track.sourceType !== 'session') {
          asset = await new Promise((resolve, reject) => {
            try {
              const transaction = this._database.transaction(STORE_NAME, 'readonly');
              const request = transaction.objectStore(STORE_NAME).get(track.assetId);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(new Error('无法读取这首本地歌曲，请重新导入。'));
              transaction.onabort = () => reject(new Error('读取本地歌曲已中断，请重试。'));
            } catch (_) { reject(new Error('无法访问本地音乐存储，请重新打开壁纸。')); }
          });
        }
        if (!asset || !(asset.blob instanceof Blob)) {
          throw new Error(track.sourceType === 'session'
            ? '这首歌曲仅在上次打开期间有效，请重新导入音频文件。'
            : '找不到这首歌的本地音频，请重新导入音频文件。');
        }
        return { url: URL.createObjectURL(asset.blob), revoke: true };
      }
      return { url: safeSource(track.src), revoke: false };
    }

    async removeTrackAsset(track) {
      const assetId = track && track.assetId;
      if (!assetId) return;
      this._sessionAssets.delete(assetId);
      await this.init();
      if (!this._database) return;
      await new Promise((resolve, reject) => {
        try {
          const transaction = this._database.transaction(STORE_NAME, 'readwrite');
          transaction.objectStore(STORE_NAME).delete(assetId);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(new Error('删除本地音频失败。'));
          transaction.onabort = () => reject(new Error('删除本地音频已中断。'));
        } catch (error) { reject(error); }
      });
    }

    async clearUnusedAssets(usedIds) {
      if (!Array.isArray(usedIds) && !(usedIds instanceof Set)) throw new Error('清理本地音频时需要提供仍在使用的音频 ID。');
      const retained = new Set(usedIds);
      for (const id of this._sessionAssets.keys()) if (!retained.has(id)) this._sessionAssets.delete(id);
      await this.init();
      if (!this._database) return;
      await new Promise((resolve, reject) => {
        try {
          const transaction = this._database.transaction(STORE_NAME, 'readwrite');
          const request = transaction.objectStore(STORE_NAME).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (!retained.has(cursor.key)) cursor.delete();
            cursor.continue();
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(new Error('清理本地音频失败。'));
          transaction.onabort = () => reject(new Error('清理本地音频已中断。'));
        } catch (error) { reject(error); }
      });
    }
  }

  MusicLibrary.safeSource = safeSource;
  window.MusicLibrary = MusicLibrary;
})();

(function () {
  'use strict';
  const clean = value => String(value || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const unwrap = value => clean(value).replace(/^[《〈「『“"](.+)[》〉」』”"]$/, '$1').trim();
  const valid = value => value && value.length <= 180 && !/^(?:[-—–－]+|无|暂无|未知|unknown|null)$/i.test(value) && !/https?:\/\//i.test(value);
  const bracket = value => { const matches = [...value.matchAll(/《([^《》]+)》/g)]; return matches.length === 1 ? unwrap(matches[0][1]) : ''; };
  const stripTags = value => clean(value).replace(/^(?:(?:【[^】]*】|\[[^\]]*\]|「[^」]*」)\s*)+/, '').trim();
  function markedName(value, artist, videoTitle) {
    value = clean(value).replace(/\s+(?:歌手|乐队|演唱|所属专辑|专辑|artist)\s*[:：].*$/i, '');
    const quoted = bracket(value);
    if (quoted) return quoted;
    const parts = value.split(/\s*(?:—+|–+|--+|\s-\s|\||│|｜)\s*/).filter(Boolean);
    if (parts.length === 2) {
      // A known performer or the video's 《song》 disambiguates artist — song.
      const titleSong = bracket(videoTitle);
      if ((artist && unwrap(parts[0]).toLowerCase() === artist.toLowerCase()) || (titleSong && unwrap(parts[1]) === titleSong)) value = parts[1];
      else value = parts[0];
    } else if (parts.length > 2) return '';
    return unwrap(value);
  }
  function unique(values) {
    const names = [...new Set(values.filter(valid))];
    return names.length === 1 ? names[0] : '';
  }
  function extract(videoTitle, description) {
    videoTitle = clean(videoTitle);
    const lines = String(description || '').split(/\r?\n/).map(clean).filter(Boolean);
    const artistLine = lines.find(line => /^(?:歌手|乐队|演唱|演唱者|artist)\s*[:：]/i.test(line));
    const artist = artistLine ? unwrap(artistLine.replace(/^[^:：]+[:：]\s*/, '')) : '';
    // Explicit song labels take priority over incidental 《titles》 in prose.
    for (const marker of [/^(?:歌曲名称|歌曲名|歌名|曲名|歌曲|song(?:\s*title)?|track)\s*[:：]\s*(.+)$/i, /^(?:BGM|背景音乐|背景音樂|配乐|配樂|音乐|音樂|music)\s*[:：]\s*(.+)$/i]) {
      const matches = lines.map(line => line.match(marker)).filter(Boolean);
      if (matches.length) {
        const name = unique(matches.map(match => markedName(match[1], artist, videoTitle)));
        if (name) return { name, source: 'description' };
      }
    }
    // Only standalone quoted names qualify here; album names and prose are excluded.
    const standalone = unique(lines.filter(line => /^《[^《》]+》$/.test(line)).map(bracket));
    if (standalone) return { name: standalone, source: 'description' };
    const quoted = bracket(videoTitle);
    if (valid(quoted)) return { name: quoted, source: 'title' };
    const title = stripTags(videoTitle), parts = title.split(/\s*[|│｜]\s*/).filter(Boolean);
    if (parts.length >= 3) {
      const name = unwrap(parts[parts.length - 2]);
      if (valid(name)) return { name, source: 'title' };
    }
    if (parts.length === 2 && artist && unwrap(parts[1]).toLowerCase() === artist.toLowerCase() && valid(parts[0])) return { name: unwrap(parts[0]), source: 'title' };
    const cover = title.match(/^(.+?)\s+[-—–]\s+.+?\s+cover\s*$/i);
    if (cover && valid(cover[1])) return { name: unwrap(cover[1]), source: 'title' };
    return { name: videoTitle, source: 'fallback' };
  }
  window.SongTitle = { extract };
})();

// Player-specific shells keep effects inside fullscreen and below native controls.
export function identifyPlayer(video) {
  const candidates = [
    ['YouTube', '.html5-video-player'],
    ['Netflix', '.watch-video--player-view, .watch-video'],
    ['Hulu', '[data-testid="player"], .video-player, .player-container'],
    ['Jellyfin', '.videoPlayerContainer, .videoPlayer, .videoOsd'],
    ['Plex', '.video-player, [class*="VideoPlayer-videoPlayer"], [class*="VideoPlayer-player"]'],
  ];
  for (const [name, selector] of candidates) {
    const shell = video.closest(selector);
    if (shell && shell.getBoundingClientRect().width > 0) return { name, shell, video };
  }
  // Use the closest nontrivial container, never the entire document by accident.
  let shell = video.parentElement;
  for (let i = 0; shell && i < 4; i++, shell = shell.parentElement) {
    const r = shell.getBoundingClientRect(),
      v = video.getBoundingClientRect();
    if (r.width >= v.width * 0.95 && r.height >= v.height * 0.95 && r.width > 100 && r.height > 80)
      return { name: 'HTML video', shell, video };
  }
  return { name: 'HTML video', shell: video.parentElement, video };
}
export function visibleVideos(root = document) {
  const found = [];
  const visit = (tree) => {
    found.push(...tree.querySelectorAll('video'));
    for (const el of tree.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  visit(root);
  return found
    .filter((v) => {
      const r = v.getBoundingClientRect(),
        s = getComputedStyle(v);
      return (
        r.width > 80 &&
        r.height > 60 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < innerHeight &&
        r.left < innerWidth &&
        s.display !== 'none' &&
        s.visibility !== 'hidden'
      );
    })
    .sort((a, b) => {
      const score = (v) => {
        const r = v.getBoundingClientRect();
        return r.width * r.height * (v.paused ? 1 : 2);
      };
      return score(b) - score(a);
    });
}
export class OwnedStyles {
  entries = new Map();
  set(el, property, value) {
    let fields = this.entries.get(el);
    if (!fields) {
      fields = new Map();
      this.entries.set(el, fields);
    }
    let field = fields.get(property);
    if (!field) {
      field = {
        value: el.style.getPropertyValue(property),
        priority: el.style.getPropertyPriority(property),
        ours: null,
      };
      fields.set(property, field);
    }
    if (el.style.getPropertyValue(property) !== field.ours && field.ours !== null) {
      field.value = el.style.getPropertyValue(property);
      field.priority = el.style.getPropertyPriority(property);
    }
    el.style.setProperty(property, value, 'important');
    field.ours = el.style.getPropertyValue(property);
  }
  restore() {
    for (const [el, fields] of this.entries)
      for (const [property, field] of fields) {
        // Do not overwrite newer host-player changes.
        if (el.style.getPropertyValue(property) === field.ours) {
          if (field.value) el.style.setProperty(property, field.value, field.priority);
          else el.style.removeProperty(property);
        }
      }
    this.entries.clear();
  }
}

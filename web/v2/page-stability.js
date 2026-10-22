// Privacy masking retains layout and scroll; returning validates the session only.
export function returnGuard({ validate, mask, clearPreview, invalid, grace = 600000, now = Date.now }) {
  let epoch = 0,
    leftAt = null;
  const hide = () => {
    epoch++;
    clearPreview();
    mask(true);
  };
  const show = async () => {
    const ticket = ++epoch;
    try {
      const valid = await validate();
      if (ticket !== epoch) return;
      if (!valid) return invalid();
      mask(false);
    } catch {
      if (ticket === epoch) invalid();
    }
  };
  // Tab switches shorter than grace keep the workspace visible and only re-check the session; longer absences mask and clear like pagehide.
  return {
    hide,
    show,
    stop() {
      epoch++;
    },
    leave() {
      epoch++;
      leftAt = now();
    },
    async resume() {
      const away = leftAt === null ? Infinity : now() - leftAt;
      leftAt = null;
      if (away >= grace) {
        hide();
        return show();
      }
      const ticket = ++epoch;
      try {
        const valid = await validate();
        if (ticket === epoch && !valid) invalid();
      } catch {
        if (ticket === epoch) invalid();
      }
    }
  };
}
// Keep expanded details, focus, pagination and the visible card's screen position on data refresh.
export function preserveList(container, render, { window: win = window, document: doc = document } = {}) {
  const cards = [...container.querySelectorAll('[data-job-id]')],
    anchor = cards.find(c => c.getBoundingClientRect().bottom > 0),
    top = anchor?.getBoundingClientRect().top;
  const open = cards.flatMap(c =>
    [...c.querySelectorAll('details')].map((d, i) => (d.open ? [c.dataset.jobId, i] : null)).filter(Boolean)
  );
  const active = doc.activeElement,
    focused = active?.closest?.('[data-job-id]'),
    index = focused ? [...focused.querySelectorAll('a,button,summary')].indexOf(active) : -1;
  const x = win.scrollX,
    y = win.scrollY,
    horizontal = container.querySelector?.('.table-scroll')?.scrollLeft || 0;
  render();
  const next = [...container.querySelectorAll('[data-job-id]')];
  for (const [id, i] of open) {
    const d = next.find(c => c.dataset.jobId === id)?.querySelectorAll('details')[i];
    if (d) d.open = true;
  }
  if (focused && index >= 0)
    next
      .find(c => c.dataset.jobId === focused.dataset.jobId)
      ?.querySelectorAll('a,button,summary')
      [index]?.focus({ preventScroll: true });
  const frame = container.querySelector?.('.table-scroll');
  if (frame) frame.scrollLeft = horizontal;
  const target = anchor && next.find(c => c.dataset.jobId === anchor.dataset.jobId);
  win.scrollTo(x, target ? y + target.getBoundingClientRect().top - top : y);
}

// Account-session memory only: keep rendered views, coalesce reads, invalidate on writes/logout.
export function viewLoader({ now = Date.now, maxAge = 60000 } = {}) {
  const entries = new Map();
  return {
    invalidate(key) {
      if (key) entries.delete(key);
      else entries.clear();
    },
    run(key, load, { force = false } = {}) {
      const previous = entries.get(key);
      if (previous?.pending) return previous.pending;
      if (!force && previous?.done && now() - previous.at < maxAge) return Promise.resolve();
      const entry = { done: false, at: 0, pending: null };
      entries.set(key, entry);
      const current = () => entries.get(key) === entry;
      entry.pending = Promise.resolve()
        .then(() => load(current))
        .then(value => {
          if (current()) {
            entry.done = true;
            entry.at = now();
          }
          return value;
        })
        .catch(error => {
          if (current()) entries.delete(key);
          throw error;
        })
        .finally(() => {
          entry.pending = null;
        });
      return entry.pending;
    }
  };
}

// Only view names enter browser history; account data and positions stay in memory.
export function viewNavigation({ window: win = window, render, read = () => {}, restore = () => {}, views }) {
  let token = {},
    current = null;
  const positions = new Map(),
    restoration = win.history.scrollRestoration;
  win.history.scrollRestoration = 'manual';
  const save = () => {
    if (current) positions.set(current, [win.scrollX, win.scrollY]);
  };
  const show = view => {
    current = view;
    render(view);
    win.scrollTo(...(positions.get(view) || [0, 0]));
  };
  const state = view => ({ cqView: view, cqNavigation: token.id });
  const pop = event => {
    if (!current || event.state?.cqNavigation !== token.id || !views.includes(event.state.cqView)) return;
    save();
    show(event.state.cqView);
    restore(current);
    read(current);
  };
  win.addEventListener('popstate', pop);
  return {
    visit(view) {
      if (!views.includes(view) || view === current) return;
      save();
      if (!current) {
        token = { id: crypto.randomUUID() };
        win.history.replaceState(state(view), '');
      } else win.history.pushState(state(view), '');
      show(view);
    },
    reset() {
      token = {};
      current = null;
      positions.clear();
      win.history.replaceState(null, '');
    },
    dispose() {
      win.removeEventListener('popstate', pop);
      win.history.scrollRestoration = restoration;
    }
  };
}

// Passive file viewing must not discard unrelated in-flight list reads. Unknown POSTs remain writes.
export function invalidatesViews(path, method = 'GET') {
  return (
    method !== 'GET' &&
    path !== '/api/recommendations/update' &&
    !(method === 'POST' && /^\/api\/files\/[a-f0-9-]{36}\/view$/.test(path))
  );
}

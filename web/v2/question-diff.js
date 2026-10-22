// Labels are comparison hints, never permission to copy an answer.
export function questionDiff(before, after) {
  const key = q => JSON.stringify([q.section, q.label]);
  const unique = rows => {
    const map = new Map();
    for (const q of rows) map.set(key(q), map.has(key(q)) ? null : q);
    return map;
  };
  const old = unique(before),
    next = unique(after);
  const added = after.filter(q => !old.get(key(q)) || !next.get(key(q)));
  const removed = before.filter(q => !next.get(key(q)) || !old.get(key(q)));
  const changed = after
    .filter(q => old.get(key(q)) && next.get(key(q)) && JSON.stringify(old.get(key(q))) !== JSON.stringify(q))
    .map(q => ({ before: old.get(key(q)), after: q }));
  return { added, removed, changed };
}

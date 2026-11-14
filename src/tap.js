export function createTapTracker() {
  let down = null, multiple = false;
  const active = new Set();
  function move(event) {
    if (!down || down.id !== event.pointerId) return;
    for (const sample of [...(event.getCoalescedEvents?.() || []), event]) {
      down.distance = Math.max(down.distance, Math.hypot(sample.clientX - down.x, sample.clientY - down.y));
    }
  }
  return {
    start(event) {
      active.add(event.pointerId);
      if (active.size > 1) multiple = true;
      down = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    },
    move,
    cancel(event) { active.delete(event.pointerId); down = null; if (!active.size) multiple = false; },
    finish(event) {
      move(event);
      const tap = !multiple && down?.id === event.pointerId && down.distance <= 5;
      active.delete(event.pointerId);
      down = null;
      if (!active.size) multiple = false;
      return tap;
    }
  };
}

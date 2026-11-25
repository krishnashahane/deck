type Listener = (msgs: { id: number; text: string }[]) => void;
let msgs: { id: number; text: string }[] = [];
let next = 1;
const listeners = new Set<Listener>();

export function toast(text: string, ms = 2600) {
  const id = next++;
  msgs = [...msgs, { id, text }].slice(-4);
  listeners.forEach((l) => l(msgs));
  setTimeout(() => {
    msgs = msgs.filter((m) => m.id !== id);
    listeners.forEach((l) => l(msgs));
  }, ms);
}

export function onToasts(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

import type { KeyboardEvent } from "react";

/** Keep all segmented controls on the same keyboard interaction model. */
export function radioKeys(event: KeyboardEvent<HTMLElement>) {
  const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
  if (!delta && event.key !== "Home" && event.key !== "End") return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
  const current = items.indexOf(event.target as HTMLButtonElement);
  if (current < 0 || !items.length) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + delta + items.length) % items.length;
  items[next].focus();
  items[next].click();
}

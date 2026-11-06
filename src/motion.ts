export type Decision = 'save' | 'dismiss';

const deadZone = 8;
const distanceThreshold = 82;
const flickDistanceThreshold = 32;
const flickVelocityThreshold = 0.65;

export const motionDurations = {
  exit: 320,
  enter: 240,
  undo: 320,
  settle: 260,
  reducedFeedback: 160,
} as const;

/** Signed feedback strength, with a quiet center for small pointer movements. */
export function directionalStrength(dx: number): number {
  if (!Number.isFinite(dx) || Math.abs(dx) < deadZone) return 0;
  return Math.max(-1, Math.min(1, dx / distanceThreshold));
}

/** Distance commits on its own; a shorter flick must continue in its drag direction. */
export function decisionForRelease(dx: number, velocity: number): Decision | null {
  if (!Number.isFinite(dx) || !Number.isFinite(velocity)) return null;

  const distance = Math.abs(dx);
  const isFlick = distance >= flickDistanceThreshold
    && Math.abs(velocity) >= flickVelocityThreshold
    && Math.sign(dx) === Math.sign(velocity);

  if (distance < distanceThreshold && !isFlick) return null;
  return dx > 0 ? 'save' : 'dismiss';
}

/** Keep an exiting card moving outward, including after a long drag or on a wide card. */
export function exitOffset(
  direction: Decision,
  offset: number,
  viewportWidth: number,
  cardWidth: number,
): number {
  const viewport = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1024;
  const card = Number.isFinite(cardWidth) && cardWidth > 0 ? cardWidth : 480;
  const release = Number.isFinite(offset) ? Math.abs(offset) : 0;
  // The extra pixel places the target strictly beyond both clearance boundaries.
  const distance = Math.max(viewport, release) + card + 64 + 1;
  return direction === 'save' ? distance : -distance;
}

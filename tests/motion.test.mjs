import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionForRelease,
  directionalStrength,
  exitOffset,
  motionDurations,
} from '../.test-dist/motion.js';

test('directional strength stays neutral inside the dead zone', () => {
  for (const offset of [0, -0, 0.5, -0.5, 7.999, -7.999]) {
    assert.equal(directionalStrength(offset), 0);
  }
  assert.equal(directionalStrength(8), 8 / 82);
  assert.equal(directionalStrength(-8), -8 / 82);
});

test('directional strength is signed, proportional and clamped', () => {
  assert.equal(directionalStrength(41), 0.5);
  assert.equal(directionalStrength(-41), -0.5);
  for (const offset of [82, 83, 400, Number.MAX_VALUE]) {
    assert.equal(directionalStrength(offset), 1);
    assert.equal(directionalStrength(-offset), -1);
  }
});

test('nonfinite drag or velocity is neutral and never commits', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(directionalStrength(value), 0);
    assert.equal(decisionForRelease(value, 1), null);
    assert.equal(decisionForRelease(100, value), null);
    assert.equal(decisionForRelease(-100, value), null);
    assert.equal(decisionForRelease(value, value), null);
  }
});

test('distance threshold is inclusive in both directions', () => {
  assert.equal(decisionForRelease(81.999, 0), null);
  assert.equal(decisionForRelease(-81.999, 0), null);
  assert.equal(decisionForRelease(82, 0), 'save');
  assert.equal(decisionForRelease(-82, 0), 'dismiss');
  assert.equal(decisionForRelease(240, 0), 'save');
  assert.equal(decisionForRelease(-240, 0), 'dismiss');
});

test('short flick requires both the distance and velocity boundaries', () => {
  assert.equal(decisionForRelease(32, 0.65), 'save');
  assert.equal(decisionForRelease(-32, -0.65), 'dismiss');
  assert.equal(decisionForRelease(31.999, 2), null);
  assert.equal(decisionForRelease(-31.999, -2), null);
  assert.equal(decisionForRelease(32, 0.649999), null);
  assert.equal(decisionForRelease(-32, -0.649999), null);
  assert.equal(decisionForRelease(60, 1.2), 'save');
  assert.equal(decisionForRelease(-60, -1.2), 'dismiss');
});

test('a contradictory velocity cannot turn a short drag into a decision', () => {
  assert.equal(decisionForRelease(32, -0.65), null);
  assert.equal(decisionForRelease(-32, 0.65), null);
  assert.equal(decisionForRelease(81, -5), null);
  assert.equal(decisionForRelease(-81, 5), null);
  assert.equal(decisionForRelease(0, 5), null);
  assert.equal(decisionForRelease(0, -5), null);
});

test('a completed distance threshold follows displacement even with reverse velocity', () => {
  assert.equal(decisionForRelease(82, -5), 'save');
  assert.equal(decisionForRelease(-82, 5), 'dismiss');
});

test('exit targets clear the viewport and release position in both directions', () => {
  for (const direction of ['save', 'dismiss']) {
    const sign = direction === 'save' ? 1 : -1;
    for (const release of [0, 82, 400, 2000]) {
      const target = exitOffset(direction, sign * release, 390, 350);
      assert.equal(Math.sign(target), sign);
      assert(Math.abs(target) > 390 + 350 + 64);
      assert(Math.abs(target) > release + 350 + 64);
      assert((target - sign * release) * sign > 0);
    }
  }
});

test('exit targets never move inward as the release position moves outward', () => {
  for (const direction of ['save', 'dismiss']) {
    const sign = direction === 'save' ? 1 : -1;
    let previous = 0;
    for (const release of [0, 32, 82, 389, 390, 391, 1000, 4000]) {
      const target = Math.abs(exitOffset(direction, sign * release, 390, 350));
      assert(target >= previous);
      assert(target > release);
      previous = target;
    }
  }
});

test('wide cards and opposite-signed release offsets retain sufficient exit clearance', () => {
  for (const direction of ['save', 'dismiss']) {
    for (const release of [100, -100, 5000, -5000]) {
      const target = exitOffset(direction, release, 1440, 2400);
      assert.equal(Math.sign(target), direction === 'save' ? 1 : -1);
      assert(Math.abs(target) > 1440 + 2400 + 64);
      assert(Math.abs(target) > Math.abs(release) + 2400 + 64);
    }
  }
});

test('missing measurements and nonfinite offsets use finite exit fallbacks', () => {
  for (const direction of ['save', 'dismiss']) {
    for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
      const target = exitOffset(direction, value, value, value);
      assert(Number.isFinite(target));
      assert.equal(Math.sign(target), direction === 'save' ? 1 : -1);
      assert(Math.abs(target) > 64);
    }
  }
});

test('motion timings retain separate exit, entrance, undo and reduced-motion feedback', () => {
  assert.deepEqual(motionDurations, {
    exit: 320,
    enter: 240,
    undo: 320,
    settle: 260,
    reducedFeedback: 160,
  });
});

// Integration contracts supplement pure motion math; browser QA verifies rendered behavior.
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('../src/ProjectCard.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/swipe-motion.css', import.meta.url), 'utf8');
test('next-card preview is inert and excluded from accessibility', () => {
  assert.match(app, /className="deck-underlay" aria-hidden="true" inert/);
  assert.match(app, /busy preview/);
});
test('feedback exposes words and icons independently of color', () => {
  assert.match(app, /role="status" aria-live="polite"/);
  assert.match(app, /intent==='save'\?'bookmark':'close'/);
  assert.match(app, /intent==='save'\?'收藏':'略过'/);
  assert.doesNotMatch(card, /swipe-label/);
});
test('reduced motion disables automatic translation and CSS animation', () => {
  assert.match(app, /reducedMotion\?motionDurations.reducedFeedback:motionDurations.exit/);
  assert.match(card, /reducedMotion&&exit\?'none'/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /animation:none!important;transition:none!important/);
});
test('motion containment and release lifecycle prevent overflow and early reset', () => {
  assert.match(css, /html,body\{overflow-x:clip\}/);
  assert.match(css, /#root\{[^}]*overflow:clip/);
  assert.match(card, /if\(decision\)onAction\(decision\);else\{setDrag\(0\)/);
  assert.match(card, /onPointerCancel=\{reset\}/);
  assert.match(css, /@keyframes card-return/);
});

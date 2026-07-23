import { FLAPPY_GEOMETRY } from '../flappyConfig';
import { bottomPipeTopY, computeFlappyGeom, resolveGateFrame, topPipeBottomY } from '../gate';

// Band 400×300 → playTop 24, playH 252, pipeW 52, planeX 100, plane 48×21, coinR 10.5
const geom = computeFlappyGeom(400, 300, FLAPPY_GEOMETRY);
const midY = geom.playTop + geom.playH / 2;

describe('flappy gate resolution', () => {
  it('computes pipe edges from fractions', () => {
    expect(topPipeBottomY(0.4, geom)).toBeCloseTo(geom.playTop + 0.4 * geom.playH, 5);
    expect(bottomPipeTopY(0.3, geom)).toBeCloseTo(geom.playTop + 0.7 * geom.playH, 5);
  });

  it('no events while the gate is far to the right', () => {
    const events = resolveGateFrame(midY, 300, 0.4, 0, geom, false, false);
    expect(events).toEqual({ hitNow: false, coinNow: false, passedNow: false });
  });

  it('hits the ceiling pipe when flying high through its span', () => {
    const highY = topPipeBottomY(0.4, geom) - 2;
    const events = resolveGateFrame(highY, geom.planeX - geom.pipeW / 2, 0.4, 0, geom, false, false);
    expect(events.hitNow).toBe(true);
  });

  it('passes cleanly through the gap without a hit', () => {
    const gapY = (topPipeBottomY(0.2, geom) + bottomPipeTopY(0.3, geom)) / 2;
    const events = resolveGateFrame(gapY, geom.planeX - geom.pipeW / 2, 0.2, 0.3, geom, false, false);
    expect(events.hitNow).toBe(false);
  });

  it('never hits an absent pipe (0-length side)', () => {
    const lowY = geom.playTop + geom.playH - 2;
    const events = resolveGateFrame(lowY, geom.planeX - geom.pipeW / 2, 0.4, 0, geom, false, false);
    expect(events.hitNow).toBe(false);
  });

  it('collects the coin at the gap center, once, and never after a hit', () => {
    const gapY = (topPipeBottomY(0.2, geom) + bottomPipeTopY(0.3, geom)) / 2;
    const coinAlignedX = geom.planeX - geom.pipeW / 2;

    const clean = resolveGateFrame(gapY, coinAlignedX, 0.2, 0.3, geom, false, false);
    expect(clean.coinNow).toBe(true);

    const alreadyTaken = resolveGateFrame(gapY, coinAlignedX, 0.2, 0.3, geom, false, true);
    expect(alreadyTaken.coinNow).toBe(false);

    const afterHit = resolveGateFrame(gapY, coinAlignedX, 0.2, 0.3, geom, true, false);
    expect(afterHit.coinNow).toBe(false);
  });

  it('misses the coin when passing off-center', () => {
    const offY = bottomPipeTopY(0.3, geom) - geom.planeH / 2 - 1;
    const events = resolveGateFrame(offY, geom.planeX - geom.pipeW / 2, 0.2, 0.3, geom, false, false);
    expect(events.coinNow).toBe(false);
  });

  it('reports passed once the pipe trailing edge clears the plane', () => {
    const justBehind = geom.planeX - geom.planeW / 2 - geom.pipeW - 1;
    expect(resolveGateFrame(midY, justBehind, 0.2, 0.3, geom, false, false).passedNow).toBe(true);
    const stillUnder = geom.planeX - geom.pipeW / 2;
    expect(resolveGateFrame(midY, stillUnder, 0.2, 0.3, geom, false, false).passedNow).toBe(false);
  });

  it('suppresses re-collision on an already-hit gate', () => {
    const highY = topPipeBottomY(0.4, geom) - 2;
    const events = resolveGateFrame(highY, geom.planeX - geom.pipeW / 2, 0.4, 0, geom, true, false);
    expect(events.hitNow).toBe(false);
  });
});

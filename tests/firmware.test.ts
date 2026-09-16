import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PulseGuardAgent } from '../lib/agent.ts';
import { encodeFirmwareFrame, toFirmwareFrame } from '../lib/firmware.ts';

describe('firmware protocol contract', () => {
  it('turns a scored window into an inspectable UART-safe frame', () => {
    const agent = new PulseGuardAgent();
    const frame = toFirmwareFrame(agent.step());
    const line = encodeFirmwareFrame(frame);
    assert.match(line, /^PGE\/1 W=1 Q=\d+ R=\d+ C=\d+ A=MONITOR QD=0 NET=ONLINE /);
    assert.match(line, / M=edge-mlp-int8-v0\.4 P=safety-policy-v3$/);
  });

  it('retains local-queue state in the frame while connectivity is absent', () => {
    const agent = new PulseGuardAgent();
    agent.setOnline(false);
    const frame = toFirmwareFrame(agent.step());
    assert.equal(frame.link, 'OFFLINE');
    assert.ok(frame.queued >= 0);
  });
});

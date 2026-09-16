/**
 * PulseGuard Edge device-protocol contract.
 *
 * This module is deliberately small and dependency-free so the browser demo,
 * a serial bridge, and the ESP32 integration scaffold share one inspectable
 * event shape. The browser is a protocol emulator, not ESP32 firmware.
 */
import type { Snapshot } from './agent.ts';
import { MODEL_VERSION, POLICY_VERSION } from './model.ts';

export type FirmwareFrame = {
  protocol: 'PGE/1';
  window: number;
  quality: number;
  risk: number;
  confidence: number;
  action: Snapshot['action'];
  queued: number;
  link: 'ONLINE' | 'OFFLINE';
  model: string;
  policy: string;
};

export function toFirmwareFrame(snapshot: Snapshot): FirmwareFrame {
  return {
    protocol: 'PGE/1',
    window: snapshot.windowIndex,
    quality: snapshot.quality,
    risk: snapshot.risk,
    confidence: snapshot.confidence,
    action: snapshot.action,
    queued: snapshot.queuedCount,
    link: snapshot.online ? 'ONLINE' : 'OFFLINE',
    model: MODEL_VERSION,
    policy: POLICY_VERSION,
  };
}

/** A one-line, UART-friendly frame; intentionally easy to parse in a field log. */
export function encodeFirmwareFrame(frame: FirmwareFrame): string {
  return `${frame.protocol} W=${frame.window} Q=${frame.quality} R=${frame.risk} C=${frame.confidence} A=${frame.action} QD=${frame.queued} NET=${frame.link} M=${frame.model} P=${frame.policy}`;
}

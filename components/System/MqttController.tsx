/**
 * MQTT controller: subscribes to `Gamerun` and maps payloads to keyboard events.
 *
 * Messages:
 * - "up"    => ArrowUp
 * - "left"  => ArrowLeft
 * - "right" => ArrowRight
 */
import React, { useEffect, useRef } from 'react';
import mqtt, { type MqttClient } from 'mqtt';
import { useStore } from '../../store';

type Command = 'up' | 'left' | 'right' | 'start';

// NOTE: In browsers, credentials embedded in the wss URL (user:pass@host) are often ignored/stripped.
// Pass username/password via options instead to avoid CONNACK timeouts.
const BROKER_URL = 'wss://mqtt.aimaker.space:8084/mqtt';
const TOPIC = 'Gamerun';
const MQTT_USERNAME = 'yinxi';
const MQTT_PASSWORD = 'gndp3106';

function dispatchKey(key: 'ArrowUp' | 'ArrowLeft' | 'ArrowRight') {
  // Reuse existing Player keyboard handlers by dispatching a real keydown event.
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function dispatchGameControl(cmd: Command) {
  window.dispatchEvent(new CustomEvent('game-control', { detail: { cmd } }));
}

function parseCommand(payloadText: string): Command | null {
  let v: unknown = payloadText;
  const raw = payloadText.trim();

  // Try JSON payloads (e.g. "left" or {"cmd":"left"})
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('"') && raw.endsWith('"'))) {
    try {
      v = JSON.parse(raw);
    } catch {
      v = raw;
    }
  }

  let s: string | undefined;
  if (typeof v === 'string') s = v;
  else if (v && typeof v === 'object') {
    const o = v as any;
    s = o.cmd ?? o.command ?? o.action ?? o.key ?? o.data;
  }

  const t = String(s ?? raw).trim().toLowerCase();

  // Accept common aliases
  if (t === 'up' || t === 'arrowup') return 'up';
  if (t === 'left' || t === 'arrowleft') return 'left';
  if (t === 'right' || t === 'arrowright') return 'right';
  if (t === 'start' || t === 'begin' || t === 'go') return 'start';
  return null;
}

export const MqttController: React.FC = () => {
  const clientRef = useRef<MqttClient | null>(null);
  const lastCmdAtRef = useRef<Record<string, number>>({});
  const lastLogAtRef = useRef(0);

  useEffect(() => {
    const client = mqtt.connect(BROKER_URL, {
      protocolVersion: 4,
      clean: true,
      reconnectPeriod: 1000,
      connectTimeout: 30_000,
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
    });

    clientRef.current = client;

    client.on('connect', () => {
      client.subscribe(TOPIC, { qos: 0 }, (err) => {
        if (err) console.warn('[MQTT] subscribe error', err);
        else console.info('[MQTT] subscribed', TOPIC);
      });
    });

    client.on('reconnect', () => console.info('[MQTT] reconnecting...'));
    client.on('error', (err) => console.warn('[MQTT] error', err));

    client.on('message', (_topic, payload) => {
      const text = payload.toString('utf8');
      const cmd = parseCommand(text);
      if (!cmd) {
        // low-noise debug (max 1/sec)
        const now = Date.now();
        if (now - lastLogAtRef.current > 1000) {
          lastLogAtRef.current = now;
          console.info('[MQTT] ignored payload (unrecognized):', text);
        }
        return;
      }

      // Simple debounce to prevent flooding (e.g., repeated retained messages)
      const now = Date.now();
      const last = lastCmdAtRef.current[cmd] ?? 0;
      if (now - last < 80) return;
      lastCmdAtRef.current[cmd] = now;

      // Use ONLY game-control events to avoid double-triggering (keydown + custom event)
      // which would move 2 lanes at once and often clamp to the edge.
      if (cmd === 'start') {
        const state = useStore.getState();
        // Start or restart depending on current status
        if (state.status === 'MENU') state.startGame();
        else state.restartGame();
      } else {
        dispatchGameControl(cmd);
      }
    });

    return () => {
      try {
        client.removeAllListeners();
        client.end(true);
      } catch {
        // ignore
      }
      clientRef.current = null;
    };
  }, []);

  return null;
};



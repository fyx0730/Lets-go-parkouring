/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


export enum GameStatus {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY'
}

export enum ObjectType {
  OBSTACLE = 'OBSTACLE',
  GEM = 'GEM',
  LETTER = 'LETTER',
  IMMORTALITY = 'IMMORTALITY',
  HEART = 'HEART',
  ALIEN = 'ALIEN',
  MISSILE = 'MISSILE'
}

export interface GameObject {
  id: string;
  type: ObjectType;
  position: [number, number, number]; // x, y, z
  active: boolean;
  value?: string; // For letters (G, E, M...)
  color?: string;
  targetIndex?: number; // Index in the GEMINI target word
  points?: number; // Score value for gems
  hasFired?: boolean; // For Aliens
}

export const LANE_WIDTH = 2.2;
export const JUMP_HEIGHT = 2.5;
export const JUMP_DURATION = 0.6; // seconds
export const RUN_SPEED_BASE = 22.5;
export const SPAWN_DISTANCE = 120;
export const REMOVE_DISTANCE = 20; // Behind player

// Per-level collection targets (shown in HUD + spawned as collectibles)
export const LEVEL_TARGET_TEXTS: Record<number, string> = {
  1: '英荔 AI 创造乐园',
  2: '玩编程，玩 AI，玩创造',
  3: '放飞孩子的想象力和创造力',
};

function normalizeTargetText(text: string) {
  // Remove whitespace & common punctuation so collectibles feel natural.
  // Keeps Latin letters (e.g. AI).
  return text
    .replace(/\s+/g, '')
    .replace(/[，,。．.!！？?、;；:：·“”"‘’'（）()【】\[\]{}<>《》\-]/g, '');
}

export function getTargetTextForLevel(level: number) {
  return LEVEL_TARGET_TEXTS[Math.max(1, Math.min(3, level))] ?? LEVEL_TARGET_TEXTS[1];
}

export function getTargetCharsForLevel(level: number) {
  return Array.from(normalizeTargetText(getTargetTextForLevel(level)));
}

export function getAllTargetChars() {
  const all = new Set<string>();
  for (const lvl of [1, 2, 3]) getTargetCharsForLevel(lvl).forEach((c) => all.add(c));
  return Array.from(all);
}

// Neon palette (cycled) for target characters
const TARGET_PALETTE = [
  '#2979ff', // blue
  '#ff1744', // red
  '#ffea00', // yellow
  '#00e676', // green
  '#b388ff', // purple
  '#00ffff', // cyan
];

export function getTargetColorsForLevel(level: number) {
  const chars = getTargetCharsForLevel(level);
  return chars.map((_, idx) => TARGET_PALETTE[idx % TARGET_PALETTE.length]);
}

// (Shop removed)

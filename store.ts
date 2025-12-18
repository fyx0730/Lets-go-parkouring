/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { create } from 'zustand';
import { GameStatus, RUN_SPEED_BASE, getTargetCharsForLevel } from './types';

interface GameState {
  status: GameStatus;
  score: number;
  lives: number;
  maxLives: number;
  speed: number;
  collectedLetters: number[]; 
  level: number;
  laneCount: number;
  gemsCollected: number;
  distance: number;
  
  // Abilities
  isImmortalityActive: boolean;
  immortalityEndsAt: number; // epoch ms, 0 when inactive

  // Actions
  startGame: () => void;
  restartGame: () => void;
  takeDamage: () => void;
  addScore: (amount: number) => void;
  collectGem: (value: number) => void;
  collectLetter: (index: number) => void;
  healOne: () => void;
  setStatus: (status: GameStatus) => void;
  setDistance: (dist: number) => void;
  
  advanceLevel: () => void;
  activateImmortality: () => void;
}

const MAX_LEVEL = 3;
const LETTER_SPEED_TOTAL_FRACTION = 0.60; // keep overall tuning similar to original (60% per full word)
const DIFFICULTY_MULT = 0.8; // overall difficulty reduced by 20%
const makeOdd = (n: number) => (n % 2 === 0 ? n + 1 : n);

export const useStore = create<GameState>((set, get) => ({
  status: GameStatus.MENU,
  score: 0,
  lives: 3,
  maxLives: 3,
  speed: 0,
  collectedLetters: [],
  level: 1,
  laneCount: 3,
  gemsCollected: 0,
  distance: 0,
  
  isImmortalityActive: false,
  immortalityEndsAt: 0,

  startGame: () => set({ 
    status: GameStatus.PLAYING, 
    score: 0, 
    lives: 3, 
    maxLives: 3,
    speed: RUN_SPEED_BASE,
    collectedLetters: [],
    level: 1,
    laneCount: 3,
    gemsCollected: 0,
    distance: 0,
    isImmortalityActive: false
    ,immortalityEndsAt: 0
  }),

  restartGame: () => set({ 
    status: GameStatus.PLAYING, 
    score: 0, 
    lives: 3, 
    maxLives: 3,
    speed: RUN_SPEED_BASE,
    collectedLetters: [],
    level: 1,
    laneCount: 3,
    gemsCollected: 0,
    distance: 0,
    isImmortalityActive: false
    ,immortalityEndsAt: 0
  }),

  takeDamage: () => {
    const { lives, isImmortalityActive } = get();
    if (isImmortalityActive) return; // No damage if skill is active

    if (lives > 1) {
      set({ lives: lives - 1 });
    } else {
      set({ lives: 0, status: GameStatus.GAME_OVER, speed: 0 });
    }
  },

  addScore: (amount) => set((state) => ({ score: state.score + amount })),
  
  collectGem: (value) => set((state) => ({ 
    score: state.score + value, 
    gemsCollected: state.gemsCollected + 1 
  })),

  healOne: () => {
    const { lives, maxLives } = get();
    if (lives >= maxLives) return; // already full
    set({ lives: Math.min(lives + 1, maxLives) });
  },

  setDistance: (dist) => set({ distance: dist }),

  collectLetter: (index) => {
    const { collectedLetters, level, speed } = get();
    const targetLen = getTargetCharsForLevel(level).length;
    
    if (!collectedLetters.includes(index)) {
      const newLetters = [...collectedLetters, index];
      
      // LINEAR SPEED INCREASE: distribute a fixed total boost across the whole target string
      const perLetter = RUN_SPEED_BASE * ((LETTER_SPEED_TOTAL_FRACTION * DIFFICULTY_MULT) / Math.max(1, targetLen));
      const nextSpeed = speed + perLetter;

      set({ 
        collectedLetters: newLetters,
        speed: nextSpeed
      });

      // Check if full target collected
      if (newLetters.length === targetLen) {
        if (level < MAX_LEVEL) {
            // Immediately advance level
            // The Shop Portal will be spawned by LevelManager at the start of the new level
            get().advanceLevel();
        } else {
            // Victory Condition
            set({
                status: GameStatus.VICTORY,
                score: get().score + 5000
            });
        }
      }
    }
  },

  advanceLevel: () => {
      const { level, laneCount, speed } = get();
      const nextLevel = level + 1;
      
      // LINEAR LEVEL INCREASE: Add 40% of BASE speed per level
      // Combined with the 6 letters (60%), this totals +100% speed per full level cycle
      const speedIncrease = RUN_SPEED_BASE * 0.40 * DIFFICULTY_MULT;
      const newSpeed = speed + speedIncrease;

      set({
          level: nextLevel,
          // IMPORTANT: keep laneCount odd to match lane centering logic (-maxLane..+maxLane)
          // and the environment lane guides width math. This prevents spawn misalignment.
          laneCount: Math.min(makeOdd(laneCount + 1), 9),
          status: GameStatus.PLAYING, // Keep playing, user runs into shop
          speed: newSpeed,
          collectedLetters: [] // Reset letters
      });
  },

  activateImmortality: () => {
      const { isImmortalityActive } = get();
      if (!isImmortalityActive) {
          const endsAt = Date.now() + 5000;
          set({ isImmortalityActive: true, immortalityEndsAt: endsAt });
          
          // Lasts 5 seconds
          setTimeout(() => {
              set({ isImmortalityActive: false, immortalityEndsAt: 0 });
          }, 5000);
      }
  },

  setStatus: (status) => set({ status }),
  increaseLevel: () => set((state) => ({ level: state.level + 1 })),
}));

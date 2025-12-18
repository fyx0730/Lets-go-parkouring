/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../../store';
import { GameObject, ObjectType, LANE_WIDTH, SPAWN_DISTANCE, REMOVE_DISTANCE, GameStatus, getTargetCharsForLevel, getTargetColorsForLevel, getAllTargetChars } from '../../types';
import { audio } from '../System/Audio';

// Geometry Constants
const OBSTACLE_HEIGHT = 1.6;
const OBSTACLE_GEOMETRY = new THREE.ConeGeometry(0.9, OBSTACLE_HEIGHT, 6);
const OBSTACLE_GLOW_GEO = new THREE.ConeGeometry(0.9, OBSTACLE_HEIGHT, 6);
const OBSTACLE_RING_GEO = new THREE.RingGeometry(0.6, 0.9, 6);

const GEM_GEOMETRY = new THREE.IcosahedronGeometry(0.3, 0);
// Triangular pyramid-like pickup (triangle silhouette)
const POWERUP_CORE_GEO = new THREE.ConeGeometry(0.34, 0.62, 3);
const POWERUP_RING_GEO = new THREE.TorusGeometry(0.45, 0.05, 16, 48);
// Heart pickup (simple stylized heart via shape extrude)
const HEART_SHAPE = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.15);
    s.bezierCurveTo(0, 0.45, -0.45, 0.45, -0.45, 0.1);
    s.bezierCurveTo(-0.45, -0.25, 0, -0.25, 0, -0.55);
    s.bezierCurveTo(0, -0.25, 0.45, -0.25, 0.45, 0.1);
    s.bezierCurveTo(0.45, 0.45, 0, 0.45, 0, 0.15);
    return s;
})();
const HEART_GEO = new THREE.ExtrudeGeometry(HEART_SHAPE, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 10,
});
HEART_GEO.center();
const HEART_RING_GEO = new THREE.TorusGeometry(0.5, 0.06, 16, 48);

// Alien Geometries
const ALIEN_BODY_GEO = new THREE.CylinderGeometry(0.6, 0.3, 0.3, 8);
const ALIEN_DOME_GEO = new THREE.SphereGeometry(0.4, 16, 16, 0, Math.PI * 2, 0, Math.PI/2);
const ALIEN_EYE_GEO = new THREE.SphereGeometry(0.1);

// Missile Geometries
const MISSILE_CORE_GEO = new THREE.CylinderGeometry(0.08, 0.08, 3.0, 8);
const MISSILE_RING_GEO = new THREE.TorusGeometry(0.15, 0.02, 16, 32);

// Shadow Geometries
const SHADOW_LETTER_GEO = new THREE.PlaneGeometry(2, 0.6);
const SHADOW_GEM_GEO = new THREE.CircleGeometry(0.6, 32);
const SHADOW_ALIEN_GEO = new THREE.CircleGeometry(0.8, 32);
const SHADOW_MISSILE_GEO = new THREE.PlaneGeometry(0.15, 3);
const SHADOW_DEFAULT_GEO = new THREE.CircleGeometry(0.8, 6);

// Letter 3D plaque geometry (thickness)
const LETTER_BODY_GEO = new THREE.BoxGeometry(1.9, 1.2, 0.18);
const LETTER_FACE_GEO = new THREE.PlaneGeometry(1.7, 1.05);
const LETTER_EDGES_GEO = new THREE.EdgesGeometry(LETTER_BODY_GEO);
const LETTER_GLOW_GEO = new THREE.TorusGeometry(0.75, 0.05, 12, 48);

// (Shop removed)

const PARTICLE_COUNT = 600;
const BASE_LETTER_INTERVAL = 150; 

const getLetterInterval = (level: number) => {
    // Level 1: 150
    // Level 2: 225 (150 * 1.5)
    // Level 3: 337.5 (225 * 1.5)
    return BASE_LETTER_INTERVAL * Math.pow(1.5, Math.max(0, level - 1));
};

const DIFFICULTY_MULT = 0.8; // overall difficulty reduced by 20%
const MISSILE_SPEED = 30 * DIFFICULTY_MULT; // Extra speed added to world speed

// --- Canvas-based text (Chinese-safe) ---
const textTextureCache = new Map<string, THREE.CanvasTexture>();

// --- Extruded 3D text font (true geometry) ---
// Use a local font file in `public/fonts` to avoid CORS / CDN / parsing issues.
// Note: keep it under `public/` so Vite serves it as a static asset.
const EXTRUDE_FONT_URL = `${import.meta.env.BASE_URL}fonts/AlibabaPuHuiTi-3-55-Regular.ttf`;

const extrudedGeoCache = new Map<string, THREE.BufferGeometry>();
let extrudeFontCached: Font | null = null;
let extrudeFontPromise: Promise<Font> | null = null;
let extrudePrewarmScheduled = false;

// Keep these in one place so prewarm + runtime generation stay consistent
const EXTRUDE_LETTER_OPTS = { size: 0.95, depth: 0.35, bevelEnabled: true };

function loadExtrudeFont() {
    if (extrudeFontCached) return Promise.resolve(extrudeFontCached);
    if (extrudeFontPromise) return extrudeFontPromise;

    extrudeFontPromise = new Promise<Font>((resolve, reject) => {
        const loader = new TTFLoader();
        loader.load(
            EXTRUDE_FONT_URL,
            (json) => {
                extrudeFontCached = new Font(json as any);
                console.info('[Gemini Runner] Extrude font loaded:', EXTRUDE_FONT_URL);
                scheduleExtrudePrewarm(extrudeFontCached);
                resolve(extrudeFontCached);
            },
            undefined,
            (err) => {
                console.warn('[Gemini Runner] Extrude font failed to load:', EXTRUDE_FONT_URL, err);
                reject(err);
            }
        );
    });

    return extrudeFontPromise;
}

function scheduleExtrudePrewarm(font: Font) {
    if (extrudePrewarmScheduled) return;
    extrudePrewarmScheduled = true;

    // Pre-generate geometries for all target characters gradually to avoid a frame spike
    const queue = Array.from(new Set(getAllTargetChars()));
    const work = (deadline?: { timeRemaining: () => number }) => {
        const start = performance.now();
        // Do small chunks: either idle time budget, or ~6ms
        const budgetMs = deadline ? Math.max(2, deadline.timeRemaining()) : 6;
        while (queue.length > 0 && (performance.now() - start) < budgetMs) {
            const ch = queue.shift()!;
            try {
                getExtrudedGeometry(font, ch, EXTRUDE_LETTER_OPTS);
            } catch {
                // ignore; fallback rendering will cover
            }
        }
        if (queue.length > 0) {
            if ('requestIdleCallback' in window) {
                (window as any).requestIdleCallback(work);
            } else {
                setTimeout(() => work(undefined), 0);
            }
        } else {
            console.info('[Gemini Runner] Extrude glyph prewarm done.');
        }
    };

    // Kick off prewarm
    if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(work);
    } else {
        setTimeout(() => work(undefined), 0);
    }
}

function getExtrudedGeometry(font: Font, text: string, opts: { size: number; depth: number; bevelEnabled: boolean }) {
    const key = JSON.stringify({ text, size: opts.size, depth: opts.depth, bevelEnabled: opts.bevelEnabled });
    const cached = extrudedGeoCache.get(key);
    if (cached) return cached;

    const geometry = new TextGeometry(text, {
        font,
        size: opts.size,
        depth: opts.depth,
        curveSegments: 6,
        bevelEnabled: opts.bevelEnabled,
        bevelThickness: opts.bevelEnabled ? Math.max(0.01, opts.depth * 0.25) : 0,
        bevelSize: opts.bevelEnabled ? Math.max(0.01, opts.size * 0.06) : 0,
        bevelSegments: opts.bevelEnabled ? 2 : 0,
    });

    geometry.computeBoundingBox();
    geometry.center();
    geometry.computeVertexNormals();

    extrudedGeoCache.set(key, geometry);
    return geometry;
}

function getTextTexture(opts: {
    text: string;
    color: string;
    width: number;
    height: number;
    font: string;
    stroke?: string;
    background?: string;
}) {
    const { text, color, width, height, font, stroke = 'rgba(0,0,0,0.85)', background = 'rgba(0,0,0,0)' } = opts;
    const key = JSON.stringify({ text, color, width, height, font, stroke, background });
    const cached = textTextureCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        // Fallback: transparent texture
        const tex = new THREE.CanvasTexture(canvas);
        textTextureCache.set(key, tex);
        return tex;
    }

    // Background (optional)
    ctx.clearRect(0, 0, width, height);
    if (background && background !== 'rgba(0,0,0,0)') {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
    }

    // Text
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // Stroke for readability
    ctx.lineWidth = Math.max(6, Math.floor(Math.min(width, height) * 0.06));
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, width / 2, height / 2);

    // Fill
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    textTextureCache.set(key, texture);
    return texture;
}

// --- Particle System ---
const ParticleSystem: React.FC = () => {
    const mesh = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    
    const particles = useMemo(() => new Array(PARTICLE_COUNT).fill(0).map(() => ({
        life: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Vector3(),
        rotVel: new THREE.Vector3(),
        color: new THREE.Color()
    })), []);

    useEffect(() => {
        const handleExplosion = (e: CustomEvent) => {
            const { position, color } = e.detail;
            let spawned = 0;
            const burstAmount = 40; 

            for(let i = 0; i < PARTICLE_COUNT; i++) {
                const p = particles[i];
                if (p.life <= 0) {
                    p.life = 1.0 + Math.random() * 0.5; 
                    p.pos.set(position[0], position[1], position[2]);
                    
                    const theta = Math.random() * Math.PI * 2;
                    const phi = Math.acos(2 * Math.random() - 1);
                    const speed = 2 + Math.random() * 10;
                    
                    p.vel.set(
                        Math.sin(phi) * Math.cos(theta),
                        Math.sin(phi) * Math.sin(theta),
                        Math.cos(phi)
                    ).multiplyScalar(speed);

                    p.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                    p.rotVel.set(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).multiplyScalar(5);
                    
                    p.color.set(color);
                    
                    spawned++;
                    if (spawned >= burstAmount) break;
                }
            }
        };
        
        window.addEventListener('particle-burst', handleExplosion as any);
        return () => window.removeEventListener('particle-burst', handleExplosion as any);
    }, [particles]);

    useFrame((state, delta) => {
        if (!mesh.current) return;
        const safeDelta = Math.min(delta, 0.1);

        particles.forEach((p, i) => {
            if (p.life > 0) {
                p.life -= safeDelta * 1.5;
                p.pos.addScaledVector(p.vel, safeDelta);
                p.vel.y -= safeDelta * 5; 
                p.vel.multiplyScalar(0.98);

                p.rot.x += p.rotVel.x * safeDelta;
                p.rot.y += p.rotVel.y * safeDelta;
                
                dummy.position.copy(p.pos);
                const scale = Math.max(0, p.life * 0.25);
                dummy.scale.set(scale, scale, scale);
                
                dummy.rotation.set(p.rot.x, p.rot.y, p.rot.z);
                dummy.updateMatrix();
                
                mesh.current!.setMatrixAt(i, dummy.matrix);
                mesh.current!.setColorAt(i, p.color);
            } else {
                dummy.scale.set(0,0,0);
                dummy.updateMatrix();
                mesh.current!.setMatrixAt(i, dummy.matrix);
            }
        });
        
        mesh.current.instanceMatrix.needsUpdate = true;
        if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    });

    return (
        <instancedMesh ref={mesh} args={[undefined, undefined, PARTICLE_COUNT]}>
            <octahedronGeometry args={[0.5, 0]} />
            <meshBasicMaterial toneMapped={false} transparent opacity={0.9} />
        </instancedMesh>
    );
};


const getRandomLane = (laneCount: number) => {
    const max = Math.floor(laneCount / 2);
    return Math.floor(Math.random() * (max * 2 + 1)) - max;
};

export const LevelManager: React.FC = () => {
  const { 
    status, 
    speed, 
    collectGem, 
    collectLetter, 
    collectedLetters,
    laneCount,
    setDistance,
    activateImmortality,
    healOne,
    lives,
    maxLives,
    level
  } = useStore();
  
  const objectsRef = useRef<GameObject[]>([]);
  const [renderTrigger, setRenderTrigger] = useState(0);
  const prevStatus = useRef(status);
  const prevLevel = useRef(level);

  const playerObjRef = useRef<THREE.Object3D | null>(null);
  const distanceTraveled = useRef(0);
  const nextLetterDistance = useRef(BASE_LETTER_INTERVAL);
  const nextImmortalityDistance = useRef(0);

  // Handle resets and transitions
  useEffect(() => {
    const isRestart = status === GameStatus.PLAYING && prevStatus.current === GameStatus.GAME_OVER;
    const isMenuReset = status === GameStatus.MENU;
    const isLevelUp = level !== prevLevel.current && status === GameStatus.PLAYING;
    const isVictoryReset = status === GameStatus.PLAYING && prevStatus.current === GameStatus.VICTORY;

    if (isMenuReset || isRestart || isVictoryReset) {
        // Hard Reset of objects
        objectsRef.current = [];
        setRenderTrigger(t => t + 1);
        
        // Reset trackers
        distanceTraveled.current = 0;
        nextLetterDistance.current = getLetterInterval(1);
        nextImmortalityDistance.current = 0;

    } else if (isLevelUp && level > 1) {
        // Soft Reset for Level Up (Keep visible objects)
        objectsRef.current = objectsRef.current.filter(obj => obj.position[2] > -80);

        // Adjust next letter spawn for the new level's difficulty
        nextLetterDistance.current = distanceTraveled.current - SPAWN_DISTANCE + getLetterInterval(level);
        // Allow immortality again, but don't let it chain immediately after level-up.
        nextImmortalityDistance.current = Math.max(nextImmortalityDistance.current, distanceTraveled.current + 120);

        setRenderTrigger(t => t + 1);
    } else if (status === GameStatus.GAME_OVER || status === GameStatus.VICTORY) {
        setDistance(Math.floor(distanceTraveled.current));
    }
    
    prevStatus.current = status;
    prevLevel.current = level;
  }, [status, level, setDistance]);

  // Start font load as early as possible (even in MENU), so gameplay won't hitch later.
  useEffect(() => {
      loadExtrudeFont().catch(() => {});
  }, []);

  useFrame((state) => {
      if (!playerObjRef.current) {
          const group = state.scene.getObjectByName('PlayerGroup');
          if (group && group.children.length > 0) {
              playerObjRef.current = group.children[0];
          }
      }
  });

  useFrame((state, delta) => {
    if (status !== GameStatus.PLAYING) return;

    const safeDelta = Math.min(delta, 0.05); 
    const dist = speed * safeDelta;
    
    distanceTraveled.current += dist;

    let hasChanges = false;
    let playerPos = new THREE.Vector3(0, 0, 0);
    
    if (playerObjRef.current) {
        playerObjRef.current.getWorldPosition(playerPos);
    }

    // 1. Move & Update
    const currentObjects = objectsRef.current;
    const keptObjects: GameObject[] = [];
    const newSpawns: GameObject[] = [];

    for (const obj of currentObjects) {
        // Standard Movement
        let moveAmount = dist;
        
        // Missile Movement (Moves faster than world)
        if (obj.type === ObjectType.MISSILE) {
            moveAmount += MISSILE_SPEED * safeDelta;
        }

        // Store previous Z for swept collision check (prevents tunneling)
        const prevZ = obj.position[2];
        obj.position[2] += moveAmount;
        
        // Alien AI Logic
        if (obj.type === ObjectType.ALIEN && obj.active && !obj.hasFired) {
             // Fire when within range (e.g., -90 units away)
             if (obj.position[2] > -90) {
                 obj.hasFired = true;
                 
                 // Spawn Missile
                 newSpawns.push({
                     id: uuidv4(),
                     type: ObjectType.MISSILE,
                     position: [obj.position[0], 1.0, obj.position[2] + 2], // Spawn slightly in front
                     active: true,
                     color: '#ff0000'
                 });
                 hasChanges = true;
                 
                 // Visual flare event
                 window.dispatchEvent(new CustomEvent('particle-burst', { 
                    detail: { position: obj.position, color: '#ff00ff' } 
                 }));
             }
        }

        let keep = true;
        if (obj.active) {
            // Swept Collision: Check if object's path [prevZ, currentZ] overlaps with player collision zone
            // INCREASED THRESHOLD from 1.0 to 2.0 to prevent missile tunneling at low FPS/High Speed
            const zThreshold = 2.0; 
            const inZZone = (prevZ < playerPos.z + zThreshold) && (obj.position[2] > playerPos.z - zThreshold);
            
            if (inZZone) {
                // STANDARD COLLISION
                const dx = Math.abs(obj.position[0] - playerPos.x);
                if (dx < 0.9) { // Slightly increased horizontal forgiveness
                     
                     // Obstacles, Aliens, and Missiles damage player
                     const isDamageSource = obj.type === ObjectType.OBSTACLE || obj.type === ObjectType.ALIEN || obj.type === ObjectType.MISSILE;
                     
                     if (isDamageSource) {
                         // VERTICAL COLLISION WITH BOUNDS CHECK
                         // More robust than simple distance check for jumping/running
                         const playerBottom = playerPos.y;
                         const playerTop = playerPos.y + 1.8; // Approx height of player

                         let objBottom = obj.position[1] - 0.5;
                         let objTop = obj.position[1] + 0.5;

                         if (obj.type === ObjectType.OBSTACLE) {
                             objBottom = 0;
                             objTop = OBSTACLE_HEIGHT;
                         } else if (obj.type === ObjectType.MISSILE) {
                             // Missile at Y=1.0
                             objBottom = 0.5;
                             objTop = 1.5;
                         }

                         const isHit = (playerBottom < objTop) && (playerTop > objBottom);

                         if (isHit) { 
                             window.dispatchEvent(new Event('player-hit'));
                             obj.active = false; 
                             hasChanges = true;
                             
                             // Visual burst for missile impact
                             if (obj.type === ObjectType.MISSILE) {
                                window.dispatchEvent(new CustomEvent('particle-burst', { 
                                    detail: { position: obj.position, color: '#ff4400' } 
                                }));
                             }
                         }
                     } else {
                         // Item Collection
                         const dy = Math.abs(obj.position[1] - playerPos.y);
                         if (dy < 2.5) { // Generous vertical pickup range
                            if (obj.type === ObjectType.GEM) {
                                collectGem(obj.points || 50);
                                audio.playGemCollect();
                            }
                            if (obj.type === ObjectType.LETTER && obj.targetIndex !== undefined) {
                                collectLetter(obj.targetIndex);
                                audio.playLetterCollect();
                            }
                            if (obj.type === ObjectType.IMMORTALITY) {
                                // Trigger the same invincibility effect as manual activation
                                activateImmortality();
                                audio.playLetterCollect(); // reuse "special pickup" sound
                            }
                            if (obj.type === ObjectType.HEART) {
                                // Only heals if not already full (store enforces)
                                healOne();
                                audio.playGemCollect(); // reuse pickup sound
                            }
                            
                            window.dispatchEvent(new CustomEvent('particle-burst', { 
                                detail: { 
                                    position: obj.position, 
                                    color: obj.color || '#ffffff' 
                                } 
                            }));

                            obj.active = false;
                            hasChanges = true;
                         }
                     }
                }
            }
        }

        if (obj.position[2] > REMOVE_DISTANCE) {
            keep = false;
            hasChanges = true;
        }

        if (keep) {
            keptObjects.push(obj);
        }
    }

    // Add any newly spawned entities (Missiles)
    if (newSpawns.length > 0) {
        keptObjects.push(...newSpawns);
    }

    // 2. Spawning Logic
    let furthestZ = 0;
    // Only consider static obstacles/gems for gap calculation, not missiles or moving aliens
    const staticObjects = keptObjects.filter(o => o.type !== ObjectType.MISSILE);
    
    if (staticObjects.length > 0) {
        furthestZ = Math.min(...staticObjects.map(o => o.position[2]));
    } else {
        furthestZ = -20;
    }

    if (furthestZ > -SPAWN_DISTANCE) {
         // Reduced gap formula to increase obstacle frequency
         const minGap = 12 + (speed * 0.4); 
         const spawnZ = Math.min(furthestZ - minGap, -SPAWN_DISTANCE);
         
         const isLetterDue = distanceTraveled.current >= nextLetterDistance.current;

         if (isLetterDue) {
             const lane = getRandomLane(laneCount);
             const targetChars = getTargetCharsForLevel(level);
             const targetColors = getTargetColorsForLevel(level);
             const availableIndices = targetChars.map((_, i) => i).filter(i => !collectedLetters.includes(i));

             if (availableIndices.length > 0) {
                 const chosenIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
                 const val = targetChars[chosenIndex];
                 const color = targetColors[chosenIndex];

                 keptObjects.push({
                    id: uuidv4(),
                    type: ObjectType.LETTER,
                    position: [lane * LANE_WIDTH, 1.0, spawnZ], 
                    active: true,
                    color: color,
                    value: val,
                    targetIndex: chosenIndex
                 });
                 
                 // Schedule next letter based on current level difficulty
                 nextLetterDistance.current += getLetterInterval(level);
                 hasChanges = true;
             } else {
                // Fallback to gem if all letters collected for this level
                keptObjects.push({
                    id: uuidv4(),
                    type: ObjectType.GEM,
                    position: [lane * LANE_WIDTH, 1.2, spawnZ],
                    active: true,
                    color: '#00ffff',
                    points: 50
                });
                hasChanges = true;
             }

         } else if (Math.random() > 0.1) { // 90% chance to attempt spawn if gap exists
            
            // Spawn pool: mostly obstacles, sometimes gems, rarely powerups
            const r = Math.random();
            // Prevent back-to-back immortality spawns (especially noticeable in level 1)
            const canSpawnImmortality = distanceTraveled.current >= nextImmortalityDistance.current;
            const immortalityChance = level === 1 ? 0.035 : 0.06; // slightly lower in level 1
            const isPowerup = canSpawnImmortality && r < immortalityChance; // immortality
            const isHeartCandidate = !isPowerup && r < 0.10; // 4% chance (heal)
            const isHeart = isHeartCandidate && lives < maxLives; // don't spawn heart at full HP
            // Increased obstacle probability from 0.35 to 0.20 (80% Obstacle/Alien, 20% Gem) - keep similar feel
            const isObstacle = !isPowerup && !isHeart && r > 0.36; // 64% obstacles (20% fewer than before)

            if (isPowerup) {
                const lane = getRandomLane(laneCount);
                keptObjects.push({
                    id: uuidv4(),
                    type: ObjectType.IMMORTALITY,
                    position: [lane * LANE_WIDTH, 1.25, spawnZ],
                    active: true,
                    color: '#b026ff', // purple
                    points: 0
                });
                // Cooldown: must travel a minimum distance before next immortality can spawn
                // Longer cooldown for level 1 to avoid chain spawns.
                nextImmortalityDistance.current = distanceTraveled.current + (level === 1 ? 220 : 160);
                hasChanges = true;
            } else if (isHeart) {
                const lane = getRandomLane(laneCount);
                keptObjects.push({
                    id: uuidv4(),
                    type: ObjectType.HEART,
                    position: [lane * LANE_WIDTH, 1.15, spawnZ],
                    active: true,
                    color: '#ff2d55', // neon pink/red
                });
                hasChanges = true;
            } else if (isObstacle) {
                // Decide between Alien (Level 2+) or Spikes
                const spawnAlien = level >= 2 && Math.random() < (0.2 * DIFFICULTY_MULT); // easier

                if (spawnAlien) {
                    // Multi-Lane Alien Logic
                    const availableLanes = [];
                    const maxLane = Math.floor(laneCount / 2);
                    for (let i = -maxLane; i <= maxLane; i++) availableLanes.push(i);
                    availableLanes.sort(() => Math.random() - 0.5);

                    // Determine how many aliens to spawn (1 to 3, based on probability)
                    let alienCount = 1;
                    const pAlien = Math.random();
                    
                    if (pAlien > 0.7) {
                        // 30% chance for 2 aliens
                        alienCount = Math.min(2, availableLanes.length);
                    }
                    // 10% chance for 3 aliens if there's enough space (and random allows)
                    if (pAlien > 0.9 && availableLanes.length >= 3) {
                        alienCount = 3;
                    }

                    for (let k = 0; k < alienCount; k++) {
                        const lane = availableLanes[k];
                        keptObjects.push({
                            id: uuidv4(),
                            type: ObjectType.ALIEN,
                            position: [lane * LANE_WIDTH, 1.5, spawnZ],
                            active: true,
                            color: '#00ff00',
                            hasFired: false
                        });
                    }
                } else {
                    // Standard Obstacle Spawning
                    const availableLanes = [];
                    const maxLane = Math.floor(laneCount / 2);
                    for (let i = -maxLane; i <= maxLane; i++) availableLanes.push(i);
                    availableLanes.sort(() => Math.random() - 0.5);
                    
                    let countToSpawn = 1;
                    const p = Math.random();

                    // Increased difficulty probabilities
                    if (p > 0.85) {
                        // Triple Spike (Was > 0.92)
                        countToSpawn = Math.min(3, availableLanes.length);
                    } else if (p > 0.60) {
                        // Double Spike (Was > 0.75)
                        countToSpawn = Math.min(2, availableLanes.length);
                    } else {
                        // Single Spike
                        countToSpawn = 1;
                    }

                    for (let i = 0; i < countToSpawn; i++) {
                        const lane = availableLanes[i];
                        const laneX = lane * LANE_WIDTH;
                        
                        keptObjects.push({
                            id: uuidv4(),
                            type: ObjectType.OBSTACLE,
                            position: [laneX, OBSTACLE_HEIGHT / 2, spawnZ],
                            active: true,
                            color: '#ff0054'
                        });

                        // Chance for gem on top of obstacle
                        if (Math.random() < 0.3) {
                             keptObjects.push({
                                id: uuidv4(),
                                type: ObjectType.GEM,
                                position: [laneX, OBSTACLE_HEIGHT + 1.0, spawnZ],
                                active: true,
                                color: '#ffd700',
                                points: 100
                            });
                        }
                    }
                }

            } else {
                // GROUND GEM SPAWNING
                const lane = getRandomLane(laneCount);
                keptObjects.push({
                    id: uuidv4(),
                    type: ObjectType.GEM,
                    position: [lane * LANE_WIDTH, 1.2, spawnZ],
                    active: true,
                    color: '#00ffff',
                    points: 50
                });
            }
            hasChanges = true;
         }
    }

    if (hasChanges) {
        objectsRef.current = keptObjects;
        setRenderTrigger(t => t + 1);
    }
  });

  return (
    <group>
      <ParticleSystem />
      {objectsRef.current.map(obj => {
        if (!obj.active) return null;
        return <GameEntity key={obj.id} data={obj} />;
      })}
    </group>
  );
};

const GameEntity: React.FC<{ data: GameObject }> = React.memo(({ data }) => {
    const groupRef = useRef<THREE.Group>(null);
    const visualRef = useRef<THREE.Group>(null);
    const shadowRef = useRef<THREE.Mesh>(null);
    const { laneCount } = useStore();

    // Load CJK-capable font without suspending the whole scene
    const [extrudeFont, setExtrudeFont] = useState<Font | null>(extrudeFontCached);
    useEffect(() => {
        let cancelled = false;
        if (!extrudeFont) {
            loadExtrudeFont()
                .then((font) => {
                    if (!cancelled) setExtrudeFont(font);
                })
                .catch((err) => {
                    // Keep fallback rendering if font fails to load
                    console.warn('[Gemini Runner] Staying on fallback text rendering (extrude font unavailable).', err);
                });
        }
        return () => {
            cancelled = true;
        };
    }, [extrudeFont]);

    // (Shop removed)

    const letterTexture = useMemo(() => {
        if (data.type !== ObjectType.LETTER || !data.value) return null;
        return getTextTexture({
            text: data.value,
            color: data.color || '#ffffff',
            width: 512,
            height: 512,
            font: '900 320px "Noto Sans SC", system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
            stroke: 'rgba(0,0,0,0.9)',
            background: 'rgba(0,0,0,0)'
        });
    }, [data.type, data.value, data.color]);

    const extrudedLetterGeo = useMemo(() => {
        if (!extrudeFont) return null;
        if (data.type !== ObjectType.LETTER || !data.value) return null;
        return getExtrudedGeometry(extrudeFont, data.value, EXTRUDE_LETTER_OPTS);
    }, [data.type, data.value, extrudeFont]);

    const extrudedLetterMaterials = useMemo(() => {
        if (data.type !== ObjectType.LETTER) return null;

        const front = new THREE.MeshStandardMaterial({
            color: data.color || '#ffffff',
            emissive: data.color || '#ffffff',
            emissiveIntensity: 1.2,
            metalness: 0.2,
            roughness: 0.15,
        });
        const side = new THREE.MeshStandardMaterial({
            color: '#0a0716',
            emissive: data.color || '#ffffff',
            emissiveIntensity: 0.25,
            metalness: 0.6,
            roughness: 0.55,
        });

        return [front, side];
    }, [data.type, data.color]);

    useEffect(() => {
        return () => {
            if (extrudedLetterMaterials) {
                extrudedLetterMaterials.forEach((m) => m.dispose());
            }
        };
    }, [extrudedLetterMaterials]);

    const extrudedLetterScale = useMemo(() => {
        if (!extrudedLetterGeo) return 1;
        const bb = (extrudedLetterGeo as any).boundingBox as THREE.Box3 | undefined;
        if (!bb) return 1;
        const size = new THREE.Vector3();
        bb.getSize(size);
        // Fit inside a ~1.6w x 1.1h envelope so complex glyphs don't get clipped.
        const targetW = 1.6;
        const targetH = 1.1;
        const sx = size.x > 0 ? targetW / size.x : 1;
        const sy = size.y > 0 ? targetH / size.y : 1;
        // Allow a little upscaling but avoid huge jumps.
        return Math.min(Math.max(0.6, Math.min(sx, sy)), 1.15);
    }, [extrudedLetterGeo]);

    // (Shop removed)
    
    useFrame((state, delta) => {
        // 1. Move Main Container
        if (groupRef.current) {
            groupRef.current.position.set(data.position[0], 0, data.position[2]);
        }

        // 2. Animate Visuals
        if (visualRef.current) {
            const baseHeight = data.position[1];
            
            if (data.type === ObjectType.MISSILE) {
                 // Missile rotation
                 visualRef.current.rotation.z += delta * 20; // Fast spin
                 visualRef.current.position.y = baseHeight;
            } else if (data.type === ObjectType.ALIEN) {
                 // Alien Hover
                 visualRef.current.position.y = baseHeight + Math.sin(state.clock.elapsedTime * 3) * 0.2;
                 visualRef.current.rotation.y += delta;
            } else if (data.type !== ObjectType.OBSTACLE) {
                // Gem/Letter Bobbing
                const bobOffset = Math.sin(state.clock.elapsedTime * 4 + data.position[0]) * 0.1;
                visualRef.current.position.y = baseHeight + bobOffset;
                
                if (data.type === ObjectType.GEM) {
                    // Gems can rotate fast
                    visualRef.current.rotation.y += delta * 3;
                } else if (data.type === ObjectType.LETTER) {
                    // Letters: face camera on Y + spin around Y (pickup-like)
                    const worldPos = new THREE.Vector3();
                    if (groupRef.current) groupRef.current.getWorldPosition(worldPos);
                    const camPos = state.camera.position;
                    const angle = Math.atan2(camPos.x - worldPos.x, camPos.z - worldPos.z);
                    const t = state.clock.elapsedTime;
                    const spin = t * 2.2 + data.position[0] * 0.3; // Y-axis spin like a pickup
                    visualRef.current.rotation.y = angle + spin;
                    visualRef.current.rotation.z = 0;
                } else if (data.type === ObjectType.IMMORTALITY || data.type === ObjectType.HEART) {
                    // Powerups: rotate like other pickups (no billboard)
                    visualRef.current.rotation.y += delta * 2.4;
                }
                
                if (shadowRef.current) {
                    const shadowScale = 1 - bobOffset; 
                    shadowRef.current.scale.setScalar(shadowScale);
                }
            } else {
                visualRef.current.position.y = baseHeight;
            }
        }
    });

    // Select Shadow Geometry based on type (using shared geometries)
    const shadowGeo = useMemo(() => {
        if (data.type === ObjectType.LETTER) return SHADOW_LETTER_GEO;
        if (data.type === ObjectType.GEM) return SHADOW_GEM_GEO;
        if (data.type === ObjectType.ALIEN) return SHADOW_ALIEN_GEO;
        if (data.type === ObjectType.MISSILE) return SHADOW_MISSILE_GEO;
        return SHADOW_DEFAULT_GEO; 
    }, [data.type]);

    return (
        <group ref={groupRef} position={[data.position[0], 0, data.position[2]]}>
            {shadowGeo && (
                <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} geometry={shadowGeo}>
                    <meshBasicMaterial color="#000000" opacity={0.3} transparent />
                </mesh>
            )}

            <group ref={visualRef} position={[0, data.position[1], 0]}>
                {/* --- OBSTACLE --- */}
                {data.type === ObjectType.OBSTACLE && (
                    <group>
                        <mesh geometry={OBSTACLE_GEOMETRY} castShadow receiveShadow>
                             <meshStandardMaterial 
                                 color="#330011"
                                 roughness={0.3} 
                                 metalness={0.8} 
                                 flatShading={true}
                             />
                        </mesh>
                        <mesh scale={[1.02, 1.02, 1.02]} geometry={OBSTACLE_GLOW_GEO}>
                             <meshBasicMaterial 
                                 color={data.color} 
                                 wireframe 
                                 transparent 
                                 opacity={0.3} 
                             />
                        </mesh>
                         <mesh position={[0, -OBSTACLE_HEIGHT/2 + 0.05, 0]} rotation={[-Math.PI/2,0,0]} geometry={OBSTACLE_RING_GEO}>
                             <meshBasicMaterial color={data.color} transparent opacity={0.4} side={THREE.DoubleSide} />
                         </mesh>
                    </group>
                )}

                {/* --- ALIEN (LEVEL 2+) --- */}
                {data.type === ObjectType.ALIEN && (
                    <group>
                        {/* Saucer Body */}
                        <mesh castShadow geometry={ALIEN_BODY_GEO}>
                            <meshStandardMaterial color="#4400cc" metalness={0.8} roughness={0.2} />
                        </mesh>
                        {/* Dome */}
                        <mesh position={[0, 0.2, 0]} geometry={ALIEN_DOME_GEO}>
                            <meshStandardMaterial color="#00ff00" emissive="#00ff00" emissiveIntensity={0.5} transparent opacity={0.8} />
                        </mesh>
                        {/* Glowing Eyes/Lights */}
                        <mesh position={[0.3, 0, 0.3]} geometry={ALIEN_EYE_GEO}>
                             <meshBasicMaterial color="#ff00ff" />
                        </mesh>
                        <mesh position={[-0.3, 0, 0.3]} geometry={ALIEN_EYE_GEO}>
                             <meshBasicMaterial color="#ff00ff" />
                        </mesh>
                    </group>
                )}

                {/* --- MISSILE (Long Laser) --- */}
                {data.type === ObjectType.MISSILE && (
                    <group rotation={[Math.PI / 2, 0, 0]}>
                        {/* Long glowing core: Oriented along Y (which is Z after rotation) */}
                        <mesh geometry={MISSILE_CORE_GEO}>
                            <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={4} />
                        </mesh>
                        {/* Energy Rings */}
                        <mesh position={[0, 1.0, 0]} geometry={MISSILE_RING_GEO}>
                            <meshBasicMaterial color="#ffff00" />
                        </mesh>
                        <mesh position={[0, 0, 0]} geometry={MISSILE_RING_GEO}>
                            <meshBasicMaterial color="#ffff00" />
                        </mesh>
                        <mesh position={[0, -1.0, 0]} geometry={MISSILE_RING_GEO}>
                            <meshBasicMaterial color="#ffff00" />
                        </mesh>
                    </group>
                )}

                {/* --- GEM --- */}
                {data.type === ObjectType.GEM && (
                    <mesh castShadow geometry={GEM_GEOMETRY}>
                        <meshStandardMaterial 
                            color={data.color} 
                            roughness={0} 
                            metalness={1} 
                            emissive={data.color} 
                            emissiveIntensity={2} 
                        />
                    </mesh>
                )}

                {/* --- IMMORTALITY POWERUP --- */}
                {data.type === ObjectType.IMMORTALITY && (
                    <group>
                        <mesh geometry={POWERUP_CORE_GEO} rotation={[0, 0, Math.PI]}>
                            <meshStandardMaterial
                                color="#1a1200"
                                emissive={data.color || '#b026ff'}
                                emissiveIntensity={3.2}
                                metalness={0.9}
                                roughness={0.2}
                            />
                        </mesh>
                        <mesh geometry={POWERUP_RING_GEO} rotation={[Math.PI / 2, 0, 0]}>
                            <meshBasicMaterial
                                color={data.color || '#b026ff'}
                                transparent
                                opacity={0.45}
                                toneMapped={false}
                                blending={THREE.AdditiveBlending}
                                depthWrite={false}
                            />
                        </mesh>
                    </group>
                )}

                {/* --- HEART (HEAL) --- */}
                {data.type === ObjectType.HEART && (
                    <group scale={[0.9, 0.9, 0.9]}>
                        {/* Core */}
                        <mesh geometry={HEART_GEO} castShadow>
                            <meshStandardMaterial
                                color={data.color || '#ff2d55'}
                                emissive={data.color || '#ff2d55'}
                                emissiveIntensity={3.0}
                                metalness={1.0}
                                roughness={0.05}
                            />
                        </mesh>
                        {/* Bloom shell (matches other pickups) */}
                        <mesh geometry={HEART_GEO} scale={[1.08, 1.08, 1.08]} position={[0, 0, 0.02]}>
                            <meshBasicMaterial
                                color={data.color || '#ff2d55'}
                                transparent
                                opacity={0.22}
                                toneMapped={false}
                                blending={THREE.AdditiveBlending}
                                depthWrite={false}
                            />
                        </mesh>
                        <mesh geometry={HEART_RING_GEO} rotation={[Math.PI / 2, 0, 0]}>
                            <meshBasicMaterial
                                color={data.color || '#ff2d55'}
                                transparent
                                opacity={0.45}
                                toneMapped={false}
                                blending={THREE.AdditiveBlending}
                                depthWrite={false}
                            />
                        </mesh>
                    </group>
                )}

                {/* --- LETTER --- */}
                {data.type === ObjectType.LETTER && (
                    <group>
                        {/* True extruded glyph (with plaque fallback while font loads) */}
                        {extrudedLetterGeo ? (
                            <group rotation={[0.12, 0, 0]}>
                                {/* Subtle halo for readability */}
                                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.15, -0.15]} geometry={LETTER_GLOW_GEO}>
                                    <meshBasicMaterial
                                        color={data.color || '#ffffff'}
                                        transparent
                                        opacity={0.35}
                                        toneMapped={false}
                                        blending={THREE.AdditiveBlending}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Outer "stroke" (slightly scaled) */}
                                <mesh geometry={extrudedLetterGeo} scale={extrudedLetterScale * 1.05} position={[0, 0, -0.06]}>
                                    <meshStandardMaterial
                                        color="#05000f"
                                        emissive={data.color || '#ffffff'}
                                        emissiveIntensity={0.45}
                                        metalness={0.2}
                                        roughness={0.8}
                                    />
                                </mesh>

                                {/* Glow shell (drives Bloom like other pickups) */}
                                <mesh
                                    geometry={extrudedLetterGeo}
                                    scale={extrudedLetterScale * 1.16}
                                    position={[0, 0, 0.02]}
                                >
                                    <meshBasicMaterial
                                        color={data.color || '#ffffff'}
                                        transparent
                                        opacity={0.22}
                                        toneMapped={false}
                                        blending={THREE.AdditiveBlending}
                                        depthWrite={false}
                                    />
                                </mesh>

                                {/* Main extruded glyph */}
                                <mesh geometry={extrudedLetterGeo} scale={extrudedLetterScale} castShadow>
                                    {/* Front bright + sides darker for readability */}
                                    {extrudedLetterMaterials && (
                                        <primitive attach="material" object={extrudedLetterMaterials} />
                                    )}
                                </mesh>
                            </group>
                        ) : (
                            <group>
                                {/* 3D plaque body (has thickness) */}
                                <mesh geometry={LETTER_BODY_GEO} castShadow>
                                    <meshStandardMaterial
                                        color="#0b0b14"
                                        roughness={0.35}
                                        metalness={0.85}
                                        emissive={data.color || '#ffffff'}
                                        emissiveIntensity={0.35}
                                    />
                                </mesh>

                                {/* Neon edges */}
                                <lineSegments geometry={LETTER_EDGES_GEO}>
                                    <lineBasicMaterial color={data.color || '#ffffff'} transparent opacity={0.65} />
                                </lineSegments>

                                {/* Front face */}
                                {letterTexture && (
                                    <mesh position={[0, 0, 0.095]} geometry={LETTER_FACE_GEO}>
                                        <meshBasicMaterial
                                            map={letterTexture}
                                            transparent
                                            toneMapped={false}
                                            side={THREE.DoubleSide}
                                        />
                                    </mesh>
                                )}

                                {/* Back face (mirrored) */}
                                {letterTexture && (
                                    <mesh position={[0, 0, -0.095]} rotation={[0, Math.PI, 0]} geometry={LETTER_FACE_GEO}>
                                        <meshBasicMaterial
                                            map={letterTexture}
                                            transparent
                                            toneMapped={false}
                                            side={THREE.DoubleSide}
                                        />
                                    </mesh>
                                )}
                            </group>
                        )}
                    </group>
                )}
            </group>
        </group>
    );
});

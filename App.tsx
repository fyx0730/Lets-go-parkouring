/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Environment } from './components/World/Environment';
import { Player } from './components/World/Player';
import { LevelManager } from './components/World/LevelManager';
import { Effects } from './components/World/Effects';
import { HUD } from './components/UI/HUD';
import { useStore } from './store';
import { MqttController } from './components/System/MqttController';

type QualityLevel = 'low' | 'medium' | 'high';
type RenderQuality = {
  level: QualityLevel;
  dpr: number;
  bloomEnabled: boolean;
  starCount: number;
  particleCount: number;
};

const getRenderQuality = (width: number, height: number): RenderQuality => {
  const pixels = width * height;
  if (pixels >= 1920 * 1080) {
    return {
      level: 'low',
      dpr: 0.72,
      bloomEnabled: false,
      starCount: 450,
      particleCount: 140,
    };
  }
  if (pixels >= 1280 * 720) {
    return {
      level: 'medium',
      dpr: 0.85,
      bloomEnabled: true,
      starCount: 700,
      particleCount: 200,
    };
  }
  return {
    level: 'high',
    dpr: 1,
    bloomEnabled: true,
    starCount: 1000,
    particleCount: 300,
  };
};

// Dynamic Camera Controller
const CameraController = () => {
  const { camera, size } = useThree();
  const { laneCount } = useStore();
  
  useFrame((state, delta) => {
    // Determine if screen is narrow (mobile portrait)
    const aspect = size.width / size.height;
    const isMobile = aspect < 1.2; // Threshold for "mobile-like" narrowness or square-ish displays

    // Calculate expansion factors
    // Mobile requires backing up significantly more because vertical FOV is fixed in Three.js,
    // meaning horizontal view shrinks as aspect ratio drops.
    // We use more aggressive multipliers for mobile to keep outer lanes in frame.
    const heightFactor = isMobile ? 2.0 : 0.5;
    const distFactor = isMobile ? 4.5 : 1.0;

    // Base (3 lanes): y=5.5, z=8
    // Calculate target based on how many extra lanes we have relative to the start
    const extraLanes = Math.max(0, laneCount - 3);

    const targetY = 5.5 + (extraLanes * heightFactor);
    const targetZ = 8.0 + (extraLanes * distFactor);

    const targetPos = new THREE.Vector3(0, targetY, targetZ);
    
    // Smoothly interpolate camera position
    camera.position.lerp(targetPos, delta * 2.0);
    
    // Look further down the track to see the end of lanes
    // Adjust look target slightly based on height to maintain angle
    camera.lookAt(0, 0, -30); 
  });
  
  return null;
};

function Scene({ quality }: { quality: RenderQuality }) {
  return (
    <>
        <Environment starCount={quality.starCount} />
        <group>
            {/* Attach a userData to identify player group for LevelManager collision logic */}
            <group userData={{ isPlayer: true }} name="PlayerGroup">
                 <Player />
            </group>
            <LevelManager particleCount={quality.particleCount} />
        </group>
        {quality.bloomEnabled && <Effects />}
    </>
  );
}

function App() {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const quality = useMemo(
    () => getRenderQuality(viewport.width, viewport.height),
    [viewport.width, viewport.height]
  );

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden select-none">
      <HUD />
      <MqttController />
      <Canvas
        shadows={false}
        dpr={quality.dpr}
        gl={{ antialias: false, stencil: false, depth: true, powerPreference: "high-performance" }}
        // Initial camera, matches the controller base
        camera={{ position: [0, 5.5, 8], fov: 60 }}
      >
        <CameraController />
        <Suspense fallback={null}>
            <Scene quality={quality} />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default App;

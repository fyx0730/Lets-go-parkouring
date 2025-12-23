/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React from 'react';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

export const Effects: React.FC = () => {
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      {/* Optimized bloom for low-end hardware: lower intensity and fewer levels */}
      <Bloom 
        luminanceThreshold={0.85} 
        mipmapBlur={false} 
        intensity={0.6} 
        radius={0.4}
        levels={4}
      />
      {/* Noise and Vignette are disabled for performance on Raspberry Pi */}
      {/* <Noise opacity={0.05} blendFunction={BlendFunction.OVERLAY} /> */}
      {/* <Vignette eskil={false} offset={0.1} darkness={0.5} /> */}
    </EffectComposer>
  );
};

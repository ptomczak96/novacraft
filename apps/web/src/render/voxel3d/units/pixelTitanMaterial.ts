import * as THREE from 'three';

/**
 * Titan-only pixel-3D material prototype.
 *
 * Keeps the rigged GLB geometry and animations, but replaces smooth PBR with:
 * - nearest-neighbour source sampling
 * - a four-colour authored mech palette
 * - three hard light bands from the original vertex normals
 * - a stable pixel-grid dither pattern for deliberate screen-space clusters
 *
 * This is a render treatment, not a destructive asset conversion. The source
 * scene and shared materials are never mutated.
 */

const PALETTE = [
  new THREE.Vector3(0.085, 0.105, 0.115), // charcoal joint / deepest shade
  new THREE.Vector3(0.165, 0.345, 0.335), // dark teal armour
  new THREE.Vector3(0.390, 0.610, 0.565), // lit teal armour
  new THREE.Vector3(0.815, 0.765, 0.595), // warm cream highlight
] as const;

export interface PixelTitanOptions {
  paletteMix?: number;
  lightDirection?: THREE.Vector3;
  ditherScale?: number;
}

function nearestPixelTexture(source: THREE.Texture | null): THREE.Texture | null {
  if (!source) return null;
  const texture = source.clone();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
  return texture;
}

export function createPixelTitanMaterial(
  source: THREE.MeshStandardMaterial,
  options: PixelTitanOptions = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: nearestPixelTexture(source.map),
    roughness: 0.88,
    metalness: 0.04,
    flatShading: true,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
  });
  material.name = `${source.name || 'Titan'}_Pixel3D`;
  material.userData.pixelTitan = true;
  material.userData.ownedTexture = material.map;
  material.customProgramCacheKey = () => 'rigbound-pixel-titan-v1';

  const paletteMix = options.paletteMix ?? 0.84;
  const ditherScale = options.ditherScale ?? 17;
  const lightDirection = (options.lightDirection ?? new THREE.Vector3(-0.42, 0.84, 0.34)).normalize();

  material.onBeforeCompile = shader => {
    shader.uniforms.uPixelPalette0 = { value: PALETTE[0] };
    shader.uniforms.uPixelPalette1 = { value: PALETTE[1] };
    shader.uniforms.uPixelPalette2 = { value: PALETTE[2] };
    shader.uniforms.uPixelPalette3 = { value: PALETTE[3] };
    shader.uniforms.uPixelPaletteMix = { value: paletteMix };
    shader.uniforms.uPixelDitherScale = { value: ditherScale };
    shader.uniforms.uPixelLightDirection = { value: lightDirection };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPixelObjectPosition;
        varying vec3 vPixelObjectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPixelObjectPosition = transformed;
        vPixelObjectNormal = normalize(objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uPixelPalette0;
        uniform vec3 uPixelPalette1;
        uniform vec3 uPixelPalette2;
        uniform vec3 uPixelPalette3;
        uniform float uPixelPaletteMix;
        uniform float uPixelDitherScale;
        uniform vec3 uPixelLightDirection;
        varying vec3 vPixelObjectPosition;
        varying vec3 vPixelObjectNormal;

        float pixelBayer4(vec2 p) {
          vec2 cell = mod(floor(p), 4.0);
          float x = cell.x;
          float y = cell.y;
          float index = 0.0;
          if (y < 1.0) {
            index = x < 1.0 ? 0.0 : x < 2.0 ? 8.0 : x < 3.0 ? 2.0 : 10.0;
          } else if (y < 2.0) {
            index = x < 1.0 ? 12.0 : x < 2.0 ? 4.0 : x < 3.0 ? 14.0 : 6.0;
          } else if (y < 3.0) {
            index = x < 1.0 ? 3.0 : x < 2.0 ? 11.0 : x < 3.0 ? 1.0 : 9.0;
          } else {
            index = x < 1.0 ? 15.0 : x < 2.0 ? 7.0 : x < 3.0 ? 13.0 : 5.0;
          }
          return (index + 0.5) / 16.0;
        }

        vec3 pixelTitanPalette(float value) {
          float v = clamp(value, 0.0, 0.999);
          if (v < 0.25) return uPixelPalette0;
          if (v < 0.50) return uPixelPalette1;
          if (v < 0.75) return uPixelPalette2;
          return uPixelPalette3;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float sourceLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float lightFacing = dot(normalize(vPixelObjectNormal), normalize(uPixelLightDirection));
        float lightBand = lightFacing < -0.10 ? 0.66 : lightFacing < 0.46 ? 0.88 : 1.12;
        vec2 ditherCoord = floor(gl_FragCoord.xy / 2.0) +
          floor((vPixelObjectPosition.xz + vPixelObjectPosition.yy * vec2(0.37, 0.61)) * uPixelDitherScale);
        float dither = pixelBayer4(ditherCoord) - 0.5;
        float paletteValue = sourceLuma * lightBand + dither * 0.095;
        vec3 authoredPalette = pixelTitanPalette(paletteValue);
        diffuseColor.rgb = mix(diffuseColor.rgb * lightBand, authoredPalette, uPixelPaletteMix);`,
      );
  };

  return material;
}

export function applyPixelTitanMaterials(model: THREE.Group): () => void {
  const ownedMaterials: THREE.Material[] = [];
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const converted = sources.map(source => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source.clone();
      return createPixelTitanMaterial(source);
    });
    converted.forEach(material => ownedMaterials.push(material));
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
  });

  return () => {
    for (const material of ownedMaterials) {
      const ownedTexture = material.userData.ownedTexture as THREE.Texture | undefined;
      ownedTexture?.dispose();
      material.dispose();
    }
  };
}

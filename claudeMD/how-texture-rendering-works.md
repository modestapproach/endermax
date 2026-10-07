# How Texture Rendering Works in Endermax

## Overview
The Endermax project uses Three.js to render 3D blocks with textures. This document explains how numbered images are parsed, loaded, and rendered on blocks in the scene.

## Image Settings Format

Located in `image-settings.txt`:
```
ID[WIDTH, TYPE, ATTRIBUTE]
```

Example:
```
1[10, x, item]
2[5, #, na]
```

- **ID**: The number used in layout.txt (e.g., 1, 2, 3)
- **WIDTH**: How many consecutive blocks are needed
- **TYPE**: Geometry type
  - `x` = wall (height y=1 to y=10)
  - `#` = sign (height y=13 to y=15)
- **ATTRIBUTE**: Future use (e.g., "item" for collectibles, "na" for none)

## Layout System

The `layout.txt` file defines a 2D grid where:
- Each row is enclosed in `[...]`
- Characters represent different objects:
  - `x` = solid wall column
  - `e` = shelf unit
  - `#` = sign
  - `h` = hanger
  - `1`, `2`, `3`, etc. = numbered image blocks

### Orientation Detection

The code checks BOTH horizontal and vertical arrangements:

**Horizontal** (along Z axis):
```
[      11111      ]  ← 5 consecutive 1's in same row
```

**Vertical** (along X axis):
```
[      2      ]
[      2      ]
[      2      ]
[      2      ]
[      2      ]
```
↑ 5 consecutive 2's in same column

## Texture Loading

In `src/scene.js`:

1. **Parse Settings** (`parseImageSettings()`):
   - Reads `image-settings.txt`
   - Stores width, type, attribute for each image ID

2. **Load Textures** (`loadNumberedTextures()`):
   - Manually imports image URLs (e.g., `image1Url`, `image2Url`)
   - Loads textures using Three.js TextureLoader
   - Stores in `numberedTextures` Map

Example:
```javascript
import image1Url from './assets/textures/1/shelf-texture.jpg';
import image2Url from './assets/textures/2/snacks.png';

// In loadNumberedTextures():
const texture = textureLoader.load(image2Url);
texture.wrapS = THREE.RepeatWrapping;
texture.wrapT = THREE.RepeatWrapping;
numberedTextures.set('2', texture);
```

## Block Creation Flow

### 1. Parse Layout (`createBlocks()`)
- Iterate through each character in the grid
- When a number is found:
  - Count consecutive horizontal matches
  - Count consecutive vertical matches
  - If count matches `settings.width`, create image object
  - Mark positions as "processed" to avoid duplicates

### 2. Create Image Object (`createImageObject()`)
- Determines Y-range based on type:
  - Wall (`x`): y=1 to 10 (height=10)
  - Sign (`#`): y=13 to 15 (height=3)

- Creates blocks with texture options:
  ```javascript
  {
    texture: texture,
    isImageBlock: true,
    imageWidth: width,
    offsetInImage: offsetX or offsetZ,
    imageHeight: imageHeight,
    yOffsetInImage: y - startY,
    orientation: 'horizontal' or 'vertical',
    isFirstBlock: offsetX === 0,
    isLastBlock: offsetX === width - 1
  }
  ```

**Horizontal orientation**: Spans along Z axis
```javascript
for (let offsetZ = 0; offsetZ < width; offsetZ++) {
    const z = startZ + offsetZ;
    for (let y = startY; y <= endY; y++) {
        createBlock(startX, y, z, ...options);
    }
}
```

**Vertical orientation**: Spans along X axis
```javascript
for (let offsetX = 0; offsetX < width; offsetX++) {
    const x = startX + offsetX;
    for (let y = startY; y <= endY; y++) {
        createBlock(x, y, startZ, ...options);
    }
}
```

### 3. Create Individual Block (`createBlock()`)
- Creates `BoxGeometry(UNIT, UNIT, UNIT)` where UNIT = 0.5
- Applies texture with custom UV mapping
- Adds to scene

## UV Mapping

UV coordinates map 2D texture pixels to 3D geometry faces:
- **U**: Horizontal (0 = left, 1 = right)
- **V**: Vertical (0 = bottom, 1 = top)

### Box Geometry Faces
A Three.js BoxGeometry has 6 faces:
- **X-facing**: Left (vx < 0) and Right (vx > 0)
- **Y-facing**: Top (vy > 0) and Bottom (vy < 0)
- **Z-facing**: Front (vz > 0) and Back (vz < 0)

We determine which face we're on by checking vertex positions:
```javascript
const vx = positionAttribute.getX(i);
const vy = positionAttribute.getY(i);
const vz = positionAttribute.getZ(i);

if (Math.abs(vz) > 0.24) {
    // Front or back face
} else if (Math.abs(vx) > 0.24) {
    // Left or right face
} else {
    // Top or bottom face
}
```

### Horizontal Orientation UV Mapping

For images spanning horizontally (along Z axis):

```javascript
// Front/Back faces (Z-facing)
newU = (offsetInImage + u) / imageWidth;
newV = (yOffsetInImage + v) / imageHeight;
```

Example with width=10, height=10:
- Block 0: U = 0.0 to 0.1 (first 10% of texture)
- Block 1: U = 0.1 to 0.2 (next 10%)
- ...
- Block 9: U = 0.9 to 1.0 (last 10%)

All blocks share the same V range based on Y position.

### Vertical Orientation UV Mapping

For images spanning vertically (along X axis):

**Current Implementation (BROKEN for back face):**
```javascript
if (Math.abs(vz) > 0.24) {
    // Front/Back faces - main visible surfaces
    if (vz > 0) {
        // Front face
        newU = (offsetInImage + u) / imageWidth;
    } else {
        // Back face - attempting to flip
        newU = ((imageWidth - offsetInImage - 1) + (1 - u)) / imageWidth;
    }
    newV = (yOffsetInImage + v) / imageHeight;
}
```

## The Problem

When viewing a vertical sign from the back:
1. The blocks are physically arranged in X order: 0, 1, 2, 3, 4
2. But from behind, we see them in reverse visual order
3. The texture needs to be mirrored so text reads correctly

**Current Issue**: The back face shows jumbled/mirrored text

## Coordinate System

```
        +Y (up)
         |
         |
         |________ +X (right)
        /
       /
     +Z (forward toward camera)
```

- **Horizontal signs**: Blocks arranged along +Z axis (into/out of screen)
- **Vertical signs**: Blocks arranged along +X axis (left to right)
- **Front face**: Faces +Z direction (toward viewer from front)
- **Back face**: Faces -Z direction (toward viewer from back)

## Box Geometry Vertex Positions

Each cube vertex has local coordinates around (0, 0, 0):
- X: ±0.25 (UNIT/2 = 0.5/2)
- Y: ±0.25
- Z: ±0.25

Threshold of 0.24 is used to detect which face each vertex belongs to.

## Texture Wrapping

Textures are loaded with:
```javascript
texture.wrapS = THREE.RepeatWrapping;
texture.wrapT = THREE.RepeatWrapping;
```

This allows UV values outside [0, 1] to wrap/repeat, though we try to keep them in [0, 1] range.

## Debug Console Logs

The code outputs several console.log statements:
- Found horizontal/vertical counts
- Settings for each image ID
- Whether texture is loaded
- Which image objects are being created

Check browser console for these messages to debug texture loading issues.

## Next Steps to Fix Back Face

Possible approaches:
1. **Duplicate texture with flip**: Load texture twice, flip one for back faces
2. **Material-level fix**: Use different materials for front/back faces
3. **Geometry groups**: Assign different materials to different face groups
4. **Simpler UV formula**: May need to debug the exact math for back face mirroring
5. **Face culling**: Only render front faces? (but loses double-sided visibility)

The core issue is getting the UV mapping formula correct so that:
- Front face: Block 0 (leftmost) shows left part of texture
- Back face: Block 0 (visually rightmost when viewed from back) shows right part of texture

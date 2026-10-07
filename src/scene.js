import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const items = [];

// UNIT SYSTEM: 1 unit = 0.5 world space (one block size)
export const UNIT = 0.5;

// Import background panorama

export function createEnvironment(scene) {
    // Fallback background color
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 20, 70);

    // More even lighting - increase ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);
    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.5); // Reduced from 0.8
    directionalLight1.position.set(5, 10, 5);
    directionalLight1.castShadow = true;
    directionalLight1.shadow.camera.left = -20;
    directionalLight1.shadow.camera.right = 20;
    directionalLight1.shadow.camera.top = 20;
    directionalLight1.shadow.camera.bottom = -20;
    scene.add(directionalLight1);

    // Additional directional lights for even coverage
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight2.position.set(-5, 10, -5);
    scene.add(directionalLight2);

    const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight3.position.set(5, 10, -5);
    scene.add(directionalLight3);

    const directionalLight4 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight4.position.set(-5, 10, 5);
    scene.add(directionalLight4);

    // Ground - 120 units × 120 units (60m × 60m in world space)
    const groundGeometry = new THREE.PlaneGeometry(120 * UNIT, 120 * UNIT);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2c54, roughness: 0.8 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData = { type: 'ground' }; // Mark as ground for gaze detection
    scene.add(ground);

    return { ground }; // Return ground so it can be used in raycasting

}

import layoutString from '../layout.txt?raw';
import imageSettingsString from '../image-settings.txt?raw';

const textureLoader = new THREE.TextureLoader();

// Parse image-settings.txt to get requirements for numbered images and 3D items
const imageSettings = new Map();
const numberedTextures = new Map();
const modelCache = new Map(); // Stores Promises that resolve to the loaded GLTF model

function parseImageSettings() {
    const lines = imageSettingsString.split('\n');
    lines.forEach(line => {
        // Format: ID[WIDTH, TYPE, ATTRIBUTE, LABEL]
        // Example: 1[10, x, item]
        // Example: b[1, 3D, item, beans]
        const match = line.match(/^(\w+)\[(\d+),\s*([^,]+),\s*([^,\]]+)(?:,\s*([^\]]+))?\]$/);
        if (match) {
            const id = match[1];
            const width = parseInt(match[2]);
            const type = match[3].trim();
            const attribute = match[4].trim();
            const label = match[5] ? match[5].trim() : undefined;

            imageSettings.set(id, { width, type, attribute, label });
        }
    });
}

// Load assets (textures and models) dynamically
async function loadAssets() {
    const gltfLoader = new GLTFLoader();
    const extensions = ['png', 'jpg', 'jpeg'];

    for (const [id, settings] of imageSettings.entries()) {
        // Handle 3D items
        if (settings.type === '3D') {
            const modelPath = `./assets/textures/${id}/model.glb`; // Assuming model.glb for now

            // Store a promise in the cache
            const loadPromise = new Promise((resolve, reject) => {
                // Try to load the model
                // Note: We might need to try different filenames if not standardized, 
                // Use dynamic import to load the texture
                // This will try common filenames in the folder
                // Use query: '?url' to ensure we get the URL string and avoid JS parsing errors
                const modules = import.meta.glob('./assets/textures/**/*.glb', { eager: true, query: '?url', import: 'default' });
                let foundPath = null;

                for (const [path, module] of Object.entries(modules)) {
                    if (path.includes(`/textures/${id}/`)) {
                        foundPath = module; // module is already the URL string due to query: '?url', import: 'default'
                        break;
                    }
                }

                if (foundPath) {
                    gltfLoader.load(foundPath, (gltf) => {
                        console.log(`Loaded model for ${id}`);
                        resolve(gltf);
                    }, undefined, (error) => {
                        console.error(`Error loading model for ${id}:`, error);
                        resolve(null); // Resolve null on error to avoid hanging
                    });
                } else {
                    console.warn(`No GLB model found for ${id} in ./assets/textures/${id}/`);
                    resolve(null);
                }
            });

            modelCache.set(id, loadPromise);
            continue;
        }

        // Handle 2D Textures
        let textureLoaded = false;
        for (const ext of extensions) {
            try {
                const modules = import.meta.glob('./assets/textures/**/*.{webp,png,jpg,jpeg}', { eager: true });
                for (const [path, module] of Object.entries(modules)) {
                    if (path.includes(`/textures/${id}/`)) {
                        const texture = textureLoader.load(module.default);
                        // Color textures must be tagged sRGB in three r152+ or they
                        // render washed out through the linear pipeline.
                        texture.colorSpace = THREE.SRGBColorSpace;
                        texture.wrapS = THREE.RepeatWrapping;
                        texture.wrapT = THREE.RepeatWrapping;
                        numberedTextures.set(id, texture);
                        console.log(`Loaded texture for image #${id}: ${path}`);
                        textureLoaded = true;
                        break;
                    }
                }
                if (textureLoaded) break;
            } catch (e) {
                continue;
            }
        }

        if (!textureLoaded) {
            console.warn(`No texture found for image #${id} in ./assets/textures/${id}/`);
        }
    }
}

// Initialize
parseImageSettings();
loadAssets();

export function createBlocks(scene, blocks, heatmapData, blockMap) {
    const lines = layoutString.split('\n');

    // Filter for lines containing brackets and extract content
    const gridRows = [];
    lines.forEach(line => {
        const match = line.match(/\[(.*?)\]/);
        if (match) {
            gridRows.push(match[1]);
        }
    });

    if (gridRows.length === 0) return;

    // Calculate dimensions to center the layout
    const zSize = gridRows[0].length;
    const xSize = gridRows.length;

    const startX = -Math.floor(xSize / 2);
    const startZ = -Math.floor(zSize / 2);

    // Track which positions have been processed (for numbered images that span multiple columns)
    const processed = new Set();

    gridRows.forEach((row, rowIndex) => {
        const x = startX + rowIndex;
        const chars = row.split('');

        for (let colIndex = 0; colIndex < chars.length; colIndex++) {
            const z = startZ + colIndex;
            const posKey = `${rowIndex},${colIndex}`;

            if (processed.has(posKey)) {
                continue; // Skip already processed positions
            }

            const char = chars[colIndex];

            // Check if it's a defined ID (number or letter)
            if (imageSettings.has(char)) {
                const settings = imageSettings.get(char);

                if (settings) {
                    if (settings.type === '3D') {
                        // 3D Item
                        console.log(`Creating 3D item '${char}' at x=${x}, z=${z}`);
                        create3DItem(x, z, char, settings, scene, blocks, heatmapData, blockMap);
                        processed.add(posKey);
                        continue;
                    }

                    // Try horizontal first
                    let horizontalCount = 1;
                    while (colIndex + horizontalCount < chars.length && chars[colIndex + horizontalCount] === char) {
                        horizontalCount++;
                    }

                    // Try vertical
                    let verticalCount = 1;
                    while (rowIndex + verticalCount < gridRows.length &&
                        gridRows[rowIndex + verticalCount].split('')[colIndex] === char) {
                        verticalCount++;
                    }

                    console.log(`Found '${char}' at row ${rowIndex}, col ${colIndex}: horizontal=${horizontalCount}, vertical=${verticalCount}`);

                    // Check if horizontal matches
                    if (horizontalCount === settings.width) {
                        const texture = numberedTextures.get(char);
                        console.log(`Horizontal match for '${char}': width=${horizontalCount}, texture loaded:`, !!texture);

                        if (texture) {
                            // Mark all positions in this sequence as processed
                            for (let i = 0; i < horizontalCount; i++) {
                                processed.add(`${rowIndex},${colIndex + i}`);
                            }

                            console.log(`Creating horizontal image object for '${char}' at x=${x}, z=${z}, width=${horizontalCount}, type=${settings.type}`);

                            // Create image object spanning horizontally
                            createImageObject(x, z, char, horizontalCount, settings.type, texture, scene, blocks, heatmapData, blockMap, 'horizontal');
                            colIndex += horizontalCount - 1; // Skip ahead
                            continue;
                        }
                    }

                    // Check if vertical matches
                    if (verticalCount === settings.width) {
                        const texture = numberedTextures.get(char);
                        console.log(`Vertical match for '${char}': width=${verticalCount}, texture loaded:`, !!texture);

                        if (texture) {
                            // Mark all positions in this sequence as processed
                            for (let i = 0; i < verticalCount; i++) {
                                processed.add(`${rowIndex + i},${colIndex}`);
                            }

                            console.log(`Creating vertical image object for '${char}' at x=${x}, z=${z}, width=${verticalCount}, type=${settings.type}`);

                            // Create image object spanning vertically
                            createImageObject(x, z, char, verticalCount, settings.type, texture, scene, blocks, heatmapData, blockMap, 'vertical');
                            continue;
                        }
                    }
                }

                // Invalid sequence or missing texture - treat as 'x'
                console.log(`Treating '${char}' as 'x' block (no valid match or missing texture)`);
                createSolidColumn(x, z, scene, blocks, heatmapData, blockMap);
            } else if (char === 'x') {
                createSolidColumn(x, z, scene, blocks, heatmapData, blockMap);
            } else if (char === 'e') {
                createShelfUnit(x, z, scene, blocks, heatmapData, blockMap);
            } else if (char === '#') {
                createSign(x, z, scene, blocks, heatmapData, blockMap);
            } else if (char === '!') {
                createHanger(x, z, scene, blocks, heatmapData, blockMap);
            } else if (char === '&') {
                createTallObject(x, z, scene, blocks, heatmapData, blockMap);
            }
        }
    });
}

function createTallObject(x, z, scene, blocks, heatmapData, blockMap) {
    // 4 blocks high
    for (let y = 1; y <= 4; y++) {
        createBlock(x, y, z, scene, blocks, heatmapData, blockMap);
    }
}

function createSolidColumn(x, z, scene, blocks, heatmapData, blockMap) {
    // Render solid column from y=1 to 10 (no texture - plain white)
    for (let y = 1; y <= 10; y++) {
        createBlock(x, y, z, scene, blocks, heatmapData, blockMap);
    }
}

function createShelfUnit(x, z, scene, blocks, heatmapData, blockMap) {
    // Shelf unit: 10 units high
    // Definition: 10101010010000000000
    // Levels: 1, 3, 5, 7, 10
    const levels = [1, 3, 5, 7, 10];
    levels.forEach(y => {
        createBlock(x, y, z, scene, blocks, heatmapData, blockMap);
    });
}

function createSign(x, z, scene, blocks, heatmapData, blockMap) {
    // Sign:
    // Definition: 00000000000011100000
    // Levels: 13, 14, 15
    for (let y = 13; y <= 15; y++) {
        createBlock(x, y, z, scene, blocks, heatmapData, blockMap);
    }
}

function createHanger(x, z, scene, blocks, heatmapData, blockMap) {
    // Hanger:
    // Levels: 13, 14, 15, 16, 17, 18, 19, 20
    for (let y = 13; y <= 20; y++) {
        createBlock(x, y, z, scene, blocks, heatmapData, blockMap);
    }
}

function createImageObject(startX, startZ, imageNum, width, type, texture, scene, blocks, heatmapData, blockMap, orientation = 'horizontal') {
    // Determine y-range based on type
    let startY, endY, imageHeight;

    if (type === 'x') {
        // Wall type: 1 to 10
        startY = 1;
        endY = 10;
        imageHeight = 10;
    } else if (type === '#') {
        // Sign type: 13 to 15
        startY = 13;
        endY = 15;
        imageHeight = 3;
    } else {
        // Default to wall if unknown
        startY = 1;
        endY = 10;
        imageHeight = 10;
    }

    // Get label from imageSettings
    const imageInfo = imageSettings.get(imageNum);
    const label = imageInfo?.label;

    // Create blocks spanning the width with continuous texture mapping
    if (orientation === 'horizontal') {
        // Horizontal: span along Z axis
        for (let offsetZ = 0; offsetZ < width; offsetZ++) {
            const z = startZ + offsetZ;
            for (let y = startY; y <= endY; y++) {
                createBlock(startX, y, z, scene, blocks, heatmapData, blockMap, {
                    texture: texture,
                    isImageBlock: true,
                    imageNum: imageNum,
                    label: label,
                    imageWidth: width,
                    offsetInImage: offsetZ,
                    imageHeight: imageHeight,
                    yOffsetInImage: y - startY, // 0-indexed offset for UV mapping
                    orientation: 'horizontal',
                    blockType: type // Pass the type from image-settings
                });
            }
        }
    } else {
        // Vertical: span along X axis
        for (let offsetX = 0; offsetX < width; offsetX++) {
            const x = startX + offsetX;
            for (let y = startY; y <= endY; y++) {
                createBlock(x, y, startZ, scene, blocks, heatmapData, blockMap, {
                    texture: texture,
                    isImageBlock: true,
                    imageNum: imageNum,
                    label: label,
                    imageWidth: width,
                    offsetInImage: offsetX,
                    imageHeight: imageHeight,
                    yOffsetInImage: y - startY, // 0-indexed offset for UV mapping
                    orientation: 'vertical',
                    blockType: type, // Pass the type from image-settings
                    isFirstBlock: offsetX === 0,
                    isLastBlock: offsetX === width - 1
                });
            }
        }
    }
}

// Geometry cache: a block's geometry is fully determined by its UV mapping
// parameters (or is the plain unit cube), so identical cells across all
// shelf images share one BufferGeometry instead of ~3,700 unique ones.
const _geometryCache = new Map();

function getBlockGeometry(options) {
    const isTextured = !!(options.texture && options.isImageBlock);
    const key = isTextured
        ? `${options.imageWidth}|${options.imageHeight}|${options.offsetInImage}|${options.yOffsetInImage}|${options.orientation || 'horizontal'}`
        : 'plain';

    let geometry = _geometryCache.get(key);
    if (geometry) return geometry;

    geometry = new THREE.BoxGeometry(UNIT, UNIT, UNIT);

    if (isTextured) {
        // Apply UV mapping for continuous texture across the image width
        const uvAttribute = geometry.attributes.uv;
        const positionAttribute = geometry.attributes.position;
        const imageWidth = options.imageWidth;
        const imageHeight = options.imageHeight;
        const offsetInImage = options.offsetInImage;
        const yOffsetInImage = options.yOffsetInImage;
        const orientation = options.orientation || 'horizontal';

        for (let i = 0; i < uvAttribute.count; i++) {
            const u = uvAttribute.getX(i);
            const v = uvAttribute.getY(i);

            // Get vertex position to determine face
            const vx = positionAttribute.getX(i);
            const vz = positionAttribute.getZ(i);

            let newU, newV;

            if (orientation === 'horizontal') {
                // Horizontal: image spans along Z axis
                // The main visible faces are X-facing (East/West)
                if (Math.abs(vx) > 0.24) {
                    // East/West face - these show the full texture
                    if (vx < 0) {
                        // West face - normal mapping
                        newU = (offsetInImage + u) / imageWidth;
                    } else {
                        // East face - reverse the block order
                        const reversedOffset = (imageWidth - 1 - offsetInImage);
                        newU = (reversedOffset + u) / imageWidth;
                    }
                    newV = (yOffsetInImage + v) / imageHeight;
                } else {
                    // Edge and top/bottom faces sample the texture center
                    newU = 0.5;
                    newV = 0.5;
                }
            } else {
                // Vertical: image spans along X axis
                // The main visible faces are Z-facing (North/South)
                if (Math.abs(vz) > 0.24) {
                    // Front/Back face - these show the full texture
                    if (vz > 0) {
                        // Front face (South) - normal mapping
                        newU = (offsetInImage + u) / imageWidth;
                    } else {
                        // Back face (North) - reverse the block order
                        const reversedOffset = (imageWidth - 1 - offsetInImage);
                        newU = (reversedOffset + u) / imageWidth;
                    }
                    newV = (yOffsetInImage + v) / imageHeight;
                } else {
                    // Edge and top/bottom faces sample the texture center
                    newU = 0.5;
                    newV = 0.5;
                }
            }

            uvAttribute.setXY(i, newU, newV);
        }

        uvAttribute.needsUpdate = true;
    }

    _geometryCache.set(key, geometry);
    return geometry;
}

function createBlock(x, y, z, scene, blocks, heatmapData, blockMap, options = {}) {
    const geometry = getBlockGeometry(options);

    // Materials stay per-block: the live heatmap tints each block's color and
    // emissive individually.
    let material;
    if (options.texture && options.isImageBlock) {
        material = new THREE.MeshStandardMaterial({
            map: options.texture,
            roughness: 0.7,
            metalness: 0.1,
            side: THREE.DoubleSide
        });
    } else {
        material = new THREE.MeshStandardMaterial({
            color: 0xffffff, // White instead of blue
            roughness: 0.7,
            metalness: 0.3
        });
    }

    const block = new THREE.Mesh(geometry, material);
    block.position.set(x * UNIT, y * UNIT, z * UNIT);
    // Blocks receive shadows but don't cast them: with 0.9 ambient light the
    // casts were invisible, and skipping ~3,700 casters halves the draw calls
    // spent on the shadow depth pass.
    block.castShadow = false;
    block.receiveShadow = true;

    // Store grid coordinates and image metadata
    block.userData = {
        gridX: x,
        gridY: y,
        gridZ: z,
        isImageBlock: options.isImageBlock || false,
        imageNum: options.imageNum,
        label: options.label,
        blockType: options.blockType // 'x' for shelf, '#' for sign, etc.
    };

    scene.add(block);
    blocks.push(block);
    heatmapData.set(block.uuid, 0);

    if (blockMap) {
        blockMap.set(`${x},${y},${z}`, block);
    }
}


function create3DItem(x, z, id, settings, scene, blocks, heatmapData, blockMap) {
    // Create a base block for the item to sit on (optional, or maybe it sits on the floor?)
    // User said "instead of a block its oging to be a 3D object"
    // So maybe no block? But we need something to occupy the grid?
    // Let's assume it sits on the floor (y=0) or a table?
    // "appear in the user's items... disappear from the ground"
    // Let's place it at y=0.5 (half unit up) or on the ground.
    // Since our ground is at y=0, let's place it at y=0.

    // Check if we have a model promise
    const modelPromise = modelCache.get(id);

    if (modelPromise) {
        modelPromise.then(gltf => {
            if (!gltf) return;

            const model = gltf.scene.clone();

            // Position
            // Grid coordinates x, z correspond to x*UNIT, z*UNIT
            model.position.set(x * UNIT, 0, z * UNIT);

            // Scale - we might need to normalize scale or read from settings?
            // For now, let's assume the model is reasonably sized or scale it to fit 1 unit.
            // Let's scale it down a bit to fit in a 0.5x0.5 square
            model.scale.set(0.5, 0.5, 0.5);

            // Add metadata
            model.userData = {
                type: 'item',
                id: id,
                label: settings.label || 'Item',
                isPickup: true,
                gridX: x,
                gridZ: z
            };

            // Enable shadows
            model.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                    // Ensure userData is on meshes too for raycasting
                    node.userData = model.userData;
                }
            });

            scene.add(model);
            items.push(model);

            console.log(`Added 3D item ${settings.label} to scene`);
        });
    } else {
        // Fallback placeholder if no model?
        const geometry = new THREE.SphereGeometry(UNIT / 4, 16, 16);
        const material = new THREE.MeshStandardMaterial({ color: 0xffd700 });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.set(x * UNIT, UNIT / 2, z * UNIT);

        sphere.userData = {
            type: 'item',
            id: id,
            label: settings.label || 'Item',
            isPickup: true
        };

        scene.add(sphere);
        items.push(sphere);
    }
}

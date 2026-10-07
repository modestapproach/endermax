import * as THREE from 'three';

export class PathVisualizer {
    constructor(scene, maxPoints = 10000) {
        this.scene = scene;
        this.maxPoints = maxPoints;
        this.points = [];
        this.lastPosition = new THREE.Vector3();
        this.minDistance = 0.5; // Minimum distance between dots

        // Create geometry with pre-allocated buffer
        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.maxPoints * 3);
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

        // Initially draw 0 points
        this.geometry.setDrawRange(0, 0);

        this.material = new THREE.PointsMaterial({
            color: 0x000000, // Black
            size: 0.15,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8
        });

        this.mesh = new THREE.Points(this.geometry, this.material);
        this.mesh.frustumCulled = false; // Ensure it's always rendered
        this.scene.add(this.mesh);

        this.count = 0;
    }

    update(position) {
        // Only add point if we've moved enough
        if (this.count > 0 && position.distanceTo(this.lastPosition) < this.minDistance) {
            return;
        }

        this.addPoint(position);
        this.lastPosition.copy(position);
    }

    addPoint(position) {
        if (this.count >= this.maxPoints) {
            // Optional: Shift points or just stop adding (for now, let's just stop or maybe wrap around?)
            // Wrapping around is complex with a single buffer. 
            // Let's just stop for now, 10k points is a lot of walking.
            return;
        }

        const index = this.count * 3;
        this.positions[index] = position.x;
        this.positions[index + 1] = 0.05; // Slightly above ground to avoid z-fighting
        this.positions[index + 2] = position.z;

        this.count++;
        this.geometry.setDrawRange(0, this.count);
        this.geometry.attributes.position.needsUpdate = true;
    }

    reset() {
        this.count = 0;
        this.geometry.setDrawRange(0, 0);
        this.lastPosition.set(0, 0, 0); // Reset last pos too, though it will be overwritten on first update
    }
}

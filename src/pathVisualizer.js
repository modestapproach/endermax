import * as THREE from 'three/webgpu';
import { attribute, uniform, mix, color, smoothstep, float, abs } from 'three/tsl';

// Walked path as a flat ribbon on the floor. Color runs from pale (start) to
// accent (most recent) by distance walked. Keeps the v1 API: positions/count
// (x,y,z per sampled point), update(), addPoint(), reset().
export class PathVisualizer {
    constructor(scene, maxPoints = 10000) {
        this.scene = scene;
        this.maxPoints = maxPoints;
        this.minDistance = 0.5;
        this.width = 0.09;
        this.positions = new Float32Array(maxPoints * 3);
        this.count = 0;
        this.lastPosition = new THREE.Vector3();
        this.totalDist = 0;
        this.cum = new Float32Array(maxPoints);

        this.verts = new Float32Array(maxPoints * 2 * 3);
        this.dist = new Float32Array(maxPoints * 2);
        this.side = new Float32Array(maxPoints * 2);
        const index = new Uint32Array((maxPoints - 1) * 6);
        for (let i = 0; i < maxPoints - 1; i++) {
            const a = i * 2;
            index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
        }
        for (let i = 0; i < maxPoints; i++) { this.side[i * 2] = -1; this.side[i * 2 + 1] = 1; }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.verts, 3));
        this.geometry.setAttribute('dist', new THREE.BufferAttribute(this.dist, 1));
        this.geometry.setAttribute('side', new THREE.BufferAttribute(this.side, 1));
        this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
        this.geometry.setDrawRange(0, 0);

        this.total = uniform(1);
        this.material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const t = attribute('dist').div(this.total.max(0.001));
        this.material.colorNode = mix(color('#c7d2fe'), color('#4338ca'), t);
        // Soft edges across the ribbon width.
        this.material.opacityNode = smoothstep(float(1.0), float(0.4), abs(attribute('side'))).mul(0.4).add(0.45);

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        this.mesh.name = 'path';
        scene.add(this.mesh);
    }

    update(position) {
        if (this.count > 0 && position.distanceTo(this.lastPosition) < this.minDistance) return;
        this.addPoint(position);
    }

    addPoint(position) {
        if (this.count >= this.maxPoints) return;
        const i = this.count;
        this.positions.set([position.x, 0.05, position.z], i * 3);
        if (i > 0) {
            const px = this.positions[(i - 1) * 3], pz = this.positions[(i - 1) * 3 + 2];
            this.totalDist += Math.hypot(position.x - px, position.z - pz);
        }
        this.cum[i] = this.totalDist;
        this.lastPosition.copy(position);
        this.count++;
        this._writeVertex(i);
        if (i > 0) this._writeVertex(i - 1); // previous point's miter changes once it has a successor
        this.total.value = this.totalDist;
        this.geometry.setDrawRange(0, Math.max(0, (this.count - 1) * 6));
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.dist.needsUpdate = true;
    }

    _writeVertex(i) {
        const P = this.positions;
        const prev = Math.max(i - 1, 0), next = Math.min(i + 1, this.count - 1);
        let dx = P[next * 3] - P[prev * 3], dz = P[next * 3 + 2] - P[prev * 3 + 2];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        const nx = -dz * this.width, nz = dx * this.width;
        const x = P[i * 3], z = P[i * 3 + 2], y = 0.012;
        this.verts.set([x - nx, y, z - nz, x + nx, y, z + nz], i * 6);
        this.dist[i * 2] = this.dist[i * 2 + 1] = this.cum[i];
    }

    reset() {
        this.count = 0;
        this.totalDist = 0;
        this.geometry.setDrawRange(0, 0);
        this.lastPosition.set(0, 0, 0);
    }
}

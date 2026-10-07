// The shopper: a stylized mannequin wearing a mixed-reality visor, with a
// procedural walk cycle, head tracking, a soft gaze beam, and a hit reticle.
// Forward is local -Z (matches v1 camera and gaze math).

import * as THREE from 'three/webgpu';
import { uv, float, smoothstep, mix, color, uniform, time, sin } from 'three/tsl';

export const EYE_HEIGHT = 2.75;

function capsule(radius, length, material) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 16), material);
    m.castShadow = true;
    return m;
}

export function createCharacter(scene) {
    const person = new THREE.Group();
    person.name = 'shopper';

    const suit = new THREE.MeshStandardNodeMaterial({ color: '#4f46e5', roughness: 0.45, metalness: 0.05 });
    const skin = new THREE.MeshStandardNodeMaterial({ color: '#f4f2ee', roughness: 0.35, metalness: 0 });
    const dark = new THREE.MeshStandardNodeMaterial({ color: '#1d1d27', roughness: 0.25, metalness: 0.3 });
    const visorMat = new THREE.MeshPhysicalNodeMaterial({ color: '#0b0b14', roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
    const visorGlow = new THREE.MeshBasicNodeMaterial({ color: '#7dd3fc' });

    // Hips/torso
    const pelvis = new THREE.Group();
    pelvis.position.y = 1.3;
    person.add(pelvis);

    const torso = capsule(0.36, 0.55, suit);
    torso.position.y = 0.55;
    torso.scale.set(1, 1, 0.72);
    pelvis.add(torso);

    // Head with visor
    const head = new THREE.Group();
    head.position.y = EYE_HEIGHT - 1.3;
    pelvis.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), skin);
    skull.castShadow = true;
    head.add(skull);
    const visor = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.36, 4, 16), visorMat);
    visor.rotation.z = Math.PI / 2;
    visor.position.set(0, 0.02, -0.24);
    visor.scale.set(1, 1, 0.75);
    head.add(visor);
    const visorLine = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.01), visorGlow);
    visorLine.position.set(0, 0.0, -0.325);
    head.add(visorLine);

    // Limbs hang from pivot groups so the walk cycle is a rotation.
    function limb(x, y, radius, length, mat, parent) {
        const pivot = new THREE.Group();
        pivot.position.set(x, y, 0);
        const seg = capsule(radius, length, mat);
        seg.position.y = -length / 2 - radius * 0.5;
        pivot.add(seg);
        parent.add(pivot);
        return pivot;
    }
    const armL = limb(-0.46, 0.92, 0.095, 0.62, suit, pelvis);
    const armR = limb(0.46, 0.92, 0.095, 0.62, suit, pelvis);
    armL.rotation.z = -0.12;
    armR.rotation.z = 0.12;
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), skin);
    handL.position.y = -0.86; armL.add(handL);
    const handR = handL.clone(); armR.add(handR);

    const legL = limb(-0.17, 0.0, 0.13, 0.92, dark, pelvis);
    const legR = limb(0.17, 0.0, 0.13, 0.92, dark, pelvis);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.38), skin);
    shoe.castShadow = true;
    shoe.position.set(0, -1.2, -0.06);
    legL.add(shoe);
    legR.add(shoe.clone());

    // Contact shadow blob keeps the figure grounded even outside the key light.
    const blob = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 32),
        (() => {
            const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
            const d = uv().sub(0.5).length().mul(2);
            m.colorNode = color('#000000');
            m.opacityNode = smoothstep(float(1), float(0.2), d).mul(0.28);
            return m;
        })()
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.004;
    person.add(blob);

    scene.add(person);

    // --- Gaze beam + reticle (world space, not parented) ------------------
    const beamOpacity = uniform(0.55);
    const beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // Cylinder uv.y runs along the beam: fade toward the far end, pulse gently.
    const along = uv().y;
    beamMat.colorNode = mix(color('#a5f3fc'), color('#6366f1'), along.oneMinus());
    beamMat.opacityNode = smoothstep(float(0.0), float(0.08), along).mul(along.mul(0.55).oneMinus()).mul(beamOpacity).mul(sin(time.mul(3)).mul(0.08).add(0.92));
    const beamGeo = new THREE.CylinderGeometry(0.012, 0.045, 1, 12, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(-Math.PI / 2); // +Y -> -Z so scale.z is length
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.frustumCulled = false;
    beam.renderOrder = 10;
    scene.add(beam);

    const reticle = new THREE.Group();
    const ringMat = new THREE.MeshBasicNodeMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.11, 0.14, 40), ringMat));
    const dotMat = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false });
    reticle.add(new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), dotMat));
    reticle.renderOrder = 11;
    reticle.visible = false;
    scene.add(reticle);

    const _q = new THREE.Quaternion();
    const _z = new THREE.Vector3(0, 0, 1);
    const _negZ = new THREE.Vector3(0, 0, -1);

    // origin/dir in world space; hit is a raycast intersection or null.
    function setGaze(visible, origin, dir, hit, normalWorld) {
        beam.visible = visible;
        if (!visible) { reticle.visible = false; return; }
        const len = hit ? hit.distance : 12;
        beam.position.copy(origin);
        beam.quaternion.setFromUnitVectors(_negZ, dir);
        beam.scale.set(1, 1, len);
        if (hit && normalWorld) {
            reticle.visible = true;
            reticle.position.copy(hit.point).addScaledVector(normalWorld, 0.012);
            reticle.quaternion.setFromUnitVectors(_z, normalWorld);
            const s = 0.85 + Math.min(len, 20) * 0.04;
            reticle.scale.setScalar(s);
        } else {
            reticle.visible = false;
        }
    }

    // --- Animation ---------------------------------------------------------
    let phase = 0;
    let stride = 0;
    function animate(dt, speed, headYaw = 0, headPitch = 0) {
        // speed in world units/sec; stride eases in/out so stops look natural.
        const target = Math.min(speed / 6, 1);
        stride += (target - stride) * Math.min(dt * 10, 1);
        phase += dt * (4 + speed * 0.9);
        const swing = Math.sin(phase) * 0.55 * stride;
        legL.rotation.x = swing;
        legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.8;
        armR.rotation.x = swing * 0.8;
        pelvis.position.y = 1.3 + Math.abs(Math.cos(phase)) * 0.05 * stride;
        torso.rotation.y = Math.sin(phase) * 0.06 * stride;
        // Idle breathing
        torso.scale.y = 1 + Math.sin(performance.now() * 0.002) * 0.008;

        const k = Math.min(dt * 8, 1);
        head.rotation.y += (headYaw - head.rotation.y) * k;
        head.rotation.x += (headPitch - head.rotation.x) * k;
    }

    // --- Emotion badge ------------------------------------------------------
    const emojiCanvas = document.createElement('canvas');
    emojiCanvas.width = emojiCanvas.height = 128;
    const ctx = emojiCanvas.getContext('2d');
    const emojiTexture = new THREE.CanvasTexture(emojiCanvas);
    emojiTexture.colorSpace = THREE.SRGBColorSpace;
    const emojiMaterial = new THREE.SpriteMaterial({ map: emojiTexture, transparent: true, opacity: 0, depthTest: false });
    const emoji = new THREE.Sprite(emojiMaterial);
    emoji.position.set(0, 3.65, 0);
    emoji.scale.setScalar(0.75);
    emoji.renderOrder = 12;
    person.add(emoji);
    const EMOJI = { happy: '🙂', neutral: '😐', mad: '😠', confused: '😕', thinking: '🤔' };
    function updateEmoji(emotion) {
        if (!emotion) { emojiMaterial.opacity = 0; return; }
        ctx.clearRect(0, 0, 128, 128);
        ctx.beginPath();
        ctx.arc(64, 64, 60, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();
        ctx.font = '84px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(EMOJI[emotion] || '', 64, 70);
        emojiTexture.needsUpdate = true;
        emojiMaterial.opacity = 1;
    }

    return { person, head, beam, reticle, setGaze, animate, updateEmoji, beamOpacity };
}

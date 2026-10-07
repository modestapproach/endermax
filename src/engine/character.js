// The shopper: a stylized mannequin wearing a mixed-reality visor, with a
// procedural walk cycle, head tracking, a soft gaze beam, and a hit reticle.
// Forward is local -Z (matches v1 camera and gaze math).

import * as THREE from 'three/webgpu';
import { uv, float, smoothstep, mix, color, uniform, time, sin, normalView, positionViewDirection, dot, pow, attribute } from 'three/tsl';
import { paint } from './materials.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const EYE_HEIGHT = 2.75;

export function createCharacter(scene) {
    const person = new THREE.Group();
    person.name = 'shopper';

    // One material for the whole figure (one shader to compile): colour and
    // surface come from painted vertex attributes. surf.w = indigo rim amount.
    const body = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    const surf = attribute('surf', 'vec4');
    const albedo = attribute('color', 'vec3');
    const fresnel = pow(float(1).sub(dot(normalView, positionViewDirection).clamp(0, 1)), 3);
    body.colorNode = albedo;
    body.roughnessNode = surf.x;
    body.metalnessNode = surf.y;
    // Self-lit visor band + a soft indigo rim that separates the figure from white shelving.
    body.emissiveNode = albedo.mul(surf.z).add(color('#6366f1').mul(fresnel.mul(surf.w)));
    const bodyMaterials = [body];
    const shell = (g) => paint(g, '#f4f4f6', { rough: 0.45, tex: 0.18 });
    const jacket = (g) => paint(g, '#4f46e5', { rough: 0.75, tex: 0.45 });
    const dark = (g) => paint(g, '#2b2b35', { rough: 0.6, metal: 0.05 });
    const visorMat = (g) => paint(g, '#1e1b4b', { rough: 0.08, metal: 0.3 });
    const visorGlow = (g) => paint(g, '#818cf8', { rough: 0.5, glow: 1.6 });
    const part = (geo, painter) => new THREE.Mesh(painter(geo), body);

    const pelvis = new THREE.Group();
    pelvis.position.y = 1.3;
    person.add(pelvis);

    // Tapered torso: lathe profile, hips -> waist -> chest -> shoulders.
    const profile = [[0, 0], [0.3, 0.02], [0.33, 0.12], [0.3, 0.32], [0.36, 0.62], [0.42, 0.86], [0.38, 0.98], [0.18, 1.06], [0, 1.08]]
        .map(([x, y]) => new THREE.Vector2(x, y));
    const torso = part(new THREE.LatheGeometry(profile, 32), jacket);
    torso.scale.set(1, 1, 0.68);
    torso.castShadow = true;
    pelvis.add(torso);
    const collar = part(new THREE.CylinderGeometry(0.11, 0.13, 0.14, 20), shell);
    collar.position.y = 1.12;
    pelvis.add(collar);

    // Head: slightly egg-shaped, wearing a wraparound MR headset whose
    // glowing band makes the facing direction readable from any camera.
    const head = new THREE.Group();
    head.position.y = EYE_HEIGHT - 1.3;
    pelvis.add(head);
    const skull = part(new THREE.SphereGeometry(0.29, 40, 28), shell);
    skull.scale.set(0.92, 1.08, 0.98);
    skull.castShadow = true;
    head.add(skull);
    // Front visor: open cylinder spanning ~200 degrees around the face (-Z).
    const visorArc = Math.PI * 1.1;
    const visor = part(new THREE.CylinderGeometry(0.3, 0.29, 0.17, 40, 1, true, Math.PI - visorArc / 2, visorArc), visorMat);
    visor.position.y = 0.02;
    visor.castShadow = true;
    head.add(visor);
    const band = part(new THREE.CylinderGeometry(0.305, 0.305, 0.018, 40, 1, true, Math.PI - visorArc / 2, visorArc), visorGlow);
    band.position.y = -0.035;
    head.add(band);
    // Strap around the back of the head with a small status light.
    const strap = part(new THREE.TorusGeometry(0.285, 0.022, 8, 40), dark);
    strap.rotation.x = Math.PI / 2;
    strap.position.y = 0.05;
    head.add(strap);
    const status = part(new THREE.SphereGeometry(0.022, 12, 8), visorGlow);
    status.position.set(0, 0.05, 0.3);
    head.add(status);

    // Tapered limbs hang from pivots so the walk cycle is a rotation.
    function limb(x, y, rTop, rBottom, length, mat, parent) {
        const pivot = new THREE.Group();
        pivot.position.set(x, y, 0);
        const seg = part(new THREE.CylinderGeometry(rTop, rBottom, length, 16), mat);
        seg.position.y = -length / 2;
        seg.castShadow = true;
        pivot.add(seg);
        const joint = part(new THREE.SphereGeometry(rTop, 16, 12), mat);
        pivot.add(joint);
        parent.add(pivot);
        return pivot;
    }
    const armL = limb(-0.43, 0.92, 0.085, 0.065, 0.78, jacket, pelvis);
    const armR = limb(0.43, 0.92, 0.085, 0.065, 0.78, jacket, pelvis);
    armL.rotation.z = -0.16;
    armR.rotation.z = 0.16;
    const handL = part(new THREE.SphereGeometry(0.075, 16, 12), shell);
    handL.scale.set(1, 1.25, 0.8);
    handL.position.y = -0.84;
    armL.add(handL);
    armR.add(handL.clone());

    const legL = limb(-0.15, 0.04, 0.12, 0.08, 1.12, dark, pelvis);
    const legR = limb(0.15, 0.04, 0.12, 0.08, 1.12, dark, pelvis);
    const shoe = part(new RoundedBoxGeometry(0.17, 0.11, 0.32, 2, 0.04), shell);
    shoe.castShadow = true;
    shoe.position.set(0, -1.2, -0.06);
    legL.add(shoe);
    legR.add(shoe.clone());

    // Brand selection ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.63, 64), new THREE.MeshBasicNodeMaterial({ color: '#4f46e5', transparent: true, opacity: 0.8, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    person.add(ring);

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

    // Static shadow map: the figure doesn't cast; its contact blob grounds it.
    person.traverse(o => { o.castShadow = false; });
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
    reticle.add(new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), ringMat)); // shares the ring's shader
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
        torso.scale.y = 1 + Math.sin(performance.now() * 0.002) * 0.01;

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

    // Fades the figure when the camera is pulled in close (spring arm), so it
    // never blocks the shelf the participant is studying.
    let fade = 1;
    function setFade(a) {
        a = Math.round(a * 50) / 50;
        if (a === fade) return;
        const wasOpaque = fade >= 1, isOpaque = a >= 1;
        fade = a;
        for (const m of bodyMaterials) {
            m.opacity = a;
            if (wasOpaque !== isOpaque) {
                m.transparent = !isOpaque;
                m.depthWrite = isOpaque;
                m.needsUpdate = true;
            }
        }
    }

    return { person, head, beam, reticle, setGaze, animate, updateEmoji, beamOpacity, setFade };
}

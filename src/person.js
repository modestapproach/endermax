import * as THREE from 'three';

export function createPerson(scene) {
    const person = new THREE.Group();

    // Body
    const bodyGeometry = new THREE.CylinderGeometry(0.3, 0.4, 1.2, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x3498db });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 1.8;
    body.castShadow = true;
    person.add(body);

    // Head (simplified - no face details)
    const headGeometry = new THREE.SphereGeometry(0.35, 16, 16);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xffdbac });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 2.75;
    head.castShadow = true;
    person.add(head);

    // Arms
    const armGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8);
    const armMaterial = new THREE.MeshStandardMaterial({ color: 0xffdbac });

    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-0.5, 1.8, 0);
    leftArm.rotation.z = Math.PI / 6;
    leftArm.castShadow = true;
    person.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(0.5, 1.8, 0);
    rightArm.rotation.z = -Math.PI / 6;
    rightArm.castShadow = true;
    person.add(rightArm);

    // Legs
    const legGeometry = new THREE.CylinderGeometry(0.12, 0.12, 1.0, 8);
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });

    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.2, 0.7, 0);
    leftLeg.castShadow = true;
    person.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.2, 0.7, 0);
    rightLeg.castShadow = true;
    person.add(rightLeg);

    person.position.set(0, 0, 0);
    scene.add(person);

    // Gaze ray visualization
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -10)
    ]);
    const rayMaterial = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.6,
        linewidth: 2
    });
    const gazeRay = new THREE.Line(rayGeometry, rayMaterial);
    person.add(gazeRay);

    // Emoji Billboard
    const emojiCanvas = document.createElement('canvas');
    emojiCanvas.width = 128;
    emojiCanvas.height = 128;
    const emojiContext = emojiCanvas.getContext('2d');
    const emojiTexture = new THREE.CanvasTexture(emojiCanvas);

    const emojiMaterial = new THREE.SpriteMaterial({
        map: emojiTexture,
        transparent: true,
        opacity: 0
    });

    const emojiSprite = new THREE.Sprite(emojiMaterial);
    emojiSprite.position.set(0, 3.8, 0); // Above head
    emojiSprite.scale.set(1, 1, 1);
    person.add(emojiSprite);

    // Function to update emoji
    function updateEmoji(emotion) {
        if (!emotion) {
            emojiMaterial.opacity = 0;
            return;
        }

        // Map emotion to emoji char
        const emojiMap = {
            'happy': '🙂',
            'neutral': '😐',
            'mad': '😠',
            'confused': '😕',
            'thinking': '🤔'
        };

        const emojiChar = emojiMap[emotion] || '';

        // Draw to canvas
        emojiContext.clearRect(0, 0, 128, 128);
        emojiContext.font = '100px Arial';
        emojiContext.textAlign = 'center';
        emojiContext.textBaseline = 'middle';
        emojiContext.fillText(emojiChar, 64, 64);

        emojiTexture.needsUpdate = true;
        emojiMaterial.opacity = 1;
    }

    return { person, gazeRay, updateEmoji };
}

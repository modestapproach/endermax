import { setGazeEnabled } from './interaction.js';

let currentStep = 1;
let currentSlide = 1; // Track visible slide independently
const totalSteps = 11; // Increased to 11 for audio test step
let hasLookedAtBlock = false;
let hasMoved = false;
let hasDragged = false;
let hasFaceDetected = false;
let hasCamEnabled = false; // Track if cam was enabled early
let initialPosition = null;
let isTutorialActive = true;
let mouseMovementTotal = 0;
let tempTargetObject = null;

// DOM Elements
let onboardingPanel, promptWindow, nextBtn, skipBtn, onboardingText;
let enableMicBtn, enableCamBtn, testVoiceBtn;
let audioTest = null;
let webcamVideo;

export function initTutorial() {
    onboardingPanel = document.getElementById('onboarding-panel');
    promptWindow = document.getElementById('prompt-window');
    nextBtn = document.getElementById('nextTutorialBtn');
    onboardingText = document.getElementById('onboarding-text');
    const closeInstructionBtn = document.getElementById('closeInstructionBtn');
    enableMicBtn = document.getElementById('enableMicBtn');
    enableCamBtn = document.getElementById('enableCamBtn');
    testVoiceBtn = document.getElementById('testVoiceBtn');
    webcamVideo = document.getElementById('webcam-video');
    const narrationModal = document.getElementById('narration-modal');
    const narrationOkBtn = document.getElementById('narration-ok-btn');
    const prevSlideBtn = document.getElementById('prevSlideBtn');
    const nextSlideBtn = document.getElementById('nextSlideBtn');

    // Initialize audio test panel
    import('./audioTest.js').then(module => {
        audioTest = new module.AudioTest();
        audioTest.init();
    });

    // Initial delay before showing tutorial
    setTimeout(() => {
        onboardingPanel.classList.remove('hidden-left');
        onboardingPanel.classList.add('slide-in-left');
        setGazeEnabled(false); // Disable gaze initially
        updateStepUI(currentStep, 2000); // Initialize UI state with delay
    }, 2000);

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            // Skip must always work: stop an in-progress mic test first, and
            // never let an error in the next step's setup swallow the click.
            try { audioTest?.cancel(); } catch (e) { console.warn(e); }
            try {
                if (currentStep < totalSteps) {
                    advanceStep();
                } else {
                    finishTutorial();
                }
            } catch (e) {
                console.error('Tutorial step failed; continuing', e);
            }
        });
    }

    if (closeInstructionBtn) {
        closeInstructionBtn.addEventListener('click', () => {
            // Just hide the instruction panel
            const instructionPanel = document.querySelector('.onboarding-instruction');
            if (instructionPanel) {
                instructionPanel.style.display = 'none';
                instructionPanel.classList.remove('visible');
            }
        });
    }

    // Slide Navigation Buttons
    if (prevSlideBtn) {
        prevSlideBtn.addEventListener('click', () => {
            if (currentSlide > 1) {
                currentSlide--;
                updateSlideVisibility();
            }
        });
    }

    if (nextSlideBtn) {
        nextSlideBtn.addEventListener('click', () => {
            if (currentSlide < 3) {
                currentSlide++;
                updateSlideVisibility();
            }
        });
    }

    // Initialize Enable Cam Button Listener (Always active)
    if (enableCamBtn) {
        enableCamBtn.onclick = () => {
            console.log('🖱️ Enable Cam clicked');
            navigator.mediaDevices.getUserMedia({ video: true })
                .then((stream) => {
                    console.log('✅ Cam enabled');
                    hasCamEnabled = true;
                    enableCamBtn.classList.add('hidden'); // Hide button after success

                    // Show emotion bar after camera is enabled
                    const emotionBar = document.getElementById('emotion-bar');
                    const bottomControls = document.getElementById('bottom-controls-container');

                    if (bottomControls) {
                        bottomControls.classList.remove('hidden');
                    }

                    if (emotionBar) {
                        emotionBar.style.display = 'flex';
                    }

                    // Start Face Detection immediately for tutorial
                    console.log('   Importing main.js for face detection...');
                    import('./main.js').then(module => {
                        console.log('   main.js imported', module);
                        if (module.startFaceDetection) {
                            module.startFaceDetection();
                        }
                    });

                    // Show and attach blurred webcam feed
                    if (webcamVideo) {
                        webcamVideo.classList.remove('hidden');
                        webcamVideo.srcObject = stream;
                    }

                    // If we are currently on the camera step, advance!
                    if (currentStep === 3) {
                        advanceStep();
                    }
                })
                .catch(err => {
                    console.error("Cam permission denied", err);
                    alert("Camera permission is required. Please enable it in your browser settings.");
                });
        };
    }
}

function advanceStep() {
    console.log(`➡️ advanceStep: ${currentStep} -> ${currentStep + 1}`);
    currentStep++;
    updateStepUI(currentStep);
}

function updateStepUI(step, delay = 0) {
    console.log(`🔄 updateStepUI: step=${step}, delay=${delay}`);
    // Reset all steps
    document.querySelectorAll('.checklist-item').forEach(item => {
        item.classList.remove('completed');
        item.classList.remove('active-step');
    });

    // Map step numbers to IDs (New Order)
    const stepIds = {
        1: 'step-mic',
        2: 'step-audio-test', // New Audio Test Step
        3: 'step-cam',
        4: 'step1', // Look around
        5: 'step2', // Move
        6: 'step3', // Drag
        7: 'step-voice',
        8: 'step-face',
        9: 'step-emoji',
        10: 'step4'  // Tasks
    };

    // Mark previous steps as completed
    for (let i = 1; i < step; i++) {
        const id = stepIds[i];
        if (id) {
            const item = document.getElementById(id);
            if (item) item.classList.add('completed');
        }
    }

    // Highlight current step
    const currentId = stepIds[step];
    if (currentId) {
        const item = document.getElementById(currentId);
        if (item) item.classList.add('active-step');
    }

    // Determine which slide to show based on step (auto-advance)
    // Only update currentSlide if the new step is on a different slide
    let targetSlide = 1;
    if (step <= 3) targetSlide = 1;      // Permissions (Mic, Audio Test, Cam)
    else if (step <= 6) targetSlide = 2; // Movement (Look, Move, Drag)
    else targetSlide = 3;                // Emotion

    // If step changed, sync slide
    if (targetSlide !== currentSlide) {
        currentSlide = targetSlide;
    }

    updateSlideVisibility();

    // Hide all custom buttons by default
    if (enableMicBtn) enableMicBtn.classList.add('hidden');
    // enableCamBtn handling is now separate to allow early click
    if (!hasCamEnabled && enableCamBtn) {
        // Only show if we are on slide 1 (handled by CSS/HTML structure usually, but let's be safe)
        // Actually, the button is inside the slide div, so visibility is handled by slide switching.
        // We just need to remove 'hidden' class if it was added by something else.
        enableCamBtn.classList.remove('hidden');
    } else if (hasCamEnabled && enableCamBtn) {
        enableCamBtn.classList.add('hidden');
    }

    if (testVoiceBtn) testVoiceBtn.classList.add('hidden');

    if (nextBtn) {
        nextBtn.style.display = 'block'; // Default to showing next button
        nextBtn.textContent = "Skip Step";
    }

    // Update instruction text
    const instructionPanel = document.querySelector('.onboarding-instruction');
    if (instructionPanel) {
        instructionPanel.style.display = 'block'; // Ensure visible when step changes

        if (delay > 0) {
            setTimeout(() => {
                instructionPanel.classList.add('visible');
            }, delay);
        } else {
            // Small timeout to ensure display:block applies before opacity transition
            setTimeout(() => {
                instructionPanel.classList.add('visible');
            }, 10);
        }
    }

    switch (step) {
        case 1: // Mic
            onboardingText.textContent = "First, please enable your microphone for voice features.";
            if (enableMicBtn) {
                enableMicBtn.classList.remove('hidden');
                enableMicBtn.style.animation = 'pulse-green 2s infinite'; // Add pulse
                enableMicBtn.onclick = () => {
                    console.log('🖱️ Enable Mic clicked');
                    navigator.mediaDevices.getUserMedia({ audio: true })
                        .then((stream) => {
                            console.log('✅ Mic enabled');
                            // Permission granted is all we needed — release the mic
                            // so it isn't held open for the rest of the session.
                            stream.getTracks().forEach(t => t.stop());
                            enableMicBtn.style.animation = ''; // Remove pulse
                            // Audio test is now inline, just advance (once, even if double-clicked)
                            if (currentStep === 1) advanceStep();
                        })
                        .catch(err => {
                            console.error("Mic permission denied", err);
                            alert("Microphone permission is required. Please enable it in your browser settings.");
                        });
                };
            }
            break;

        case 2: // Audio Test
            onboardingText.textContent = "Now, test your microphone by recording a short clip.";
            // Listen for completion event from audioTest.js
            window.addEventListener('audioTestComplete', () => {
                console.log('✅ Audio Test Complete event received');
                if (currentStep === 2) {
                    advanceStep();
                }
            }, { once: true });
            break;

        case 3: // Cam (Moved from 2)
            onboardingText.textContent = "Next, please enable your camera for emotion tracking.";
            // If already enabled, just advance
            if (hasCamEnabled) {
                console.log('✅ Cam already enabled, skipping step 3');
                // Use timeout to avoid instant skip confusion
                setTimeout(() => advanceStep(), 500);
            } else {
                if (enableCamBtn) {
                    enableCamBtn.style.animation = 'pulse-green 2s infinite'; // Add pulse
                }
            }
            break;

        case 4: // Look around (Mouse movement)
            onboardingText.textContent = "Try looking around by moving your mouse.";
            setGazeEnabled(true); // Enable gaze ray
            mouseMovementTotal = 0;
            // Add mouse move listener to track movement
            const trackMouse = (e) => {
                if (currentStep === 4) {
                    mouseMovementTotal += Math.abs(e.movementX) + Math.abs(e.movementY);
                }
            };
            document.addEventListener('mousemove', trackMouse);
            break;

        case 5: // Move
            onboardingText.textContent = "Great! Now try moving around using WASD or Arrow keys.";
            // Cleanup temp object if it exists (safety check)
            if (tempTargetObject) {
                window.dispatchEvent(new CustomEvent('tutorialRemoveObject', { detail: { object: tempTargetObject } }));
                tempTargetObject = null;
            }
            break;

        case 6: // Drag
            onboardingText.textContent = "You can also drag with your mouse to rotate your view.";
            break;

        case 7: // Test Voice Assistant
            onboardingText.textContent = "Click 'Test Voice' to hear your AI assistant.";
            if (testVoiceBtn) {
                testVoiceBtn.classList.remove('hidden');
                testVoiceBtn.onclick = () => {
                    if (window.voiceAgent) {
                        window.voiceAgent.speak("Hello! I am here to help you with the test.");
                    }
                    advanceStep();
                };
            }
            break;

        case 8: // Test facial expressions
            onboardingText.textContent = "Testing facial expression detection! Try making different faces (happy, neutral, mad, confused, thinking) and see which button lights up.";

            // Wait for face detection to work
            window.addEventListener('faceDetectionSuccess', () => {
                if (currentStep === 8 && !hasFaceDetected) {
                    hasFaceDetected = true;
                    advanceStep();
                }
            }, { once: false });
            break;

        case 9: // Emoji
            onboardingText.textContent = "Click one of the faces to manually record an emotion.";

            // Add listener to emotion buttons
            const emotionBtns = document.querySelectorAll('.emotion-btn');
            const onEmojiClick = () => {
                if (currentStep === 9) {
                    advanceStep();
                    // Remove listeners
                    emotionBtns.forEach(btn => btn.removeEventListener('click', onEmojiClick));
                }
            };
            emotionBtns.forEach(btn => btn.addEventListener('click', onEmojiClick));
            break;

        case 10: // Tasks
            onboardingText.textContent = "Finally, hover over the task panel in the bottom right.";

            // Ensure emotion bar and bottom controls are visible (in case previous steps were skipped)
            const emotionBar = document.getElementById('emotion-bar');
            const bottomControls = document.getElementById('bottom-controls-container');
            if (bottomControls) bottomControls.classList.remove('hidden');
            if (emotionBar) emotionBar.style.display = 'flex';

            // Show task panel
            promptWindow.classList.remove('hidden-right');
            promptWindow.classList.add('slide-in-right');

            // Remove animation class after it finishes
            const cleanupAnimation = () => {
                promptWindow.classList.remove('slide-in-right');
                promptWindow.removeEventListener('animationend', cleanupAnimation);
            };
            promptWindow.addEventListener('animationend', cleanupAnimation);

            if (nextBtn) nextBtn.textContent = "Next";

            // Step 6: Hover over tasks panel
            promptWindow.classList.add('pulse-green-border');

            // Add hover listener
            const onHover = () => {
                promptWindow.classList.remove('pulse-green-border');
                promptWindow.removeEventListener('mouseenter', onHover);
                advanceStep();
            };
            promptWindow.addEventListener('mouseenter', onHover);
            break;

        case 11: // Begin Test
            onboardingText.textContent = "Press the 'Begin Test' button to start. Recording will begin automatically.";

            // Show Begin Test button
            const beginTestBtn = document.getElementById('begin-test-btn');
            if (beginTestBtn) {
                beginTestBtn.classList.remove('hidden');
                beginTestBtn.addEventListener('click', async () => {
                    console.log("🖱️ 'Begin Test' button clicked");
                    // Show narration modal instead of starting immediately
                    const narrationModal = document.getElementById('narration-modal');
                    if (narrationModal) {
                        console.log("   Showing narration modal");

                        // Hide OK button initially (ensure it's hidden before showing modal)
                        const okBtn = document.getElementById('narration-ok-btn');
                        if (okBtn) okBtn.classList.add('hidden');

                        narrationModal.classList.remove('hidden');

                        // Speak the instruction
                        if (window.voiceAgent) {
                            await window.voiceAgent.speak("Please speak your thoughts out loud and narrate your actions as you proceed through the test.");
                        } else {
                            console.warn("   window.voiceAgent not found");
                        }

                        // Show OK button after speech
                        if (okBtn) okBtn.classList.remove('hidden');
                    } else {
                        console.error("❌ narration-modal not found in DOM");
                    }
                });

                // Setup Narration OK button
                const narrationOkBtn = document.getElementById('narration-ok-btn');
                if (narrationOkBtn) {
                    // Remove old listeners to be safe (though initTutorial runs once usually)
                    const newBtn = narrationOkBtn.cloneNode(true);
                    narrationOkBtn.parentNode.replaceChild(newBtn, narrationOkBtn);

                    newBtn.addEventListener('click', () => {
                        console.log("🖱️ 'OK' button clicked (Narration)");
                        // Hide modal
                        const narrationModal = document.getElementById('narration-modal');
                        if (narrationModal) narrationModal.classList.add('hidden');

                        // Show recording panel
                        const recordingPanel = document.getElementById('recording-panel');
                        if (recordingPanel) recordingPanel.classList.add('visible');

                        // Close audio test panel if open
                        const audioTestPanel = document.getElementById('audio-test-panel');
                        if (audioTestPanel) {
                            audioTestPanel.classList.add('hidden');
                            // Stop any playing audio
                            const audioPlayer = document.getElementById('testAudioPlayer');
                            if (audioPlayer) {
                                audioPlayer.pause();
                                audioPlayer.currentTime = 0;
                            }
                        }

                        // Start the test
                        console.log("   Importing main.js to call startTest...");
                        import('./main.js').then(module => {
                            console.log("   main.js imported. Calling startTest...", module);
                            if (module.startTest) {
                                module.startTest();
                            } else {
                                console.error("❌ module.startTest is undefined");
                            }
                        }).catch(err => {
                            console.error("❌ Failed to import main.js:", err);
                        });
                        finishTutorial();

                        // Speak the task description
                        if (window.voiceAgent && window.gameLogic) {
                            const currentObjective = window.gameLogic.getCurrentObjective();
                            console.log("🗣️ Triggering initial task voice prompt:", currentObjective);
                            if (currentObjective) {
                                // Small delay to allow the previous message to finish or modal to close
                                setTimeout(() => {
                                    console.log("🗣️ Calling speak for initial task...");
                                    window.voiceAgent.speak(`For this task, I would like you to ${currentObjective.description}`);
                                }, 500);
                            }
                        } else {
                            console.warn("⚠️ Missing voiceAgent or gameLogic in tutorial OK handler");
                        }
                    });
                }
            }
            break;
        default:
            break;
    }
}

function finishTutorial(skipped = false) {
    isTutorialActive = false;
    onboardingPanel.classList.remove('slide-in-left');
    onboardingPanel.classList.add('hidden-left');

    // Hide instruction panel
    const instructionPanel = document.querySelector('.onboarding-instruction');
    if (instructionPanel) {
        instructionPanel.style.display = 'none';
        instructionPanel.classList.remove('visible');
    }

    // Ensure prompt window is visible
    promptWindow.classList.remove('hidden-right');
    promptWindow.classList.add('slide-in-right');

    // Remove animation class after it finishes to allow CSS transform to take over
    // This restores the 3D perspective transform in first-person mode
    // Remove animation class after it finishes to allow CSS transform to take over
    // This restores the 3D perspective transform in first-person mode
    const cleanupAnimation = () => {
        promptWindow.classList.remove('slide-in-right');
        promptWindow.removeEventListener('animationend', cleanupAnimation);
    };
    promptWindow.addEventListener('animationend', cleanupAnimation);

    // If skipped, ensure Begin Test button is visible so user can start
    if (skipped) {
        onboardingText.textContent = "Press the 'Begin Test' button to start.";
        const beginTestBtn = document.getElementById('begin-test-btn');
        if (beginTestBtn) {
            beginTestBtn.classList.remove('hidden');
            // Ensure listener is attached (might be redundant if already attached in step 5 logic, but safe)
            // Actually, better to just use the same logic or ensure it's not double-bound.
            // Since we are in a module, we can't easily check listeners.
            // Let's just clone and replace to clear old listeners, or just add it.
            // A simple flag is better.

            beginTestBtn.onclick = () => {
                // Show narration modal
                const narrationModal = document.getElementById('narration-modal');
                if (narrationModal) {
                    narrationModal.classList.remove('hidden');
                }
                // Hide button after click
                beginTestBtn.classList.add('hidden');
            };
        }
    }
}

export function updateTutorial(person, heatmapData, isDragging) {
    if (!isTutorialActive || currentStep >= totalSteps) return;

    // Step 3 is now face detection (handled by event listener in updateStepUI)

    // Step 4: Look around (Mouse movement check)
    if (currentStep === 4) {
        if (mouseMovementTotal > 2000) { // Arbitrary threshold for "looking around"
            advanceStep();
        }
    }
    // Step 5: Move (Position check)
    else if (currentStep === 5) {
        if (!initialPosition) {
            initialPosition = person.position.clone();
        } else {
            const distance = person.position.distanceTo(initialPosition);
            if (distance > 1.0) {
                hasMoved = true;
                advanceStep();
            }
        }
    }
    // Step 6: Drag (Input check)
    else if (currentStep === 6) {
        if (isDragging) {
            hasDragged = true;
            advanceStep();
        }
    }
}

function updateSlideVisibility() {
    const slidePermissions = document.getElementById('slide-permissions');
    const slideMovement = document.getElementById('slide-movement');
    const slideEmotion = document.getElementById('slide-emotion');
    const dots = document.querySelectorAll('.page-dot');
    const prevSlideBtn = document.getElementById('prevSlideBtn');
    const nextSlideBtn = document.getElementById('nextSlideBtn');

    console.log(`   Showing slide ${currentSlide}`);
    if (slidePermissions) slidePermissions.classList.add('hidden');
    if (slideMovement) slideMovement.classList.add('hidden');
    if (slideEmotion) slideEmotion.classList.add('hidden');

    if (currentSlide === 1 && slidePermissions) slidePermissions.classList.remove('hidden');
    if (currentSlide === 2 && slideMovement) slideMovement.classList.remove('hidden');
    if (currentSlide === 3 && slideEmotion) slideEmotion.classList.remove('hidden');

    // Update dots
    dots.forEach((dot, index) => {
        if (index + 1 === currentSlide) dot.classList.add('active');
        else dot.classList.remove('active');
    });

    // Update button states
    if (prevSlideBtn) prevSlideBtn.disabled = currentSlide === 1;
    if (nextSlideBtn) nextSlideBtn.disabled = currentSlide === 3;

    // Update Skip Button Visibility
    const nextBtn = document.getElementById('nextTutorialBtn');
    if (nextBtn) {
        // Determine which slide the current step belongs to
        let activeSlideForCurrentStep = 1;
        if (currentStep <= 3) activeSlideForCurrentStep = 1;      // Permissions
        else if (currentStep <= 6) activeSlideForCurrentStep = 2; // Movement
        else activeSlideForCurrentStep = 3;                       // Emotion

        // Only show Skip button if we are viewing the slide that contains the current step
        // AND we are not at the end of the tutorial
        if (currentSlide === activeSlideForCurrentStep && currentStep < totalSteps) {
            nextBtn.style.opacity = '1';
            nextBtn.style.pointerEvents = 'auto';
        } else {
            nextBtn.style.opacity = '0';
            nextBtn.style.pointerEvents = 'none';
        }
    }
}

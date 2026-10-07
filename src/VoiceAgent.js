export class VoiceAgent {
    constructor() {
        this.element = document.getElementById('voice-agent');
        this.isSpeaking = false;

        // State for triggers
        this.timeSinceLastSpeech = 0;
        this.silenceThreshold = 5.0; // Increased to 5s as requested
        this.speechThreshold = 0.05; // Increased to 0.05 to avoid background noise

        this.lastEmotion = 'neutral';
        this.pendingEmotion = null; // The emotion waiting to be triggered
        this.pendingEmotionTimer = 0; // How long we've waited since detection
        this.emotionCooldown = 0;
        this.emotionCooldownTime = 10.0; // Don't ask about emotions too often

        this.reminderCooldown = 0;

        // ElevenLabs Config
        // ElevenLabs Config
        // this.apiKey = '...'; // Removed for security, handled by proxy
        this.voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Bella - Soft, helpful, and nice
        this.isPlaying = false;

        // Speech Recognition Removed (replaced with Frequency VAD)
        this.recognition = null;
        this.isListening = false;
    }

    // Deprecated methods kept empty to avoid breaking calls
    setupSpeechRecognition() { }
    startListening() { }
    stopListening() { }

    update(deltaTime, currentEmotion) {
        if (this.isSpeaking) return;

        // Update cooldowns
        if (this.emotionCooldown > 0) this.emotionCooldown -= deltaTime;
        if (this.reminderCooldown > 0) this.reminderCooldown -= deltaTime;

        // Silence Detection REMOVED as per user request
        // We no longer track timeSinceLastSpeech or trigger reminders based on silence.

        // 2. Expression Detection
        // Logic: If ANY non-neutral emotion is detected (edge trigger), wait 2s.
        // If user remains silent for those 2s, trigger prompt.

        // Check for NEW non-neutral emotion
        if (currentEmotion !== 'neutral' && currentEmotion !== this.lastEmotion) {
            // console.log(`😲 Detected new emotion: ${currentEmotion}. Waiting 2s for silence...`);
            this.pendingEmotion = currentEmotion;
            this.pendingEmotionTimer = 0;
        }

        // Process pending emotion
        if (this.pendingEmotion) {
            this.pendingEmotionTimer += deltaTime;

            // If user spoke, we would have cleared pendingEmotion in onresult (or via timeSinceLastSpeech check)
            // Double check timeSinceLastSpeech just in case
            if (this.timeSinceLastSpeech < 0.1) {
                this.pendingEmotion = null;
            }
            else if (this.pendingEmotionTimer > 2.0) {
                // 2 seconds passed without speech!
                if (this.emotionCooldown <= 0) {
                    this.speak(`I noticed you look ${this.pendingEmotion}. Can you tell me why?`);
                    this.emotionCooldown = this.emotionCooldownTime;
                }
                this.pendingEmotion = null; // Reset
            }
        }

        this.lastEmotion = currentEmotion;
    }

    show() {
        if (this.element) {
            this.element.classList.remove('hidden');
        }
    }

    hide() {
        if (this.element) {
            this.element.classList.add('hidden');
        }
    }

    async speak(text) {
        console.log(`🗣️ VoiceAgent.speak called with: "${text}"`);
        if (this.isPlaying) {
            console.log("⚠️ Voice Agent already speaking, skipping:", text);
            return Promise.resolve();
        }

        // console.log(`🗣️ Voice Agent speaking: "${text}"`);
        this.isSpeaking = true;
        this.isPlaying = true;
        this.show();

        return new Promise(async (resolve) => {
            try {
                // console.log(`🎤 Requesting TTS from ElevenLabs for: "${text}"`);
                // Use proxy endpoint
                const response = await fetch('/api/tts', {
                    method: 'POST',
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json'
                        // xi-api-key is injected by the proxy/server
                    },
                    body: JSON.stringify({
                        text: text,
                        model_id: "eleven_turbo_v2_5", // Newer, more natural model
                        voice_settings: {
                            stability: 0.35, // Lower stability = more expressive/upward inflections
                            similarity_boost: 0.8,
                            style: 0.5, // Add style parameter for v2 models
                            use_speaker_boost: true
                        }
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`❌ ElevenLabs API Error: ${response.status}`, errorText);
                    throw new Error(`ElevenLabs API Error: ${response.status} ${errorText}`);
                }

                // console.log("✅ ElevenLabs response received. Processing audio blob...");
                const blob = await response.blob();
                const audioUrl = URL.createObjectURL(blob);
                const audio = new Audio(audioUrl);

                audio.onended = () => {
                    // console.log("✅ Voice Agent finished speaking");
                    this.isSpeaking = false;
                    this.isPlaying = false;
                    this.hide();
                    URL.revokeObjectURL(audioUrl); // Cleanup
                    resolve();
                };

                audio.onerror = (e) => {
                    console.error("❌ Audio playback error:", e);
                    this.isSpeaking = false;
                    this.isPlaying = false;
                    this.hide();
                    resolve(); // Resolve anyway to not block
                };

                await audio.play();
                // console.log("▶️ Audio playback started");

            } catch (err) {
                console.error("❌ Voice Agent Error:", err);
                this.isSpeaking = false;
                this.isPlaying = false;
                this.hide();
                resolve(); // Resolve anyway
            }
        });
    }
}

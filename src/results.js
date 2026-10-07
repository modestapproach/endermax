import { db } from './db.js';
import { initViewer, disposeViewer } from './viewer.js';

let audioPlayer = null;
let audioBlob = null;
let sessionStartTime = 0;
let cachedAiSummary = null;
let currentSessionId = null;
let aiSummaryStatus = 'waiting'; // 'waiting', 'generating', 'done', 'error'

async function initResults() {
    const sessionInfoEl = document.getElementById('session-info');
    const timelineContainer = document.getElementById('timeline-container');

    // Show debug log from previous page
    const debugLog = localStorage.getItem('debugLog');
    if (debugLog) {
        console.log("🔍 Debug log from previous page:", debugLog);
    }

    try {
        // Get the most recent session
        const lastSession = await db.sessions.orderBy('id').last();

        if (!lastSession) {
            sessionInfoEl.textContent = "No session data found.";
            // Friendly empty state instead of a blank page
            const timeline = document.getElementById('timeline-container') || document.body;
            const empty = document.createElement('div');
            empty.style.cssText = 'width:100%;min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:4rem 2rem;text-align:center;color:#a1a1aa;font-family:Inter,sans-serif;';
            empty.innerHTML = `
                <div style="font-size:3rem;">🛒</div>
                <h2 style="color:#fff;margin:0;">No sessions recorded yet</h2>
                <p style="max-width:420px;margin:0;line-height:1.6;">Run a shopping simulation first — the session timeline,
                emotion track, transcript, and 3D replay will appear here when the test ends.</p>
                <a href="/" style="margin-top:0.5rem;background:#4f46e5;color:#fff;padding:0.7rem 1.6rem;border-radius:10px;text-decoration:none;font-weight:600;">Start a session</a>`;
            timeline.appendChild(empty);
            return;
        }

        sessionStartTime = lastSession.startTime;

        // Calculate duration
        const duration = lastSession.duration
            ? (lastSession.duration / 1000).toFixed(1) + 's'
            : 'Incomplete';

        const date = new Date(lastSession.startTime).toLocaleString();
        sessionInfoEl.textContent = `Session ID: ${lastSession.id} | Date: ${date} | Duration: ${duration}`;

        // Get snapshots for this session
        const snapshots = await db.snapshots
            .where('sessionId')
            .equals(lastSession.id)
            .sortBy('timestamp');

        // Get audio recording
        const audioRecording = await db.audioRecordings
            .where('sessionId')
            .equals(lastSession.id)
            .first();

        if (audioRecording) {
            audioBlob = audioRecording.audioBlob;
            console.log("🎵 Audio recording found:", audioBlob.size, "bytes");
            console.log("🎵 Audio recording found:", audioBlob.size, "bytes");
            createAudioPlayer(audioBlob, lastSession.duration || 0, snapshots, lastSession.startTime);
        } else {
            console.warn("⚠️ No audio recording found for this session!");
        }

        // Add 3D Snapshot Button
        const snapshotBtn = document.createElement('button');
        snapshotBtn.className = 'btn-primary';
        snapshotBtn.style.cssText = 'margin: 1rem 2rem; display: block; width: calc(100% - 4rem);';
        snapshotBtn.innerHTML = '🌐 View 3D Session Snapshot';

        // Modal Logic
        const modal = document.getElementById('viewer-modal');
        const container = document.getElementById('viewer-container');
        const closeBtn = document.getElementById('close-viewer');
        const modalSessionId = document.getElementById('modal-session-id');
        const modalCollectedCount = document.getElementById('modal-collected-count');

        // Sync selection if exists
        if (window.lastSelectedTimestamp) {
            const { selectSnapshot } = await import('./viewer.js');
            // Small delay to ensure nodes are ready
            setTimeout(() => {
                selectSnapshot(window.lastSelectedTimestamp);
            }, 100);
        }

        // Register callback for 3D clicks
        const { setOnSnapshotSelected } = await import('./viewer.js');
        setOnSnapshotSelected((timestamp) => {
            syncViews(timestamp, '3d');
        });
        snapshotBtn.onclick = async () => {
            modal.classList.remove('hidden');
            modalSessionId.textContent = lastSession.id;
            modalCollectedCount.textContent = snapshots.length;

            await initViewer(container, lastSession.id, snapshots);
        };

        closeBtn.onclick = async () => {
            modal.classList.add('hidden');

            // Check if a snapshot was clicked in the viewer
            const { getLastClickedSnapshotTimestamp } = await import('./viewer.js');
            const lastTimestamp = getLastClickedSnapshotTimestamp();

            disposeViewer();

            if (lastTimestamp) {
                console.log("Syncing to snapshot from 3D view:", lastTimestamp);
                highlightSnapshot(lastTimestamp);
            }
        };

        // Insert after audio player or before timeline
        const main = document.querySelector('main');
        if (main) {
            main.parentElement.insertBefore(snapshotBtn, main);
        } else {
            timelineContainer.parentElement.insertBefore(snapshotBtn, timelineContainer);
        }

        // Get transcriptions
        const transcriptions = await db.transcriptions
            .where('sessionId')
            .equals(lastSession.id)
            .sortBy('startTime');

        console.log("📊 Results Page Debug:");
        console.log("   Session ID:", lastSession.id);
        console.log("   Snapshots found:", snapshots.length);
        console.log("   Transcriptions found:", transcriptions.length);
        if (transcriptions.length > 0) {
            console.log("   Transcription details:", transcriptions);
        } else {
            console.warn("   ⚠️ No transcriptions found for this session!");
        }

        if (snapshots.length === 0) {
            timelineContainer.innerHTML = '<p style="padding: 1rem;">No data points recorded for this session.</p>';
            return;
        }

        if (transcriptions.length === 0) {
            const debugLog = localStorage.getItem('debugLog');
            if (debugLog) {
                const debugBox = document.createElement('div');
                debugBox.style.cssText = 'margin: 1rem; padding: 1rem; background: #333; color: #fca5a5; border-radius: 8px; font-family: monospace; white-space: pre-wrap; max-height: 200px; overflow-y: auto;';
                debugBox.textContent = "⚠️ No transcripts found. Debug Log:\n" + debugLog;
                timelineContainer.parentElement.insertBefore(debugBox, timelineContainer);
            }
        }

        // Render snapshots
        let currentSnapshots = snapshots;

        // Reuse a previously generated summary — each regeneration is a paid
        // OpenAI call, and the transcript doesn't change after the session.
        currentSessionId = lastSession.id;
        if (lastSession.aiSummary) {
            cachedAiSummary = lastSession.aiSummary;
            aiSummaryStatus = 'done';
        } else if (aiSummaryStatus === 'waiting' && transcriptions.length > 0) {
            // Auto-generate AI summary after 4 seconds (only once)
            setTimeout(() => {
                if (aiSummaryStatus === 'waiting') {
                    generateAiSummary(transcriptions);
                }
            }, 4000);
        }

        const render = (isFiltered = false) => {
            renderTimeline(currentSnapshots, transcriptions, lastSession.startTime, timelineContainer, isFiltered);
        };

        // Initial render
        render();

        // Populate Task Filter
        const taskFilter = document.getElementById('task-filter');
        const uniqueTasks = [...new Set(snapshots.map(s => s.task).filter(t => t))];
        uniqueTasks.forEach(task => {
            const option = document.createElement('option');
            option.value = task;
            option.textContent = task;
            taskFilter.appendChild(option);
        });

        // Define Trackable Items
        const TRACKABLE_ITEMS = [
            'Floor', 'Sky', 'Shelf',
            'Meat Sign', 'Vegetable Sign', 'Snacks Sign', 'Sauce Sign', 'Canned Sign', 'Frozen Sign',
            'Meat Shelf', 'Vegetable Shelf', 'Snacks Shelf', 'Sauce Shelf', 'Canned Shelf', 'Frozen Shelf'
        ];

        // Calculate Seen Items and Emotions for the entire session
        const sessionSeenItems = new Set();
        const sessionEmotions = new Set();

        snapshots.forEach(snap => {
            // Emotions
            if (snap.emotionManual) sessionEmotions.add(snap.emotionManual);
            if (snap.emotionDetected) sessionEmotions.add(snap.emotionDetected);

            // Items
            if (snap.gazeTarget) {
                const target = snap.gazeTarget.toLowerCase();
                if (target.includes('floor')) sessionSeenItems.add('Floor');
                else if (target.includes('sky')) sessionSeenItems.add('Sky');
                else if (target === 'shelf') sessionSeenItems.add('Shelf'); // Exact match for generic shelf

                // Signs
                else if (target.includes('meat sign')) sessionSeenItems.add('Meat Sign');
                else if ((target.includes('veggie') || target.includes('vegetable')) && target.includes('sign')) sessionSeenItems.add('Vegetable Sign');
                else if (target.includes('snacks sign')) sessionSeenItems.add('Snacks Sign');
                else if (target.includes('sauce sign')) sessionSeenItems.add('Sauce Sign');
                else if (target.includes('canned sign')) sessionSeenItems.add('Canned Sign');
                else if (target.includes('frozen sign')) sessionSeenItems.add('Frozen Sign');

                // Shelves
                else if (target.includes('meat shelf')) sessionSeenItems.add('Meat Shelf');
                else if ((target.includes('veggie') || target.includes('vegetable')) && target.includes('shelf')) sessionSeenItems.add('Vegetable Shelf');
                else if (target.includes('snacks shelf')) sessionSeenItems.add('Snacks Shelf');
                else if (target.includes('sauce shelf')) sessionSeenItems.add('Sauce Shelf');
                else if (target.includes('canned shelf')) sessionSeenItems.add('Canned Shelf');
                else if (target.includes('frozen shelf')) sessionSeenItems.add('Frozen Shelf');
            }
        });

        // Populate Item Filter
        const itemFilter = document.getElementById('item-filter');
        TRACKABLE_ITEMS.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            if (!sessionSeenItems.has(item)) {
                option.disabled = true;
                option.style.color = 'rgba(255, 255, 255, 0.3)'; // Visual greying
            }
            itemFilter.appendChild(option);
        });

        // Populate Emotion Filter (Clear existing hardcoded options first)
        const emotionFilter = document.getElementById('emotion-filter');
        // Keep the first "All Emotions" option
        while (emotionFilter.options.length > 1) {
            emotionFilter.remove(1);
        }

        const EMOTIONS = ['happy', 'neutral', 'mad', 'confused', 'thinking'];
        EMOTIONS.forEach(emotion => {
            const option = document.createElement('option');
            option.value = emotion;
            // Capitalize first letter
            option.textContent = emotion.charAt(0).toUpperCase() + emotion.slice(1);

            if (!sessionEmotions.has(emotion)) {
                option.disabled = true;
                option.style.color = 'rgba(255, 255, 255, 0.3)'; // Visual greying
            }
            emotionFilter.appendChild(option);
        });

        // Search and Filter Logic
        const searchInput = document.getElementById('search-input');

        const filterData = () => {
            const query = searchInput.value.toLowerCase();
            const selectedEmotion = emotionFilter.value;
            const selectedTask = taskFilter.value;
            const selectedItem = itemFilter.value;

            const isFiltered = query !== '' || selectedEmotion !== '' || selectedTask !== '' || selectedItem !== '';

            currentSnapshots = snapshots.filter(snap => {
                // 1. Emotion Filter
                if (selectedEmotion) {
                    const hasManual = snap.emotionManual === selectedEmotion;
                    const hasDetected = snap.emotionDetected === selectedEmotion;
                    if (!hasManual && !hasDetected) return false;
                }

                // 2. Task Filter
                if (selectedTask && snap.task !== selectedTask) {
                    return false;
                }

                // 3. Item Filter
                if (selectedItem) {
                    const target = (snap.gazeTarget || '').toLowerCase();
                    // Simple inclusion check. 
                    // Note: 'Meat Sign' in filter vs 'meat' in gazeTarget.
                    // We need to map filter item to gaze keyword or check loosely.
                    // Let's use the same logic as the summary box:
                    let match = false;
                    const lowerItem = selectedItem.toLowerCase();

                    if (lowerItem === 'floor' && target.includes('floor')) match = true;
                    else if (lowerItem === 'sky' && target.includes('sky')) match = true;
                    else if (lowerItem === 'shelf' && target.includes('shelf')) match = true;
                    else if (lowerItem.includes('meat') && target.includes('meat')) match = true;
                    else if (lowerItem.includes('vegetable') && (target.includes('veggie') || target.includes('vegetable'))) match = true;
                    else if (lowerItem.includes('snacks') && target.includes('snacks')) match = true;
                    else if (lowerItem.includes('sauce') && target.includes('sauce')) match = true;
                    else if (lowerItem.includes('canned') && target.includes('canned')) match = true;
                    else if (lowerItem.includes('frozen') && target.includes('frozen')) match = true;

                    // Specific check for Sign vs Shelf if needed, but loose matching above covers both if user selects "Meat Sign" it might match "Meat Shelf" with current logic?
                    // Actually, the logic above: `lowerItem` is the selected filter value (e.g. "Meat Shelf").
                    // `target` is the gaze target (e.g. "meat shelf").
                    // If selected is "Meat Shelf", lowerItem is "meat shelf". target "meat shelf" matches.
                    // If selected is "Meat Sign", lowerItem is "meat sign". target "meat shelf" does NOT match "meat sign".
                    // So we can just use simple inclusion or equality.

                    if (target.includes(lowerItem)) match = true;
                    // Handle "Vegetable" vs "Veggie" mapping
                    if (lowerItem.includes('vegetable') && target.includes('veggie')) match = true;

                    if (!match) return false;
                }

                // 4. Text Search (excluding task)
                if (query) {
                    // Find transcription text
                    const transcription = transcriptions.find(t =>
                        snap.timestamp >= t.startTime && snap.timestamp <= t.endTime
                    );
                    const transText = transcription ? transcription.text.toLowerCase() : '';

                    const manualEmo = (snap.emotionManual || '').toLowerCase();
                    const detectedEmo = (snap.emotionDetected || '').toLowerCase();
                    const gaze = (snap.gazeTarget || '').toLowerCase();
                    // const task = (snap.task || '').toLowerCase(); // Excluded from text search

                    const matches =
                        transText.includes(query) ||
                        manualEmo.includes(query) ||
                        detectedEmo.includes(query) ||
                        gaze.includes(query);

                    if (!matches) return false;
                }

                return true;
            });

            render(isFiltered);
        };

        // Debounce typing — filterData rebuilds the whole timeline DOM, which
        // is too heavy to run on every keystroke.
        let searchDebounce = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(filterData, 200);
        });
        emotionFilter.addEventListener('change', filterData);
        taskFilter.addEventListener('change', filterData);
        itemFilter.addEventListener('change', filterData);

    } catch (error) {
        console.error("Error loading results:", error);
        sessionInfoEl.textContent = "Error loading data.";
    }
}



async function generateAiSummary(transcriptions) {
    aiSummaryStatus = 'generating';
    updateAiSummaryDOM();

    const fullText = transcriptions.map(t => t.text).join(' ');

    try {
        // Use the proxy endpoint (works for both local Vite proxy and Cloudflare Function)
        const response = await fetch('/api/summary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
                // Authorization header is injected by the proxy/server
            },
            body: JSON.stringify({
                model: "gpt-4o", // Or gpt-3.5-turbo
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant summarizing a user testing session. The user is navigating a 3D virtual store environment. Summarize their actions, thoughts, and any feedback they provided based on the transcript. Be extensive and detailed."
                    },
                    {
                        role: "user",
                        content: `Here is the transcript of the session:\n\n${fullText}`
                    }
                ],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            let errorMsg = `OpenAI API Error: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData.error) {
                    errorMsg += ` - ${typeof errorData.error === 'string' ? errorData.error : JSON.stringify(errorData.error)}`;
                }
            } catch (e) {
                // Could not parse JSON error, try text
                const text = await response.text();
                if (text) errorMsg += ` - ${text}`;
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        cachedAiSummary = data.choices[0].message.content;
        aiSummaryStatus = 'done';
        updateAiSummaryDOM();

        // Persist so revisiting the results page doesn't re-bill OpenAI
        if (currentSessionId != null) {
            try {
                await db.sessions.update(currentSessionId, { aiSummary: cachedAiSummary });
            } catch (e) {
                console.warn('Could not persist AI summary:', e);
            }
        }

    } catch (error) {
        console.error("Error generating AI summary:", error);
        cachedAiSummary = "Failed to generate summary. Please check console for details.";
        aiSummaryStatus = 'error';
        updateAiSummaryDOM();
    }
}

function updateAiSummaryDOM() {
    const contentDiv = document.querySelector('.ai-content');
    if (!contentDiv) return;

    if (aiSummaryStatus === 'waiting') {
        contentDiv.innerHTML = `
            <p style="color: #a1a1aa;">Auto-generating summary in 4s... <span class="loading-dots">...</span></p>
            <button id="btn-generate-summary" class="btn-primary" style="margin-top: 0.5rem; font-size: 0.8rem;">✨ Generate Now</button>
        `;
    } else if (aiSummaryStatus === 'generating') {
        contentDiv.innerHTML = `Generating summary... <span class="loading-dots">...</span>`;
    } else if (aiSummaryStatus === 'done') {
        contentDiv.textContent = cachedAiSummary;
    } else if (aiSummaryStatus === 'error') {
        contentDiv.innerHTML = `
            <p style="color: #fca5a5; margin-bottom: 0.5rem;">${cachedAiSummary}</p>
            <button id="btn-generate-summary" class="btn-primary" style="font-size: 0.8rem;">↻ Retry</button>
        `;
    }
}

function createAudioPlayer(blob, durationMs, snapshots = [], startTime = 0) {
    const audioContainer = document.createElement('div');
    audioContainer.style.cssText = 'margin: 1rem 2rem; padding: 1rem; background: #1e293b; border-radius: 12px; border: 1px solid #334155;';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;';

    const title = document.createElement('h3');
    title.textContent = '🎵 Session Recording';
    title.style.cssText = 'margin: 0; color: #f8fafc; font-size: 1.1rem;';

    const timeDisplay = document.createElement('div');
    timeDisplay.style.cssText = 'font-family: monospace; color: #94a3b8; font-size: 0.9rem;';
    timeDisplay.textContent = '0:00 / 0:00';

    header.appendChild(title);
    header.appendChild(timeDisplay);

    // Audio Element (Hidden controls)
    audioPlayer = document.createElement('audio');
    audioPlayer.style.display = 'none';
    audioPlayer.src = URL.createObjectURL(blob);

    // Custom Controls
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; align-items: center; gap: 1rem; position: relative;';

    const playBtn = document.createElement('button');
    playBtn.innerHTML = '▶️';
    playBtn.style.cssText = 'background: #3b82f6; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; color: white; transition: background 0.2s; z-index: 2;';

    playBtn.onmouseover = () => playBtn.style.background = '#2563eb';
    playBtn.onmouseout = () => playBtn.style.background = '#3b82f6';

    // Progress Bar Container (for relative positioning of markers)
    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = 'flex-grow: 1; position: relative; height: 20px; display: flex; align-items: center;';

    const progressBar = document.createElement('input');
    progressBar.type = 'range';
    progressBar.min = 0;
    progressBar.max = 100;
    progressBar.value = 0;
    progressBar.style.cssText = 'width: 100%; height: 6px; border-radius: 3px; background: #475569; cursor: pointer; accent-color: #3b82f6; position: relative; z-index: 1;';

    // Render Markers
    if (snapshots && snapshots.length > 0 && durationMs > 0) {
        snapshots.forEach(snap => {
            const offset = snap.timestamp - startTime;
            if (offset < 0 || offset > durationMs) return;

            const percent = (offset / durationMs) * 100;
            const marker = document.createElement('div');
            marker.id = `marker-${snap.timestamp}`;
            marker.className = 'timeline-marker'; // Add class for easy selection

            // Determine marker type
            const emotion = snap.emotionManual || snap.emotionDetected || 'neutral';
            let content = '';
            let style = '';

            if (emotion === 'neutral') {
                // White dot, positioned inline with emojis (above line)
                style = `
                    position: absolute;
                    left: ${percent}%;
                    top: -16px; /* Align with emojis */
                    transform: translateX(-50%);
                    width: 6px;
                    height: 6px;
                    background: #fff; /* White */
                    border: 1px solid rgba(0,0,0,0.5); /* Dark border for contrast */
                    border-radius: 50%;
                    pointer-events: auto;
                    cursor: pointer;
                    z-index: 10;
                `;
            } else {
                // Emoji
                let emoji = '😐';
                if (emotion.includes('happy')) emoji = '🙂';
                else if (emotion.includes('mad')) emoji = '😠';
                else if (emotion.includes('confused')) emoji = '🤔';
                else if (emotion.includes('thinking')) emoji = '🤔';

                content = emoji;
                style = `
                    position: absolute;
                    left: ${percent}%;
                    top: -20px;
                    transform: translateX(-50%);
                    font-size: 14px;
                    pointer-events: auto;
                    cursor: pointer;
                    z-index: 10;
                `;
            }

            marker.style.cssText = style;
            marker.textContent = content;
            marker.title = `Jump to snapshot at ${((offset) / 1000).toFixed(1)}s`;

            // Click Handler
            marker.onclick = (e) => {
                e.stopPropagation();

                // 1. Seek audio
                audioPlayer.currentTime = offset / 1000;

                // 2. Highlight Sync
                highlightSnapshot(snap.timestamp);
            };

            progressContainer.appendChild(marker);
        });
    }

    progressContainer.appendChild(progressBar);
    controls.appendChild(playBtn);
    controls.appendChild(progressContainer);

    audioContainer.appendChild(header);
    audioContainer.appendChild(audioPlayer);
    audioContainer.appendChild(controls);

    // Logic
    const totalSeconds = durationMs / 1000;

    const formatTime = (secs) => {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    timeDisplay.textContent = `0:00 / ${formatTime(totalSeconds)}`;

    // Play/Pause Toggle
    playBtn.onclick = () => {
        if (audioPlayer.paused) {
            audioPlayer.play();
        } else {
            audioPlayer.pause();
        }
    };

    // Sync Button State
    audioPlayer.onplay = () => {
        playBtn.innerHTML = '⏸️';
    };
    audioPlayer.onpause = () => {
        playBtn.innerHTML = '▶️';
    };

    // Update Progress
    audioPlayer.ontimeupdate = () => {
        const current = audioPlayer.currentTime;
        // Avoid division by zero
        const percent = totalSeconds > 0 ? (current / totalSeconds) * 100 : 0;
        progressBar.value = percent;
        timeDisplay.textContent = `${formatTime(current)} / ${formatTime(totalSeconds)}`;

        // Auto-reset when done (handled by onended usually, but this works too)
        if (current >= totalSeconds && totalSeconds > 0) {
            // audioPlayer.pause(); // Optional, but onended is better
        }
    };

    audioPlayer.onended = () => {
        playBtn.innerHTML = '▶️';
        progressBar.value = 0;
        audioPlayer.currentTime = 0;
    };

    // Seek
    progressBar.oninput = () => {
        const seekTime = (progressBar.value / 100) * totalSeconds;
        audioPlayer.currentTime = seekTime;
    };

    // Insert before the main element
    const main = document.querySelector('main');
    if (main) {
        main.parentElement.insertBefore(audioContainer, main);
    } else {
        const timelineContainer = document.getElementById('timeline-container');
        timelineContainer.parentElement.insertBefore(audioContainer, timelineContainer);
    }
}

function playAudioAtTimestamp(timestamp) {
    if (!audioPlayer || !audioBlob) {
        console.warn("⚠️ No audio player available");
        return;
    }

    // Calculate offset from session start in seconds
    const offsetSeconds = (timestamp - sessionStartTime) / 1000;
    console.log(`▶️ Playing audio from ${offsetSeconds.toFixed(1)}s`);

    audioPlayer.currentTime = offsetSeconds;
    audioPlayer.play().catch(err => {
        console.error("❌ Failed to play audio:", err);
    });

    // Sync other views
    syncViews(timestamp, 'audio');
}

// Central Sync Function
async function syncViews(timestamp, source) {
    console.log(`🔄 Syncing views from ${source} at ${timestamp}`);
    window.lastSelectedTimestamp = timestamp;

    // 1. Update Card (if not source)
    if (source !== 'card') {
        highlightSnapshot(timestamp, false); // false = don't re-trigger sync
    }

    // 2. Update Audio (if not source)
    if (source !== 'audio' && audioPlayer && audioBlob) {
        const offsetSeconds = (timestamp - sessionStartTime) / 1000;
        if (Math.abs(audioPlayer.currentTime - offsetSeconds) > 0.5) {
            audioPlayer.currentTime = offsetSeconds;
        }
    }

    // 3. Update 3D View (if not source)
    if (source !== '3d') {
        // Dynamically import to avoid circular dependency issues if any
        const { selectSnapshot } = await import('./viewer.js');
        selectSnapshot(timestamp);
    }
}

function highlightSnapshot(timestamp, triggerSync = true) {
    // Track selection
    window.lastSelectedTimestamp = timestamp;

    if (triggerSync) {
        syncViews(timestamp, 'card');
    }

    // 1. Highlight Timeline Marker
    document.querySelectorAll('.timeline-marker.highlight').forEach(el => el.classList.remove('highlight'));
    const markerId = `marker-${timestamp}`;
    const marker = document.getElementById(markerId);
    if (marker) {
        marker.classList.add('highlight');
        // setTimeout(() => marker.classList.remove('highlight'), 2000); // Removed for persistence
    }

    // 2. Scroll to and Highlight Card
    const cardId = `snapshot-${timestamp}`;
    const card = document.getElementById(cardId);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.querySelectorAll('.timeline-item.highlight').forEach(el => el.classList.remove('highlight'));
        card.classList.add('highlight');
        // setTimeout(() => card.classList.remove('highlight'), 2000); // Removed for persistence
    }
}

function openLightbox(src, label) {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxLabel = document.getElementById('lightbox-label');

    if (lightbox && lightboxImg) {
        lightboxImg.src = src;
        if (lightboxLabel) lightboxLabel.textContent = label;
        lightbox.classList.add('active');

        // Close on click
        lightbox.onclick = () => {
            lightbox.classList.remove('active');
        };
    }
}

function renderTimeline(snapshots, transcriptions, startTime, container, isFiltered = false) {
    container.innerHTML = '';

    if (!isFiltered) {
        // --- Summary Box Logic ---
        const TRACKABLE_ITEMS = [
            'Floor', 'Sky', 'Shelf',
            'Meat Sign', 'Vegetable Sign', 'Snacks Sign', 'Sauce Sign', 'Canned Sign', 'Frozen Sign',
            'Meat Shelf', 'Vegetable Shelf', 'Snacks Shelf', 'Sauce Shelf', 'Canned Shelf', 'Frozen Shelf'
        ];
        const seenItems = new Set();

        snapshots.forEach(snap => {
            if (snap.gazeTarget) {
                // Normalize check
                const target = snap.gazeTarget.toLowerCase();

                // Check against our list
                // Note: The gazeTarget usually comes from the label in scene.js or block data.
                // The labels in image-settings.txt are: snacks, veggie, meat, sauce, canned, frozen.
                // We need to match these.

                if (target.includes('floor')) seenItems.add('Floor');
                else if (target.includes('sky')) seenItems.add('Sky');
                else if (target === 'shelf') seenItems.add('Shelf'); // Exact match for generic shelf

                // Signs
                else if (target.includes('meat sign')) seenItems.add('Meat Sign');
                else if ((target.includes('veggie') || target.includes('vegetable')) && target.includes('sign')) seenItems.add('Vegetable Sign');
                else if (target.includes('snacks sign')) seenItems.add('Snacks Sign');
                else if (target.includes('sauce sign')) seenItems.add('Sauce Sign');
                else if (target.includes('canned sign')) seenItems.add('Canned Sign');
                else if (target.includes('frozen sign')) seenItems.add('Frozen Sign');

                // Shelves
                else if (target.includes('meat shelf')) seenItems.add('Meat Shelf');
                else if ((target.includes('veggie') || target.includes('vegetable')) && target.includes('shelf')) seenItems.add('Vegetable Shelf');
                else if (target.includes('snacks shelf')) seenItems.add('Snacks Shelf');
                else if (target.includes('sauce shelf')) seenItems.add('Sauce Shelf');
                else if (target.includes('canned shelf')) seenItems.add('Canned Shelf');
                else if (target.includes('frozen shelf')) seenItems.add('Frozen Shelf');
            }
        });

        const summaryBox = document.createElement('div');
        summaryBox.className = 'summary-box';

        // Generate Table Rows
        const tableRowsHtml = TRACKABLE_ITEMS.map(item => {
            const isSeen = seenItems.has(item);
            const lookedAtIcon = isSeen ? '✅' : '';
            const missedIcon = !isSeen ? '❌' : '';
            const statusClass = isSeen ? 'seen' : 'missed';

            return `
                <tr class="summary-row ${statusClass}">
                    <td class="summary-cell-item">${item}</td>
                    <td class="summary-cell-status">${lookedAtIcon}</td>
                    <td class="summary-cell-status">${missedIcon}</td>
                </tr>
            `;
        }).join('');

        summaryBox.innerHTML = `
            <div class="summary-header">Session Summary</div>
            <div class="summary-table-wrapper">
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th style="text-align: left;">Item</th>
                            <th style="text-align: center;">Looked At</th>
                            <th style="text-align: center;">Missed</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHtml}
                    </tbody>
                </table>
            </div>
        `;

        // --- End Summary Box Logic ---

        // --- AI Summary Logic ---
        const aiSummaryBox = document.createElement('div');
        aiSummaryBox.className = 'ai-summary-box';
        aiSummaryBox.innerHTML = `
            <div class="summary-header">AI Session Summary</div>
            <div class="ai-content"></div>
        `;

        // Insert AI Summary first, then Session Summary
        container.appendChild(aiSummaryBox);
        container.appendChild(summaryBox);

        // Populate with current state
        if (aiSummaryStatus === 'waiting') {
            aiSummaryBox.querySelector('.ai-content').innerHTML = `
                <p style="color: #a1a1aa;">Auto-generating summary in 4s... <span class="loading-dots">...</span></p>
                <button id="btn-generate-summary" class="btn-primary" style="margin-top: 0.5rem; font-size: 0.8rem;">✨ Generate Now</button>
            `;
        } else if (aiSummaryStatus === 'generating') {
            aiSummaryBox.querySelector('.ai-content').innerHTML = `Generating summary... <span class="loading-dots">...</span>`;
        } else if (aiSummaryStatus === 'done') {
            aiSummaryBox.querySelector('.ai-content').textContent = cachedAiSummary;
        } else if (aiSummaryStatus === 'error') {
            aiSummaryBox.querySelector('.ai-content').innerHTML = `
                <p style="color: #fca5a5; margin-bottom: 0.5rem;">${cachedAiSummary}</p>
                <button id="btn-generate-summary" class="btn-primary" style="font-size: 0.8rem;">↻ Retry</button>
            `;
        }

        // Event Delegation for the button
        aiSummaryBox.addEventListener('click', (e) => {
            if (e.target.id === 'btn-generate-summary') {
                if (transcriptions.length > 0) {
                    generateAiSummary(transcriptions);
                } else {
                    aiSummaryBox.querySelector('.ai-content').innerHTML = "No speech detected to summarize.";
                }
            }
        });
        // --- End AI Summary Logic ---
    }

    snapshots.forEach((snap, index) => {
        const relativeTime = ((snap.timestamp - startTime) / 1000).toFixed(1);

        // Find relevant transcription
        const transcription = transcriptions.find(t =>
            snap.timestamp >= t.startTime && snap.timestamp <= t.endTime
        );

        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.id = `snapshot-${snap.timestamp}`;
        // Add click listener for sync
        item.onclick = () => {
            highlightSnapshot(snap.timestamp);
        };

        // Emotion display
        const emojiMap = {
            'happy': '🙂',
            'neutral': '😐',
            'mad': '😠',
            'confused': '😕',
            'thinking': '🤔'
        };

        let emotionsHtml = '';

        // Manual Emotion
        if (snap.emotionManual) {
            const emoji = emojiMap[snap.emotionManual] || '';
            emotionsHtml += `
                <div class="emotion-row">
                    <span class="emotion-label">Manual:</span>
                    <span class="emotion-badge manual">${emoji} ${snap.emotionManual}</span>
                </div>`;
        }

        // Detected Emotion
        if (snap.emotionDetected && snap.emotionDetected !== 'neutral') {
            const emoji = emojiMap[snap.emotionDetected] || '';

            emotionsHtml += `
                <div class="emotion-row">
                    <span class="emotion-label">AI:</span>
                    <span class="emotion-badge detected">${emoji} ${snap.emotionDetected}</span>
                </div>`;
        }

        if (!emotionsHtml) {
            emotionsHtml = '<span class="text-faint">No emotion data</span>';
        }

        // Location formatting
        const loc = `X: ${Math.round(snap.position.x)}, Z: ${Math.round(snap.position.z)}`;

        // Gaze target
        const gazeTarget = snap.gazeTarget || 'nothing';

        // Task
        const task = snap.task || 'No task';

        // Transcription HTML
        let transcriptionHtml = '';
        if (transcription) {
            transcriptionHtml = `<div class="transcription-bubble">${transcription.text}</div>`;
        }

        // Play button HTML
        // Only show play button if there is a transcription (speech detected)
        const playButtonHtml = (audioBlob && transcription) ?
            `<button class="play-audio-btn" data-timestamp="${snap.timestamp}">▶️ Play Audio</button>` :
            '';

        item.innerHTML = `
            <div class="timestamp">T+${relativeTime}s ${playButtonHtml}</div>
            <div class="screenshot-container">
                <div class="screenshot-wrapper">
                    <span class="view-label">First Person</span>
                    <img src="${snap.screenshot}" class="screenshot first-person" alt="First Person View at ${relativeTime}s">
                </div>
                ${snap.birdsEyeScreenshot ? `
                <div class="screenshot-wrapper">
                    <span class="view-label">Bird's Eye</span>
                    <img src="${snap.birdsEyeScreenshot}" class="screenshot birds-eye" alt="Bird's Eye View at ${relativeTime}s">
                </div>
                ` : ''}
            </div>
            ${transcriptionHtml}
            <div class="data-row">
                <span class="task-data">📋 Task: ${task}</span>
            </div>
            <div class="emotions-container">
                ${emotionsHtml}
            </div>
            <div class="data-row">
                <span class="gaze-data">👁️ Looking at: ${gazeTarget}</span>
            </div>
            <div class="data-row">
                <span class="location-data">${loc}</span>
            </div>
        `;

        container.appendChild(item);

        // Add lightbox listeners
        const firstPersonImg = item.querySelector('.screenshot.first-person');
        if (firstPersonImg) {
            firstPersonImg.addEventListener('click', () => {
                openLightbox(snap.screenshot, `First Person View (T+${relativeTime}s)`);
            });
        }

        const birdsEyeImg = item.querySelector('.screenshot.birds-eye');
        if (birdsEyeImg) {
            birdsEyeImg.addEventListener('click', () => {
                openLightbox(snap.birdsEyeScreenshot, `Bird's Eye View (T+${relativeTime}s)`);
            });
        }

        // Add event listener to play button
        if (audioBlob) {
            const playBtn = item.querySelector('.play-audio-btn');
            if (playBtn) {
                playBtn.addEventListener('click', () => {
                    playAudioAtTimestamp(snap.timestamp);
                });
            }
        }
    });
}

initResults();

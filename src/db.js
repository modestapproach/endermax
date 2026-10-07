import Dexie from 'dexie';

export const db = new Dexie('InsightEngineDB');

db.version(2).stores({
    sessions: '++id, startTime, endTime, duration, collectedItems, heatmapData, pathPoints, finalPosition, snapshotData',
    snapshots: '++id, sessionId, timestamp, emotion, position, screenshot',
    transcriptions: '++id, sessionId, startTime, endTime, text',
    audioRecordings: '++id, sessionId, audioBlob, startTime'
});

// v3: only index fields queries actually filter/sort on. v2 indexed whole
// payloads (base64 screenshots, audio blobs), which made IndexedDB build
// index entries for megabytes of data on every 2-second snapshot write.
// Non-indexed fields are still stored on the records as before.
db.version(3).stores({
    sessions: '++id, startTime, endTime',
    snapshots: '++id, sessionId, timestamp',
    transcriptions: '++id, sessionId, startTime',
    audioRecordings: '++id, sessionId, startTime'
});

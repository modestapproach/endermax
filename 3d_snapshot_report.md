# Feature Report: 3D Scene Snapshot & Replay

## Overview
This feature allows users to "step back into" the 3D environment as it existed at the end of a test session. By clicking a button on the results page, they can explore the final state of the world, seeing exactly where they ended up and which items were removed/collected.

## Technical Implementation Strategy

### 1. Data Persistence (The "Snapshot")
Since the environment layout is static (defined by `layout.txt`), we don't need to save the entire 3D mesh. We only need to save the **deltas**—specifically, the changes made to the world during the session.

**Required Changes:**
-   **Track Collected Items**: We need to record which items were picked up (and thus removed from the scene).
-   **Database Update**: Modify the `sessions` table in `db.js` to include a `collectedItems` array.
-   **Capture Logic**: In `main.js`, inside the `endTest()` function, capture the current state of `inventory.items` and save it to the session entry in the database.

### 2. Scene Reconstruction (The Viewer)
To show the 3D space, we will create a lightweight viewer that reuses your existing scene generation code but strips out the game logic.

**New Components:**
-   **`viewer.html`**: A new page (or a full-screen overlay in `results.html`) dedicated to rendering the static scene.
-   **`viewer.js`**: A script that:
    1.  Initializes a Three.js scene (reusing `createEnvironment` and `createBlocks` from `src/scene.js`).
    2.  Loads the session data from IndexedDB.
    3.  **Restores State**: Iterates through the saved `collectedItems` and removes the corresponding objects from the reconstructed scene.
    4.  **Positions Camera**: Sets the camera to the user's final position (from the last snapshot).

### 3. Interaction & Controls
-   **Navigation**: Reuse `setupControls` from `interaction.js` but disable the "gameplay" elements (no picking up items, no objectives).
-   **Heatmap Disabled**: As requested, the heatmap logic will be disabled. The blocks will render with their standard textures/colors, not the heat-map overlay.
-   **Exit**: A simple "Back to Results" button to close the viewer.

## Implementation Steps

1.  **Modify Database Schema**: Update `db.js` to store `collectedItems`.
2.  **Save State**: Update `main.js` -> `endTest` to save the inventory list.
3.  **Create Viewer**:
    -   Create `viewer.html`.
    -   Create `src/viewer.js` importing `scene.js` and `interaction.js`.
    -   Implement the logic to load the scene and hide collected items.
4.  **Update UI**: Add a "View 3D Snapshot" button to `results.html`.

## Feasibility
**High**. Your codebase is well-structured for this. `scene.js` is already modular, allowing us to generate the world deterministically. Reusing the existing assets and logic makes this a low-risk, high-value feature.

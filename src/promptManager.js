// Prompt Manager
// Handles display and navigation of task prompts

class PromptManager {
    constructor() {
        this.prompts = []; // Will be synced with GameLogic
        this.currentIndex = 0;
        this.isStarted = false; // New state to track if test has started

        // DOM elements
        this.promptText = document.getElementById('prompt-text');
        this.dotsContainer = document.querySelector('.prompt-dots'); // Corrected selector
        this.dots = this.dotsContainer.querySelectorAll('.dot'); // Initialize dots
        this.prevBtn = document.getElementById('prevPrompt');
        this.nextBtn = document.getElementById('nextPrompt');
        this.missionCompleteBtn = document.getElementById('mission-complete-btn');

        this.setupEventListeners();
        this.updatePromptUI(); // Initial display update
    }

    setupEventListeners() {
        // Add event listeners
        this.prevBtn.addEventListener('click', () => this.prevPrompt());
        this.nextBtn.addEventListener('click', () => this.nextPrompt());

        if (this.missionCompleteBtn) {
            this.missionCompleteBtn.addEventListener('click', () => {
                if (this.gameLogic) {
                    this.gameLogic.advanceObjective();
                }
            });
        }
    }

    start() {
        this.isStarted = true;
        this.updatePromptUI();
    }

    syncPrompts() {
        if (!this.gameLogic) return;

        // Get descriptions from objectives
        this.prompts = this.gameLogic.objectives.map(obj => obj.description);

        // Rebuild dots
        // Remove existing dots (keep buttons)
        const existingDots = this.dotsContainer.querySelectorAll('.dot');
        existingDots.forEach(dot => dot.remove());

        // Create new dots
        this.prompts.forEach((_, index) => {
            const dot = document.createElement('div');
            dot.classList.add('dot');
            dot.dataset.prompt = index;
            if (index === 0) dot.classList.add('active');

            dot.addEventListener('click', (e) => {
                const targetIndex = parseInt(e.target.dataset.prompt);
                if (this.gameLogic && this.gameLogic.canNavigateToObjective(targetIndex)) {
                    this.goToPrompt(targetIndex);
                }
            });

            // Append to dots container
            this.dotsContainer.appendChild(dot);
        });

        this.dots = this.dotsContainer.querySelectorAll('.dot');
    }

    updatePromptUI() {
        // If test hasn't started, show waiting text
        if (!this.isStarted) {
            this.promptText.textContent = "Waiting to start...";
            this.promptText.classList.remove('strikethrough');
            // Disable navigation
            this.prevBtn.disabled = true;
            this.nextBtn.disabled = true;
            return;
        }

        // Update text
        this.promptText.textContent = this.prompts[this.currentIndex];

        // Update dots
        this.dots.forEach((dot, index) => {
            dot.classList.toggle('active', index === this.currentIndex);
        });

        // Logic for buttons and visual states
        if (!this.gameLogic) return;

        const currentObjectiveIndex = this.gameLogic.currentObjectiveIndex;
        const currentObjective = this.gameLogic.objectives[this.currentIndex];
        const isFrontier = this.currentIndex === currentObjectiveIndex;
        const isHistory = this.currentIndex < currentObjectiveIndex;

        // Reset visual states
        this.promptText.classList.remove('strikethrough');
        this.missionCompleteBtn.classList.add('hidden');

        // Navigation Buttons
        // Prev: Enabled if not first task
        this.prevBtn.disabled = this.currentIndex === 0;

        // Next: 
        // - If History: Enabled (to go back to frontier)
        // - If Frontier: Disabled (must complete task and click "Next Mission")
        // - If Future: Disabled (shouldn't be reachable)
        this.nextBtn.disabled = isFrontier || this.currentIndex > currentObjectiveIndex;

        // Visuals based on state
        if (isHistory) {
            // Completed past task
            this.promptText.classList.add('strikethrough');
            this.promptText.innerHTML = `<span style="color: var(--success-color); margin-right: 0.5rem;">✓</span>${this.prompts[this.currentIndex]}`;
        } else if (isFrontier) {
            // Current task
            if (currentObjective && currentObjective.completed) {
                // Task done
                // If it's NOT the last task, show "Next Mission"
                // If it IS the last task, just show checkmark (popup handled by GameLogic)
                const isLastTask = this.currentIndex === this.gameLogic.objectives.length - 1;

                if (!isLastTask) {
                    this.missionCompleteBtn.classList.remove('hidden');
                }

                // Also show checkmark for current completed task
                this.promptText.innerHTML = `<span style="color: var(--success-color); margin-right: 0.5rem;">✓</span>${this.prompts[this.currentIndex]}`;
                this.promptText.classList.add('strikethrough');
            }
        }
    }

    onObjectiveCompleted(objective, index) {
        // Called when game logic detects completion
        // If we are viewing the completed task, update UI to show the button
        if (this.currentIndex === index) {
            this.updatePromptUI();
        }
    }

    goToPrompt(index) {
        if (index >= 0 && index < this.prompts.length) {
            this.currentIndex = index;
            this.updatePromptUI();
        }
    }

    setGameLogic(gameLogic) {
        this.gameLogic = gameLogic;
        this.syncPrompts();
        this.updatePromptUI();
    }

    nextPrompt() {
        // Only allow next if we are in history (going back to frontier)
        if (this.gameLogic && this.currentIndex < this.gameLogic.currentObjectiveIndex) {
            this.currentIndex++;
            this.updatePromptUI();
        }
    }

    prevPrompt() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updatePromptUI();
        }
    }

    getCurrentPrompt() {
        return this.prompts[this.currentIndex];
    }

    getCurrentIndex() {
        return this.currentIndex;
    }
}

export default PromptManager;

// Game Logic
// Manages objectives and task completion tracking

class GameLogic {
    constructor(promptManager, onComplete) {
        this.promptManager = promptManager;
        this.onComplete = onComplete;
        this.objectives = this.initializeObjectives();
        this.currentObjectiveIndex = 0;
        this.objectiveStartTime = Date.now(); // Initialize objectiveStartTime
    }

    initializeObjectives() {
        // Define objectives
        // Each objective has a description and a check function
        // The check function returns true if the objective is met

        return [
            {
                id: 'task_beans',
                description: 'Find beans',
                completed: false,
                checkCompletion: (state) => {
                    return this.hasItem(state.inventory, 'beans');
                }
            },
            {
                id: 'task_chicken',
                description: 'Find chicken',
                completed: false,
                checkCompletion: (state) => {
                    return this.hasItem(state.inventory, 'chicken');
                }
            }
        ];
    }

    hasItem(inventory, label) {
        if (!inventory || !inventory.items) return false;
        return inventory.items.some(item => item.label.toLowerCase().includes(label.toLowerCase()));
    }

    getCurrentObjective() {
        return this.objectives[this.currentObjectiveIndex];
    }

    update(gameState) {
        // Check if all objectives are completed
        if (this.currentObjectiveIndex >= this.objectives.length) return;

        const currentObjective = this.objectives[this.currentObjectiveIndex];

        // Check completion condition
        // Pass the full gameState which should include inventory
        const isComplete = currentObjective.checkCompletion(gameState);
        // console.log(`Checking objective ${currentObjective.id}: ${isComplete}`, gameState.inventory);

        if (!currentObjective.completed && isComplete) {
            console.log(`✅ Objective ${currentObjective.id} condition met!`);
            this.completeObjective(currentObjective);
        }
    }

    completeObjective(objective) {
        objective.completed = true;
        console.log(`Objective completed: ${objective.description}`);

        // Voice Feedback
        if (window.voiceAgent) {
            console.log(`🗣️ Attempting voice feedback for objective: ${objective.id}`);
            if (objective.id === 'task_beans') {
                window.voiceAgent.speak("You found the beans, good job, now press next mission to continue.");
            } else if (objective.id === 'task_chicken') {
                window.voiceAgent.speak("You found the chicken, great job. Now wait for the results to process.");
            }
        } else {
            console.warn("⚠️ window.voiceAgent is missing in completeObjective");
        }

        // Notify PromptManager
        if (this.promptManager) {
            this.promptManager.onObjectiveCompleted(objective, this.currentObjectiveIndex);
        }

        // Check if this was the last objective
        if (this.currentObjectiveIndex === this.objectives.length - 1) {
            // Last task completed!
            this.onAllObjectivesComplete();
        } else {
            // Not last task, wait for user to click "Next Mission"
            // PromptManager handles showing the button
        }
    }

    advanceObjective() {
        if (this.currentObjectiveIndex < this.objectives.length - 1) {
            this.currentObjectiveIndex++;
            console.log(`Advanced to objective index: ${this.currentObjectiveIndex}`);

            // Voice Prompt for new task
            if (window.voiceAgent) {
                const currentObjective = this.objectives[this.currentObjectiveIndex];
                if (currentObjective.id === 'task_chicken') {
                    window.voiceAgent.speak("For this next task, I would like you to find some chicken.");
                }
            }

            // Notify PromptManager to update UI and switch to new prompt
            if (this.promptManager) {
                this.promptManager.goToPrompt(this.currentObjectiveIndex);
            }
            // Reset timer for new objective
            this.objectiveStartTime = Date.now();
            return true;
        }
        console.log("All objectives completed!");
        this.onAllObjectivesComplete();
        return false;
    }

    onAllObjectivesComplete() {
        // Show completion message or trigger end sequence
        console.log("Congratulations! You've completed all tasks.");
        if (this.onComplete) {
            this.onComplete();
        }
    }

    getProgress() {
        const completedCount = this.objectives.filter(obj => obj.completed).length;
        return {
            completed: completedCount,
            total: this.objectives.length,
            percentage: (completedCount / this.objectives.length) * 100
        };
    }

    reset() {
        this.objectives.forEach(obj => obj.completed = false);
        this.currentObjectiveIndex = 0;
        this.promptManager.goToPrompt(0);
        this.objectiveStartTime = Date.now();
    }

    // Allow manual navigation (for testing or user override)
    canNavigateToObjective(index) {
        // Can only navigate to objectives that have been reached (current or past)
        return index <= this.currentObjectiveIndex;
    }
}

export default GameLogic;

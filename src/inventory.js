export class Inventory {
    constructor() {
        this.items = [];
        this.container = document.getElementById('items-list');

        if (!this.container) {
            console.warn('Inventory container not found');
        }
    }

    addItem(itemData) {
        this.items.push(itemData);
        this.updateUI();

        // Show notification
        this.showNotification(`Picked up ${itemData.label}`);
    }

    clear() {
        this.items = [];
        this.updateUI();
    }

    updateUI() {
        if (!this.container) return;

        this.container.innerHTML = '';

        if (this.items.length === 0) {
            this.container.innerHTML = '<span class="no-items">No items collected</span>';
            return;
        }

        this.items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'item-chip';
            el.textContent = item.label;
            this.container.appendChild(el);
        });
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'notification glass-card slide-in-right';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.remove('slide-in-right');
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }
}

export function initIntroModal(onComplete) {
    const modal = document.getElementById('intro-modal');
    const nextBtn = document.querySelector('.intro-next-btn');
    const startBtn = document.querySelector('.intro-start-btn');
    const slides = document.querySelectorAll('.intro-slide');
    const dots = document.querySelectorAll('.intro-dot');

    if (!modal) {
        console.warn('Intro modal not found');
        if (onComplete) onComplete();
        return;
    }

    let currentSlide = 0;

    function showSlide(index) {
        slides.forEach((slide, i) => {
            if (i === index) {
                slide.classList.add('active');
            } else {
                slide.classList.remove('active');
            }
        });

        // Update dots in ALL slides (since they are duplicated in HTML structure per slide)
        // Actually, looking at the HTML, each slide has its own pagination dots.
        // So we just need to ensure the correct slide is shown.
        // The dots inside the slide are static (hardcoded active class).
        // Wait, my HTML has:
        // Slide 1: Dot 1 active, Dot 2 inactive
        // Slide 2: Dot 1 inactive, Dot 2 active
        // So I don't need to update dots dynamically if I'm switching the entire slide container.
        // The `showSlide` logic above just toggles `.intro-slide.active`.

        currentSlide = index;
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            // Pause video in slide 1
            const iframe = document.querySelector('.intro-slide[data-slide="1"] iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
            }
            showSlide(1);
        });
    }

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            // Wait for transition
            setTimeout(() => {
                modal.style.display = 'none';
                if (onComplete) onComplete();
            }, 500);
        });
    }

    // Handle dot clicks if user wants to go back
    // Since dots are inside the slides, we need to attach listeners to the dots in BOTH slides
    // But wait, if I'm on Slide 1, I can only click Dot 2 to go to Slide 2.
    // If I'm on Slide 2, I can click Dot 1 to go back.

    document.querySelectorAll('.intro-dot').forEach((dot, index) => {
        // This is tricky because there are 2 sets of dots.
        // The first set (in slide 1) has index 0 and 1.
        // The second set (in slide 2) has index 2 and 3.
        // I should probably just rely on the buttons for now, or be smarter about the selector.

        dot.addEventListener('click', (e) => {
            // Find which slide this dot belongs to? No, we want to go to a specific slide index.
            // Let's assume the dots are ordered: Slide 1 Dot 1, Slide 1 Dot 2, Slide 2 Dot 1, Slide 2 Dot 2.
            // This is messy.
            // Let's just use the buttons as the primary navigation as per the design.
            // The user didn't explicitly ask for clickable dots, just "pagination dots".
        });
    });

    // Back Button Logic
    const backBtn = document.getElementById('btn-back-modal');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            // Refresh the page to go back to the home page (Front Page)
            window.location.reload();
        });
    }
}

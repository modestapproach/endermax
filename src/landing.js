export function initFrontPage(onComplete) {
    const frontPage = document.getElementById('front-page');

    if (!frontPage) {
        console.warn('Front page not found');
        if (onComplete) onComplete();
        return;
    }

    frontPage.addEventListener('click', () => {
        frontPage.classList.add('hidden');
        // Wait for transition
        setTimeout(() => {
            frontPage.style.display = 'none';
            if (onComplete) onComplete();
        }, 500);
    });
}

export function initLandingPage(onComplete) {
    const landingPage = document.getElementById('landing-page');
    const exploreBtn = document.querySelector('.btn-explore');

    if (!landingPage) {
        console.warn('Landing page not found');
        if (onComplete) onComplete();
        return;
    }

    if (exploreBtn) {
        exploreBtn.addEventListener('click', () => {
            landingPage.classList.add('hidden');
            // Wait for transition
            setTimeout(() => {
                landingPage.style.display = 'none';
                if (onComplete) onComplete();
            }, 500);
        });
        // Back Button Logic
        const backBtn = document.getElementById('btn-back-landing');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                const frontPage = document.getElementById('front-page');
                if (frontPage) {
                    frontPage.style.display = 'block';
                    // Small timeout to allow display:block to apply before opacity transition
                    setTimeout(() => {
                        frontPage.classList.remove('hidden');
                    }, 10);
                }
            });
        }
    }
}

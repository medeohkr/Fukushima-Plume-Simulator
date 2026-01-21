// web/app.js - ENHANCED VISUALIZATION
let engine = null;
let canvas, ctx;
let isRunning = false;
let animationId = null;
let stats = {
    frameCount: 0,
    lastTime: 0,
    fps: 0,
    lastUpdate: 0
};

// Color schemes for isotopes
const ISOTOPE_COLORS = {
    'Cs137': { r: 100, g: 200, b: 255 }, // Blue
    'Sr90': { r: 255, g: 200, b: 100 },  // Orange
    'H3': { r: 100, g: 255, b: 200 }     // Green
};

async function init() {
    console.log('🚀 Initializing Fukushima Plume Simulator with OSCAR 2011...');

    // Setup canvas
    canvas = document.getElementById('plumeCanvas');
    ctx = canvas.getContext('2d', { alpha: true });
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Create and initialize engine
    engine = new ParticleEngine(8000); // Increased for better visualization

    try {
        await engine.loadCurrentData();
        console.log('✅ Engine ready with OSCAR data');

        // Display data source
        document.getElementById('dataSource').textContent =
            engine.currentData.meta?.source || 'OSCAR 2011';

    } catch (error) {
        console.error('❌ Engine initialization failed:', error);
        showError('Failed to load current data. Using fallback mode.');
    }

    // Setup UI controls
    setupControls();

    // Start animation
    isRunning = true;
    runBtn.textContent = 'Pause';
    requestAnimationFrame(animate);

    // Initial draw
    draw();
}

function resizeCanvas() {
    // SIMPLEST POSSIBLE VERSION
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Reset any transformations
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    console.log(`Canvas reset to: ${canvas.width}×${canvas.height}`);
    console.log(`Top-left should be (0,0), Bottom-right: (${canvas.width},${canvas.height})`);
}

function setupControls() {
    const kuroshioSlider = document.getElementById('kuroshioSlider');
    const diffusionSlider = document.getElementById('diffusionSlider');
    const speedSlider = document.getElementById('speedSlider');
    const resetBtn = document.getElementById('resetBtn');
    const runBtn = document.getElementById('runBtn');
    const interpolationToggle = document.getElementById('interpolationToggle');
    const decayToggle = document.getElementById('decayToggle');

    kuroshioSlider.addEventListener('input', (e) => {
        engine.params.kuroshioMultiplier = parseFloat(e.target.value);
        document.getElementById('kuroshioValue').textContent = e.target.value;
    });

    diffusionSlider.addEventListener('input', (e) => {
        engine.params.diffusion = parseFloat(e.target.value);
        document.getElementById('diffusionValue').textContent = e.target.value;
    });

    speedSlider.addEventListener('input', (e) => {
        engine.params.simulationSpeed = parseFloat(e.target.value);
        document.getElementById('speedValue').textContent = e.target.value;
    });

    interpolationToggle.addEventListener('change', (e) => {
        engine.params.interpolation = e.target.checked;
        console.log(`Interpolation: ${engine.params.interpolation ? 'ON' : 'OFF'}`);
    });

    decayToggle.addEventListener('change', (e) => {
        engine.params.decayEnabled = e.target.checked;
        console.log(`Radioactive decay: ${engine.params.decayEnabled ? 'ON' : 'OFF'}`);
    });

    resetBtn.addEventListener('click', () => {
        engine.reset();
        console.log('Simulation reset');
    });

    runBtn.addEventListener('click', toggleSimulation);
}

function toggleSimulation() {
    isRunning = !isRunning;
    runBtn.textContent = isRunning ? 'Pause' : 'Run';
    if (isRunning) {
        requestAnimationFrame(animate);
    }
}

function animate(timestamp) {
    if (!isRunning) return;

    // Calculate FPS
    stats.frameCount++;
    if (timestamp >= stats.lastTime + 1000) {
        stats.fps = Math.round((stats.frameCount * 1000) / (timestamp - stats.lastTime));
        stats.frameCount = 0;
        stats.lastTime = timestamp;
    }

    // Update simulation (60 FPS target)
    const deltaTime = Math.min(timestamp - stats.lastUpdate, 100) / 1000; // Cap at 100ms
    engine.update(deltaTime);
    stats.lastUpdate = timestamp;

    // Draw
    draw();

    // Continue loop
    animationId = requestAnimationFrame(animate);
}

function draw() {
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#0a1929');
    gradient.addColorStop(1, '#0c2541');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Center and scale
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const scale = 3.0; // Good visibility scale

    // **1. DRAW PARTICLES**
    if (engine && engine.particles) {
        const particles = engine.particles;

        for (const p of particles) {
            if (!p.active) continue;

            const screenX = centerX + (p.x * scale);
            const screenY = centerY - (p.y * scale);

            // Skip if off-screen
            if (screenX < -20 || screenX > canvas.width + 20 ||
                screenY < -20 || screenY > canvas.height + 20) {
                continue;
            }

            // Color by isotope
            const color = ISOTOPE_COLORS[p.isotope] || ISOTOPE_COLORS['Cs137'];
            const alpha = 0.3 + (p.mass * 0.6);
            const size = Math.max(1.5, 2.0 + (p.mass * 3.0));

            ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // **2. DRAW FUKUSHIMA MARKER**
    ctx.fillStyle = 'rgba(255, 50, 50, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 10, 0, Math.PI * 2);
    ctx.fill();

    // **3. DRAW STATS PANEL (Top-Left)**
    drawStatsPanel();

    // **4. DRAW LEGEND (Bottom-Left)**
    drawLegend();

    // **5. DRAW DATA SOURCE (Bottom-Right)**
    drawDataSource();
}

function drawStatsPanel() {
    if (!engine || !engine.stats || !engine.stats.activeByIsotope) {
        return; // Don't draw if stats aren't ready
    }

    const activeCounts = engine.stats.activeByIsotope;

    // Safely get total active particles
    let totalActive = 0;
    if (activeCounts) {
        totalActive = (activeCounts['Cs137'] || 0) +
                     (activeCounts['Sr90'] || 0) +
                     (activeCounts['H3'] || 0);
    }

    // Panel position (top-left, but not overlapping controls if on right)
    const controls = document.getElementById('controls');
    const controlsRect = controls ? controls.getBoundingClientRect() : null;

    let panelX, panelY;

    if (controlsRect && controlsRect.left < canvas.width / 2) {
        // Controls on left → put stats on right
        panelX = canvas.width - 320;
        panelY = 20;
    } else {
        // Controls on right → put stats on left
        panelX = 20;
        panelY = 20;
    }

    const panelWidth = 300;
    const panelHeight = 160;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

    // Border
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

    // Title
    ctx.fillStyle = '#4fc3f7';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('🌊 Plume Statistics', panelX + 15, panelY + 30);

    // Stats
    ctx.fillStyle = 'white';
    ctx.font = '14px monospace';

    let lineY = panelY + 60;
    const lineHeight = 25;

    ctx.fillText(`Active Particles: ${totalActive}`, panelX + 20, lineY);
    lineY += lineHeight;

    // Safely get simulation days
    const simDays = engine.stats.simulationDays || 0;
    ctx.fillText(`Simulation Day: ${Math.floor(simDays)}`, panelX + 20, lineY);
    lineY += lineHeight;

    // Safely get max distance
    const maxDist = engine.stats.maxDistance || 0;
    ctx.fillText(`Max Distance: ${maxDist.toFixed(0)} km`, panelX + 20, lineY);

    // Isotope breakdown
    ctx.fillStyle = '#88CCFF';
    ctx.fillText(`Cs-137: ${activeCounts['Cs137'] || 0}`, panelX + 20, panelY + 140);
    ctx.fillStyle = '#FFCC88';
    ctx.fillText(`Sr-90: ${activeCounts['Sr90'] || 0}`, panelX + 120, panelY + 140);
    ctx.fillStyle = '#88FFCC';
    ctx.fillText(`H-3: ${activeCounts['H3'] || 0}`, panelX + 220, panelY + 140);
}

function drawLegend() {
    // Position (bottom-left)
    const legendX = 20;
    const legendY = canvas.height - 150;
    const legendWidth = 220;
    const legendHeight = 130;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

    // Title
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px Arial';
    ctx.fillText('📊 Isotope Legend', legendX + 15, legendY + 25);

    // Isotope items
    const items = [
        { color: '#88CCFF', name: 'Cs-137 (Cesium)', halfLife: '30.1 years' },
        { color: '#FFCC88', name: 'Sr-90 (Strontium)', halfLife: '28.8 years' },
        { color: '#88FFCC', name: 'H-3 (Tritium)', halfLife: '12.3 years' }
    ];

    let itemY = legendY + 50;
    const itemHeight = 25;

    items.forEach(item => {
        // Color dot
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(legendX + 15, itemY - 5, 6, 0, Math.PI * 2);
        ctx.fill();

        // Text
        ctx.fillStyle = 'white';
        ctx.font = '13px Arial';
        ctx.fillText(item.name, legendX + 30, itemY);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '11px Arial';
        ctx.fillText(item.halfLife, legendX + 30, itemY + 15);

        itemY += itemHeight + 10;
    });
}

function drawDataSource() {
    // Position (bottom-right)
    const sourceX = canvas.width - 250;
    const sourceY = canvas.height - 50;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(sourceX, sourceY, 230, 30);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '12px Arial';

    if (engine && engine.currentData && engine.currentData.meta) {
        ctx.fillText(`Data: ${engine.currentData.meta.source}`, sourceX + 10, sourceY + 20);
    } else {
        ctx.fillText('Data: OSCAR 2011 Surface Currents', sourceX + 10, sourceY + 20);
    }
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 50, 50, 0.9);
        color: white;
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        z-index: 1000;
    `;
    errorDiv.innerHTML = `<strong>⚠️ Error</strong><br>${message}`;
    document.body.appendChild(errorDiv);

    setTimeout(() => errorDiv.remove(), 5000);
}

// Start when page loads
window.addEventListener('load', init);
// web/app.js - PROTEUS Core Application (Pre-render Only)
console.log('=== PROTEUS App Initializing ===');

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

// Core
let engine = null;
let bakeSystem = null;
let animationId = null;
let simulationMode = 'baked'; // Only 'baked' remains

// Map visualization
let simMap = null;
let particleCanvas = null;
let deckgl = null;
let showHeatmap = true;
let showParticleTrails = true;

// State
let currentBakedParticles = [];
let phaseContainer = null;
let statsInterval = null;

// UI state
let currentDepth = 0;
const depthLevels = [0, 50, 100, 200, 500, 1000];
const ALL_DEPTHS = -1;
let visualizationMode = 'concentration'; // 'concentration' or 'particles'

// Location picker
let mapClickEnabled = false;
let locationMarker = null;

// Heatmap
let heatmapParams = {
    intensity: 1.0,
    radiusPixels: 45,
    opacity: 0.9,
    threshold: 0.001,
    useLogScale: true,
    gridSize: 0.5
};
let lastHeatmapUpdate = 0;
const HEATMAP_UPDATE_INTERVAL = 500;
const CONCENTRATION_RANGE = { min: 1e-6, max: 1e6 };

// Date management
let simulationStartDate = new Date('2011-03-01T00:00:00Z');
let simulationEndDate = new Date('2013-02-28T00:00:00Z');
let currentSimulationDate = new Date(simulationStartDate);
let simulationDay = 0;
let totalSimulationDays = 731;

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
    const loadingStatus = createStatusElement();
    updateLoadingStatus('Initializing...', 10);

    try {
        // Map
        updateLoadingStatus('Creating map...', 20);
        createMap();

        // Visualizations
        updateLoadingStatus('Creating visualization...', 30);
        createParticleOverlay();

        updateLoadingStatus('Initializing WebGL...', 40);
        await initDeckGL();

        // Particle engine
        updateLoadingStatus('Loading ocean data...', 50);
        await initParticleEngine();

        // Bake system
        bakeSystem = new BakeSystem();
        setupBakeSystemCallbacks();

        // UI setup
        updateLoadingStatus('Adding controls...', 70);
        setupAllControls();

        // Stats
        if (statsInterval) clearInterval(statsInterval);
        statsInterval = setInterval(updateReleaseStats, 1000);

        // Map events
        simMap.on('move resize zoom', () => {
            updateDeckGLView();
            updateCanvasOverlay();
        });

        // Start animation
        updateLoadingStatus('Ready!', 100);
        setTimeout(() => {
            hideLoadingStatus();
            animate();
        }, 500);

        console.log('✅ PROTEUS initialized successfully');
        return true;

    } catch (error) {
        console.error('❌ Initialization failed:', error);
        showErrorMessage(`Initialization failed: ${error.message}`);
        hideLoadingStatus();
        return false;
    }
}

function createMap() {
    simMap = L.map('map', {
        center: [35.0, 180.0],
        zoom: 3.5,
        minZoom: 3.5,
        maxZoom: 3.5,
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        dragging: true,
        worldCopyJump: false,
        attributionControl: true,
        maxBounds: [[-90, -180], [90, 360]]
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap, © CARTO',
        maxZoom: 8
    }).addTo(simMap);

    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(simMap);
}

function createParticleOverlay() {
    particleCanvas = createCanvasOverlay();
    simMap.addLayer(particleCanvas);
}

async function initParticleEngine() {
    if (typeof ParticleEngine !== 'function') {
        throw new Error('ParticleEngine not loaded');
    }

    engine = new ParticleEngine(10000);
    window.engine = engine;

    if (typeof engine.enableRK4 === 'function') {
        engine.enableRK4(false);
    }

    const success = await engine.init();
    if (!success) {
        showDataWarning('Using fallback diffusion data');
    }
}

function setupBakeSystemCallbacks() {
    bakeSystem.on('frame', (frameData) => {
        currentBakedParticles = frameData.particles;

        if (visualizationMode === 'concentration') {
            updateDeckGLHeatmap(currentBakedParticles);
        } else {
            updateDeckGLParticles(currentBakedParticles);
        }

        if (particleCanvas?.updateParticles) {
            particleCanvas.updateParticles(currentBakedParticles);
        }

        updateDateTimeDisplay();
    });

    bakeSystem.on('bakeProgress', (progress) => {
        updatePreRenderProgress(progress.percent, progress.message);
    });

    bakeSystem.on('bakeComplete', (info) => {
        hidePreRenderProgress();
    });
}

function setupAllControls() {
    setupVisualizationMode();
    updateUIForEngine();
    updateDateTimeDisplay();
    createHeatmapColorLegend();
    setupTrailToggle();
    setupUIModeSwitching();
    setupSliderValueDisplays();
    setupPreRenderButton();
    setupPlaybackControls();
    setupTracerUI();
    setupDownloadButton();
    setupSnapshotImport();
    setupLocationPicker();
    setupDateRange();
}

// ============================================================================
// DECK.GL VISUALIZATION
// ============================================================================

async function initDeckGL() {
    if (typeof deck === 'undefined') {
        console.warn('deck.gl not loaded, running in Leaflet-only mode');
        showDataWarning('WebGL heatmap not available');
        return;
    }

    const canvas = document.getElementById('deckgl-overlay');
    if (!canvas) return;

    canvas.width = window.innerWidth - 360;
    canvas.height = window.innerHeight;

    deckgl = new deck.Deck({
        canvas: canvas,
        initialViewState: {
            longitude: 165.0,
            latitude: 25.0,
            zoom: 3,
            pitch: 0,
            bearing: 0,
            width: window.innerWidth - 360,
            height: window.innerHeight
        },
        controller: false,
        layers: [],
        parameters: {
            blend: true,
            blendFunc: [0x0302, 0x0303],
            clearColor: [0, 0, 0, 0]
        }
    });

    updateDeckGLView();
    window.addEventListener('resize', handleResize);
}

function handleResize() {
    if (!deckgl) return;

    const canvas = document.getElementById('deckgl-overlay');
    if (!canvas) return;

    canvas.width = window.innerWidth - 360;
    canvas.height = window.innerHeight;

    updateDeckGLView();
}

function updateDeckGLView() {
    if (!deckgl || !simMap) return;

    const center = simMap.getCenter();
    const zoom = simMap.getZoom();
    const deckZoom = Math.max(0, zoom - 1);

    deckgl.setProps({
        viewState: {
            longitude: center.lng,
            latitude: center.lat,
            zoom: deckZoom,
            pitch: 0,
            bearing: 0,
            width: window.innerWidth - 360,
            height: window.innerHeight
        }
    });

    deckgl.redraw();
}

// ============================================================================
// HEATMAP
// ============================================================================

function createConcentrationGrid(particles, gridSize = 0.5) {
    if (!engine || !particles || particles.length === 0) {
        return [];
    }

    const grid = new Map();
    let validParticles = 0;
    let totalConcentration = 0;

    particles.forEach(p => {
        // Skip inactive or invalid particles
        if (!p || !p.active) return;
        if (!p.concentration || p.concentration <= 0) return;

        validParticles++;
        totalConcentration += p.concentration;

        // Calculate position
        const lon = engine.REFERENCE_LON + (p.x / engine.LON_SCALE);
        const lat = engine.REFERENCE_LAT + (p.y / engine.LAT_SCALE);

        // Skip invalid coordinates
        if (isNaN(lon) || isNaN(lat) || Math.abs(lat) > 90) return;

        // Grid cell calculation
        const lonIdx = Math.floor(lon / gridSize);
        const latIdx = Math.floor(lat / gridSize);
        const key = `${lonIdx},${latIdx}`;

        if (!grid.has(key)) {
            const cellLon = (lonIdx + 0.5) * gridSize;
            const cellLat = (latIdx + 0.5) * gridSize;

            grid.set(key, {
                position: [cellLon, cellLat],
                concentration: 0
            });
        }

        grid.get(key).concentration += p.concentration;
    });

    return Array.from(grid.values());
}

function updateDeckGLHeatmap(particles) {
    // Exit conditions
    if (!deckgl || particles.length === 0 || visualizationMode !== 'concentration') {
        if (deckgl) deckgl.setProps({ layers: [] });
        return;
    }

    // Filter by depth if needed
    let particlesToUse = particles;
    if (currentDepth !== ALL_DEPTHS) {
        const depthRange = 100;
        particlesToUse = particles.filter(p => {
            const particleDepthM = p.depth !== undefined ? p.depth * 1000 : 0;
            return Math.abs(particleDepthM - currentDepth) <= depthRange;
        });
    }

    // Throttle updates
    const now = Date.now();
    if (now - lastHeatmapUpdate < HEATMAP_UPDATE_INTERVAL) return;
    lastHeatmapUpdate = now;

    // Create concentration grid
    const gridData = createConcentrationGrid(particlesToUse, heatmapParams.gridSize);

    if (gridData.length === 0) {
        deckgl.setProps({ layers: [] });
        return;
    }

    // ===== STEP 1: Calculate ACTUAL min/max concentrations =====
    const concentrations = gridData.map(cell => cell.concentration);
    const actualMin = Math.min(...concentrations);
    const actualMax = Math.max(...concentrations);

    // ===== STEP 2: Update legend with actual values =====
    updateHeatmapLegend(actualMin, actualMax);

    // ===== STEP 3: Calculate log scaling parameters =====
    // Add tiny epsilon to avoid log(0)
    const EPSILON = 1e-30;
    const logMin = Math.log10(Math.max(actualMin, EPSILON));
    const logMax = Math.log10(actualMax);

    // ===== STEP 4: Create normalized heatmap data (0-1 scale) =====
    const heatmapData = gridData.map(cell => {
        // Log-scale normalization for better visual distribution
        const logVal = Math.log10(Math.max(cell.concentration, EPSILON));
        const normalized = (logVal - logMin) / (logMax - logMin);

        return {
            position: cell.position,
            weight: Math.max(0, Math.min(normalized, 1)) // Clamp to 0-1
        };
    });

    // ===== STEP 5: Create heatmap layer with normalized weights =====
    try {
        const heatmapLayer = new deck.HeatmapLayer({
            id: 'concentration-heatmap',
            data: heatmapData,
            getPosition: d => d.position,
            getWeight: d => d.weight,
            colorRange: [
                [231, 236, 251, 255], [195, 209, 247, 255], [162, 186, 244, 255],
                [120, 153, 227, 255], [68, 115, 227, 255], [141, 142, 213, 255],
                [252, 184, 197, 255], [255, 115, 107, 255], [255, 41, 0, 250],
                [255, 106, 0, 255], [255, 154, 0, 255], [255, 216, 1, 255]
            ],
            radiusPixels: heatmapParams.radiusPixels,
            intensity: 1.0,
            opacity: heatmapParams.opacity,
            threshold: 0.01,
            aggregation: 'SUM'
        });

        deckgl.setProps({ layers: [heatmapLayer] });
        deckgl.redraw();

    } catch (error) {
        console.error('Heatmap error:', error);
    }
}


// ============================================================================
// PARTICLE VISUALIZATION
// ============================================================================

function updateDeckGLParticles(particles) {
    if (!deckgl || particles.length === 0 || visualizationMode !== 'particles') {
        deckgl?.setProps({ layers: [] });
        return;
    }

    try {
        // Define ALL_DEPTHS constant
        const ALL_DEPTHS = -1;

        let particlesToUse = particles;

        // Only filter by depth if NOT "All Depths"
        if (currentDepth !== ALL_DEPTHS) {
            const depthRange = 50;
            particlesToUse = particles.filter(p => {
                const particleDepthM = p.depth !== undefined ? p.depth * 1000 : 0;
                return Math.abs(particleDepthM - currentDepth) <= depthRange;
            });
        }

        const particleData = [];
        const trailData = [];

        // Get reference coordinates
        const refLon = engine ? engine.REFERENCE_LON : 142.03;
        const refLat = engine ? engine.REFERENCE_LAT : 37.42;
        const lonScale = engine ? engine.LON_SCALE : 88.8;
        const latScale = engine ? engine.LAT_SCALE : 111.0;

        for (const p of particlesToUse) {
            // Check if particle is valid - handle BOTH realtime AND baked formats
            const isValid = p.active === undefined ? true : p.active;
            if (!isValid) continue;

            // Calculate coordinates using our fallback values
            const lon = refLon + (p.x / lonScale);
            const lat = refLat + (p.y / latScale);

            // Skip obviously invalid positions
            if (Math.abs(lat) > 90) continue;

            // Add current position
            particleData.push({
                position: [lon, lat],
                color: getParticleColor(p),
                radius: getParticleRadius(p)
            });

            // Add trail if enabled
            if (showParticleTrails) {
                // Handle different history formats
                let historyPoints = [];

                // Case 1: New circular buffer
                if (p.history && typeof p.history.getAll === 'function') {
                    historyPoints = p.history.getAll();
                }
                // Case 2: Old array format (for backward compatibility)
                else if (Array.isArray(p.history)) {
                    historyPoints = p.history;
                }
                // Case 3: Baked format with historyX/historyY
                else if (p.historyX && p.historyLength > 0) {
                    historyPoints = [];
                    for (let i = 0; i < p.historyLength; i++) {
                        historyPoints.push({
                            x: p.historyX[i],
                            y: p.historyY[i]
                        });
                    }
                }

                if (historyPoints && historyPoints.length > 1) {
                    const positions = historyPoints.map(h => {
                        const histLon = refLon + (h.x / lonScale);
                        const histLat = refLat + (h.y / latScale);
                        return [histLon, histLat];
                    }).filter(pos => Math.abs(pos[1]) <= 90);

                    if (positions.length >= 2) {
                        trailData.push({
                            path: positions,
                            color: getTrailColor(p),
                            width: 1.5
                        });
                    }
                }
            }
        }

        // Create deck.gl layers
        const layers = [];

        if (trailData.length > 0) {
            layers.push(new deck.PathLayer({
                id: 'particle-trails',
                data: trailData,
                getPath: d => d.path,
                getColor: d => d.color,
                getWidth: d => d.width,
                widthUnits: 'pixels',
                widthMinPixels: 1,
                capRounded: true,
                jointRounded: true
            }));
        }

        if (particleData.length > 0) {
            layers.push(new deck.ScatterplotLayer({
                id: 'particle-points',
                data: particleData,
                getPosition: d => d.position,
                getColor: d => d.color,
                getRadius: d => d.radius,
                radiusUnits: 'pixels',
                radiusMinPixels: 1,
                radiusMaxPixels: 6,
                filled: true,
                opacity: 0.8
            }));
        }

        deckgl.setProps({ layers });

    } catch (error) {
        console.error('Particle visualization error:', error);
    }
}

function getParticleColor(p) {
    if (!p.concentration) return [255, 255, 255, 150]; // White for no data

    // Convert concentration to 0-1 normalized value
    const concentration = Math.max(p.concentration, CONCENTRATION_RANGE.min);
    const clampedConc = Math.min(concentration, CONCENTRATION_RANGE.max);

    const logConc = Math.log10(clampedConc);
    const logMin = Math.log10(CONCENTRATION_RANGE.min);
    const logMax = Math.log10(CONCENTRATION_RANGE.max);
    const normalized = (logConc - logMin) / (logMax - logMin);

    // Your beautiful color scheme
    const colorStops = [
        [231, 236, 251, 200], // Very low - Soft blue-white
        [195, 209, 247, 200], // Low - Light blue
        [162, 186, 244, 200], // Low-mid - Periwinkle
        [120, 153, 227, 210], // Mid-low - Cornflower blue
        [68, 115, 227, 210],  // Mid - Royal blue
        [141, 142, 213, 220], // Mid-high - Purple-blue
        [252, 184, 197, 220], // High - Soft pink
        [255, 115, 107, 230], // Higher - Coral
        [255, 41, 0, 240],    // Very high - Bright red
        [255, 106, 0, 250],   // Extreme - Orange
        [255, 154, 0, 250],   // Extreme - Orange-yellow
        [255, 216, 1, 255]    // Peak - Bright yellow
    ];

    // Map normalized value (0-1) to color index
    const colorIndex = Math.floor(normalized * (colorStops.length - 1));

    // Return the color at that index (with bounds checking)
    return colorIndex < colorStops.length ? colorStops[colorIndex] : colorStops[colorStops.length - 1];
}

function getTrailColor(p) {
    // Fade trail color based on particle age
    const age = p.age || 0;
    const alpha = Math.max(50, 255 - age * 2); // Fade with age

    if (age < 100) return [255, 107, 107, alpha];    // Red for new particles
    if (age < 300) return [255, 193, 7, alpha];      // Yellow for medium age
    return [79, 195, 247, alpha];                    // Blue for old particles
}

function getParticleRadius(p) {
    if (!p.concentration) return 1;

    const concentration = Math.max(p.concentration, 1e-9);
    const logConc = Math.log10(concentration);

    // Scale radius based on concentration, but make peak particles slightly larger
    // Min radius 1, max radius 5
    const baseRadius = Math.min(4, Math.max(1, 1 + logConc * 0.3));

    // Boost radius for the highest concentrations (yellow/orange range)
    if (logConc > 6) {
        return baseRadius * 1.2; // 20% larger for peak
    }

    return baseRadius;
}

// ============================================================================
// UI CONTROLS
// ============================================================================

function setupVisualizationMode() {
    // Get mode toggle buttons - UPDATED IDs
    const btnPreRender = document.getElementById('btn-pre-render');
    const btnConcentration = document.getElementById('btn-concentration');
    const btnParticles = document.getElementById('btn-particles');

    // Get UI panels - UPDATED IDs
    const prenderControls = document.getElementById('prender-controls');
    const playbackControls = document.getElementById('playback-controls');

    // Pre-render mode (formerly Bake mode)
    if (btnPreRender) {
        btnPreRender.addEventListener('click', () => {
            // Update mode
            simulationMode = 'baked';

            // Update button states
            btnPreRender.classList.add('active');

            // Show pre-render UI
            if (prenderControls) prenderControls.style.display = 'block';
            if (playbackControls) playbackControls.style.display = 'none'; // Hidden until pre-render completes

            // If we already have baked data loaded, use it
            if (bakeSystem && bakeSystem.snapshots.length > 0) {
                const particles = bakeSystem.interpolateParticles();
                if (visualizationMode === 'concentration') {
                    updateDeckGLHeatmap(particles);
                } else {
                    updateDeckGLParticles(particles);
                }
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }
        });
    }

    // Concentration mode
    if (btnConcentration) {
        btnConcentration.addEventListener('click', () => {
            visualizationMode = 'concentration';

            // Update button states
            btnConcentration.classList.add('active');
            if (btnParticles) btnParticles.classList.remove('active');

            // Update visualization based on current simulation mode
            if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
                const particles = bakeSystem.interpolateParticles();
                updateDeckGLHeatmap(particles);

                // Clear particle canvas
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }
            }
        });
    }

    // Particles mode
    if (btnParticles) {
        btnParticles.addEventListener('click', () => {
            visualizationMode = 'particles';

            // Update button states
            btnParticles.classList.add('active');
            if (btnConcentration) btnConcentration.classList.remove('active');

            // Update visualization based on current simulation mode
            if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
                const particles = bakeSystem.interpolateParticles();
                updateDeckGLParticles(particles);

                // Update canvas particles
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }
        });
    }

    // Set initial state (default to pre-render + concentration)
    if (btnPreRender) btnPreRender.click();
    if (btnConcentration) btnConcentration.click();
}

function setupUIModeSwitching() {
    const btnPreRender = document.getElementById('btn-pre-render');
    const prenderControls = document.getElementById('prender-controls');
    const playbackControls = document.getElementById('playback-controls');

    if (!btnPreRender) return;

    btnPreRender.addEventListener('click', () => {
        simulationMode = 'baked';
        if (prenderControls) prenderControls.style.display = 'block';
        if (playbackControls) playbackControls.style.display = 'none';
    });

    btnPreRender.click();
}

function setupSliderValueDisplays() {
    // PRE-RENDER SLIDERS
    const prParticles = document.getElementById('pr-particles');
    if (prParticles) {
        const display = document.getElementById('pr-particles-value');
        display.textContent = parseInt(prParticles.value).toLocaleString();
        prParticles.addEventListener('input', (e) => {
            display.textContent = parseInt(e.target.value).toLocaleString();
        });
    }

    const prDuration = document.getElementById('pr-duration');
    if (prDuration) {
        const display = document.getElementById('pr-duration-value');
        const updateDurationDisplay = (val) => {
            const days = parseInt(val);
            if (days === 1) {
                display.textContent = '1 day';
            } else {
                display.textContent = `${days} days`;
            }
        };
        updateDurationDisplay(prDuration.value);
        prDuration.addEventListener('input', (e) => updateDurationDisplay(e.target.value));
    }
    // Add to setupSliderValueDisplays()
    const snapshotFreq = document.getElementById('snapshot-frequency');
    if (snapshotFreq) {
        const display = document.getElementById('snapshot-frequency-value');

        const updateDisplay = (val) => {
            const days = parseInt(val);
            if (days === 1) display.textContent = 'Daily';
            else if (days === 7) display.textContent = 'Weekly';
            else if (days === 30) display.textContent = 'Monthly';
            else display.textContent = `Every ${days} days`;
        };

        updateDisplay(snapshotFreq.value);

        snapshotFreq.addEventListener('input', (e) => {
            updateDisplay(e.target.value);
        });
    }

    const prEke = document.getElementById('pr-eke');
    if (prEke) {
        const display = document.getElementById('pr-eke-value');
        display.textContent = parseFloat(prEke.value).toFixed(1) + 'x';
        prEke.addEventListener('input', (e) => {
            display.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
        });
    }

    // PLAYBACK SLIDERS
    const playbackSpeed = document.getElementById('playback-speed');
    if (playbackSpeed) {
        const display = document.getElementById('playback-speed-value');
        display.textContent = parseFloat(playbackSpeed.value).toFixed(1) + 'x';
        playbackSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value).toFixed(1);
            display.textContent = val + 'x';
            if (bakeSystem) bakeSystem.playbackSpeed = parseFloat(val);
        });
    }

    // Depth slider
    const depthSlider = document.getElementById('depth-slider');
    if (depthSlider) {
        const display = document.getElementById('depth-value');
        const depthLevels = [0, 50, 100, 200, 500, 1000];

        // Special value for "All Depths" - we'll use -1 to represent "all"
        const ALL_DEPTHS = -1;

        const updateDepthDisplay = (idx) => {
            const index = parseInt(idx);

            if (index === 0) {
                // "All Depths" option
                currentDepth = ALL_DEPTHS;
                display.textContent = 'All Depths';
            } else {
                // Specific depth
                const depth = depthLevels[index - 1]; // Offset by 1 because index 0 is "All"
                currentDepth = depth;

                if (depth === 0) display.textContent = 'Surface (0m)';
                else if (depth === 50) display.textContent = 'Near-surface (50m)';
                else if (depth === 100) display.textContent = 'Upper thermocline (100m)';
                else if (depth === 200) display.textContent = 'Lower thermocline (200m)';
                else if (depth === 500) display.textContent = 'Intermediate (500m)';
                else display.textContent = 'Deep ocean (1000m)';
            }

            // Update HYCOM loader (only if not "All Depths")
            if (window.streamingHycomLoader3D && currentDepth !== ALL_DEPTHS) {
                window.streamingHycomLoader3D.setDefaultDepth(currentDepth);
            }

            // Refresh visualization
            refreshVisualization();
        };

        // Set initial value
        updateDepthDisplay(depthSlider.value);

        // Add event listener
        depthSlider.addEventListener('input', (e) => {
            updateDepthDisplay(e.target.value);
        });
    }
}

function setupPreRenderButton() {
    const btn = document.getElementById('btn-start-prerender');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        // Get phases from the UI
        const phaseCards = document.querySelectorAll('.phase-card');
        const phases = [];

        phaseCards.forEach(card => {
            const start = parseInt(card.querySelector('.phase-start').value) || 0;
            const end = parseInt(card.querySelector('.phase-end').value) || 0;
            const total = parseFloat(card.querySelector('.phase-total').value) || 0;
            const unit = card.querySelector('.phase-unit').value;

            phases.push({ start, end, total, unit });
        });

        const config = {
            numParticles: parseInt(document.getElementById('pr-particles').value),
            ekeDiffusivity: parseFloat(document.getElementById('pr-eke').value),
            rk4Enabled: document.getElementById('pr-rk4').checked,
            durationDays: parseInt(document.getElementById('pr-duration').value),
            startDate: simulationStartDate,
            endDate: simulationEndDate,
            location: {
                lat: engine.REFERENCE_LAT,
                lon: engine.REFERENCE_LON
            },
            phases: phases
        };

        // Show progress
        showPreRenderProgress();

        try {
            // Ensure we're in bake mode
            if (simulationMode !== 'baked') {
                document.getElementById('btn-pre-render').click();
            }

            // Start baking
            const snapshots = await bakeSystem.bake(config);

            // Load into playback
            bakeSystem.loadSnapshots(snapshots);

            // Hide pre-render controls, show playback
            document.getElementById('prender-controls').style.display = 'none';
            document.getElementById('playback-controls').style.display = 'block';

            if (snapshots.length > 0) {
                const maxDay = snapshots[snapshots.length - 1].day;

                // Update timeline slider
                const timeline = document.getElementById('playback-timeline');
                if (timeline) {
                    timeline.max = maxDay;
                    timeline.value = 0;
                }

                // Update labels
                document.getElementById('playback-date-end').textContent = `Day ${maxDay}`;
                document.getElementById('playback-date-start').textContent = 'Day 0';

                // Show first frame
                bakeSystem.seek(0);
            }

            hidePreRenderProgress();

        } catch (error) {
            console.error('Pre-render failed:', error);
            alert('Pre-render failed: ' + error.message);
            hidePreRenderProgress();
        }
    });
}

function setupPlaybackControls() {
    const playBtn = document.getElementById('playback-play');
    const pauseBtn = document.getElementById('playback-pause');
    const speedSlider = document.getElementById('playback-speed');
    const timelineSlider = document.getElementById('playback-timeline');

    // Play button
    if (playBtn) {
        const newPlayBtn = playBtn.cloneNode(true);
        playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
        newPlayBtn.addEventListener('click', () => {
            if (bakeSystem) {
                bakeSystem.play();
            }
        });
    }

    // Pause button
    if (pauseBtn) {
        const newPauseBtn = pauseBtn.cloneNode(true);
        pauseBtn.parentNode.replaceChild(newPauseBtn, pauseBtn);
        newPauseBtn.addEventListener('click', () => {
            if (bakeSystem) {
                bakeSystem.pause();
            }
        });
    }

    // Speed slider
    if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            if (bakeSystem) {
                bakeSystem.playbackSpeed = speed;
            }
        });
    }

    // Timeline slider
    if (timelineSlider) {
        timelineSlider.addEventListener('input', (e) => {
            if (!bakeSystem || bakeSystem.snapshots.length === 0) return;
            const targetDay = parseFloat(e.target.value);
            bakeSystem.seek(targetDay);
        });
    }
}

function setupTrailToggle() {
    const trailsToggle = document.getElementById('trailsToggle');

    if (trailsToggle) {
        trailsToggle.checked = showParticleTrails;
        trailsToggle.addEventListener('change', (e) => {
            showParticleTrails = e.target.checked;

            // Update visualization
            if (visualizationMode === 'particles') {
                refreshVisualization();
            }
        });
    }
}

function setupDownloadButton() {
    const btn = document.getElementById('download-snapshots');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (!bakeSystem || !bakeSystem.snapshots.length) {
            alert('No snapshots to download');
            return;
        }

        const downloadData = {
            version: '1.0',
            timestamp: Date.now(),
            metadata: {
                simulationStartDate: simulationStartDate.toISOString(),
                simulationEndDate: simulationEndDate.toISOString(),
                totalDays: totalSimulationDays,
                tracer: engine?.tracer?.name || 'Cs-137'
            },
            snapshots: bakeSystem.snapshots.map(s => ({
                day: s.day,
                particleCount: s.particleCount,
                stats: s.stats,
                particles: s.particles.map(p => ({
                    x: p.x, y: p.y, depth: p.depth,
                    concentration: p.concentration,
                    mass: p.mass, age: p.age,
                    history: p.history || []
                }))
            }))
        };

        const jsonStr = JSON.stringify(downloadData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `proteus_snapshots_${new Date().toISOString().slice(0,10)}.json`;
        a.click();

        URL.revokeObjectURL(url);
    });
}
function setupSnapshotImport() {
    const importBtn = document.getElementById('import-snapshots');
    const fileInput = document.getElementById('snapshot-upload');

    if (!importBtn || !fileInput) return;

    importBtn.addEventListener('click', () => {
        fileInput.click(); // Trigger file selection
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const imported = JSON.parse(text);

            // Validate imported data
            if (!imported.snapshots || !Array.isArray(imported.snapshots)) {
                throw new Error('Invalid snapshot file');
            }

            // Load into bakeSystem
            bakeSystem.loadSnapshots(imported.snapshots);

            // Switch to playback mode
            document.getElementById('prender-controls').style.display = 'none';
            document.getElementById('playback-controls').style.display = 'block';

            // Update timeline
            if (imported.snapshots.length > 0) {
                const maxDay = imported.snapshots[imported.snapshots.length - 1].day;
                const timeline = document.getElementById('playback-timeline');
                if (timeline) {
                    timeline.max = maxDay;
                    timeline.value = 0;
                }
                document.getElementById('playback-date-end').textContent = `Day ${maxDay}`;
                document.getElementById('playback-date-start').textContent = 'Day 0';
                bakeSystem.seek(0);
            }

            console.log('✅ Imported', imported.snapshots.length, 'snapshots');

        } catch (error) {
            console.error('❌ Import failed:', error);
            alert('Failed to import snapshots: ' + error.message);
        }

        // Clear input so same file can be selected again
        fileInput.value = '';
    });
}


// ============================================================================
// LOCATION PICKER
// ============================================================================

function setupLocationPicker() {
    const latInput = document.getElementById('location-lat');
    const lonInput = document.getElementById('location-lon');
    const mapToggle = document.getElementById('map-click-toggle');
    const currentLocationSpan = document.getElementById('current-location');
    const oceanStatusSpan = document.getElementById('location-ocean-status');

    if (!latInput || !lonInput || !mapToggle) return;

    // Update display when coordinates change
    function updateLocationDisplay() {
        const lat = parseFloat(latInput.value);
        const lon = parseFloat(lonInput.value);

        if (isNaN(lat) || isNaN(lon)) return;

        // Format display
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        currentLocationSpan.textContent = `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;

        // Check if in ocean
        checkIfOcean(lat, lon).then(isOcean => {
            oceanStatusSpan.textContent = isOcean ? '✅ Yes' : '❌ No (land)';
            oceanStatusSpan.style.color = isOcean ? '#4fc3f7' : '#ff6b6b';
        });

        // Update engine reference point
        if (engine) {
            engine.REFERENCE_LAT = lat;
            engine.REFERENCE_LON = lon;
        }

        // Update marker on map
        updateLocationMarker(lat, lon);
    }

    // Check if coordinates are in ocean
    async function checkIfOcean(lat, lon) {
        if (!engine || !engine.hycomLoader) return true;
        try {
            return await engine.hycomLoader.isOcean(lon, lat, 0, 0);
        } catch {
            return true;
        }
    }

    // Add marker on map
    function updateLocationMarker(lat, lon) {
        if (!simMap) return;

        // Remove old marker
        if (locationMarker) {
            simMap.removeLayer(locationMarker);
        }

        // Add new marker
        locationMarker = L.circleMarker([lat, lon], {
            radius: 8,
            color: '#ff6b6b',
            fillColor: '#ff6b6b',
            fillOpacity: 0.8,
            weight: 2,
            opacity: 1
        }).addTo(simMap);

        locationMarker.bindPopup(`
            <b>Release Location</b><br>
            ${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'},
            ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}
        `);
    }

    // Input event listeners
    latInput.addEventListener('input', updateLocationDisplay);
    lonInput.addEventListener('input', updateLocationDisplay);

    // Map click toggle
    mapToggle.addEventListener('change', (e) => {
        mapClickEnabled = e.target.checked;
        if (mapClickEnabled) {
            simMap.dragging.disable();
            simMap.getContainer().style.cursor = 'crosshair';
        } else {
            simMap.dragging.enable();
            simMap.getContainer().style.cursor = '';
        }
    });

    // Map click handler
    simMap.on('click', (e) => {
        if (!mapClickEnabled) return;

        const { lat, lng } = e.latlng;

        // Clamp to reasonable bounds
        const clampedLat = Math.max(-90, Math.min(90, lat));
        let clampedLng = lng;

        // Handle longitude wrapping
        while (clampedLng < 100) clampedLng += 360;
        while (clampedLng > 260) clampedLng -= 360;

        latInput.value = clampedLat.toFixed(2);
        lonInput.value = clampedLng.toFixed(2);

        updateLocationDisplay();
    });

    // Initial update
    updateLocationDisplay();

    // Add button to reset to Fukushima
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn';
    resetBtn.style.cssText = 'width: 100%; margin-top: 10px;';
    resetBtn.innerHTML = '<i class="fas fa-redo"></i> Reset to Fukushima';
    resetBtn.addEventListener('click', () => {
        latInput.value = '37.42';
        lonInput.value = '142.03';
        updateLocationDisplay();
    });

    const container = mapToggle.closest('.control-group');
    if (container) container.appendChild(resetBtn);
}

// ============================================================================
// DATE MANAGEMENT
// ============================================================================

function setupDateRange() {
    const startInput = document.getElementById('sim-start-date');
    const endInput = document.getElementById('sim-end-date');
    const totalDaysSpan = document.getElementById('total-days');
    const durationMaxLabel = document.getElementById('duration-max-label');

    if (!startInput || !endInput) return;

    function updateDateRange() {
        const startDate = new Date(startInput.value + 'T00:00:00Z');
        const endDate = new Date(endInput.value + 'T00:00:00Z');

        if (isNaN(startDate) || isNaN(endDate)) return;

        // Calculate inclusive days between dates
        const diffTime = Math.abs(endDate - startDate);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

        totalDaysSpan.textContent = `${diffDays} days`;

        // Update the duration max label
        if (durationMaxLabel) {
            if (diffDays > 365) {
                const years = (diffDays / 365).toFixed(1);
                durationMaxLabel.textContent = `${years} years`;
            } else {
                durationMaxLabel.textContent = `${diffDays} days`;
            }
        }

        // Update global variables
        simulationStartDate = startDate;
        simulationEndDate = endDate;
        totalSimulationDays = diffDays;

        // Update engine if exists
        if (engine) {
            engine.simulationStartTime = new Date(startDate);
            engine.currentSimulationTime = new Date(startDate);
        }

        // Update pre-render duration slider max
        const durationSlider = document.getElementById('pr-duration');
        if (durationSlider) {
            durationSlider.max = diffDays;
            if (parseInt(durationSlider.value) > diffDays) {
                durationSlider.value = diffDays;
            }
        }

        // Update date display
        updateDateTimeDisplay();
    }

    startInput.addEventListener('change', updateDateRange);
    endInput.addEventListener('change', updateDateRange);

    // Initial update
    updateDateRange();
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateDateTimeDisplay() {
    const dayElement = document.getElementById('simulation-day');
    const dateElement = document.getElementById('simulation-date');

    if (!dayElement || !dateElement) return;

    if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
        // ===== BAKED MODE =====
        const currentDay = bakeSystem.getCurrentDay();

        // Calculate date from start date
        const date = new Date(simulationStartDate);
        date.setUTCDate(simulationStartDate.getUTCDate() + Math.floor(currentDay));

        const hours = Math.floor((currentDay % 1) * 24);
        const minutes = Math.floor(((currentDay % 1) * 24 * 60) % 60);

        dayElement.textContent = `Day ${currentDay.toFixed(2)}`;

        if (hours > 0 || minutes > 0) {
            dateElement.textContent = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC'
            }) + ` ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} UTC`;
        } else {
            dateElement.textContent = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC'
            });
        }

        // Update timeline slider
        const timeline = document.getElementById('playback-timeline');
        if (timeline && bakeSystem.snapshots.length > 0) {
            const maxDay = bakeSystem.snapshots[bakeSystem.snapshots.length - 1].day;

            if (timeline.max != maxDay) {
                timeline.max = maxDay;
            }

            timeline.value = currentDay;

            const currentDateElement = document.getElementById('playback-date-current');
            if (currentDateElement) {
                currentDateElement.textContent = `Day ${currentDay.toFixed(1)}`;
            }
        }

    } else {
        // ===== NO ACTIVE SIMULATION =====
        dayElement.textContent = 'Day 0.0';
        dateElement.textContent = simulationStartDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC'
        });
    }
}

function updateStatsDisplay() {
    const activeSpan = document.getElementById('stats-active');
    const releasedSpan = document.getElementById('stats-released');
    const decayedSpan = document.getElementById('stats-decayed');
    const depthSpan = document.getElementById('stats-depth');

    if (!activeSpan) return;

    if (simulationMode === 'baked' && bakeSystem?.snapshots?.length > 0) {
        // PLAYBACK MODE STATS
        const currentSnapshot = bakeSystem.snapshots[bakeSystem.currentSnapshotIndex || 0];
        const particles = currentSnapshot?.particles || [];
        const stats = currentSnapshot?.stats || {};


        activeSpan.textContent = particles.length.toLocaleString();
        releasedSpan.textContent = (stats.totalReleased || particles.length).toLocaleString();
        decayedSpan.textContent = (stats.totalDecayed || 0).toLocaleString();
        depthSpan.textContent = (stats.maxDepthReached || 0).toFixed(0) + 'm';

    } else {
        // NO SIMULATION
        activeSpan.textContent = '0';
        releasedSpan.textContent = '0';
        decayedSpan.textContent = '0';
        depthSpan.textContent = '0m';
    }
}

function updateUIForEngine() {
    if (!engine) return;

    // PRE-RENDER CONTROLS (initial values only)
    const prRk4 = document.getElementById('pr-rk4');
    if (prRk4) {
        prRk4.checked = engine.rk4Enabled || false;
    }

    const prEke = document.getElementById('pr-eke');
    const prEkeValue = document.getElementById('pr-eke-value');
    if (prEke && prEkeValue) {
        const eke = engine.params?.diffusivityScale || 1.0;
        prEke.value = eke;
        prEkeValue.textContent = eke.toFixed(1) + 'x';
    }

    // Update the stats panel with current data
    updateStatsDisplay();
}

function refreshVisualization() {
    if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
        const particles = bakeSystem.interpolateParticles();
        if (visualizationMode === 'concentration') {
            updateDeckGLHeatmap(particles);
        } else {
            updateDeckGLParticles(particles);
        }
        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }
    }
}

function updateCanvasOverlay() {
    if (particleCanvas && particleCanvas.updateParticles && engine) {
        const particles = engine.getActiveParticles();
        particleCanvas.updateParticles(particles);
    }
}

// ============================================================================
// LEGEND
// ============================================================================

function createHeatmapColorLegend() {
    // Remove old legend
    const oldLegend = document.getElementById('concentration-legend');
    if (oldLegend) oldLegend.remove();

    // Create container
    const legendDiv = document.createElement('div');
    legendDiv.id = 'concentration-legend';
    legendDiv.style.cssText = `
        position: absolute;
        bottom: 25px;
        right: 25px;
        background: rgba(15, 30, 45, 0.95);
        border: 2px solid #4fc3f7;
        border-radius: 8px;
        padding: 15px;
        width: 240px;
        color: white;
        font-family: monospace;
        z-index: 9999;
    `;

    // Build HTML
    let html = '<div style="text-align:center; margin-bottom:10px;"><h3 style="margin:0; color:#4fc3f7;">Cs-137 Concentration</h3></div>';
    html += '<div style="display:flex; gap:10px;">';

    // Color bars
    html += '<div style="flex:1; display:flex; flex-direction:column; gap:2px;">';
    const colors = [
        '#ffd801', '#ff9a00', '#ff6a00', '#ff2900',
        '#ff736b', '#fcb8c5', '#8d8ed5', '#4473e3',
        '#7899e3', '#a2baf4', '#c3d1f7', '#e7ecfb'
    ];
    for (let i = 0; i < 12; i++) {
        html += `<div style="background: ${colors[i]}; height: 20px; width: 100%;"></div>`;
    }
    html += '</div>';

    // Value labels
    html += '<div style="flex:2; display:flex; flex-direction:column; gap:2px; text-align:right;">';
    for (let i = 0; i < 12; i++) {
        html += `<div id="legend-val-${i}" style="background: rgba(0,0,0,0.3); padding: 2px 5px; height: 20px; line-height: 20px;">-</div>`;
    }
    html += '</div>';


    legendDiv.innerHTML = html;
    document.getElementById('map-container').appendChild(legendDiv);

    console.log('Legend created');
}

function updateHeatmapLegend(minVal, maxVal) {
    console.log('updateHeatmapLegend called with:', minVal, maxVal);

    const minBq = minVal * 1e9;
    const maxBq = maxVal * 1e9;

    const logMin = Math.log10(Math.max(minBq, 1e-30));
    const logMax = Math.log10(maxBq);

    for (let i = 0; i < 12; i++) {
        const t = i / 11;
        const logVal = logMax - t * (logMax - logMin);
        const conc = Math.pow(10, logVal);

        const label = document.getElementById(`legend-val-${i}`);
        if (label) {
            if (conc >= 1000) {
                label.textContent = (conc/1000).toFixed(2) + ' kBq/m³';
            } else if (conc >= 1) {
                label.textContent = conc.toFixed(2) + ' Bq/m³';
            } else {
                label.textContent = (conc*1000).toFixed(2) + ' mBq/m³';
            }
        }
    }

}

function addLegendStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #concentration-legend {
            position: absolute;
            bottom: 25px;
            right: 25px;
            background: rgba(15, 30, 45, 0.95);
            border: 1px solid rgba(79, 195, 247, 0.3);
            border-radius: 12px;
            padding: 16px;
            width: 260px;
            color: white;
            font-family: 'Segoe UI', sans-serif;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(8px);
            z-index: 1000;
        }

        .legend-header {
            text-align: center;
            margin-bottom: 15px;
        }

        .legend-header h4 {
            margin: 5px 0 3px 0;
            color: #4fc3f7;
            font-size: 15px;
        }

        .legend-subtitle {
            font-size: 10px;
            color: #b0bec5;
        }

        .legend-main {
            display: flex;
            height: 260px;
            margin: 10px 0;
            gap: 10px;
        }

        .color-bars-container {
            flex: 3;
            display: flex;
            flex-direction: column;
            gap: 2px;
            border-radius: 4px;
            overflow: hidden;
        }

        .color-bar {
            flex: 1;
            width: 100%;
            min-height: 18px; /* Ensure minimum height */
            transition: transform 0.2s;
        }

        .color-bar:hover {
            transform: scaleX(1.05);
            box-shadow: 0 0 10px rgba(255,255,255,0.3);
        }

        .value-labels-container {
            flex: 4;
            display: flex;
            flex-direction: column;
            justify-content: flex-start; /* Change from space-between */
            gap: 4px; /* Add consistent gap */
            font-size: 10px;
            font-family: 'Courier New', monospace;
            text-align: right;
            overflow: visible;
        }

        .value-label {
            padding: 2px 5px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 3px;
            white-space: nowrap;
            height: 18px; /* Fixed height */
            line-height: 18px; /* Match height for vertical centering */
            box-sizing: border-box;
        }

        .legend-footer {
            margin-top: 12px;
            padding-top: 8px;
            border-top: 1px solid rgba(255,255,255,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 10px;
            color: #b0bec5;
        }

        .legend-date {
            color: #4fc3f7;
        }

        .legend-note {
            font-style: italic;
        }
    `;
    document.head.appendChild(style);
}

// ============================================================================
// LEAFLET PARTICLE CANVAS
// ============================================================================

function createCanvasOverlay() {
    const particleLayer = L.layerGroup();
    window.particleMarkers = [];

    particleLayer.updateParticles = function(particles) {
        this.clearLayers();
        window.particleMarkers = [];

        if (visualizationMode !== 'particles' || !engine) return;

        const limit = Math.min(particles.length, 2000);

        for (let i = 0; i < limit; i++) {
            const p = particles[i];

            // Skip invalid particles
            if (!p || isNaN(p.x) || isNaN(p.y)) continue;

            const lon = engine.REFERENCE_LON + (p.x / engine.LON_SCALE);
            const lat = engine.REFERENCE_LAT + (p.y / engine.LAT_SCALE);

            if (Math.abs(lat) > 90) continue;

            const color = getCanvasParticleColor(p);

            let radius = 2;

            // Scale by concentration (log scale)
            if (p.concentration && p.concentration > 0) {
                const logConc = Math.log10(p.concentration);
                radius = Math.min(4, Math.max(1, 1 + logConc * 0.5));
            }

            const marker = L.circleMarker([lat, lon], {
                radius: radius,
                color: color,
                fillColor: color,
                fillOpacity: 0.7,
                weight: 0.5,
                opacity: 0.6
            });

            marker.addTo(this);
        }
    };

    particleLayer.clearAllParticles = function() {
        this.clearLayers();
        window.particleMarkers = [];
    };

    return particleLayer;
}

function getCanvasParticleColor(p) {
    if (!p.concentration) return '#ffffff';

    const concentration = Math.max(p.concentration, 1e-9);
    const logConc = Math.log10(concentration);

    // Map to your beautiful color scheme
    if (logConc < -3) return '#e7ecfb';
    if (logConc < -2) return '#c3d1f7';
    if (logConc < -1) return '#a2baf4';
    if (logConc < 0) return '#7899e3';
    if (logConc < 1) return '#4473e3';
    if (logConc < 2) return '#8d8ed5';
    if (logConc < 3) return '#fcb8c5';
    if (logConc < 4) return '#ff736b';
    if (logConc < 5) return '#ff2900';
    if (logConc < 6) return '#ff6a00';
    if (logConc < 7) return '#ff9a00';
    return '#ffd801';
}

// ============================================================================
// TRACER UI
// ============================================================================

function setupTracerUI() {
    const tracerSelect = document.getElementById('tracer-select');
    if (!tracerSelect) return;

    // Update tracer info when selection changes
    tracerSelect.addEventListener('change', (e) => {
        const tracerId = e.target.value;
        const tracer = TracerLibrary[tracerId];

        if (tracer) {
            document.getElementById('tracer-type').textContent =
                tracer.type.charAt(0).toUpperCase() + tracer.type.slice(1);

            if (tracer.halfLife) {
                const years = (tracer.halfLife / 365).toFixed(1);
                document.getElementById('tracer-halfLife').textContent =
                    `${years} years (${tracer.halfLife} days)`;
            } else {
                document.getElementById('tracer-halfLife').textContent = 'N/A';
            }

            let behavior = 'Standard';
            if (tracer.behavior.settlingVelocity > 0) behavior = 'Sinking';
            if (tracer.behavior.settlingVelocity < 0) behavior = 'Floating';
            if (tracer.behavior.evaporation) behavior = 'Evaporative';
            document.getElementById('tracer-behavior').textContent = behavior;

            // Update release manager
            if (engine) {
                engine.tracerId = tracerId;
                engine.tracer = tracer;
                engine.calculateParticleCalibration();
            }
        }
    });

    // Setup phase editor
    setupPhaseEditor();
}

function setupPhaseEditor() {
    phaseContainer = document.getElementById('phase-container');
    const addBtn = document.getElementById('add-phase-btn');

    if (!phaseContainer || !addBtn) return;

    let phaseCount = 0;

    function createPhaseElement(phaseData = null) {
        const phaseDiv = document.createElement('div');
        phaseDiv.className = 'phase-card';
        phaseDiv.style.cssText = `
            background: rgba(79,195,247,0.1);
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 10px;
        `;

        phaseDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: #b0bec5;">Phase ${phaseCount + 1}</span>
                <button class="remove-phase" style="background: none; border: none; color: #ff6b6b; cursor: pointer; font-size: 16px;">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                <div style="flex: 1;">
                    <label style="font-size: 11px;">Start Day</label>
                    <input type="number" class="phase-start" min="0" max="730" value="${phaseData?.start || 0}"
                           style="width: 100%; background: rgba(0,0,0,0.3); color: #4fc3f7; border: 1px solid rgba(79,195,247,0.3); border-radius: 4px; padding: 5px;">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 11px;">End Day</label>
                    <input type="number" class="phase-end" min="0" max="730" value="${phaseData?.end || 30}"
                           style="width: 100%; background: rgba(0,0,0,0.3); color: #4fc3f7; border: 1px solid rgba(79,195,247,0.3); border-radius: 4px; padding: 5px;">
                </div>
            </div>
            <div style="display: flex; gap: 10px;">
                <div style="flex: 2;">
                    <label style="font-size: 11px;">Total Release</label>
                    <input type="number" class="phase-total" min="0" value="${phaseData?.total || 10}"
                           style="width: 100%; background: rgba(0,0,0,0.3); color: #4fc3f7; border: 1px solid rgba(79,195,247,0.3); border-radius: 4px; padding: 5px;">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 11px;">Unit</label>
                    <select class="phase-unit" style="width: 100%; background: rgba(0,0,0,0.3); color: #4fc3f7; border: 1px solid rgba(79,195,247,0.3); border-radius: 4px; padding: 5px;">
                        <option value="PBq" ${phaseData?.unit === 'PBq' ? 'selected' : ''}>PBq</option>
                        <option value="TBq" ${phaseData?.unit === 'TBq' ? 'selected' : ''}>TBq</option>
                        <option value="GBq" ${phaseData?.unit === 'GBq' ? 'selected' : ''}>GBq</option>
                    </select>
                </div>
            </div>
            <div style="margin-top: 8px; font-size: 11px; color: #78909c; text-align: right;">
                Rate: <span class="phase-rate-display">33.3 GBq/day</span>
            </div>
        `;

        // Update rate display
        const updateRateDisplay = () => {
            const start = parseFloat(phaseDiv.querySelector('.phase-start').value) || 0;
            const end = parseFloat(phaseDiv.querySelector('.phase-end').value) || 0;
            const total = parseFloat(phaseDiv.querySelector('.phase-total').value) || 0;
            const unit = phaseDiv.querySelector('.phase-unit').value;

            const days = Math.max(1, end - start);
            const rate = total / days;

            let rateDisplay = '';
            if (unit === 'PBq') rateDisplay = `${rate.toFixed(2)} PBq/day`;
            else if (unit === 'TBq') rateDisplay = `${rate.toFixed(2)} TBq/day`;
            else if (unit === 'GBq') rateDisplay = `${rate.toFixed(2)} GBq/day`;
            else rateDisplay = `${rate.toFixed(2)} kg/day`;

            phaseDiv.querySelector('.phase-rate-display').textContent = rateDisplay;
        };

        // Validation function
        const validatePhase = (start, end) => {
            if (end <= start) {
                return {
                    valid: false,
                    message: 'End day must be greater than start day'
                };
            }
            if (start < 0) {
                return {
                    valid: false,
                    message: 'Start day cannot be negative'
                };
            }
            return { valid: true };
        };

        // Update max attribute based on total days
        const totalDays = totalSimulationDays || 731;
        phaseDiv.querySelector('.phase-start').max = totalDays;
        phaseDiv.querySelector('.phase-end').max = totalDays;

        // Add input handlers with validation
        phaseDiv.querySelectorAll('input, select').forEach(el => {
            el.addEventListener('input', () => {
                const start = parseInt(phaseDiv.querySelector('.phase-start').value) || 0;
                const end = parseInt(phaseDiv.querySelector('.phase-end').value) || 0;

                const validation = validatePhase(start, end);
                if (!validation.valid) {
                    // Highlight in red
                    phaseDiv.style.border = '2px solid #ff6b6b';
                    phaseDiv.setAttribute('title', validation.message);

                    // Disable start button
                    const startBtn = document.getElementById('btn-start-prerender');
                    if (startBtn) startBtn.disabled = true;
                } else {
                    phaseDiv.style.border = 'none';
                    phaseDiv.removeAttribute('title');

                    // Re-enable start button (only if all phases valid)
                    const allPhases = document.querySelectorAll('.phase-card');
                    let allValid = true;
                    allPhases.forEach(phase => {
                        const s = parseInt(phase.querySelector('.phase-start').value) || 0;
                        const e = parseInt(phase.querySelector('.phase-end').value) || 0;
                        if (e <= s) allValid = false;
                    });

                    const startBtn = document.getElementById('btn-start-prerender');
                    if (startBtn) startBtn.disabled = !allValid;
                }

                updateRateDisplay();
                updateReleaseStats();
                syncPhasesToEngine();
            });
        });

        // Remove handler
        const removeBtn = phaseDiv.querySelector('.remove-phase');
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (phaseContainer.children.length <= 1) {
                alert('You must keep at least one release phase');
                return;
            }

            phaseDiv.remove();

            // Update phase numbers
            const remainingPhases = phaseContainer.querySelectorAll('.phase-card');
            remainingPhases.forEach((phase, index) => {
                const phaseSpan = phase.querySelector('div:first-child span:first-child');
                if (phaseSpan) {
                    phaseSpan.textContent = `Phase ${index + 1}`;
                }
            });

            updateReleaseStats();
            syncPhasesToEngine();
        });

        // Initial rate display
        updateRateDisplay();

        return phaseDiv;
    }

    // Add initial phase
    phaseContainer.appendChild(createPhaseElement());

    // Add phase button
    addBtn.addEventListener('click', () => {
        phaseCount++;
        phaseContainer.appendChild(createPhaseElement());
        updateReleaseStats();
        syncPhasesToEngine();
    });

    // Initial sync
    setTimeout(() => {
        updateReleaseStats();
        syncPhasesToEngine();
    }, 500);
}

function updateReleaseStats() {
    if (!engine || !phaseContainer) return;

    const phases = [];
    document.querySelectorAll('.phase-card').forEach(card => {
        const start = parseInt(card.querySelector('.phase-start').value) || 0;
        const end = parseInt(card.querySelector('.phase-end').value) || 0;
        const total = parseFloat(card.querySelector('.phase-total').value) || 0;
        const unit = card.querySelector('.phase-unit').value;

        phases.push({ start, end, total, unit });
    });

    // Get the actual particle count from the slider
    let particleCount = 10000; // Default
    const prParticles = document.getElementById('pr-particles');
    if (prParticles) {
        particleCount = parseInt(prParticles.value) || 10000;
    }

    // Calculate total in base unit
    let grandTotalInBase = 0;
    phases.forEach(p => {
        let valueInBase = p.total;
        if (p.unit === 'TBq') valueInBase *= 1000;
        if (p.unit === 'PBq') valueInBase *= 1e6;
        grandTotalInBase += valueInBase;
    });

    // Calculate units per particle (this is constant for all phases)
    const unitsPerParticle = grandTotalInBase / particleCount;

    // Format total display
    let totalDisplay = '';
    const hasPBq = phases.some(p => p.unit === 'PBq');
    const hasTBq = phases.some(p => p.unit === 'TBq');
    const hasGBq = phases.some(p => p.unit === 'GBq');

    if (hasPBq) {
        let totalPBq = 0;
        phases.forEach(p => {
            if (p.unit === 'PBq') totalPBq += p.total;
            else if (p.unit === 'TBq') totalPBq += p.total / 1000;
            else if (p.unit === 'GBq') totalPBq += p.total / 1e6;
        });
        totalDisplay = `${totalPBq.toFixed(2)} PBq`;
    } else if (hasTBq) {
        let totalTBq = 0;
        phases.forEach(p => {
            if (p.unit === 'TBq') totalTBq += p.total;
            else if (p.unit === 'GBq') totalTBq += p.total / 1000;
        });
        totalDisplay = `${totalTBq.toFixed(2)} TBq`;
    } else if (hasGBq) {
        let totalGBq = 0;
        phases.forEach(p => {
            if (p.unit === 'GBq') totalGBq += p.total;
        });
        totalDisplay = `${totalGBq.toFixed(2)} GBq`;
    }

    const totalElement = document.getElementById('total-release');
    if (totalElement) totalElement.textContent = totalDisplay;

    // Find current or next phase
    const currentDay = engine.stats?.simulationDays || 0;
    let activePhase = null;
    let nextPhase = null;

    // First, check for active phase
    for (const phase of phases) {
        if (currentDay >= phase.start && currentDay <= phase.end) {
            activePhase = phase;
            break;
        }
    }

    // If no active phase, find the next upcoming phase
    if (!activePhase) {
        let smallestStart = Infinity;
        for (const phase of phases) {
            if (phase.start > currentDay && phase.start < smallestStart) {
                smallestStart = phase.start;
                nextPhase = phase;
            }
        }
    }

    const rateElement = document.getElementById('current-rate');
    const particlesElement = document.getElementById('particles-per-day');

    // Get the phase to display (either active or next)
    const displayPhase = activePhase || nextPhase;

    if (displayPhase) {
        const days = Math.max(1, displayPhase.end - displayPhase.start);
        const rateInOriginalUnits = displayPhase.total / days;

        // Format rate display
        let rateDisplay = '';
        if (displayPhase.unit === 'PBq') {
            rateDisplay = `${rateInOriginalUnits.toFixed(2)} PBq/day`;
        } else if (displayPhase.unit === 'TBq') {
            rateDisplay = `${rateInOriginalUnits.toFixed(2)} TBq/day`;
        } else if (displayPhase.unit === 'GBq') {
            rateDisplay = `${rateInOriginalUnits.toFixed(2)} GBq/day`;
        } else {
            rateDisplay = `${rateInOriginalUnits.toFixed(2)} kg/day`;
        }

        if (rateElement) {
            rateElement.textContent = rateDisplay;
        }

        // Calculate particles per day for THIS phase
        let rateInBase = rateInOriginalUnits;
        if (displayPhase.unit === 'TBq') rateInBase *= 1000;
        if (displayPhase.unit === 'PBq') rateInBase *= 1e6;

        if (unitsPerParticle > 0 && particlesElement) {
            const particlesPerDay = rateInBase / unitsPerParticle;
            particlesElement.textContent = Math.round(particlesPerDay).toLocaleString();
        }

    } else {
        // No phases
        if (rateElement) {
            rateElement.textContent = 'No release scheduled';
            rateElement.style.color = '#b0bec5';
        }
        if (particlesElement) particlesElement.textContent = '0';
    }
}

function syncPhasesToEngine() {
    if (!engine || !engine.releaseManager || !phaseContainer) return;

    const phases = [];
    document.querySelectorAll('.phase-card').forEach(card => {
        const start = parseInt(card.querySelector('.phase-start').value) || 0;
        const end = parseInt(card.querySelector('.phase-end').value) || 0;
        const total = parseFloat(card.querySelector('.phase-total').value) || 0;
        const unit = card.querySelector('.phase-unit').value;

        phases.push(new ReleasePhase(start, end, total, unit));
    });

    // Set the phases in the engine WITHOUT recalibrating
    engine.releaseManager.phases = phases;

    // Update the stats display
    updateReleaseStats();
}

// ============================================================================
// ANIMATION LOOP
// ============================================================================

function animate() {
    if (simulationMode === 'baked' && bakeSystem) {
        updateDateTimeDisplay();
        updateStatsDisplay();
    }
    animationId = requestAnimationFrame(animate);
}

// ============================================================================
// PRE-RENDER PROGRESS
// ============================================================================

function showPreRenderProgress() {
    const progress = document.getElementById('pr-progress');
    if (progress) progress.style.display = 'block';

    const btn = document.getElementById('btn-start-prerender');
    if (btn) btn.disabled = true;
}

function hidePreRenderProgress() {
    const progress = document.getElementById('pr-progress');
    if (progress) progress.style.display = 'none';

    const btn = document.getElementById('btn-start-prerender');
    if (btn) btn.disabled = false;
}

function updatePreRenderProgress(percent, message) {
    const bar = document.getElementById('pr-progress-bar');
    const msg = document.getElementById('pr-progress-message');
    const pct = document.getElementById('pr-progress-percent');

    if (bar) bar.style.width = percent + '%';
    if (msg) msg.textContent = message || 'Processing...';
    if (pct) pct.textContent = Math.round(percent) + '%';
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatConcentration(value) {
    if (value >= 1e6) return `${(value/1e6).toFixed(2)} MBq/m³`;
    if (value >= 1e3) return `${(value/1e3).toFixed(2)} kBq/m³`;
    if (value >= 1) return `${value.toFixed(2)} Bq/m³`;
    if (value >= 1e-3) return `${(value*1e3).toFixed(2)} mBq/m³`;
    return `${(value*1e6).toFixed(2)} μBq/m³`;
}

function addMapControls(map) {
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
}

function showDataWarning(message) {
    const warningElement = document.getElementById('dataWarning') || createWarningElement();
    warningElement.innerHTML = `⚠️ ${message}`;
    warningElement.style.display = 'block';

    setTimeout(() => {
        warningElement.style.opacity = '0';
        setTimeout(() => {
            warningElement.style.display = 'none';
            warningElement.style.opacity = '1';
        }, 500);
    }, 5000);
}

function createWarningElement() {
    const warning = document.createElement('div');
    warning.id = 'dataWarning';
    warning.style.cssText = `
        position: fixed;
        top: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 193, 7, 0.9);
        color: #333;
        padding: 15px 25px;
        border-radius: 8px;
        font-family: 'Segoe UI', sans-serif;
        font-size: 14px;
        z-index: 9999;
        text-align: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        transition: opacity 0.5s;
    `;
    document.body.appendChild(warning);
    return warning;
}

function showErrorMessage(message) {
    const errorElement = document.createElement('div');
    errorElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(220, 53, 69, 0.95);
        color: white;
        padding: 25px 35px;
        border-radius: 10px;
        font-family: 'Segoe UI', sans-serif;
        font-size: 16px;
        z-index: 10000;
        text-align: center;
        max-width: 80%;
        box-shadow: 0 8px 25px rgba(0,0,0,0.3);
    `;
    errorElement.innerHTML = `
        <div style="font-size: 24px; margin-bottom: 10px;">❌ Error</div>
        <div>${message}</div>
        <button onclick="this.parentElement.remove()" style="
            margin-top: 15px;
            background: white;
            color: #dc3545;
            border: none;
            padding: 8px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
        ">Dismiss</button>
    `;
    document.body.appendChild(errorElement);
}

function createStatusElement() {
    const status = document.createElement('div');
    status.id = 'loadingStatus';
    status.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(10, 25, 41, 0.95);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        color: white;
        font-family: 'Segoe UI', sans-serif;
        text-align: center;
        z-index: 9999;
        transition: opacity 0.5s ease;
    `;

    status.innerHTML = `
        <div style="font-size: 24px; color: #4fc3f7; margin-bottom: 20px;">
            🌊 Loading PROTEUS
        </div>
        <div id="loadingMessage" style="font-size: 18px; margin-bottom: 30px;">
            Initializing...
        </div>
        <div style="width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px;">
            <div id="loadingBar" style="width: 0%; height: 100%; background: #4fc3f7; border-radius: 2px; transition: width 0.3s;"></div>
        </div>
        <div style="margin-top: 30px; font-size: 14px; color: #b0bec5;">
            HYCOM 2011-2013 · AVISO EKE
        </div>
    `;

    document.body.appendChild(status);
    return status;
}

function updateLoadingStatus(message, progress = 0) {
    const statusElement = document.getElementById('loadingStatus');
    if (!statusElement) return;

    const messageElement = document.getElementById('loadingMessage');
    const barElement = document.getElementById('loadingBar');

    if (messageElement) {
        messageElement.textContent = `⚙️ ${message}`;
    }

    if (barElement) {
        barElement.style.width = `${Math.min(100, progress)}%`;
    }

    if (progress >= 100) {
        setTimeout(hideLoadingStatus, 500);
    }
}

function hideLoadingStatus() {
    const statusElement = document.getElementById('loadingStatus');
    if (statusElement) {
        statusElement.style.opacity = '0';
        setTimeout(() => {
            if (statusElement.parentNode) {
                statusElement.parentNode.removeChild(statusElement);
            }
        }, 500);
    }
}

// ============================================================================
// START APPLICATION
// ============================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 100);
}
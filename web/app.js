// web/app.js - COMPLETE WORKING VERSION WITH NEW FEATURES
console.log('=== app.js STARTING WITH HYBRID VISUALIZATION ===');

// Global variables
let engine = null;
let animationId = null;
let simulationMode = 'baked'; // 'realtime' or 'baked'
// Leaflet globals
let simMap = null;
let particleCanvas = null;
// Add with other global variables
let showParticleTrails = true;
// Deck.gl globals
let deckgl = null;
let showHeatmap = true;

let bakeSystem = null;
let currentBakedParticles = [];

let phaseContainer = null;
let statsInterval = null;

let mapClickEnabled = false;
let locationMarker = null;
// Add with other global variables
let currentDepth = 0; // 0 = surface
const depthLevels = [0, 50, 100, 200, 500, 1000]; // Match your HYCOM depths
const ALL_DEPTHS = -1;
// Visualization mode
let visualizationMode = 'concentration'; // 'concentration' or 'particles'

// Heatmap parameters
let heatmapParams = {
    intensity: 1.0,
    radiusPixels: 75,
    opacity: 0.9,
    threshold: 0.001,
    useLogScale: true,
    gridSize: 0.5
};

let simulationStartDate = new Date('2011-03-01T00:00:00Z'); // Now configurable
let simulationEndDate = new Date('2013-02-28T00:00:00Z');   // End date
let currentSimulationDate = new Date(simulationStartDate);
let simulationDay = 0;
let totalSimulationDays = 731; // Will be recalculated

// Heatmap data cache
let lastHeatmapUpdate = 0;
const HEATMAP_UPDATE_INTERVAL = 500; // ms between updates
// Add these with other global variables at the top
const CONCENTRATION_RANGE = {
    min: 1e-6,      // 1 μBq/m³
    max: 1e6        // 1 MBq/m³
};

async function init() {
    console.log('=== INITIALIZATION WITH IMPROVED VISUALIZATION ===');

    // Create loading screen
    const loadingStatus = createStatusElement();
    updateLoadingStatus('Initializing...', 10);

    try {
        // 1. CREATE LEAFLET MAP
        updateLoadingStatus('Creating map...', 20);
        console.log('Creating Leaflet map...');
        simMap = L.map('map', {
            center: [35.0, 180.0],
            zoom: 4, // Fixed zoom level (adjust as needed)
            minZoom: 4, // Same as zoom = locked
            maxZoom: 4, // Same as zoom = locked
            zoomControl: false, // Remove zoom controls
            scrollWheelZoom: false, // Disable mouse wheel zoom
            doubleClickZoom: false, // Disable double-click zoom
            boxZoom: false, // Disable shift-drag zoom
            keyboard: false, // Disable keyboard zoom
            touchZoom: false, // Disable pinch zoom on mobile
            dragging: false, // Also disable panning if you want
            worldCopyJump: true,
            attributionControl: true,
            maxBounds: [[-90, -180], [90, 360]]
        });

        // 2. ADD BASEMAP
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap, © CARTO',
            maxZoom: 8
        }).addTo(simMap);

        // 3. CREATE PARTICLE OVERLAY
        updateLoadingStatus('Creating visualization...', 30);
        console.log('Creating particle overlay...');
        particleCanvas = createCanvasOverlay();
        simMap.addLayer(particleCanvas);

        // 4. INITIALIZE DECK.GL
        updateLoadingStatus('Initializing WebGL...', 40);
        console.log('Initializing deck.gl overlay...');
        await initDeckGL();

        // 5. INITIALIZE PARTICLE ENGINE WITH 3D PHYSICS
        updateLoadingStatus('Loading ocean data...', 50);
        if (typeof ParticleEngine === 'function') {
            engine = new ParticleEngine(10000);
            window.engine = engine;

            // DEBUG: Check what class we're using
            console.log(`🔍 Engine constructor: ${engine.constructor.name}`);
            console.log(`🔍 Has enableRK4 method: ${typeof engine.enableRK4 === 'function'}`);

            // ENABLE RK4 IF AVAILABLE
            if (typeof engine.enableRK4 === 'function') {
                engine.enableRK4(false);
                console.log('✅ RK4 integration enabled');
            } else {
                console.warn('⚠️ RK4 not available in this ParticleEngine version');
            }

            console.log('Loading HYCOM ocean currents...');
            try {
                const success = await engine.init();
                if (!success) {
                    console.warn('Using fallback data');
                    showDataWarning('Using fallback diffusion data');
                }
            } catch (error) {
                console.error('Engine init failed:', error);
                showErrorMessage('Failed to load data. Using fallback.');
            }
        } else {
            console.error('ParticleEngine not found!');
            showErrorMessage('ParticleEngine class not loaded');
            return false;
        }
        // In your init() function, where you create bakeSystem
        bakeSystem = new BakeSystem();

        // In app.js, when setting up bakeSystem, make sure the event names match
        bakeSystem.on('frame', (frameData) => {
            console.log('🎬 Frame received at day:', frameData.day);
            currentBakedParticles = frameData.particles;

            if (visualizationMode === 'concentration') {
                updateDeckGLHeatmap(currentBakedParticles);
            } else {
                updateDeckGLParticles(currentBakedParticles);
            }

            if (particleCanvas && particleCanvas.updateParticles) {
                particleCanvas.updateParticles(currentBakedParticles);
            }

            updateDateTimeDisplay();
        });

        if (bakeSystem) {
            bakeSystem.on('bakeProgress', (progress) => {
                updatePreRenderProgress(progress.percent, progress.message);
            });

            bakeSystem.on('bakeComplete', (info) => {
                console.log('✅ Pre-render complete!', info);
                hidePreRenderProgress();
            });
        }

        // 6. ADD MAP CONTROLS
        updateLoadingStatus('Adding controls...', 70);
        addMapControls(simMap);

        // 7. SET UP CONTROLS
        updateLoadingStatus('Finalizing...', 90);
        setupVisualizationMode();
        updateUIForEngine();
        updateDateTimeDisplay();
        createHeatmapColorLegend();
        setupTrailToggle();
        setupUIModeSwitching();
        setupSliderValueDisplays();
        setupPreRenderButton();
        setupRealtimeControls();
        setupPlaybackControls();
        setupTracerUI();
        setupLocationPicker();
        setupDateRange();

        if (statsInterval) clearInterval(statsInterval);
        statsInterval = setInterval(updateReleaseStats, 1000);

        // 8. ADD MAP EVENT LISTENERS
        simMap.on('move resize zoom', function() {
            updateDeckGLView();
            updateCanvasOverlay();
        });

        // 9. START ANIMATION
        updateLoadingStatus('Ready!', 100);
        setTimeout(() => {
            hideLoadingStatus();
            animate();
        }, 500);

        console.log('✅ Particle Engine with improved visualization initialized');
        return true;

    } catch (error) {
        console.error('Initialization failed:', error);
        showErrorMessage(`Initialization failed: ${error.message}`);
        hideLoadingStatus();
        return false;
    }
}


async function initDeckGL() {
    // Check if deck.gl is loaded
    if (typeof deck === 'undefined') {
        console.error('deck.gl not loaded! Check script tags.');
        return;
    }

    try {
        // Get the canvas element
        const canvas = document.getElementById('deckgl-overlay');
        if (!canvas) {
            throw new Error('deckgl-overlay canvas not found');
        }

        // Set canvas size
        const width = window.innerWidth - 360;
        const height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;

        // Initial view state
        const initialViewState = {
            longitude: 165.0,
            latitude: 25.0,
            zoom: 3,
            pitch: 0,
            bearing: 0
        };

        // Create deck.gl instance
        deckgl = new deck.Deck({
            canvas: canvas,
            initialViewState: initialViewState,
            controller: false,
            layers: [],
            parameters: {
                blend: true,
                blendFunc: [0x0302, 0x0303],
                clearColor: [0, 0, 0, 0]
            }
        });

        // Sync deck.gl with Leaflet view
        updateDeckGLView();

        // Handle window resize
        window.addEventListener('resize', handleResize);

        console.log('✅ deck.gl initialized successfully');

    } catch (error) {
        console.error('Failed to initialize deck.gl:', error);
        console.warn('Running in Leaflet-only mode');
        showDataWarning('WebGL heatmap not available. Using particles only.');
    }
}

function handleResize() {
    if (!deckgl) return;

    const canvas = document.getElementById('deckgl-overlay');
    if (!canvas) return;

    const width = window.innerWidth - 360;
    const height = window.innerHeight;

    canvas.width = width;
    canvas.height = height;

    updateDeckGLView();
}

function updateDeckGLView() {
    if (!deckgl || !simMap) return;

    const center = simMap.getCenter();
    const zoom = simMap.getZoom();

    // Convert Leaflet zoom to deck.gl zoom
    const deckZoom = Math.max(0, zoom - 1);

    // Update deck.gl view state
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

    // Force redraw
    deckgl.redraw();
}

// ==================== CONCENTRATION HEATMAP ====================

function createConcentrationGrid(particles, gridSize = 0.5) {
    if (!engine || !particles || particles.length === 0) {
        console.log('❌ Grid: no particles or engine');
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

    console.log('📊 Grid stats:', {
        particles: particles.length,
        valid: validParticles,
        cells: grid.size,
        totalConc: totalConcentration.toExponential(2)
    });

    return Array.from(grid.values());
}
// ==================== ENHANCED HEATMAP WITH DYNAMIC SCALING ====================

function updateDeckGLHeatmap(particles) {
    // Debug logging
    console.log('🔍 HEATMAP DEBUG:', {
        deckglExists: !!deckgl,
        particleCount: particles?.length,
        mode: visualizationMode
    });

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
        console.log(`🌡️ Depth ${currentDepth}m: Using ${particlesToUse.length}/${particles.length} particles`);
    }

    // Throttle updates
    const now = Date.now();
    if (now - lastHeatmapUpdate < HEATMAP_UPDATE_INTERVAL) return;
    lastHeatmapUpdate = now;

    // Create concentration grid
    const gridData = createConcentrationGrid(particlesToUse, heatmapParams.gridSize);

    if (gridData.length === 0) {
        console.log('⚠️ No grid cells generated');
        deckgl.setProps({ layers: [] });
        return;
    }

    // ===== STEP 1: Calculate ACTUAL min/max concentrations =====
    const concentrations = gridData.map(cell => cell.concentration);
    const actualMin = Math.min(...concentrations);
    const actualMax = Math.max(...concentrations);

    console.log('📊 Concentration range:', {
        min: formatConcentration(actualMin),
        max: formatConcentration(actualMax)
    });

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

    // Log sample to verify scaling
    console.log('📊 Normalized data sample:', heatmapData.slice(0, 3));

    // ===== STEP 5: Create heatmap layer with normalized weights =====
    try {
        console.log('🎨 Creating heatmap layer...');

        const heatmapLayer = new deck.HeatmapLayer({
            id: 'concentration-heatmap',
            data: heatmapData,
            getPosition: d => d.position,
            getWeight: d => d.weight,  // Now normalized 0-1
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

        console.log('✅ Heatmap layer updated');

    } catch (error) {
        console.error('❌ Failed to create heatmap layer:', error);
    }
}
// ==================== LEGEND UPDATE ====================

function updateHeatmapLegend(minVal, maxVal) {
    // Convert from GBq/m³ to Bq/m³
    const minBq = minVal * 1e9;
    const maxBq = maxVal * 1e9;

    // Calculate a middle value (geometric mean for log scale)
    const midBq = Math.sqrt(minBq * maxBq);

    document.getElementById('legend-min').textContent = formatConcentration(minBq);
    document.getElementById('legend-mid').textContent = formatConcentration(midBq);
    document.getElementById('legend-max').textContent = formatConcentration(maxBq);
}

function createLegendRange() {
    const legend = document.querySelector('.map-legend');
    if (!legend) return;

    const rangeDiv = document.createElement('div');
    rangeDiv.className = 'legend-range';
    rangeDiv.style.cssText = `
        display: flex;
        justify-content: space-between;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.2);
        font-family: 'Courier New', monospace;
        font-size: 11px;
    `;

    rangeDiv.innerHTML = `
        <span id="legend-min">1 μBq/m³</span>
        <span>→</span>
        <span id="legend-max">1 MBq/m³</span>
    `;

    legend.appendChild(rangeDiv);
}
// ==================== PARTICLE TRAIL VISUALIZATION ====================

function updateDeckGLParticles(particles) {
    if (!deckgl || particles.length === 0 || visualizationMode !== 'particles') {
        deckgl.setProps({ layers: [] });
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
            console.log(`🎯 Depth ${currentDepth}m: Showing ${particlesToUse.length}/${particles.length} particles`);
        } else {
            console.log(`🎯 All Depths: Showing all ${particles.length} particles`);
        }

        const particleData = [];
        const trailData = [];

        // Get reference coordinates
        const refLon = engine ? engine.REFERENCE_LON : 142.03;
        const refLat = engine ? engine.REFERENCE_LAT : 37.42;
        const lonScale = engine ? engine.LON_SCALE : 88.8;
        const latScale = engine ? engine.LAT_SCALE : 111.0;

        for (const p of particlesToUse) { // Use particlesToUse instead of filteredParticle
            // Check if particle is valid - handle BOTH realtime AND baked formats
            const isValid = p.active === undefined ? true : p.active; // Baked particles don't have 'active'
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

            // Add trail if enabled - handle both history formats
            if (showParticleTrails) {
                // Check for both possible history formats
                let history = p.history;

                // If no history array but we have historyX/Y arrays (from bake system)
                if (!history && p.historyX && p.historyLength > 0) {
                    history = [];
                    for (let i = 0; i < p.historyLength; i++) {
                        history.push({
                            x: p.historyX[i],
                            y: p.historyY[i]
                        });
                    }
                }

                if (history && history.length > 1) {
                    const positions = history.map(h => {
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

        console.log(`🎯 Rendering ${particleData.length} particles, ${trailData.length} trails`);

        const layers = [];

        if (showParticleTrails && trailData.length > 0) {
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
        console.error('Failed to create particle layers:', error);
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

// ==================== VISUALIZATION MODE CONTROLS ====================

// ==================== VISUALIZATION MODE CONTROLS ====================

function setupVisualizationMode() {
    // Get mode toggle buttons - UPDATED IDs
    const btnRealtime = document.getElementById('btn-realtime');
    const btnPreRender = document.getElementById('btn-pre-render'); // Changed from btn-bake
    const btnConcentration = document.getElementById('btn-concentration');
    const btnParticles = document.getElementById('btn-particles');

    // Get UI panels - UPDATED IDs
    const prenderControls = document.getElementById('prender-controls'); // Changed from bake-panel
    const playbackControls = document.getElementById('playback-controls');

    // ===== SIMULATION MODE TOGGLES (Realtime vs Pre-render) =====

    // Realtime mode
    if (btnRealtime) {
        btnRealtime.addEventListener('click', () => {
            // Update mode
            simulationMode = 'realtime';

            // Update button states
            btnRealtime.classList.add('active');
            if (btnPreRender) btnPreRender.classList.remove('active');

            // Hide pre-render UI
            if (prenderControls) prenderControls.style.display = 'none';
            if (playbackControls) playbackControls.style.display = 'none';

            // Ensure realtime simulation is running
            if (engine) {
                if (!engine.isRunning && engine.stats.totalReleased > 0) {
                    engine.resumeSimulation();
                }
            }

            // Force visualization update with realtime particles
            if (engine) {
                const particles = engine.getActiveParticles();
                if (visualizationMode === 'concentration') {
                    updateDeckGLHeatmap(particles);
                } else {
                    updateDeckGLParticles(particles);
                }
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }

            console.log('🎮 Switched to REALTIME mode');
        });
    }

    // Pre-render mode (formerly Bake mode)
    if (btnPreRender) {
        btnPreRender.addEventListener('click', () => {
            // Update mode
            simulationMode = 'baked';

            // Update button states
            btnPreRender.classList.add('active');
            if (btnRealtime) btnRealtime.classList.remove('active');

            // Show pre-render UI
            if (prenderControls) prenderControls.style.display = 'block';
            if (playbackControls) playbackControls.style.display = 'none'; // Hidden until pre-render completes

            // Pause realtime simulation if running
            if (engine && engine.isRunning) {
                engine.pauseSimulation();
            }

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

            console.log('🎬 Switched to PRE-RENDER mode');
        });
    }

    // ===== VISUALIZATION TYPE TOGGLES (Concentration vs Particles) =====
    // (This part remains the same)

    // Concentration mode
    if (btnConcentration) {
        btnConcentration.addEventListener('click', () => {
            visualizationMode = 'concentration';

            // Update button states
            btnConcentration.classList.add('active');
            if (btnParticles) btnParticles.classList.remove('active');

            // Update visualization based on current simulation mode
            if (simulationMode === 'realtime' && engine) {
                const particles = engine.getActiveParticles();
                updateDeckGLHeatmap(particles);

                // Clear particle canvas
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }

            } else if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
                const particles = bakeSystem.interpolateParticles();
                updateDeckGLHeatmap(particles);

                // Clear particle canvas
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }
            }

            console.log('🔵 Switched to Concentration mode');
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
            if (simulationMode === 'realtime' && engine) {
                const particles = engine.getActiveParticles();
                updateDeckGLParticles(particles);

                // Update canvas particles
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }

            } else if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
                const particles = bakeSystem.interpolateParticles();
                updateDeckGLParticles(particles);

                // Update canvas particles
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }

            console.log('🔴 Switched to Particle mode');
        });
    }

    // Set initial state (default to pre-render + concentration)
    if (btnPreRender) btnPreRender.click();
    if (btnConcentration) btnConcentration.click();
}
function setupLocationPicker() {
    console.log('🗺️ Setting up location picker');

    const latInput = document.getElementById('location-lat');
    const lonInput = document.getElementById('location-lon');
    const mapToggle = document.getElementById('map-click-toggle');
    const currentLocationSpan = document.getElementById('current-location');
    const oceanStatusSpan = document.getElementById('location-ocean-status');

    if (!latInput || !lonInput || !mapToggle) {
        console.warn('⚠️ Location picker elements not found');
        return;
    }

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
            console.log(`📍 Release location set to: ${lat}°, ${lon}°`);
        }

        // Update marker on map
        updateLocationMarker(lat, lon);
    }

    // Check if coordinates are in ocean
    async function checkIfOcean(lat, lon) {
        if (!engine || !engine.hycomLoader) return true;

        try {
            // Use a default day (0) for checking
            return await engine.hycomLoader.isOcean(lon, lat, 0, 0);
        } catch (error) {
            console.warn('Ocean check failed:', error);
            return true; // Default to true if check fails
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

        // Add pulsing effect
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
        console.log(`🗺️ Map click ${mapClickEnabled ? 'enabled' : 'disabled'}`);

        if (mapClickEnabled) {
            simMap.dragging.disable(); // Temporarily disable dragging when picking
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

        // Optional: Disable map click after picking
        // mapToggle.checked = false;
        // mapClickEnabled = false;
        // simMap.dragging.enable();
        // simMap.getContainer().style.cursor = '';
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

    // Add to location picker container
    const container = mapToggle.closest('.control-group');
    container.appendChild(resetBtn);
}
// ==================== LEAFLET PARTICLE CANVAS ====================

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

            // ===== FIX: REDUCE RADIUS =====
            // Old: radius: Math.max(1, Math.sqrt(p.mass) * 2),
            // New: Smaller radius based on concentration
            let radius = 2; // Base radius

            // Scale by concentration (log scale)
            if (p.concentration && p.concentration > 0) {
                const logConc = Math.log10(p.concentration);
                // Scale from 1-4 pixels based on log concentration
                radius = Math.min(4, Math.max(1, 1 + logConc * 0.5));
            }

            const marker = L.circleMarker([lat, lon], {
                radius: radius,  // Much smaller!
                color: color,
                fillColor: color,
                fillOpacity: 0.7,
                weight: 0.5,
                opacity: 0.6
            });

            marker.addTo(this);
        }
    };

    // Remove trails functions since we're disabling them
    particleLayer.clearTrails = function() {
        // No-op
    };

    particleLayer.clearAllParticles = function() {
        this.clearLayers();
        window.particleMarkers = [];
    };

    return particleLayer;
}

function getCanvasParticleColor(p) {
    if (!p.concentration) return '#ffffff'; // White for no data

    const concentration = Math.max(p.concentration, 1e-9);
    const logConc = Math.log10(concentration);

    // Map to your beautiful color scheme
    if (logConc < -3) return '#e7ecfb';  // Very low - Soft blue-white
    if (logConc < -2) return '#c3d1f7';  // Low - Light blue
    if (logConc < -1) return '#a2baf4';  // Low-mid - Periwinkle
    if (logConc < 0) return '#7899e3';   // Mid-low - Cornflower blue
    if (logConc < 1) return '#4473e3';   // Mid - Royal blue
    if (logConc < 2) return '#8d8ed5';   // Mid-high - Purple-blue
    if (logConc < 3) return '#fcb8c5';   // High - Soft pink
    if (logConc < 4) return '#ff736b';   // Higher - Coral
    if (logConc < 5) return '#ff2900';   // Very high - Bright red
    if (logConc < 6) return '#ff6a00';   // Extreme - Orange
    if (logConc < 7) return '#ff9a00';   // Extreme - Orange-yellow
    return '#ffd801';                     // Peak - Bright yellow
}

function formatConcentration(value) {
    if (value >= 1e6) return `${(value/1e6).toFixed(2)} MBq/m³`;
    if (value >= 1e3) return `${(value/1e3).toFixed(2)} kBq/m³`;
    if (value >= 1) return `${value.toFixed(2)} Bq/m³`;
    if (value >= 1e-3) return `${(value*1e3).toFixed(2)} mBq/m³`;
    return `${(value*1e6).toFixed(2)} μBq/m³`;
}

// ==================== ANIMATION LOOP ====================

function animate() {
    if (simulationMode === 'realtime' && engine && engine.isRunning) {
        engine.update();
        const particles = engine.getActiveParticles();

        if (visualizationMode === 'concentration') {
            updateDeckGLHeatmap(particles);
        } else {
            updateDeckGLParticles(particles);
        }

        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }

        updateDateTimeDisplay();
        updateStatsDisplay(); // <-- ADD THIS LINE
        updateUIForEngine();  // <-- ADD THIS LINE (updates sliders)

    } else if (simulationMode === 'baked' && bakeSystem) {
        // Baked mode - just update stats
        updateDateTimeDisplay();
        updateStatsDisplay(); // <-- ADD THIS LINE
    }

    animationId = requestAnimationFrame(animate);
}
// ==================== DATE RANGE SETUP ====================

function setupDateRange() {
    const startInput = document.getElementById('sim-start-date');
    const endInput = document.getElementById('sim-end-date');
    const totalDaysSpan = document.getElementById('total-days');
    const durationMaxLabel = document.getElementById('duration-max-label');

    if (!startInput || !endInput) return;

    function updateDateRange() {
        const startDate = new Date(startInput.value + 'T00:00:00Z');
        const endDate = new Date(endInput.value + 'T00:00:00Z');

        if (isNaN(startDate) || isNaN(endDate)) {
            console.warn('⚠️ Invalid dates');
            return;
        }

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

        console.log(`📅 Simulation period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (${diffDays} days)`);
    }

    startInput.addEventListener('change', updateDateRange);
    endInput.addEventListener('change', updateDateRange);

    // Initial update
    updateDateRange();
}
// ==================== UI UPDATES ====================

function updateDateTimeDisplay() {
    const dayElement = document.getElementById('simulation-day');
    const dateElement = document.getElementById('simulation-date');

    if (!dayElement || !dateElement) return;

    if (simulationMode === 'realtime' && engine) {
        // ===== REALTIME MODE =====
        let day = engine.stats.simulationDays || 0;
        let date = new Date(simulationStartDate);
        date.setUTCDate(simulationStartDate.getUTCDate() + Math.floor(day));

        // Handle fractional days for smooth time display
        const hours = Math.floor((day % 1) * 24);
        const minutes = Math.floor(((day % 1) * 24 * 60) % 60);

        dayElement.textContent = `Day ${day.toFixed(2)}`;

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

    } else if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
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
    const concSpan = document.getElementById('stats-conc');

    if (!activeSpan) return; // Stats panel not found

    if (simulationMode === 'realtime' && engine) {
        // REALTIME MODE STATS
        const activeParticles = engine.getActiveParticles();
        const stats = engine.stats || {};

        activeSpan.textContent = activeParticles.length.toLocaleString();
        releasedSpan.textContent = (stats.totalReleased || 0).toLocaleString();
        decayedSpan.textContent = (stats.totalDecayed || 0).toLocaleString();
        depthSpan.textContent = (stats.maxDepthReached || 0).toFixed(0) + 'm';
        concSpan.textContent = formatConcentration(stats.maxConcentration || 0);

    } else if (simulationMode === 'baked' && bakeSystem?.snapshots?.length > 0) {
        // PLAYBACK MODE STATS
        const currentSnapshot = bakeSystem.snapshots[bakeSystem.currentSnapshotIndex || 0];
        const particles = currentSnapshot?.particles || [];
        const stats = currentSnapshot?.stats || {};

        let maxConc = 0;
        if (particles.length > 0) {
            maxConc = Math.max(...particles.map(p => p.concentration || 0));
        }

        activeSpan.textContent = particles.length.toLocaleString();
        releasedSpan.textContent = (stats.totalReleased || particles.length).toLocaleString();
        decayedSpan.textContent = (stats.totalDecayed || 0).toLocaleString();
        depthSpan.textContent = (stats.maxDepthReached || 0).toFixed(0) + 'm';
        concSpan.textContent = formatConcentration(maxConc || stats.maxConcentration || 0);

    } else {
        // NO SIMULATION
        activeSpan.textContent = '0';
        releasedSpan.textContent = '0';
        decayedSpan.textContent = '0';
        depthSpan.textContent = '0m';
        concSpan.textContent = '0 Bq/m³';
    }
}


function createHeatmapColorLegend() {
    console.log('🎨 Creating legend from HeatmapLayer colorRange...');

    // Remove old legend
    const oldLegend = document.getElementById('concentration-legend');
    if (oldLegend) oldLegend.remove();

    // YOUR NEW BEAUTIFUL COLOR SCHEME
    const heatmapColors = [
        [231, 236, 251, 255], [195, 209, 247, 255], [162, 186, 244, 255],
        [120, 153, 227, 255], [68, 115, 227, 255], [141, 142, 213, 255],
        [252, 184, 197, 255], [255, 115, 107, 255], [255, 41, 0, 250],
        [255, 106, 0, 255], [255, 154, 0, 255], [255, 216, 1, 255]
    ];

    // Convert RGBA arrays to CSS colors
    const cssColors = heatmapColors.map(rgba =>
        `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})`
    );

    // Build the gradient
    const gradientColors = cssColors.join(', ');

    // Create the legend
    const legendDiv = document.createElement('div');
    legendDiv.id = 'concentration-legend';
    legendDiv.className = 'map-legend';

    // HTML structure
    legendDiv.innerHTML = `
        <div class="legend-header">
            <i class="fas fa-fire"></i>
            <h4>Cs-137 Concentration</h4>
            <div class="legend-subtitle">Bq/m³ (Log Scale)</div>
        </div>

        <div class="legend-main">
            <div class="gradient-bar" style="background: linear-gradient(to top, ${gradientColors})"></div>
            <div class="value-labels">
                <div class="value-label top" id="legend-max">1 MBq/m³</div>
                <div class="value-label middle" id="legend-mid">1 Bq/m³</div>
                <div class="value-label bottom" id="legend-min">1 μBq/m³</div>
            </div>
        </div>

        <div class="legend-note">Heatmap shows Cs-137 in seawater</div>
    `;

    // Add to page
    const mapContainer = document.getElementById('map-container');
    if (mapContainer) {
        mapContainer.appendChild(legendDiv);

        // Add CSS - with updated border colors to match your scheme
        const style = document.createElement('style');
        style.textContent = `
            #concentration-legend {
                position: absolute;
                bottom: 25px;
                right: 25px;
                background: rgba(15, 30, 45, 0.95);
                border: 1px solid rgba(79, 195, 247, 0.3);
                border-radius: 10px;
                padding: 18px;
                width: 200px;
                color: white;
                font-family: 'Segoe UI', sans-serif;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(8px);
                z-index: 1000;
            }

            .legend-header {
                margin-bottom: 15px;
                text-align: center;
            }

            .legend-header h4 {
                margin: 5px 0 3px 0;
                color: #4fc3f7;
                font-size: 16px;
            }

            .legend-subtitle {
                font-size: 11px;
                color: #b0bec5;
            }

            .legend-main {
                display: flex;
                margin: 15px 0;
                height: 180px;
            }

            .gradient-bar {
                width: 24px;
                border-radius: 4px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                margin-right: 15px;
                background: linear-gradient(to top, ${gradientColors});
            }

            .value-labels {
                flex: 1;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                padding: 5px 0;
            }

            .value-label {
                font-size: 11px;
                color: #e0e0e0;
                font-family: 'Courier New', monospace;
                background: rgba(0, 0, 0, 0.3);
                padding: 6px 10px;
                border-radius: 4px;
            }

            .value-label.top {
                border-left: 3px solid rgb(255, 216, 1); /* Matches your high-end yellow */
            }

            .value-label.middle {
                border-left: 3px solid rgb(255, 115, 107); /* Matches your mid-range pink */
            }

            .value-label.bottom {
                border-left: 3px solid rgb(68, 115, 227); /* Matches your low-end blue */
            }

            .legend-note {
                font-size: 10px;
                color: #78909c;
                text-align: center;
                font-style: italic;
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
        `;
        document.head.appendChild(style);

        console.log('✅ Heatmap color legend created with new beautiful colors!');
    }
}

// ==================== UI MODE SWITCHING ====================

function setupUIModeSwitching() {
    console.log('🎛️ Setting up UI mode switching');

    const btnPreRender = document.getElementById('btn-pre-render');
    const btnRealtime = document.getElementById('btn-realtime');
    const prenderControls = document.getElementById('prender-controls');
    const realtimeControls = document.getElementById('realtime-controls');
    const playbackControls = document.getElementById('playback-controls');

    if (!btnPreRender || !btnRealtime) {
        console.warn('⚠️ Mode buttons not found');
        return;
    }

    // Pre-render mode
    btnPreRender.addEventListener('click', () => {
        console.log('🎬 Switching to PRE-RENDER mode');

        // Update buttons
        btnPreRender.classList.add('active');
        btnRealtime.classList.remove('active');

        // Update global mode
        simulationMode = 'baked';

        // Show/hide controls
        prenderControls.style.display = 'block';
        realtimeControls.style.display = 'none';
        playbackControls.style.display = 'none'; // Hide playback when configuring

        // Pause realtime if running
        if (engine && engine.isRunning) {
            engine.pauseSimulation();
        }
    });

    // Realtime mode
    btnRealtime.addEventListener('click', () => {
        console.log('⚡ Switching to REALTIME mode');

        // Update buttons
        btnRealtime.classList.add('active');
        btnPreRender.classList.remove('active');

        // Update global mode
        simulationMode = 'realtime';

        // Show/hide controls
        prenderControls.style.display = 'none';
        realtimeControls.style.display = 'block';
        playbackControls.style.display = 'none';

        syncRealtimeControls();
        // Ensure engine is ready
        if (engine && !engine.isRunning) {
            // Update UI with current engine state
            updateUIForEngine();

        }
    });


    // Default to pre-render mode
    btnPreRender.click();
}
function refreshVisualization() {
    console.log('🔄 refreshVisualization called, currentDepth:', currentDepth);

    if (simulationMode === 'realtime' && engine) {
        const particles = engine.getActiveParticles();
        if (visualizationMode === 'concentration') {
            updateDeckGLHeatmap(particles);
        } else {
            updateDeckGLParticles(particles);
        }
        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }
    } else if (simulationMode === 'baked' && bakeSystem && bakeSystem.snapshots.length > 0) {
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
// ==================== SLIDER VALUE UPDATES ====================

function setupSliderValueDisplays() {
    console.log('🎚️ Setting up slider value displays');

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


    const prEke = document.getElementById('pr-eke');
    if (prEke) {
        const display = document.getElementById('pr-eke-value');
        display.textContent = parseFloat(prEke.value).toFixed(1) + 'x';
        prEke.addEventListener('input', (e) => {
            display.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
        });
    }

    // REALTIME SLIDERS
    const rtParticles = document.getElementById('rt-particles');
    if (rtParticles) {
        const display = document.getElementById('rt-particles-value');
        display.textContent = parseInt(rtParticles.value).toLocaleString();
        rtParticles.addEventListener('input', (e) => {
            display.textContent = parseInt(e.target.value).toLocaleString();

            // Update engine if exists
            if (engine && engine.setParameter) {
                // You might need to adjust particle count - this is complex
                console.log('Particle count changed to:', e.target.value);
            }
        });
    }

    const rtSpeed = document.getElementById('rt-speed');
    if (rtSpeed) {
        const display = document.getElementById('rt-speed-value');
        display.textContent = parseFloat(rtSpeed.value).toFixed(1) + 'x';
        rtSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value).toFixed(1);
            display.textContent = val + 'x';

            // Update engine
            if (engine && engine.setParameter) {
                engine.setParameter('simulationSpeed', parseFloat(val));
            }
        });
    }

    const rtEke = document.getElementById('rt-eke');
    if (rtEke) {
        const display = document.getElementById('rt-eke-value');
        display.textContent = parseFloat(rtEke.value).toFixed(1) + 'x';
        rtEke.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value).toFixed(1);
            display.textContent = val + 'x';

            // Update engine
            if (engine && engine.setParameter) {
                engine.setParameter('diffusivityScale', parseFloat(val));
            }
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
        console.log('✅ Depth slider found');

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
                console.log(`📏 Depth slider set to ALL DEPTHS`);
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

                console.log(`📏 Depth slider moved to index ${index}, depth ${depth}m`);
            }

            // Update HYCOM loader (only if not "All Depths")
            if (window.streamingHycomLoader3D && currentDepth !== ALL_DEPTHS) {
                window.streamingHycomLoader3D.setDefaultDepth(currentDepth);
                console.log(`🌊 HYCOM default depth set to ${currentDepth}m`);
            }

            // Refresh visualization
            console.log('🔄 Calling refreshVisualization()');
            refreshVisualization();
        };

        // Set initial value
        updateDepthDisplay(depthSlider.value);

        // Add event listener
        depthSlider.addEventListener('input', (e) => {
            console.log('🎯 Depth slider input event fired!', e.target.value);
            updateDepthDisplay(e.target.value);
        });

        console.log('✅ Depth slider event listener attached');
    }
}
// ==================== PRE-RENDER BUTTON ====================
function syncRealtimeControls() {
    if (!engine) return;

    console.log('🔄 Syncing realtime controls with engine');

    // Get values from UI
    const rtSpeed = document.getElementById('rt-speed');
    const rtEke = document.getElementById('rt-eke');
    const rtRk4 = document.getElementById('rt-rk4');

    // Apply to engine
    if (rtSpeed && engine.setParameter) {
        engine.setParameter('simulationSpeed', parseFloat(rtSpeed.value));
    }

    if (rtEke && engine.setParameter) {
        engine.setParameter('diffusivityScale', parseFloat(rtEke.value));
    }

    if (rtRk4 && engine.enableRK4) {
        engine.enableRK4(rtRk4.checked);
    }

    // Update UI to match
    updateUIForEngine();
}
// ==================== PLAYBACK CONTROLS SETUP ====================

function setupPlaybackControls() {
    console.log('🎮 Setting up playback controls');

    const playBtn = document.getElementById('playback-play');
    const pauseBtn = document.getElementById('playback-pause');
    const speedSlider = document.getElementById('playback-speed');
    const timelineSlider = document.getElementById('playback-timeline');

    // Play button
    if (playBtn) {
        // Remove any existing listeners
        const newPlayBtn = playBtn.cloneNode(true);
        playBtn.parentNode.replaceChild(newPlayBtn, playBtn);

        newPlayBtn.addEventListener('click', () => {
            console.log('▶️ Play clicked');
            if (bakeSystem) {
                bakeSystem.play();
                // Update button states if needed
            } else {
                console.warn('⚠️ No bakeSystem available');
            }
        });
    }

    // Pause button
    if (pauseBtn) {
        const newPauseBtn = pauseBtn.cloneNode(true);
        pauseBtn.parentNode.replaceChild(newPauseBtn, pauseBtn);

        newPauseBtn.addEventListener('click', () => {
            console.log('⏸️ Pause clicked');
            if (bakeSystem) {
                bakeSystem.pause();
            }
        });
    }

    // Speed slider
    if (speedSlider) {
        const speedValue = document.getElementById('playback-speed-value');
        if (speedValue) {
            speedValue.textContent = speedSlider.value + 'x';
        }

        speedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            if (speedValue) {
                speedValue.textContent = speed.toFixed(1) + 'x';
            }
            if (bakeSystem) {
                bakeSystem.playbackSpeed = speed;
                console.log(`⚡ Playback speed set to ${speed}x`);
            }
        });
    }

    // Timeline slider
    if (timelineSlider) {
        timelineSlider.addEventListener('input', (e) => {
            if (!bakeSystem || bakeSystem.snapshots.length === 0) {
                console.warn('⚠️ No snapshots loaded');
                return;
            }

            const val = parseFloat(e.target.value);
            const maxDay = bakeSystem.snapshots[bakeSystem.snapshots.length - 1].day;
            const targetDay = val; // Since max is now in days, not percentage

            console.log(`📅 Seeking to day ${targetDay.toFixed(1)}`);
            bakeSystem.seek(targetDay);
        });
    }
}
function setupPreRenderButton() {
    const btn = document.getElementById('btn-start-prerender');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        console.log('🎬 Starting pre-render...');

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

        console.log('📋 Phases from UI:', phases);

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
            phases: phases  // ← Now phases is defined!
        };

        console.log('📋 Pre-render config:', config);

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

            // In setupPreRenderButton(), after getting snapshots
            if (snapshots.length > 0) {
                const maxDay = snapshots[snapshots.length - 1].day;

                // Update timeline slider - THIS IS CRITICAL
                const timeline = document.getElementById('playback-timeline');
                if (timeline) {
                    timeline.max = maxDay;  // Set the max to actual duration
                    timeline.value = 0;      // Reset to start
                }

                // Update labels
                document.getElementById('playback-date-end').textContent = `Day ${maxDay}`;
                document.getElementById('playback-date-start').textContent = 'Day 0';

                // Show first frame
                bakeSystem.seek(0);
            }

            hidePreRenderProgress();

        } catch (error) {
            console.error('❌ Pre-render failed:', error);
            alert('Pre-render failed: ' + error.message);
            hidePreRenderProgress();
        }
    });
}

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
// ==================== REALTIME CONTROLS ====================

function setupRealtimeControls() {
    const startBtn = document.getElementById('rt-start');
    const resetBtn = document.getElementById('rt-reset');

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (!engine) return;

            if (!engine.isRunning) {
                if (engine.stats.totalReleased === 0) {
                    engine.startSimulation();
                } else {
                    engine.resumeSimulation();
                }
                startBtn.innerHTML = '<i class="fas fa-pause"></i> PAUSE';
                startBtn.classList.remove('btn-primary');
                startBtn.classList.add('btn-secondary');
            } else {
                engine.pauseSimulation();
                startBtn.innerHTML = '<i class="fas fa-play"></i> START';
                startBtn.classList.remove('btn-secondary');
                startBtn.classList.add('btn-primary');
            }
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (engine) {
                engine.resetSimulation();

                // Reset UI
                startBtn.innerHTML = '<i class="fas fa-play"></i> START';
                startBtn.classList.remove('btn-secondary');
                startBtn.classList.add('btn-primary');

                // Clear visualizations
                if (deckgl) deckgl.setProps({ layers: [] });
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }
            }
        });
    }

}
// ==================== TRACER UI SETUP ====================

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

    if (!phaseContainer || !addBtn) {
        console.warn('⚠️ Phase editor elements not found');
        return;
    }

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
                    <input type="number" class="phase-total" min="0" value="${phaseData?.total || 1000}"
                           style="width: 100%; background: rgba(0,0,0,0.3); color: #4fc3f7; border: 1px solid rgba(79,195,247,0.3); border-radius: 4px; padding: 5px;">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 11px;">Unit</label>
                    <select class="phase-unit" style="width: 100%; background: rgba(0,0,0,0.3); color: #4fc3f7; border: 1px solid rgba(79,195,247,0.3); border-radius: 4px; padding: 5px;">
                        <option value="GBq" ${phaseData?.unit === 'GBq' ? 'selected' : ''}>GBq</option>
                        <option value="TBq" ${phaseData?.unit === 'TBq' ? 'selected' : ''}>TBq</option>
                        <option value="PBq" ${phaseData?.unit === 'PBq' ? 'selected' : ''}>PBq</option>
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
            else if (unit === 'tons') rateDisplay = `${rate.toFixed(2)} tons/day`;
            else rateDisplay = `${rate.toFixed(2)} kg/day`;

            phaseDiv.querySelector('.phase-rate-display').textContent = rateDisplay;
        };

        // Update max attribute based on total days
        const totalDays = totalSimulationDays || 731;
        phaseDiv.querySelector('.phase-start').max = totalDays;
        phaseDiv.querySelector('.phase-end').max = totalDays;

        // Add input handlers
        phaseDiv.querySelectorAll('input, select').forEach(el => {
            el.addEventListener('input', () => {
                updateRateDisplay();
                updateReleaseStats();
                syncPhasesToEngine();
            });
        });

        // ===== FIXED REMOVE HANDLER =====
        const removeBtn = phaseDiv.querySelector('.remove-phase');
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent any default button behavior
            e.stopPropagation(); // Stop event bubbling

            console.log('🗑️ Removing phase', phaseCount);

            // Check if this is the last phase
            if (phaseContainer.children.length <= 1) {
                console.log('⚠️ Cannot remove the last phase');
                // Optionally show a warning to the user
                alert('You must keep at least one release phase');
                return;
            }

            // Remove the phase
            phaseDiv.remove();

            // Update phase numbers for remaining phases
            const remainingPhases = phaseContainer.querySelectorAll('.phase-card');
            remainingPhases.forEach((phase, index) => {
                const phaseSpan = phase.querySelector('div:first-child span:first-child');
                if (phaseSpan) {
                    phaseSpan.textContent = `Phase ${index + 1}`;
                }
            });

            // Update stats and sync
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
    const rtParticles = document.getElementById('rt-particles');

    if (prParticles && prParticles.style.display !== 'none') {
        particleCount = parseInt(prParticles.value) || 10000;
    } else if (rtParticles && rtParticles.style.display !== 'none') {
        particleCount = parseInt(rtParticles.value) || 10000;
    }

    // Calculate total in base unit
    let grandTotalInBase = 0;
    phases.forEach(p => {
        let valueInBase = p.total;
        if (p.unit === 'TBq') valueInBase *= 1000;
        if (p.unit === 'PBq') valueInBase *= 1e6;
        if (p.unit === 'tons') valueInBase *= 1000;
        grandTotalInBase += valueInBase;
    });

    // Calculate units per particle (this is constant for all phases)
    const unitsPerParticle = grandTotalInBase / particleCount;

    // Format total display (same as before)
    let totalDisplay = '';
    const hasPBq = phases.some(p => p.unit === 'PBq');
    const hasTBq = phases.some(p => p.unit === 'TBq');
    const hasGBq = phases.some(p => p.unit === 'GBq');
    const hasTons = phases.some(p => p.unit === 'tons');
    const hasKg = phases.some(p => p.unit === 'kg');

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
    } else if (hasTons) {
        let totalTons = 0;
        phases.forEach(p => {
            if (p.unit === 'tons') totalTons += p.total;
            else if (p.unit === 'kg') totalTons += p.total / 1000;
        });
        totalDisplay = `${totalTons.toFixed(2)} tons`;
    } else if (hasKg) {
        let totalKg = 0;
        phases.forEach(p => {
            if (p.unit === 'kg') totalKg += p.total;
        });
        totalDisplay = `${totalKg.toFixed(2)} kg`;
    }

    const totalElement = document.getElementById('total-release');
    if (totalElement) totalElement.textContent = totalDisplay;

    // ===== IMPROVED: Find current or next phase =====
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
        } else if (displayPhase.unit === 'tons') {
            rateDisplay = `${rateInOriginalUnits.toFixed(2)} tons/day`;
        } else {
            rateDisplay = `${rateInOriginalUnits.toFixed(2)} kg/day`;
        }

        // Add indicator if it's upcoming
        if (!activePhase && nextPhase) {
            rateDisplay = `${rateDisplay}`;
        }

        if (rateElement) {
            rateElement.textContent = rateDisplay;
        }

        // Calculate particles per day for THIS phase
        let rateInBase = rateInOriginalUnits;
        if (displayPhase.unit === 'TBq') rateInBase *= 1000;
        if (displayPhase.unit === 'PBq') rateInBase *= 1e6;
        if (displayPhase.unit === 'tons') rateInBase *= 1000;

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
    if (!engine || !engine.releaseManager || !phaseContainer) {
        console.warn('⚠️ Cannot sync phases: engine or releaseManager missing');
        return;
    }

    const phases = [];
    document.querySelectorAll('.phase-card').forEach(card => {
        const start = parseInt(card.querySelector('.phase-start').value) || 0;
        const end = parseInt(card.querySelector('.phase-end').value) || 0;
        const total = parseFloat(card.querySelector('.phase-total').value) || 0;
        const unit = card.querySelector('.phase-unit').value;

        phases.push(new ReleasePhase(start, end, total, unit));
    });

    console.log('🔍 PHASE DEBUG: Syncing to engine', {
        phaseCount: phases.length,
        phases: phases.map(p => ({
            start: p.start,
            end: p.end,
            total: p.total,
            unit: p.unit,
            duration: p.getDuration(),
            rate: p.getRate()
        }))
    });

    // Store old UNITS_PER_PARTICLE for logging
    const oldUnits = engine.UNITS_PER_PARTICLE;

    // Set the phases in the engine WITHOUT recalibrating
    engine.releaseManager.phases = phases;

    // Log but DON'T recalculate
    console.log('🔍 PHASE DEBUG: Engine phases updated, UNITS_PER_PARTICLE unchanged:', oldUnits);

    // Update the stats display
    updateReleaseStats();
}
function updateUIForEngine() {
    if (!engine) return;

    console.log('🔄 Updating UI for engine state');

    // ===== REALTIME CONTROLS =====

    // Update particle count slider
    const rtParticles = document.getElementById('rt-particles');
    const rtParticlesValue = document.getElementById('rt-particles-value');
    if (rtParticles && rtParticlesValue) {
        // You might want to sync this with actual particle count
        // But particle count is usually fixed at startup
        const activeCount = engine.getActiveParticles().length;
        rtParticlesValue.textContent = activeCount.toLocaleString();
    }

    // Update simulation speed slider
    const rtSpeed = document.getElementById('rt-speed');
    const rtSpeedValue = document.getElementById('rt-speed-value');
    if (rtSpeed && rtSpeedValue) {
        const speed = engine.params?.simulationSpeed || 1.0;
        rtSpeed.value = speed;
        rtSpeedValue.textContent = speed.toFixed(1) + 'x';
    }

    // Update EKE diffusivity slider
    const rtEke = document.getElementById('rt-eke');
    const rtEkeValue = document.getElementById('rt-eke-value');
    if (rtEke && rtEkeValue) {
        const eke = engine.params?.diffusivityScale || 1.0;
        rtEke.value = eke;
        rtEkeValue.textContent = eke.toFixed(1) + 'x';
    }

    // Update RK4 toggle
    const rtRk4 = document.getElementById('rt-rk4');
    if (rtRk4) {
        rtRk4.checked = engine.rk4Enabled || false;
    }

    // Update start/pause button
    const startBtn = document.getElementById('rt-start');
    if (startBtn) {
        if (engine.isRunning) {
            startBtn.innerHTML = '<i class="fas fa-pause"></i> PAUSE';
            startBtn.classList.remove('btn-primary');
            startBtn.classList.add('btn-secondary');
        } else {
            if (engine.stats.totalReleased === 0 && engine.stats.simulationDays === 0) {
                startBtn.innerHTML = '<i class="fas fa-play"></i> START';
            } else {
                startBtn.innerHTML = '<i class="fas fa-play"></i> RESUME';
            }
            startBtn.classList.remove('btn-secondary');
            startBtn.classList.add('btn-primary');
        }
    }

    // ===== PRE-RENDER CONTROLS (initial values only) =====
    // These don't need frequent updates, but set initial state

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

    // ===== STATS DISPLAY =====
    // Update the stats panel with current data
    updateStatsDisplay();

    console.log('✅ UI updated for engine');
}

function updateCanvasOverlay() {
    if (particleCanvas && particleCanvas.updateParticles && engine) {
        const particles = engine.getActiveParticles();
        particleCanvas.updateParticles(particles);
    }
}

// ==================== UTILITY FUNCTIONS ====================

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
            🌊 Loading Pacific Ocean Transport Simulator
        </div>
        <div id="loadingMessage" style="font-size: 18px; margin-bottom: 30px;">
            Initializing...
        </div>
        <div style="width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px;">
            <div id="loadingBar" style="width: 0%; height: 100%; background: #4fc3f7; border-radius: 2px; transition: width 0.3s;"></div>
        </div>
        <div style="margin-top: 30px; font-size: 14px; color: #b0bec5;">
            Using HYCOM 2011-2013 currents and AVISO EKE
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
function setupTrailToggle() {
    const trailsToggle = document.getElementById('trailsToggle');

    if (trailsToggle) {
        trailsToggle.checked = showParticleTrails;
        // Update the toggle event listener to clear trails:
        trailsToggle.addEventListener('change', (e) => {
            showParticleTrails = e.target.checked;
            console.log(`Particle trails: ${showParticleTrails ? 'ON' : 'OFF'}`);

            // Clear existing trails if turning off
            if (!showParticleTrails && particleCanvas && particleCanvas.clearTrails) {
                particleCanvas.clearTrails();
            }

            // Update visualization
            if (engine && visualizationMode === 'particles') {
                const particles = engine.getActiveParticles();
                updateDeckGLParticles(particles);
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }
        });
    }
}
// ==================== START APPLICATION ====================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 100);
}
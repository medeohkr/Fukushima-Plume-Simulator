// web/app.js - COMPLETE WORKING VERSION WITH NEW FEATURES
console.log('=== app.js STARTING WITH HYBRID VISUALIZATION ===');

// Global variables
let engine = null;
let animationId = null;

// Leaflet globals
let simMap = null;
let particleCanvas = null;
// Add with other global variables
let showParticleTrails = true;
// Deck.gl globals
let deckgl = null;
let showHeatmap = true;

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

// Time globals
let simulationStartDate = new Date('2011-03-11T00:00:00Z');
let currentSimulationDate = new Date(simulationStartDate);
let simulationDay = 0;

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

        // 6. ADD MAP CONTROLS
        updateLoadingStatus('Adding controls...', 70);
        addMapControls(simMap);

        // 7. SET UP CONTROLS
        updateLoadingStatus('Finalizing...', 90);
        setupControls();
        setupVisualizationMode();
        updateUIForEngine();
        updateDateTimeDisplay();
        createHeatmapColorLegend();
        setupTrailToggle();

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
    if (!engine || !particles || particles.length === 0) return [];

    const grid = new Map();

    particles.forEach(p => {
        if (!p.active || !p.concentration) return;

        // SIMPLE: Just calculate raw coordinates - no normalization!
        const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
        const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

        // Simple grid cell calculation
        const lonIdx = Math.floor(lon / gridSize);
        const latIdx = Math.floor(lat / gridSize);
        const key = `${lonIdx},${latIdx}`;

        if (!grid.has(key)) {
            // Cell center coordinates - let Leaflet/deck.gl handle wrapping
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
    if (!deckgl || particles.length === 0 || visualizationMode !== 'concentration') return;

    const now = Date.now();
    if (now - lastHeatmapUpdate < HEATMAP_UPDATE_INTERVAL) return;
    lastHeatmapUpdate = now;

    const gridData = createConcentrationGrid(particles, heatmapParams.gridSize);
    if (gridData.length === 0) {
        deckgl.setProps({ layers: [] });
        return;
    }

    const heatmapData = gridData.map(cell => ({
        position: cell.position,
        weight: cell.concentration
    }));

    try {
        const heatmapLayer = new deck.HeatmapLayer({
            id: 'concentration-heatmap',
            data: heatmapData,
            getPosition: d => d.position,
            getWeight: d => {
                let concentration = Math.max(d.weight, CONCENTRATION_RANGE.min);
                concentration = Math.min(concentration, CONCENTRATION_RANGE.max);

                // Log scale normalization
                const logConc = Math.log10(concentration);
                const logMin = Math.log10(CONCENTRATION_RANGE.min);
                const logMax = Math.log10(CONCENTRATION_RANGE.max);
                const normalized = (logConc - logMin) / (logMax - logMin);

                return Math.max(0, Math.min(normalized, 1)) * heatmapParams.intensity;
            },
            colorRange: [ // Your existing color range
                [13, 8, 135, 0], [40, 60, 190, 100], [23, 154, 176, 150],
                [13, 188, 121, 200], [62, 218, 79, 220], [130, 226, 74, 230],
                [192, 226, 70, 240], [243, 210, 65, 245], [251, 164, 57, 250],
                [241, 99, 55, 255], [231, 29, 43, 255], [190, 0, 38, 255]
            ],
            radiusPixels: heatmapParams.radiusPixels,
            intensity: 1.0,
            threshold: 0.01,
            aggregation: 'SUM'
        });

        deckgl.setProps({ layers: [heatmapLayer] });
    } catch (error) {
        console.error('Failed to create heatmap layer:', error);
    }
}
// ==================== PARTICLE TRAIL VISUALIZATION ====================

function updateDeckGLParticles(particles) {
    if (!deckgl || particles.length === 0 || visualizationMode !== 'particles') {
        deckgl.setProps({ layers: [] });
        return;
    }

    try {
        const particleData = [];
        const trailData = [];

        for (const p of particles) {
            if (!p.active) continue;

            // SIMPLE: Raw coordinates, no filtering!
            const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
            const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

            // Skip obviously invalid positions
            if (Math.abs(lat) > 90) continue;

            // Add current position
            particleData.push({
                position: [lon, lat],
                color: getParticleColor(p),
                radius: getParticleRadius(p)
            });

            // Add trail if enabled
            if (showParticleTrails && p.history && p.history.length > 1) {
                const positions = p.history.map(h => {
                    const histLon = engine.FUKUSHIMA_LON + (h.x / engine.LON_SCALE);
                    const histLat = engine.FUKUSHIMA_LAT + (h.y / engine.LAT_SCALE);
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

        // Rest of the function unchanged...
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
    if (!p.concentration) return [255, 255, 255, 200];

    const concentration = Math.max(p.concentration, CONCENTRATION_RANGE.min);
    const clampedConc = Math.min(concentration, CONCENTRATION_RANGE.max);

    // Use the same log normalization
    const logConc = Math.log10(clampedConc);
    const logMin = Math.log10(CONCENTRATION_RANGE.min);
    const logMax = Math.log10(CONCENTRATION_RANGE.max);
    const normalized = (logConc - logMin) / (logMax - logMin);

    // Map normalized value (0-1) to color gradient
    const colorIndex = Math.floor(normalized * 10);

    const colorStops = [
        [33, 102, 172, 150],   // 0.0: Blue: 1 μBq/m³
        [103, 169, 207, 180],  // 0.1: Light blue: 10 μBq/m³
        [103, 169, 207, 180],  // 0.2: Light blue: 100 μBq/m³
        [209, 229, 240, 200],  // 0.3: Very light blue: 1 mBq/m³
        [209, 229, 240, 200],  // 0.4: Very light blue: 10 mBq/m³
        [253, 219, 199, 220],  // 0.5: Light orange: 100 mBq/m³
        [253, 219, 199, 220],  // 0.6: Light orange: 1 Bq/m³
        [239, 138, 98, 230],   // 0.7: Orange: 10 Bq/m³
        [239, 138, 98, 230],   // 0.8: Orange: 100 Bq/m³
        [203, 24, 29, 255],    // 0.9: Red: 1 kBq/m³
        [203, 24, 29, 255]     // 1.0: Red: 10 kBq/m³+
    ];

    return colorIndex < colorStops.length ? colorStops[colorIndex] : [203, 24, 29, 255];
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
    // Scale radius based on concentration
    if (!p.concentration) return 2;

    const concentration = Math.max(p.concentration, 1e-9);
    const logConc = Math.log10(concentration);

    // Base radius + scaled by log concentration
    return Math.min(Math.max(1 + logConc * 0.3, 1), 6);
}

// ==================== VISUALIZATION MODE CONTROLS ====================

function setupVisualizationMode() {
    // Setup mode toggle buttons
    const btnConcentration = document.getElementById('btn-concentration');
    const btnParticles = document.getElementById('btn-particles');

    if (btnConcentration) {
        btnConcentration.addEventListener('click', () => {
            visualizationMode = 'concentration';
            btnConcentration.classList.add('active');
            btnParticles.classList.remove('active');

            // Update visualization immediately
            if (engine) {
                const particles = engine.getActiveParticles();
                updateDeckGLHeatmap(particles);

                // Hide particle canvas
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }
            }

            console.log('🔵 Switched to Concentration mode');
        });
    }

    if (btnParticles) {
        btnParticles.addEventListener('click', () => {
            visualizationMode = 'particles';
            btnParticles.classList.add('active');
            btnConcentration.classList.remove('active');

            // Update visualization immediately
            if (engine) {
                const particles = engine.getActiveParticles();
                updateDeckGLParticles(particles);

                // Also update canvas particles
                if (particleCanvas && particleCanvas.updateParticles) {
                    particleCanvas.updateParticles(particles);
                }
            }

            console.log('🔴 Switched to Particle mode');
        });
    }

    // Set initial state
    if (btnConcentration) {
        btnConcentration.click();
    }
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

            // SIMPLE: Raw coordinates!
            const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
            const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

            // Skip invalid latitudes
            if (Math.abs(lat) > 90) continue;

            const color = getCanvasParticleColor(p);
            const marker = L.circleMarker([lat, lon], {
                radius: Math.max(1, Math.sqrt(p.mass) * 2),
                color: color,
                fillColor: color,
                fillOpacity: 0.6 + p.mass * 0.3,
                weight: 0.5,
                opacity: 0.8
            });

            // Add trails if enabled
            if (showParticleTrails && p.history && p.history.length > 1) {
                const trailPoints = p.history.map(h => [
                    engine.FUKUSHIMA_LAT + (h.y / engine.LAT_SCALE),
                    engine.FUKUSHIMA_LON + (h.x / engine.LON_SCALE)
                ]).filter(point => Math.abs(point[0]) <= 90);

                if (trailPoints.length >= 2) {
                    L.polyline(trailPoints, {
                        color: color,
                        weight: 1,
                        opacity: 0.4
                    }).addTo(this);
                }
            }

            marker.bindPopup(/* ... popup content ... */);
            marker.addTo(this);
        }
    };

    // Rest of the function remains the same...
    particleLayer.clearTrails = function() {
        this.eachLayer((layer) => {
            if (layer instanceof L.Polyline) {
                this.removeLayer(layer);
            }
        });
    };

    particleLayer.clearAllParticles = function() {
        this.clearLayers();
        window.particleMarkers = [];
        console.log('🧹 Cleared canvas particles');
    };

    return particleLayer;
}

function getCanvasParticleColor(p) {
    if (!p.concentration) return '#4fc3f7';

    const concentration = Math.max(p.concentration, 1e-9);
    const logConc = Math.log10(concentration);

    if (logConc < -3) return '#2166ac';   // Blue: < 1 mBq/m³
    if (logConc < 0) return '#67a9cf';    // Light blue: 1 mBq/m³ - 1 Bq/m³
    if (logConc < 3) return '#d1e5f0';    // Very light blue: 1 Bq/m³ - 1 kBq/m³
    if (logConc < 6) return '#fddbc7';    // Light orange: 1 kBq/m³ - 1 MBq/m³
    return '#cb181d';                     // Red: > 1 MBq/m³
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
    if (engine && engine.isRunning) {
        // Update simulation
        engine.update();

        // Get current particles
        const particles = engine.getActiveParticles();

        // Update deck.gl visualization based on mode
        if (visualizationMode === 'concentration') {
            updateDeckGLHeatmap(particles);
        } else {
            updateDeckGLParticles(particles);
        }

        // Update canvas particles (always for particle mode)
        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }

        // Update UI
        updateDateTimeDisplay();
        updateStatsDisplay();
        updateUIForEngine();
    }

    animationId = requestAnimationFrame(animate);
}

// ==================== UI UPDATES ====================

function updateDateTimeDisplay() {
    if (!engine) return;

    // Update simulation date from engine
    if (engine.getFormattedTime) {
        const time = engine.getFormattedTime();
        currentSimulationDate = new Date(
            time.year, time.month - 1, time.day
        );
        simulationDay = engine.stats.simulationDays || 0;
    }

    // Update day display
    const dayElement = document.getElementById('simulation-day');
    const dateElement = document.getElementById('simulation-date');

    if (dayElement) {
        dayElement.textContent = `Day ${simulationDay.toFixed(1)}`;
    }

    if (dateElement) {
        const dateStr = currentSimulationDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
        dateElement.textContent = dateStr;
    }
}

function updateStatsDisplay() {
    if (!engine) return;

    const activeParticles = engine.getActiveParticles();
    const statsElement = document.getElementById('simulation-stats');

    if (statsElement) {
        statsElement.innerHTML = `
            <div>
                <span class="stat-label">Active Particles:</span>
                <span class="stat-value">${activeParticles.length}</span>
            </div>
            <div>
                <span class="stat-label">Total Released:</span>
                <span class="stat-value">${engine.stats.totalReleased || 0}</span>
            </div>
            <div>
                <span class="stat-label">Decayed:</span>
                <span class="stat-value">${engine.stats.totalDecayed || 0}</span>
            </div>
            <div>
                <span class="stat-label">Days Elapsed:</span>
                <span class="stat-value">${simulationDay.toFixed(1)}</span>
            </div>
        `;
    }
}


function createHeatmapColorLegend() {
    console.log('🎨 Creating legend from HeatmapLayer colorRange...');

    // Remove old legend
    const oldLegend = document.getElementById('concentration-legend');
    if (oldLegend) oldLegend.remove();

    // These are YOUR exact colors from app.js - HeatmapLayer colorRange
    const heatmapColors = [
        [13, 8, 135, 0],      // Deep blue (low) - 1 μBq/m³
        [40, 60, 190, 100],   // Blue
        [23, 154, 176, 150],  // Cyan
        [13, 188, 121, 200],  // Green
        [62, 218, 79, 220],   // Light green
        [130, 226, 74, 230],  // Yellow-green
        [192, 226, 70, 240],  // Yellow
        [243, 210, 65, 245],  // Orange
        [251, 164, 57, 250],  // Red-orange
        [241, 99, 55, 255],   // Red
        [231, 29, 43, 255],   // Dark red
        [190, 0, 38, 255]     // Very dark red (high) - 1 MBq/m³
    ];

    // Create concentration levels that match the 12 color stops
    const concentrationLevels = [
        1e-6,   // 1 μBq/m³ - Deep blue
        1e-5,   // 10 μBq/m³
        1e-4,   // 100 μBq/m³
        1e-3,   // 1 mBq/m³
        1e-2,   // 10 mBq/m³
        1e-1,   // 100 mBq/m³
        1e0,    // 1 Bq/m³
        1e1,    // 10 Bq/m³
        1e2,    // 100 Bq/m³
        1e3,    // 1 kBq/m³
        1e4,    // 10 kBq/m³
        1e5,    // 100 kBq/m³
        1e6     // 1 MBq/m³ - Very dark red
    ];

    // Convert RGBA arrays to CSS colors (ignore alpha for the legend)
    const cssColors = heatmapColors.map(rgba =>
        `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})`
    );

    // Build the gradient (using all colors)
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
                <div class="value-label top">1 MBq/m³</div>
                <div class="value-label middle">1 Bq/m³</div>
                <div class="value-label bottom">1 μBq/m³</div>
            </div>
        </div>

        <div class="legend-colors">
            <div class="color-row">
                <div class="color-box" style="background: rgb(190, 0, 38)"></div>
                <div class="color-label">High (100 kBq/m³+)</div>
            </div>
            <div class="color-row">
                <div class="color-box" style="background: rgb(243, 210, 65)"></div>
                <div class="color-label">Medium (1-10 kBq/m³)</div>
            </div>
            <div class="color-row">
                <div class="color-box" style="background: rgb(13, 188, 121)"></div>
                <div class="color-label">Low (10-100 Bq/m³)</div>
            </div>
            <div class="color-row">
                <div class="color-box" style="background: rgb(23, 154, 176)"></div>
                <div class="color-label">Very Low (1-10 Bq/m³)</div>
            </div>
            <div class="color-row">
                <div class="color-box" style="background: rgb(13, 8, 135)"></div>
                <div class="color-label">Background (<1 Bq/m³)</div>
            </div>
        </div>

        <div class="legend-note">Heatmap shows Cs-137 in seawater</div>
    `;

    // Add to page
    const mapContainer = document.getElementById('map-container');
    if (mapContainer) {
        mapContainer.appendChild(legendDiv);

        // Add CSS
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
                width: 220px;
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
                border-left: 3px solid rgba(79, 195, 247, 0.5);
            }

            .value-label.top {
                border-left-color: rgba(241, 99, 55, 0.7);
            }

            .value-label.middle {
                border-left-color: rgba(62, 218, 79, 0.7);
            }

            .value-label.bottom {
                border-left-color: rgba(23, 154, 176, 0.7);
            }

            .legend-colors {
                margin: 15px 0;
                padding: 12px;
                background: rgba(10, 25, 41, 0.6);
                border-radius: 6px;
            }

            .color-row {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
            }

            .color-box {
                width: 20px;
                height: 20px;
                border-radius: 3px;
                margin-right: 12px;
                border: 1px solid rgba(255, 255, 255, 0.3);
                flex-shrink: 0;
            }

            .color-label {
                font-size: 12px;
                color: #b0bec5;
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

        console.log('✅ Heatmap color legend created!');
        console.log('Using colors:', cssColors);
    }
}


// ==================== CONTROLS ====================

function setupControls() {
    console.log('Setting up controls...');

    // Get controls
    const diffusionSlider = document.getElementById('diffusionSlider');
    const speedSlider = document.getElementById('speedSlider');
    const startBtn = document.getElementById('startBtn');
    const resetBtn = document.getElementById('resetBtn');

    // Find the diffusion slider event listener and modify it:
    if (diffusionSlider) {
        diffusionSlider.addEventListener('input', (e) => {
            const rawValue = parseFloat(e.target.value);

            // Fix: Round to 1 decimal place to avoid floating point issues
            const value = Math.round(rawValue * 10) / 10;

            // Update display
            const diffusionValue = document.getElementById('diffusionValue');

            if (Math.abs(value) < 0.05) { // Effectively 0
                diffusionValue.textContent = '0 (Pure HYCOM)';
                diffusionValue.style.color = '#ff6b6b';

                // Ensure engine gets exactly 0
                if (engine && engine.setParameter) {
                    engine.setParameter('diffusivityScale', 0);
                }
            } else {
                diffusionValue.textContent = value.toFixed(1);
                diffusionValue.style.color = '#4fc3f7';

                if (engine && engine.setParameter) {
                    engine.setParameter('diffusivityScale', value);
                }
            }

            console.log(`Diffusion scale: ${value}x`);
        });
    }
    // Speed slider
    if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            document.getElementById('speedValue').textContent = value.toFixed(1);

            if (engine && engine.setParameter) {
                engine.setParameter('simulationSpeed', value);
            }
        });
    }

    // Start/Pause/Resume button
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (!engine) return;

            if (!engine.isRunning) {
                // Determine if this is a fresh start or resume
                if (engine.stats.totalReleased === 0 && engine.stats.simulationDays === 0) {
                    // Fresh start
                    engine.startSimulation();
                    startBtn.textContent = '⏸️ Pause Simulation';
                    console.log('🚀 Simulation started fresh');
                } else {
                    // Resume from pause
                    if (engine.resumeSimulation) {
                        engine.resumeSimulation();
                    } else {
                        engine.startSimulation();
                    }
                    startBtn.textContent = '⏸️ Pause Simulation';
                    console.log('▶️ Simulation resumed');
                }

                startBtn.style.background = 'linear-gradient(135deg, #ff6b6b, #ff4757)';
            } else {
                // Pause the simulation
                if (engine.pauseSimulation) {
                    engine.pauseSimulation();
                } else {
                    engine.stopSimulation();
                }

                startBtn.textContent = '▶ Resume Simulation';
                startBtn.style.background = 'linear-gradient(135deg, #4fc3f7, #2979ff)';
                console.log('⏸️ Simulation paused');
            }
        });
    }

    // Reset button
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (engine) {
                // Clear visualizations
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }

                if (deckgl) {
                    deckgl.setProps({ layers: [] });
                }

                // Reset the engine
                engine.resetSimulation();

                // Reset UI variables
                currentSimulationDate = new Date(simulationStartDate);
                simulationDay = 0;

                // Reset UI button to "Start"
                if (startBtn) {
                    startBtn.textContent = '▶ Start Simulation';
                    startBtn.style.background = 'linear-gradient(135deg, #4fc3f7, #2979ff)';
                }

                // Reset sliders to defaults
                if (diffusionSlider) {
                    diffusionSlider.value = 1.0;
                    const diffusionValue = document.getElementById('diffusionValue');
                    diffusionValue.textContent = '1.0';
                    diffusionValue.style.color = '#4fc3f7';
                }

                if (speedSlider) {
                    speedSlider.value = 1.0;
                    document.getElementById('speedValue').textContent = '1.0';
                }

                // Force immediate UI update
                updateDateTimeDisplay();
                updateUIForEngine();
                console.log('🔄 Simulation fully reset');
            }
        });
    }

    console.log('✅ Controls setup complete');
}

function updateUIForEngine() {
    if (!engine) return;

    const params = engine.params;
    const startBtn = document.getElementById('startBtn');

    // Update diffusion slider
    const diffusionSlider = document.getElementById('diffusionSlider');
    if (diffusionSlider) {
        // Fix: Handle 0 value specially
        const displayValue = Math.abs(params.diffusivityScale) < 0.05 ? 0 : params.diffusivityScale;
        diffusionSlider.value = displayValue;

        const diffusionValue = document.getElementById('diffusionValue');
        if (Math.abs(displayValue) < 0.05) {
            diffusionValue.textContent = '0 (Pure HYCOM)';
            diffusionValue.style.color = '#ff6b6b';
        } else {
            diffusionValue.textContent = displayValue.toFixed(1);
            diffusionValue.style.color = '#4fc3f7';
        }
    }
    // Update speed slider
    const speedSlider = document.getElementById('speedSlider');
    if (speedSlider) {
        speedSlider.value = params.simulationSpeed || 1.0;
        document.getElementById('speedValue').textContent = (params.simulationSpeed || 1.0).toFixed(1);
    }

    // Update start/pause button
    if (startBtn) {
        if (engine.isRunning) {
            startBtn.textContent = '⏸️ Pause Simulation';
            startBtn.style.background = 'linear-gradient(135deg, #ff6b6b, #ff4757)';
        } else {
            if (engine.stats.totalReleased === 0 && engine.stats.simulationDays === 0) {
                startBtn.textContent = '▶ Start Simulation';
            } else {
                startBtn.textContent = '▶ Resume Simulation';
            }
            startBtn.style.background = 'linear-gradient(135deg, #4fc3f7, #2979ff)';
        }
    }
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
            🌊 Loading Fukushima Plume Simulator
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
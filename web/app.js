// web/app.js - HYBRID LEAFLET + DECK.GL VERSION WITH HYCOM
console.log('=== app.js STARTING HYBRID VERSION WITH HYCOM ===');

// Global variables
let engine = null;
let animationId = null;

// Leaflet globals
let simMap = null;
let particleCanvas = null;

// Deck.gl globals
let deckgl = null;
let heatmapLayer = null;
let showHeatmap = true;

let heatmapParams = {
    intensity: 10.0,
    radiusPixels: 150,
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
let heatmapData = [];
let lastHeatmapUpdate = 0;
const HEATMAP_UPDATE_INTERVAL = 500;

async function init() {
    console.log('=== INITIALIZATION HYBRID VERSION WITH HYCOM ===');

    // Create loading screen
    const loadingStatus = createStatusElement();
    updateLoadingStatus('Initializing...', 10);

    try {
        // 1. CREATE LEAFLET MAP
        updateLoadingStatus('Creating map...', 20);
        console.log('Creating Leaflet map...');
        simMap = L.map('map', {
            center: [25.0, 165.0],
            zoom: 3,
            minZoom: 2,
            maxZoom: 8,
            worldCopyJump: false,
            attributionControl: true,
            zoomControl: true,
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

        // 5. INITIALIZE PARTICLE ENGINE WITH HYCOM
        updateLoadingStatus('Loading ocean data...', 50);
        if (typeof ParticleEngine === 'function') {
            engine = new ParticleEngine(10000);

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
        setupHeatmapControls();
        updateUIForEngine();
        updateDateTimeDisplay();

        // 8. ADD MAP EVENT LISTENERS
        simMap.on('moveend resize zoomend', function() {
            updateCanvasOverlay();
            updateDeckGLView();
        });

        // 9. START ANIMATION
        updateLoadingStatus('Ready!', 100);
        setTimeout(() => {
            hideLoadingStatus();
            animate();
        }, 500);

        console.log('✅ Hybrid Leaflet + deck.gl with HYCOM initialized');
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
                blendFunc: [0x0302, 0x0303]
            }
        });

        // Sync deck.gl with Leaflet view
        updateDeckGLView();

        // Handle window resize
        window.addEventListener('resize', handleResize);

        console.log('✅ deck.gl initialized successfully');
        document.getElementById('heatmap-control').style.display = 'block';

    } catch (error) {
        console.error('Failed to initialize deck.gl:', error);
        console.warn('Running in Leaflet-only mode');
        showDataWarning('WebGL heatmap not available. Using particles only.');
    }
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

function createDensityGrid(particles, gridSize = 0.5) {
    const grid = {};

    if (!particles || particles.length === 0) {
        return [];
    }

    particles.forEach(p => {
        const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
        const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

        // Round to grid cell
        const gridX = Math.floor(lon / gridSize);
        const gridY = Math.floor(lat / gridSize);
        const key = `${gridX},${gridY}`;

        if (!grid[key]) {
            grid[key] = {
                position: [gridX * gridSize + gridSize/2, gridY * gridSize + gridSize/2],
                mass: 0,
                count: 0
            };
        }

        grid[key].mass += p.mass;
        grid[key].count++;
    });

    // Convert to array
    const data = Object.values(grid);

    if (data.length === 0) return [];

    // Calculate densities
    const cellArea = gridSize * 111 * gridSize * 111 * Math.cos(37.4 * Math.PI/180); // km²
    data.forEach(cell => {
        // Concentration in "mass per 1000 km²"
        cell.density = (cell.mass / cellArea) * 1000;
    });

    // Normalize for visualization
    const maxDensity = Math.max(...data.map(d => d.density));
    if (maxDensity > 0) {
        data.forEach(cell => {
            cell.normalizedDensity = cell.density / maxDensity;
        });
    }

    console.log(`📍 Density grid: ${data.length} cells, Max density=${maxDensity.toExponential(2)}`);
    return data;
}

function updateDeckGLHeatmap(particles) {
    if (!deckgl || !showHeatmap || particles.length === 0) return;

    const now = Date.now();
    if (now - lastHeatmapUpdate < HEATMAP_UPDATE_INTERVAL) return;
    lastHeatmapUpdate = now;

    // Create density grid
    const gridData = createDensityGrid(particles, heatmapParams.gridSize);
    if (gridData.length === 0) return;

    // Convert to heatmap points
    const heatmapData = gridData.map(cell => ({
        position: cell.position,
        weight: cell.density
    }));

    // Calculate stats
    const weights = heatmapData.map(d => d.weight);
    const maxWeight = Math.max(...weights);
    const avgWeight = weights.reduce((a, b) => a + b) / weights.length;

    console.log(`📊 Heatmap stats: Max=${maxWeight.toFixed(4)}, Avg=${avgWeight.toFixed(4)}, Cells=${heatmapData.length}`);

    try {
        heatmapLayer = new deck.HeatmapLayer({
            id: 'fukushima-heatmap',
            data: heatmapData,
            getPosition: d => d.position,
            getWeight: d => {
                let weight = d.weight;
                if (heatmapParams.useLogScale) {
                    weight = Math.log10(1 + weight * 100);
                }
                return weight * heatmapParams.intensity * 10;
            },
            colorRange: [
                [13, 8, 135, 0],
                [40, 60, 190, 50],
                [23, 154, 176, 100],
                [13, 188, 121, 150],
                [62, 218, 79, 200],
                [130, 226, 74, 220],
                [192, 226, 70, 235],
                [243, 210, 65, 245],
                [251, 164, 57, 250],
                [241, 99, 55, 255],
                [231, 29, 43, 255],
                [190, 0, 38, 255]
            ],
            radiusPixels: heatmapParams.radiusPixels,
            intensity: 5.0,
            threshold: 0.01,
            colorDomain: [0, 10],
            aggregation: 'SUM'
        });

        deckgl.setProps({
            layers: [heatmapLayer]
        });
    } catch (error) {
        console.error('Failed to create heatmap layer:', error);
    }
}

function clearDeckGLHeatmap() {
    if (!deckgl) return;
    deckgl.setProps({
        layers: []
    });
}

// ==================== HEATMAP CONTROLS ====================

function setupHeatmapControls() {
    // Main toggle
    const heatmapToggleMain = document.getElementById('heatmapToggleMain');
    if (heatmapToggleMain) {
        heatmapToggleMain.checked = showHeatmap;
        heatmapToggleMain.addEventListener('change', (e) => {
            showHeatmap = e.target.checked;
            toggleHeatmap();
        });
    }

    // Heatmap panel toggle
    const heatmapToggle = document.getElementById('heatmapToggle');
    if (heatmapToggle) {
        heatmapToggle.checked = showHeatmap;
        heatmapToggle.addEventListener('change', (e) => {
            showHeatmap = e.target.checked;
            toggleHeatmap();
            if (heatmapToggleMain) heatmapToggleMain.checked = showHeatmap;
        });
    }

    // Intensity slider
    const intensitySlider = document.getElementById('intensitySlider');
    const intensityValue = document.getElementById('intensityValue');
    if (intensitySlider && intensityValue) {
        intensitySlider.value = heatmapParams.intensity;
        intensityValue.textContent = heatmapParams.intensity.toFixed(1);
        intensitySlider.addEventListener('input', (e) => {
            heatmapParams.intensity = parseFloat(e.target.value);
            intensityValue.textContent = heatmapParams.intensity.toFixed(1);
        });
    }

    // Radius slider
    const radiusSlider = document.getElementById('radiusSlider');
    const radiusValue = document.getElementById('radiusValue');
    if (radiusSlider && radiusValue) {
        radiusSlider.value = heatmapParams.radiusPixels;
        radiusValue.textContent = heatmapParams.radiusPixels;
        radiusSlider.addEventListener('input', (e) => {
            heatmapParams.radiusPixels = parseInt(e.target.value);
            radiusValue.textContent = heatmapParams.radiusPixels;
        });
    }

    // Log scale toggle
    setTimeout(() => {
        const logToggle = document.getElementById('logScaleToggle');
        if (logToggle) {
            logToggle.checked = heatmapParams.useLogScale;
            logToggle.addEventListener('change', (e) => {
                heatmapParams.useLogScale = e.target.checked;
            });
        }
    }, 100);
}

function toggleHeatmap() {
    const deckCanvas = document.getElementById('deckgl-overlay');
    if (!deckCanvas) return;

    if (showHeatmap) {
        // Heatmap ON
        deckCanvas.style.opacity = '1';

        // FORCE refresh when toggling ON
        if (engine && !engine.isRunning) {
            // Get current particles and create heatmap
            const particles = engine.getActiveParticles();
            if (particles.length > 0) {
                updateDeckGLHeatmap(particles);
            }
        }
        console.log('🔥 Heatmap ON - Particles hidden');
    } else {
        // Heatmap OFF
        deckCanvas.style.opacity = '0';
        clearDeckGLHeatmap();
        console.log('🌀 Heatmap OFF - Particles visible');
    }

    // Update particle display
    if (particleCanvas && engine) {
        const particles = engine.getActiveParticles();
        particleCanvas.updateParticles(particles);
    }
}

// ==================== LEAFLET FUNCTIONS ====================

function createCanvasOverlay() {
    const particleLayer = L.layerGroup();
    window.particleMarkers = [];

    particleLayer.updateParticles = function(particles) {
        // Clear existing markers
        this.clearLayers();
        window.particleMarkers = [];

        // If heatmap is ON, don't draw particles
        if (showHeatmap || !engine) {
            return;
        }

        // Only draw particles when heatmap is OFF
        const limit = Math.min(particles.length, 2000);

        for (let i = 0; i < limit; i++) {
            const p = particles[i];
            const lon = engine.FUKUSHIMA_LON + (p.x / engine.LON_SCALE);
            const lat = engine.FUKUSHIMA_LAT + (p.y / engine.LAT_SCALE);

            const color = '#4fc3f7';
            const marker = L.circleMarker([lat, lon], {
                radius: Math.max(1, Math.sqrt(p.mass) * 2),
                color: color,
                fillColor: color,
                fillOpacity: 0.6 + p.mass * 0.3,
                weight: 0.5,
                opacity: 0.8
            });

            marker.bindPopup(`
                <div style="font-family: 'Segoe UI', sans-serif; font-size: 12px;">
                    <strong>Cesium-137 Particle</strong><br>
                    Location: ${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E<br>
                    Age: ${p.age.toFixed(1)} days<br>
                    Mass: ${p.mass.toFixed(3)}<br>
                    Distance: ${Math.sqrt(p.x*p.x + p.y*p.y).toFixed(0)} km
                </div>
            `);

            marker.addTo(this);
            window.particleMarkers.push(marker);
        }

        console.log(`✅ Drew ${limit} particles (heatmap: ${showHeatmap})`);
    };

    particleLayer.clearAllParticles = function() {
        this.clearLayers();
        window.particleMarkers = [];
        clearDeckGLHeatmap();
        console.log('🧹 Cleared ALL visualization layers');
    };

    return particleLayer;
}

// ==================== ANIMATION LOOP ====================

function animate() {
    if (engine && engine.isRunning) {
        // Update simulation
        engine.update();

        // Get current particles
        const particles = engine.getActiveParticles();

        // Update heatmap if enabled
        if (showHeatmap) {
            updateDeckGLHeatmap(particles);
        }

        // Update particles on map
        if (particleCanvas && particleCanvas.updateParticles) {
            particleCanvas.updateParticles(particles);
        }

        // Update UI
        updateDateTimeDisplay();
        updateStatsDisplay();
        updateUIForEngine();
        updateDataSourceDisplay();
    }

    animationId = requestAnimationFrame(animate);
}

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

    // Update date display only (no time)
    const dateDisplay = document.getElementById('dateDisplay');
    if (dateDisplay) {
        const dateStr = currentSimulationDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const dateLabel = dateDisplay.querySelector('.date-label') || dateDisplay;
        dateLabel.textContent = dateStr;
    }

    // Update simulation day
    const simDayDisplay = document.getElementById('simDay');
    if (simDayDisplay) {
        simDayDisplay.textContent = Math.floor(simulationDay);
    }

    // REMOVE time display completely
    const timeLabel = document.getElementById('timeLabel');
    if (timeLabel) {
        timeLabel.textContent = ''; // Empty string
        // Or you can remove it from DOM entirely:
        // timeLabel.style.display = 'none';
    }
}
function setupDiffusionControls() {
    // Add to your HTML:
    // <div class="slider-container">
    //     <label>Diffusion: <span id="diffusionValue">1.0</span>x</label>
    //     <input type="range" id="diffusionSlider" min="0.0" max="2.0" step="0.1" value="1.0">
    // </div>
    // <div class="toggle-container">
    //     <label>Enable Diffusion</label>
    //     <label class="toggle-switch">
    //         <input type="checkbox" id="diffusionToggle" checked>
    //         <span class="toggle-slider"></span>
    //     </label>
    // </div>

    const diffusionSlider = document.getElementById('diffusionSlider');
    const diffusionToggle = document.getElementById('diffusionToggle');

    if (diffusionSlider) {
        diffusionSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            document.getElementById('diffusionValue').textContent = value.toFixed(1);

            if (engine) {
                engine.setParameter('diffusionStrength', value);
            }
        });
    }

    if (diffusionToggle) {
        diffusionToggle.addEventListener('change', (e) => {
            if (engine) {
                engine.setParameter('enableDiffusion', e.target.checked);
                console.log(`Diffusion ${e.target.checked ? 'ENABLED' : 'DISABLED'}`);
            }
        });
    }
}
function updateStatsDisplay() {
    if (!engine) return;

    const particleCount = document.getElementById('particleCount');
    const totalReleased = document.getElementById('totalReleased');
    const decayedCount = document.getElementById('decayedCount');

    if (particleCount) {
        const active = engine.getActiveParticles().length;
        particleCount.textContent = active.toLocaleString();
    }

    if (totalReleased) {
        totalReleased.textContent = (engine.stats.totalReleased || 0).toLocaleString();
    }

    if (decayedCount) {
        decayedCount.textContent = (engine.stats.totalDecayed || 0).toLocaleString();
    }
}

function addMapControls(map) {
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
}

function updateCanvasOverlay() {
    if (particleCanvas && particleCanvas.redraw) {
        particleCanvas.redraw();
    }
}

function setupControls() {
    console.log('Setting up controls...');

    // Get controls
    const diffusionSlider = document.getElementById('diffusionSlider');
    const speedSlider = document.getElementById('speedSlider');
    const startBtn = document.getElementById('startBtn');
    const resetBtn = document.getElementById('resetBtn');

    // Diffusion slider - simple control
    if (diffusionSlider) {
        diffusionSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);

            // Update display
            const diffusionValue = document.getElementById('diffusionValue');
            diffusionValue.textContent = value.toFixed(1);

            // Color code for visual feedback
            if (value === 0) {
                diffusionValue.style.color = '#ff6b6b';
                diffusionValue.textContent = '0 (Pure HYCOM)';
            } else {
                diffusionValue.style.color = '#4fc3f7';
            }

            // Update engine
            if (engine && engine.setParameter) {
                engine.setParameter('diffusivityScale', value);
                console.log(`Diffusion scale: ${value}x`);
            }
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
                    // Fresh start - use startSimulation
                    engine.startSimulation();
                    startBtn.textContent = '⏸️ Pause Simulation';
                    console.log('🚀 Simulation started fresh');
                } else {
                    // Resume from pause - use resumeSimulation
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

    // Reset button - fully reset everything
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (engine) {
                if (particleCanvas && particleCanvas.clearAllParticles) {
                    particleCanvas.clearAllParticles();
                }

                // Reset the engine
                engine.resetSimulation();

                // CRITICAL: Also reset the UI's date variables
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

    // Update sliders
    const diffusionSlider = document.getElementById('diffusionSlider');
    const speedSlider = document.getElementById('speedSlider');

    // Update diffusion slider
    if (diffusionSlider) {
        diffusionSlider.value = params.diffusivityScale;
        const diffusionValue = document.getElementById('diffusionValue');
        diffusionValue.textContent = params.diffusivityScale.toFixed(1);

        // Color code
        if (params.diffusivityScale === 0) {
            diffusionValue.style.color = '#ff6b6b';
            diffusionValue.textContent = '0 (Pure HYCOM)';
        } else {
            diffusionValue.style.color = '#4fc3f7';
        }
    }

    // Update speed slider
    if (speedSlider) {
        speedSlider.value = params.simulationSpeed;
        document.getElementById('speedValue').textContent = params.simulationSpeed.toFixed(1);
    }

    // Update start/pause/resume button
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        if (engine.isRunning) {
            startBtn.textContent = '⏸️ Pause Simulation';
            startBtn.style.background = 'linear-gradient(135deg, #ff6b6b, #ff4757)';
        } else {
            // Determine button text based on simulation state
            if (engine.stats.totalReleased === 0 && engine.stats.simulationDays === 0) {
                startBtn.textContent = '▶ Start Simulation'; // Fresh start
            } else {
                startBtn.textContent = '▶ Resume Simulation'; // Paused state
            }
            startBtn.style.background = 'linear-gradient(135deg, #4fc3f7, #2979ff)';
        }
    }

    updateStatsDisplay();
}
function updateDataSourceDisplay() {
    if (!engine) return;

    const sourceElem = document.getElementById('dataSource');
    const particleElem = document.getElementById('particleCount');

    if (sourceElem) {
        // Get HYCOM info
        const info = engine.getDataSourceInfo ? engine.getDataSourceInfo() : { source: 'Unknown' };

        if (info.source === 'HYCOM') {
            const date = new Date(info.year, info.month - 1, 1);
            const monthName = date.toLocaleDateString('en-US', { month: 'long' });
            sourceElem.textContent = `HYCOM ${monthName} ${info.year}`;
            sourceElem.style.color = '#4fc3f7';
        } else {
            sourceElem.textContent = info.source;
            sourceElem.style.color = '#ff6b6b';
        }
    }

    if (particleElem && engine.isRunning) {
        const active = engine.getActiveParticles().length;
        particleElem.textContent = active.toLocaleString();
        particleElem.style.color = active > 0 ? '#4fc3f7' : '#ff6b6b';
    }
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

// Start application
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 100);
}
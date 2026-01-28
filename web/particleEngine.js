
// web/particleEngine.js - COMPLETE REWRITTEN VERSION
console.log('=== Loading Enhanced ParticleEngine ===');

class ParticleEngine {
    constructor(numParticles = 20000) {
        console.log('🚀 Creating Enhanced ParticleEngine');

        // Core data stores
        this.particles = [];
        this.currentData = null;
        this.ekeData = null;  // AVISO EKE data

        // Physics parameters
        this.params = {
            // Ocean currents
            kuroshioMultiplier: 1.0,      // Enhance/weaken Kuroshio current
            useBilinearInterpolation: true, // Smooth current interpolation

            // Diffusion physics
            useEKEData: true,             // Use real AVISO EKE data (true) or fallback (false)
            diffusivityScale: 1.0,        // Multiply K by this factor
            lagrangianTimescale: 7,       // T_L in days (critical physics parameter!)
            minimumDiffusivity: 20.0,     // Minimum K in m²/s (coastal)

            // Simulation control
            simulationSpeed: 1.0,         // Real-time multiplier
            decayEnabled: true,           // Radioactive decay
            continuousRelease: true,      // Continuous particle emission

            // Advanced diffusion
            enableShearDispersion: true,  // Velocity shear spreading
            enableWindStirring: true      // Wind-driven mixing
        };

        // Fukushima location
        this.FUKUSHIMA_LON = 141.6;
        this.FUKUSHIMA_LAT = 37.4;

        // Pacific bounds
        this.PACIFIC_BOUNDS = {
            minLon: 120,   // 120°E
            maxLon: -110,  // 110°W
            minLat: -20,   // 20°S
            maxLat: 60     // 60°N
        };

        // Scale factors (km per degree at ~37°N)
        this.LON_SCALE = 88.8;   // km/degree longitude
        this.LAT_SCALE = 111.0;  // km/degree latitude

        // Isotope data with realistic half-lives
        this.isotopes = {
            'Cs137': {
                name: 'Cesium-137',
                halfLifeDays: 30.17 * 365.25,
                color: '#FF6B6B',
                initialMass: 1.0
            },
        };

        // Simulation state
        this.isRunning = false;
        this.lastUpdateTime = Date.now();
        this.simulationStartTime = new Date('2011-03-11T00:00:00Z');
        this.currentSimulationTime = new Date(this.simulationStartTime);

        // Statistics
        this.stats = {
            totalReleased: 0,
            totalDecayed: 0,
            simulationDays: 0,

            // Particle counts
            activeByIsotope: { Cs137: 0, Sr90: 0, H3: 0 },

            // Regional distribution
            byRegion: {
                coastal_japan: 0,
                kuroshio_region: 0,
                west_pacific: 0,
                central_pacific: 0,
                east_pacific: 0,
                us_west_coast: 0
            },

            // Diffusivity stats
            avgDiffusivity: 0,
            maxDiffusivity: 0,
            diffusivityReadings: 0,

            // Current stats
            avgCurrentSpeed: 0,
            maxCurrentSpeed: 0
        };

        // Release schedule (based on actual 2011 events)
        this.releaseSchedule = [
            { day: 0, amount: 300, label: 'Initial release (Mar 11)', released: false },
            { day: 3, amount: 1000, label: 'Major release (Mar 14)', released: false },
            { day: 7, amount: 800, label: 'Continued release (Mar 18)', released: false },
            { day: 30, amount: 400, label: 'Late release (Apr 10)', released: false }
        ];

        // Initialize particle pool
        this.particlePool = [];
        this.initializeParticlePool(numParticles);

        console.log('✅ Enhanced ParticleEngine initialized');
    }
// ==================== DEBUG SYSTEM ====================

enableDebug() {
    console.log('🔍 DEBUG MODE ENABLED');
    this.params.debugMode = true;
    this.debugStats = {
        frameCount: 0,
        totalDeltaDays: 0,
        maxDeltaDays: 0,
        maxCurrentSpeed: 0,
        maxMovementPerFrame: 0,
        sampleParticleId: null,
        framesPerSecond: 0,
        lastFPSUpdate: Date.now()
    };

    // Track a specific particle for detailed analysis
    const activeParticles = this.getActiveParticles();
    if (activeParticles.length > 0) {
        this.debugStats.sampleParticleId = activeParticles[0].id;
    }

    return this;
}

disableDebug() {
    console.log('🔍 DEBUG MODE DISABLED');
    this.params.debugMode = false;
    return this;
}

logFrameDebug(deltaDays, particle, current) {
    if (!this.params.debugMode) return;

    this.debugStats.frameCount++;
    this.debugStats.totalDeltaDays += deltaDays;
    this.debugStats.maxDeltaDays = Math.max(this.debugStats.maxDeltaDays, deltaDays);

    const currentSpeed = Math.sqrt(current.u * current.u + current.v * current.v);
    this.debugStats.maxCurrentSpeed = Math.max(this.debugStats.maxCurrentSpeed, currentSpeed);

    // Calculate movement per frame
    const moveX = current.u * deltaDays;
    const moveY = current.v * deltaDays;
    const movementDistance = Math.sqrt(moveX * moveX + moveY * moveY);
    this.debugStats.maxMovementPerFrame = Math.max(this.debugStats.maxMovementPerFrame, movementDistance);

    // FPS calculation
    const now = Date.now();
    if (now - this.debugStats.lastFPSUpdate >= 1000) {
        this.debugStats.framesPerSecond = this.debugStats.frameCount;
        this.debugStats.frameCount = 0;
        this.debugStats.lastFPSUpdate = now;

        // Log summary every second
        console.log('══════════════════════════════════════════════════');
        console.log('🕐 FRAME DEBUG SUMMARY (per second)');
        console.log(`📊 FPS: ${this.debugStats.framesPerSecond}`);
        console.log(`⏱️  Avg deltaDays: ${(this.debugStats.totalDeltaDays / this.debugStats.framesPerSecond).toFixed(6)}`);
        console.log(`⚡ Max deltaDays: ${this.debugStats.maxDeltaDays.toFixed(6)}`);
        console.log(`🌊 Max current speed: ${this.debugStats.maxCurrentSpeed.toFixed(2)} km/day`);
        console.log(`🚀 Max movement/frame: ${this.debugStats.maxMovementPerFrame.toFixed(2)} km`);
        console.log('══════════════════════════════════════════════════');

        // Reset for next second
        this.debugStats.totalDeltaDays = 0;
        this.debugStats.maxDeltaDays = 0;
        this.debugStats.maxCurrentSpeed = 0;
        this.debugStats.maxMovementPerFrame = 0;
    }

    // Detailed particle tracking (every 60 frames ~= 1 second at 60 FPS)
    if (particle && particle.id === this.debugStats.sampleParticleId) {
        if (this.debugStats.frameCount % 60 === 0) {
            console.log('🔬 SAMPLE PARTICLE DETAILS');
            console.log(`   Particle ID: ${particle.id}`);
            console.log(`   Position (km): x=${particle.x.toFixed(2)}, y=${particle.y.toFixed(2)}`);
            console.log(`   Age: ${particle.age.toFixed(2)} days`);
            console.log(`   Current (u,v): ${current.u.toFixed(2)}, ${current.v.toFixed(2)} km/day`);
            console.log(`   Movement this frame: ${movementDistance.toFixed(2)} km`);
            console.log(`   Distance from Fukushima: ${Math.sqrt(particle.x*particle.x + particle.y*particle.y).toFixed(2)} km`);
        }
    }
}

    // Add this method to check unit conversions
    validateUnits() {
        console.log('🔧 UNIT VALIDATION CHECK');

        // Test current conversion
        const testLon = 141.6; // Fukushima
        const testLat = 37.4;
        const current = this.getCurrentAt(testLon, testLat);

        console.log(`📍 Test at Fukushima (${testLon}°, ${testLat}°)`);
        console.log(`   Current from getCurrentAt(): u=${current.u.toFixed(4)}, v=${current.v.toFixed(4)} km/day`);

        // Calculate what it should be
        // Real Kuroshio ~0.5 m/s = 0.0005 km/s = 43.2 km/day
        console.log(`   Expected (Kuroshio): ~43.2 km/day`);
        console.log(`   Ratio (actual/expected): ${(current.u / 43.2).toFixed(2)}x`);

        // Check deltaDays calculation
        const testDelta = 0.016; // ~60 FPS
        console.log(`\n⏱️  Time step analysis:`);
        console.log(`   Test deltaDays: ${testDelta} (simulation days per frame)`);
        console.log(`   Expected movement: ${(current.u * testDelta).toFixed(2)} km/frame`);
        console.log(`   At 60 FPS: ${(current.u * testDelta * 60).toFixed(2)} km/second`);
        console.log(`   Pacific crossing (~8000km): ${(8000 / (current.u * testDelta * 60)).toFixed(1)} seconds`);

        return {
            currentSpeed: current.u,
            expectedSpeed: 43.2,
            ratio: current.u / 43.2,
            crossingTime: 8000 / (current.u * testDelta * 60)
        };
    }
    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing with data...');

        try {
            // Load OSCAR current data
            await this.loadCurrentData();

            // Load AVISO EKE data
            await this.loadEKEData();

            console.log('✅ All data loaded successfully');
            return true;
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            return false;
        }
    }

    async loadCurrentData() {
        console.log('🌊 Loading OSCAR current data...');

        try {
            const response = await fetch('data/current_field.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            this.currentData = await response.json();

            // Validate structure
            if (!this.currentData.lons || !this.currentData.u) {
                throw new Error('Invalid OSCAR data format');
            }

            console.log(`✅ OSCAR data: ${this.currentData.lons.length}x${this.currentData.lats.length} grid`);
            return true;
        } catch (error) {
            console.error('Failed to load OSCAR data:', error);
            this.createFallbackCurrentField();
            return false;
        }
    }

    async loadEKEData() {
        console.log('🌀 Loading synthetic EKE data...');

        try {
            const response = await fetch('data/eke_pacific.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            this.ekeData = await response.json();

            // Validate structure
            if (!this.ekeData.lons || !this.ekeData.eke) {
                throw new Error('Invalid EKE data format');
            }

            // Calculate statistics
            const flatEKE = this.ekeData.eke.flat().filter(v => v > 0);
            if (flatEKE.length > 0) {
                const avgEKE = flatEKE.reduce((a, b) => a + b) / flatEKE.length;
                const avgK = this.ekeToDiffusivity(avgEKE);

                console.log(`✅ EKE data loaded: ${this.ekeData.lons.length}x${this.ekeData.lats.length} grid`);
                console.log(`   Avg EKE: ${avgEKE.toFixed(4)} m²/s² → Avg K: ${avgK.toFixed(1)} m²/s`);
                console.log(`   EKE range: ${Math.min(...flatEKE).toFixed(4)} to ${Math.max(...flatEKE).toFixed(4)} m²/s²`);
            }

            return true;
        } catch (error) {
            console.error('Failed to load EKE data:', error);
            return false;
        }
    }

    createFallbackCurrentField() {
        console.log('Creating fallback current field...');

        // Simple 5x5 grid for fallback
        const lons = [120, 135, 150, 165, 180, -165, -150, -135, -120, -105];
        const lats = [-20, -5, 10, 25, 40, 55];

        const u = [];
        const v = [];

        for (let j = 0; j < lats.length; j++) {
            u[j] = new Array(lons.length).fill(0);
            v[j] = new Array(lons.length).fill(0);

            for (let i = 0; i < lons.length; i++) {
                // Simple Kuroshio pattern
                const distFromJapan = Math.sqrt(
                    Math.pow(lons[i] - 141.6, 2) +
                    Math.pow(lats[j] - 37.4, 2)
                );

                const kuroshio = 0.5 * Math.exp(-distFromJapan / 30);
                u[j][i] = kuroshio * 0.5;  // m/s
                v[j][i] = 0.1 * Math.sin(lons[i] * Math.PI / 180);
            }
        }

        this.currentData = { lons, lats, u, v };
    }

    initializeParticlePool(numParticles) {
        console.log(`📦 Creating pool of ${numParticles} particles`);

        for (let i = 0; i < numParticles; i++) {
            this.particlePool.push({
                id: i,
                active: false,
                isotope: this.getRandomIsotope(),
                x: 0,           // km east of Fukushima
                y: 0,           // km north of Fukushima
                age: 0,         // days
                mass: 1.0,      // normalized activity
                history: [],    // for trails
                releaseTime: null,
                region: null
            });
        }
    }

    getRandomIsotope() {
        return 'Cs137';
    }

    // ==================== PHYSICS CORE ====================

    // Convert EKE to diffusivity using physics formula
    ekeToDiffusivity(eke) {
        if (!eke || eke <= 0) {
            return this.params.minimumDiffusivity;
        }

        // PHYSICS: K = C × EKE × T_L
        // C = 0.1 (empirical constant, Chelton et al. 2011)
        // T_L = Lagrangian timescale in seconds
        // EKE in m²/s²

        const C = 0.1;
        const T_L_seconds = this.params.lagrangianTimescale * 86400;

        let K = C * eke * T_L_seconds;

        // Apply user scaling
        K *= this.params.diffusivityScale;

        // Ensure minimum value
        return Math.max(this.params.minimumDiffusivity, K);
    }

    // Get EKE at position with bilinear interpolation
    getEKEAt(lon, lat) {
        if (!this.ekeData || !this.params.useEKEData) {
            return null;
        }

        const lons = this.ekeData.lons;
        const lats = this.ekeData.lats;
        const ekeGrid = this.ekeData.eke;

        // Find grid cell
        let i = 0, j = 0;
        for (i = 0; i < lons.length - 1; i++) {
            if (lon >= lons[i] && lon <= lons[i + 1]) break;
        }
        for (j = 0; j < lats.length - 1; j++) {
            if (lat >= lats[j] && lat <= lats[j + 1]) break;
        }

        // If outside grid, return null
        if (i >= lons.length - 1 || j >= lats.length - 1) {
            return null;
        }

        // Bilinear interpolation
        const lon1 = lons[i], lon2 = lons[i + 1];
        const lat1 = lats[j], lat2 = lats[j + 1];

        const eke11 = ekeGrid[j][i] || 0;
        const eke12 = ekeGrid[j][i + 1] || 0;
        const eke21 = ekeGrid[j + 1][i] || 0;
        const eke22 = ekeGrid[j + 1][i + 1] || 0;

        const wx = (lon - lon1) / (lon2 - lon1);
        const wy = (lat - lat1) / (lat2 - lat1);

        const ekeTop = eke11 * (1 - wx) + eke12 * wx;
        const ekeBottom = eke21 * (1 - wx) + eke22 * wx;
        const ekeValue = ekeTop * (1 - wy) + ekeBottom * wy;

        return ekeValue > 0 ? ekeValue : null;
    }

    // Get diffusivity at position (using EKE or fallback)
    getDiffusivityAt(lon, lat) {
        // Try to use real EKE data
        const eke = this.getEKEAt(lon, lat);
        if (eke !== null) {
            const K = this.ekeToDiffusivity(eke);

            // Update statistics
            this.stats.avgDiffusivity = (this.stats.avgDiffusivity * this.stats.diffusivityReadings + K) /
                                       (this.stats.diffusivityReadings + 1);
            this.stats.maxDiffusivity = Math.max(this.stats.maxDiffusivity, K);
            this.stats.diffusivityReadings++;

            return K; // m²/s
        }

        // Fallback: distance-based parameterization
        return this.getFallbackDiffusivity(lon, lat);
    }

    getFallbackDiffusivity(lon, lat) {
        const distanceKm = Math.sqrt(
            Math.pow((lon - 141.6) * this.LON_SCALE, 2) +
            Math.pow((lat - 37.4) * this.LAT_SCALE, 2)
        );

        // Fukushima study values (Tsumune et al. 2013)
        if (distanceKm < 200) return 20.0;
        if (distanceKm < 1000) return 80.0;
        if (distanceKm < 3000) return 150.0;
        return 200.0;
    }

    // Get ocean current at position
    getCurrentAt(lon, lat) {
        if (!this.currentData) {
            return this.getFallbackCurrent(lon, lat);
        }

        if (this.params.useBilinearInterpolation) {
            return this.getInterpolatedCurrent(lon, lat);
        }

        return this.getNearestCurrent(lon, lat);
    }

    getInterpolatedCurrent(lon, lat) {
        const lons = this.currentData.lons;
        const lats = this.currentData.lats;
        const u = this.currentData.u;
        const v = this.currentData.v;

        // Find grid cell
        let i = 0, j = 0;
        for (i = 0; i < lons.length - 1; i++) {
            if (lon >= lons[i] && lon <= lons[i + 1]) break;
        }
        for (j = 0; j < lats.length - 1; j++) {
            if (lat >= lats[j] && lat <= lats[j + 1]) break;
        }

        if (i >= lons.length - 1 || j >= lats.length - 1) {
            return this.getNearestCurrent(lon, lat);
        }

        // Bilinear interpolation
        const lon1 = lons[i], lon2 = lons[i + 1];
        const lat1 = lats[j], lat2 = lats[j + 1];

        const u11 = u[j][i] || 0, u12 = u[j][i + 1] || 0;
        const u21 = u[j + 1][i] || 0, u22 = u[j + 1][i + 1] || 0;

        const v11 = v[j][i] || 0, v12 = v[j][i + 1] || 0;
        const v21 = v[j + 1][i] || 0, v22 = v[j + 1][i + 1] || 0;

        const wx = (lon - lon1) / (lon2 - lon1);
        const wy = (lat - lat1) / (lat2 - lat1);

        const uTop = u11 * (1 - wx) + u12 * wx;
        const uBottom = u21 * (1 - wx) + u22 * wx;
        let uValue = uTop * (1 - wy) + uBottom * wy;

        const vTop = v11 * (1 - wx) + v12 * wx;
        const vBottom = v21 * (1 - wx) + v22 * wx;
        let vValue = vTop * (1 - wy) + vBottom * wy;

        // Apply Kuroshio multiplier to eastward currents
        const eastward = Math.max(0, uValue);
        uValue = eastward * this.params.kuroshioMultiplier + (uValue - eastward);

        uValue *= 0.01; // Convert cm/s to m/s
        vValue *= 0.01; // Convert cm/s to m/s
        // Convert m/s to km/day and return
        return {
            u: uValue * 86.4,
            v: vValue * 86.4
        };
    }

    getNearestCurrent(lon, lat) {
        const lons = this.currentData.lons;
        const lats = this.currentData.lats;
        const u = this.currentData.u;
        const v = this.currentData.v;

        // CRITICAL FIX: Find nearest grid INDEX, not just closest value
        let nearest_i = 0;
        let nearest_j = 0;
        let minDist = Infinity;

        for (let i = 0; i < lons.length; i++) {
            const dx = lons[i] - lon;
            for (let j = 0; j < lats.length; j++) {
                const dy = lats[j] - lat;
                const dist = dx * dx + dy * dy;

                if (dist < minDist) {
                    minDist = dist;
                    nearest_i = i;
                    nearest_j = j;
                }
            }
        }

        // Get values from the SAME grid cell
        let bestU = u[nearest_j][nearest_i] || 0;
        let bestV = v[nearest_j][nearest_i] || 0;

        // Apply Kuroshio multiplier (but only to eastward component)
        const eastward = Math.max(0, bestU);
        bestU = eastward * this.params.kuroshioMultiplier + (bestU - eastward);

        // Convert cm/s → m/s → km/day
        bestU *= 0.01 * 86.4; // cm/s to km/day
        bestV *= 0.01 * 86.4;

        return { u: bestU, v: bestV };
    }
    getFallbackCurrent(lon, lat) {
        const distFromJapan = Math.sqrt(
            Math.pow(lon - 141.6, 2) +
            Math.pow(lat - 37.4, 2)
        );

        const kuroshio = 0.5 * Math.exp(-distFromJapan / 30);
        const eastward = kuroshio * this.params.kuroshioMultiplier;
        const northward = 0.1 * Math.sin(lon * Math.PI / 180);

        return {
            u: eastward * 86.4,
            v: northward * 86.4
        };
    }

    // Get radioactive decay factor
    getDecayFactor(isotope, days) {
        const halfLife = this.isotopes[isotope]?.halfLifeDays;
        if (!halfLife || halfLife <= 0) return 1.0;

        return Math.pow(0.5, days / halfLife);
    }

    // Determine region for statistics
    getRegion(lon, lat) {
        if (lon > 140 && lon < 150) return 'coastal_japan';
        if (lon >= 150 && lon < 180) return 'kuroshio_region';
        if (lon >= 180 || lon < -160) return 'west_pacific';
        if (lon >= -160 && lon < -140) return 'central_pacific';
        if (lon >= -140 && lon < -120) return 'east_pacific';
        return 'us_west_coast';
    }

    // ==================== SIMULATION CONTROL ====================

    startSimulation() {
        if (this.isRunning) {
            console.warn('Simulation already running');
            return;
        }

        console.log('🚀 Starting simulation with EKE diffusion');
        this.isRunning = true;
        this.lastUpdateTime = Date.now();
        this.currentSimulationTime = new Date(this.simulationStartTime);

        // Reset stats
        this.resetStats();

        // Release initial particles
        this.releaseParticles(500);
    }

    stopSimulation() {
        console.log('⏸️ Stopping simulation');
        this.isRunning = false;
    }

    resetSimulation() {
        console.log('🔄 Resetting simulation');

        this.isRunning = false;
        this.currentSimulationTime = new Date(this.simulationStartTime);
        this.stats.simulationDays = 0;

        // Reset particles
        for (const p of this.particlePool) {
            p.active = false;
            p.x = 0;
            p.y = 0;
            p.age = 0;
            p.mass = 1.0;
            p.history = [];
            p.region = null;
        }

        // Reset release schedule
        for (const release of this.releaseSchedule) {
            release.released = false;
        }

        // Reset stats
        this.resetStats();
    }

    resetStats() {
        this.stats = {
            totalReleased: 0,
            totalDecayed: 0,
            simulationDays: 0,
            activeByIsotope: { Cs137: 0, Sr90: 0, H3: 0 },
            byRegion: {
                coastal_japan: 0,
                kuroshio_region: 0,
                west_pacific: 0,
                central_pacific: 0,
                east_pacific: 0,
                us_west_coast: 0
            },
            avgDiffusivity: 0,
            maxDiffusivity: 0,
            diffusivityReadings: 0,
            avgCurrentSpeed: 0,
            maxCurrentSpeed: 0,
            currentReadings: 0
        };
    }

    releaseParticles(count) {
        let released = 0;
        const releaseRadius = 150; // km - broader initial release

        for (const p of this.particlePool) {
            if (!p.active && released < count) {
                // Random position in release radius
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * releaseRadius;

                p.x = Math.cos(angle) * distance;
                p.y = Math.sin(angle) * distance;
                p.active = true;
                p.age = 0;
                p.mass = this.isotopes[p.isotope]?.initialMass || 1.0;
                p.releaseTime = new Date(this.currentSimulationTime);
                p.history = [{x: p.x, y: p.y}];

                released++;
            }
        }

        this.stats.totalReleased += released;

        if (released > 0) {
            console.log(`🎯 Released ${released} particles`);
        }

        return released;
    }

    // ==================== MAIN UPDATE LOOP ====================

    update() {
        if (!this.isRunning) return;

        const now = Date.now();
        const realElapsedSeconds = (now - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = now;

        // Simulation time elapsed (days)
        const deltaDays = realElapsedSeconds * this.params.simulationSpeed;

        // Update simulation clock
        this.currentSimulationTime.setTime(
            this.currentSimulationTime.getTime() + deltaDays * 86400000
        );
        this.stats.simulationDays += deltaDays;

        // Scheduled releases
        this.checkScheduledReleases();

        // Continuous release
        if (this.params.continuousRelease && Math.random() < 0.05) {
            this.releaseParticles(1);
        }

        // Update all particles
        this.updateParticles(deltaDays);
    }

    checkScheduledReleases() {
        for (const release of this.releaseSchedule) {
            if (!release.released && this.stats.simulationDays >= release.day) {
                this.releaseParticles(release.amount);
                release.released = true;
                console.log(`📅 ${release.label}: ${release.amount} particles`);
            }
        }
    }

    updateParticles(deltaDays) {
        // === DEBUG: Track frame timing ===
        if (this.params.debugMode && this.debugStats) {
            this.logFrameDebug(deltaDays);
        }

        // Reset counters
        const activeCounts = { Cs137: 0, Sr90: 0, H3: 0 };
        const regionCounts = {
            coastal_japan: 0,
            kuroshio_region: 0,
            west_pacific: 0,
            central_pacific: 0,
            east_pacific: 0,
            us_west_coast: 0
        };

        let currentSpeedSum = 0;
        let currentReadings = 0;

        // Get sample particle for debugging
        let sampleParticle = null;
        if (this.params.debugMode && this.debugStats && this.debugStats.sampleParticleId !== null) {
            sampleParticle = this.particlePool.find(p => p.id === this.debugStats.sampleParticleId);
        }

        // Pre-calculate for performance
        const sqrtDeltaDays = Math.sqrt(deltaDays);

        for (const p of this.particlePool) {
            if (!p.active) continue;

            // Current position
            const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
            const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);

            // ===== 1. ADVECTION (Mean currents) =====
            const current = this.getCurrentAt(lon, lat);

            // === DEBUG: Detailed logging for sample particle ===
            if (this.params.debugMode && p.id === this.debugStats?.sampleParticleId) {
                console.log('🔍 DEBUG PARTICLE MOVEMENT');
                console.log(`   Position: lon=${lon.toFixed(2)}, lat=${lat.toFixed(2)}`);
                console.log(`   Current: u=${current.u.toFixed(4)} km/day, v=${current.v.toFixed(4)} km/day`);
                console.log(`   Speed: ${Math.sqrt(current.u*current.u + current.v*current.v).toFixed(2)} km/day`);
                console.log(`   deltaDays: ${deltaDays.toFixed(6)}`);
                console.log(`   Movement: x+=${(current.u * deltaDays).toFixed(4)} km, y+=${(current.v * deltaDays).toFixed(4)} km`);
            }

            // Track current statistics
            const speed = Math.sqrt(current.u * current.u + current.v * current.v);
            currentSpeedSum += speed;
            currentReadings++;

            p.x += current.u * deltaDays;
            p.y += current.v * deltaDays;

            // ===== 2. DIFFUSION =====
            const K_m2_s = this.getDiffusivityAt(lon, lat);
            const K_km2_day = K_m2_s * 86.4; // Convert to km²/day

            // Random walk step: σ = √(2KΔt)
            const stepSize = Math.sqrt(2 * K_km2_day * deltaDays);

            // Apply diffusion in both directions
            p.x += (Math.random() - 0.5) * stepSize * 2.0;
            p.y += (Math.random() - 0.5) * stepSize * 2.0;

            // ===== 3. DECAY =====
            p.age += deltaDays;

            if (this.params.decayEnabled) {
                const decayFactor = this.getDecayFactor(p.isotope, deltaDays);
                p.mass *= decayFactor;

                if (p.mass < 0.001) {
                    p.active = false;
                    this.stats.totalDecayed++;
                    continue;
                }
            }

            // ===== 4. UPDATE STATISTICS =====
            activeCounts[p.isotope]++;

            const region = this.getRegion(lon, lat);
            p.region = region;
            regionCounts[region]++;

            // Store history for trails
            p.history.push({x: p.x, y: p.y});
            if (p.history.length > 10) {
                p.history.shift();
            }
        }

        // ===== 5. UPDATE GLOBAL STATS =====
        this.stats.activeByIsotope = activeCounts;
        this.stats.byRegion = regionCounts;

        if (currentReadings > 0) {
            this.stats.avgCurrentSpeed = (this.stats.avgCurrentSpeed * this.stats.currentReadings + currentSpeedSum) /
                                        (this.stats.currentReadings + currentReadings);
            this.stats.maxCurrentSpeed = Math.max(this.stats.maxCurrentSpeed, currentSpeedSum / currentReadings);
            this.stats.currentReadings += currentReadings;
        }
    }

    // ==================== UTILITY METHODS ====================

    getActiveParticles() {
        return this.particlePool.filter(p => p.active);
    }

    getFormattedTime() {
        return {
            year: this.currentSimulationTime.getUTCFullYear(),
            month: this.currentSimulationTime.getUTCMonth() + 1,
            day: this.currentSimulationTime.getUTCDate(),
            hour: this.currentSimulationTime.getUTCHours(),
            minute: this.currentSimulationTime.getUTCMinutes(),
            second: this.currentSimulationTime.getUTCSeconds()
        };
    }

    getStatus() {
        const active = this.getActiveParticles();
        return {
            isRunning: this.isRunning,
            daysElapsed: this.stats.simulationDays.toFixed(2),
            totalParticles: this.stats.totalReleased,
            activeParticles: active.length,
            decayedParticles: this.stats.totalDecayed,
            avgDiffusivity: this.stats.avgDiffusivity.toFixed(1),
            dataSource: this.params.useEKEData ? 'AVISO EKE' : 'Parameterized'
        };
    }

    setParameter(name, value) {
        if (name in this.params) {
            const oldValue = this.params[name];
            this.params[name] = value;
            console.log(`Parameter ${name}: ${oldValue} → ${value}`);
            return true;
        }
        return false;
    }
}

// Export to global scope
if (typeof window !== 'undefined') {
    window.ParticleEngine = ParticleEngine;
    console.log('✅ Enhanced ParticleEngine loaded');
}

console.log('=== ParticleEngine script complete ===');
// web/particleEngine.js - ENHANCED WITH OSCAR SUPPORT
class ParticleEngine {
    constructor(numParticles = 5000) {
        this.particles = [];
        this.currentData = null;

        // Enhanced parameters
        this.params = {
            kuroshioMultiplier: 1.0,
            diffusion: 2.0,           // Optimized for OSCAR's realistic currents
            simulationSpeed: 0.5,
            interpolation: true,      // Enable bilinear interpolation
            decayEnabled: true        // Enable radioactive decay
        };

        // OSCAR 2011 data region (from your processing)
        this.FUKUSHIMA_LON = 141.25;
        this.FUKUSHIMA_LAT = 37.25;
        this.MIN_LON = 130.0;     // 130°E
        this.MAX_LON = 250.0;     // 110°W = 250°E
        this.MIN_LAT = 20.0;
        this.MAX_LAT = 50.0;

        // Scale factors (km per degree)
        this.LON_SCALE = 88.8;    // km/degree at ~37°N
        this.LAT_SCALE = 111.0;   // km/degree (constant)

        // Performance optimization
        this.lastCurrentLookup = {};
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.gridCellSizeLon = null;
        this.gridCellSizeLat = null;

        // Decay constants (half-lives in days)
        this.DECAY_CONSTANTS = {
            'Cs137': 30.17 * 365.25,    // 30.17 years
            'Sr90': 28.8 * 365.25,      // 28.8 years
            'H3': 12.32 * 365.25        // 12.32 years
        };

        // Particle statistics
        this.stats = {
            totalReleased: 0,
            activeByIsotope: { 'Cs137': 0, 'Sr90': 0, 'H3': 0 },
            maxDistance: 0,
            simulationDays: 0
        };

        this.initializeParticles(numParticles);
    }

    initializeParticles(num) {
        console.log(`🚀 Initializing ${num} particles with OSCAR 2011 currents`);

        this.particles = [];
        const plumeRadius = 30; // km initial spread (realistic for initial release)

        // Isotope distribution (rough estimates from Fukushima)
        const isotopeRatios = [
            { type: 'Cs137', ratio: 0.6 },  // Cesium-137: ~60%
            { type: 'Sr90', ratio: 0.3 },   // Strontium-90: ~30%
            { type: 'H3', ratio: 0.1 }      // Tritium: ~10%
        ];

        for (let i = 0; i < num; i++) {
            // Circular plume with Gaussian distribution
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * plumeRadius * Math.sqrt(Math.random()); // More near center

            // Select isotope based on ratios
            const rand = Math.random();
            let cumulative = 0;
            let isotope = 'Cs137';
            for (const iso of isotopeRatios) {
                cumulative += iso.ratio;
                if (rand <= cumulative) {
                    isotope = iso.type;
                    break;
                }
            }

            this.particles.push({
                x: Math.cos(angle) * distance,
                y: Math.sin(angle) * distance,
                active: true,
                age: 0, // days
                mass: 1.0, // initial mass
                isotope: isotope,
                id: i
            });

            this.stats.activeByIsotope[isotope]++;
        }

        this.stats.totalReleased = num;
        console.log(`Isotopes: Cs137:${this.stats.activeByIsotope['Cs137']}, Sr90:${this.stats.activeByIsotope['Sr90']}, H3:${this.stats.activeByIsotope['H3']}`);
    }

    async loadCurrentData() {
        try {
            console.log('🌊 Loading OSCAR 2011 surface currents...');
            const response = await fetch('data/current_field.json');

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.currentData = await response.json();
            console.log('✅ OSCAR data loaded:', this.currentData.meta);

            // Setup grid cache
            this.setupGridCache();

            // Test a current reading
            const testCurrent = this.getCurrentAt(0, 0);
            console.log(`Test current at Fukushima: u=${testCurrent.u.toFixed(1)}, v=${testCurrent.v.toFixed(1)} km/day`);

        } catch (error) {
            console.error('❌ Failed to load current data:', error);
            // Fallback to zero currents
            this.currentData = {
                lons: [this.FUKUSHIMA_LON],
                lats: [this.FUKUSHIMA_LAT],
                u: [[0]],
                v: [[0]],
                meta: { source: 'FALLBACK (zero currents)' }
            };
        }
    }

    setupGridCache() {
        if (!this.currentData || this.currentData.lons.length < 2) return;

        this.gridCellSizeLon = this.currentData.lons[1] - this.currentData.lons[0];
        this.gridCellSizeLat = this.currentData.lats[1] - this.currentData.lats[0];

        console.log(`📐 Grid: ${this.currentData.lons.length}×${this.currentData.lats.length}`);
        console.log(`   Cell size: ${this.gridCellSizeLon.toFixed(3)}° lon, ${this.gridCellSizeLat.toFixed(3)}° lat`);
        console.log(`   Domain: ${this.currentData.lons[0]}° to ${this.currentData.lons[this.currentData.lons.length-1]}°E`);
        console.log(`          ${this.currentData.lats[0]}° to ${this.currentData.lats[this.currentData.lats.length-1]}°N`);
    }

    getCurrentAt(x, y) {
        if (!this.currentData) return { u: 0, v: 0 };

        // Convert km to degrees
        let lon = this.FUKUSHIMA_LON + x / this.LON_SCALE;
        let lat = this.FUKUSHIMA_LAT + y / this.LAT_SCALE;

        // Clamp to OSCAR grid bounds
        lon = Math.max(this.MIN_LON, Math.min(this.MAX_LON, lon));
        lat = Math.max(this.MIN_LAT, Math.min(this.MAX_LAT, lat));

        // Use interpolation if enabled
        let current;
        if (this.params.interpolation && this.gridCellSizeLon) {
            current = this.getInterpolatedCurrent(lon, lat);
        } else {
            current = this.getNearestCurrent(lon, lat);
        }

        // Apply Kuroshio enhancement
        if (this.isInKuroshioRegion(lon, lat)) {
            current.u *= this.params.kuroshioMultiplier;
            current.v *= this.params.kuroshioMultiplier;
        }

        return current;
    }

    getInterpolatedCurrent(lon, lat) {
        const lons = this.currentData.lons;
        const lats = this.currentData.lats;

        // Find grid cell indices
        const i = Math.floor((lon - lons[0]) / this.gridCellSizeLon);
        const j = Math.floor((lat - lats[0]) / this.gridCellSizeLat);

        // Ensure we're within bounds
        if (i < 0 || i >= lons.length - 1 || j < 0 || j >= lats.length - 1) {
            return this.getNearestCurrent(lon, lat);
        }

        // Bilinear interpolation weights
        const dx = (lon - lons[i]) / this.gridCellSizeLon;
        const dy = (lat - lats[j]) / this.gridCellSizeLat;

        // Get the 4 surrounding grid values
        const u11 = this.currentData.u[j][i];
        const u12 = this.currentData.u[j][i + 1];
        const u21 = this.currentData.u[j + 1][i];
        const u22 = this.currentData.u[j + 1][i + 1];

        const v11 = this.currentData.v[j][i];
        const v12 = this.currentData.v[j][i + 1];
        const v21 = this.currentData.v[j + 1][i];
        const v22 = this.currentData.v[j + 1][i + 1];

        // Interpolate
        const u = (1 - dx) * (1 - dy) * u11 +
                  dx * (1 - dy) * u12 +
                  (1 - dx) * dy * u21 +
                  dx * dy * u22;

        const v = (1 - dx) * (1 - dy) * v11 +
                  dx * (1 - dy) * v12 +
                  (1 - dx) * dy * v21 +
                  dx * dy * v22;

        return { u, v };
    }

    getNearestCurrent(lon, lat) {
        const lons = this.currentData.lons;
        const lats = this.currentData.lats;

        // Find nearest indices
        let i = 0, minDist = Infinity;
        for (let idx = 0; idx < lons.length; idx++) {
            const dist = Math.abs(lons[idx] - lon);
            if (dist < minDist) {
                minDist = dist;
                i = idx;
            }
        }

        let j = 0; minDist = Infinity;
        for (let idx = 0; idx < lats.length; idx++) {
            const dist = Math.abs(lats[idx] - lat);
            if (dist < minDist) {
                minDist = dist;
                j = idx;
            }
        }

        return {
            u: this.currentData.u[j][i],
            v: this.currentData.v[j][i]
        };
    }

    isInKuroshioRegion(lon, lat) {
        // Kuroshio Current region
        return lon >= 130 && lon <= 150 && lat >= 25 && lat <= 40;
    }

    getDecayFactor(isotope, days) {
        if (!this.DECAY_CONSTANTS[isotope]) return 1.0;

        const halfLife = this.DECAY_CONSTANTS[isotope];
        return Math.exp(-Math.LN2 * days / halfLife);
    }

    update(dt = 1.0) {
        if (!this.currentData) return;

        const timeScale = 0.05 * this.params.simulationSpeed; // Real-time scaling
        const deltaDays = dt * timeScale;

        // Update simulation time
        this.stats.simulationDays += deltaDays;

        // Reset isotope counters
        const activeCounts = { 'Cs137': 0, 'Sr90': 0, 'H3': 0 };
        let maxDistance = 0;

        for (const p of this.particles) {
            if (!p.active) continue;

            // Get ocean current
            const current = this.getCurrentAt(p.x, p.y);

            // Advection (km/day × days)
            p.x += current.u * deltaDays;
            p.y += current.v * deltaDays;

            // Turbulent diffusion (random walk)
            const diffScale = this.params.diffusion * Math.sqrt(deltaDays);
            p.x += (Math.random() - 0.5) * diffScale;
            p.y += (Math.random() - 0.5) * diffScale;

            // Age particle
            p.age += deltaDays;

            // Radioactive decay
            if (this.params.decayEnabled && p.isotope) {
                const decayFactor = this.getDecayFactor(p.isotope, deltaDays);
                p.mass *= decayFactor;

                // Deactivate if decayed below threshold
                if (p.mass < 0.01) { // 1% remaining
                    p.active = false;
                    continue;
                }
            }

            // Update statistics
            const distance = Math.sqrt(p.x * p.x + p.y * p.y);
            maxDistance = Math.max(maxDistance, distance);
            activeCounts[p.isotope]++;

            // Boundary check
            const lon = this.FUKUSHIMA_LON + p.x / this.LON_SCALE;
            const lat = this.FUKUSHIMA_LAT + p.y / this.LAT_SCALE;

            if (lon < this.MIN_LON || lon > this.MAX_LON ||
                lat < this.MIN_LAT || lat > this.MAX_LAT) {
                p.active = false;
            }
        }

        // Update stats
        this.stats.activeByIsotope = activeCounts;
        this.stats.maxDistance = maxDistance;

        // Occasionally log stats
        if (Math.random() < 0.01) {
            const totalActive = Object.values(activeCounts).reduce((a, b) => a + b, 0);
            console.log(`📊 ${totalActive} active particles, Max distance: ${maxDistance.toFixed(0)}km`);
        }
    }

    reset() {
        const numParticles = this.particles.length;
        this.initializeParticles(numParticles);
        this.stats.simulationDays = 0;
        this.stats.maxDistance = 0;
        console.log('🔄 Simulation reset');
    }
}
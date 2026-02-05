// web/particleEngine.js - CLEAN VERSION WITH HYCOM + EKE
console.log('=== Loading ParticleEngine (Clean Version) ===');

class ParticleEngine {
    constructor(numParticles = 10000) {
        console.log('🚀 Creating ParticleEngine');

        // Loaders
        this.hycomLoader = window.streamingHycomLoaderDaily;
        this.ekeLoader = window.streamingEkeLoader;

        // Fukushima location
        this.FUKUSHIMA_LON = 140.6;
        this.FUKUSHIMA_LAT = 37.4;
                // ===== LEAFLET PROJECTION SETUP =====
        this.crs = L.CRS.EPSG3857;  // Web Mercator projection
        this.origin = this.crs.projection.origin;  // [0, 0] in pixel space
        this.initialZoom = 0;

        // Pre-calculate Fukushima in CRS coordinates (pixels)
        this.fukushimaCRS = this.crs.latLngToPoint(
            L.latLng(this.FUKUSHIMA_LAT, this.FUKUSHIMA_LON),
            this.initialZoom
        );

        console.log(`🗺️  CRS setup: Fukushima at ${this.fukushimaCRS.x},${this.fukushimaCRS.y} pixels`);

        // Scale factors (km per degree at ~37°N)
        this.LON_SCALE = 88.8;   // km/degree longitude
        this.LAT_SCALE = 111.0;  // km/degree latitude

        // Physics parameters - NO ARTIFICIAL MINIMUM!
        this.params = {
            diffusivityScale: 1.0,        // User slider: 0 = no diffusion
            simulationSpeed: 1.0,         // Real-time multiplier
            decayEnabled: true,           // Radioactive decay
            lagrangianTimescale: 7        // T_L in days (for physics formula)
        };

        // Isotope data
        this.isotopes = {
            'Cs137': {
                name: 'Cesium-137',
                halfLifeDays: 30.17 * 365.25, // ~30 years
                color: '#FF6B6B',
                initialMass: 1.0
            }
        };

        // Release phases (Kanda 2013, Rypina 2013)
        this.releasePhases = [
            // Phase 1: MAJOR LEAKS (21 Mar - 31 May 2011) ~13.73 PBq
            {
                startDay: 10, // ~March 21, 2011
                endDay: 80,   // ~May 31, 2011
                label: 'Major Leak Events (Mar-May 2011)',
                totalActivityPBq: 13.73,
            },
            // Phase 2: HIGH CONTINUOUS (1 Jun - 31 Aug 2011) ~8.58 TBq
            {
                startDay: 81,
                endDay: 172,
                label: 'Steady Continuous Release (Summer 2011)',
                dailyRateGBq: 93.2,
            },
            // Phase 3: DECLINING CONTINUOUS (1 Sep 2011 - 31 Mar 2012)
            {
                startDay: 173,
                endDay: 385,
                label: 'Declining Continuous Release',
                dailyRateGBq: 33.2,
            },
            // Phase 4: LOW-LEVEL (1 Apr - 30 Sep 2012)
            {
                startDay: 386,
                endDay: 568,
                label: 'Low-Level Continuous Release (2012)',
                dailyRateGBq: 8.1,
            }
        ];


        // Activity scaling: 1 particle = 1 GBq
        this.activityToParticleScale = 0.001;

        // Calculate Phase 1 daily rate
        const phase1 = this.releasePhases[0];
        phase1.dailyRateGBq = (phase1.totalActivityPBq * 1e6) / (phase1.endDay - phase1.startDay);

        console.log(`📅 Release phases: ${this.releasePhases.length} phases`);
        console.log(`   Phase 1: ${phase1.dailyRateGBq.toFixed(1)} GBq/day`);

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
            activeParticles: 0
        };
        this.stats.releaseDistribution = {
            gaussian: true,
            sigmaKm: 30,
            center: [141.31, 37.42]
        };

        // Initialize particle pool
        this.particlePool = [];
        this.initializeParticlePool(numParticles);

        console.log('✅ ParticleEngine initialized');
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing with HYCOM + EKE loaders...');

        try {
            // Initialize HYCOM loader
            if (this.hycomLoader && !this.hycomLoader.metadata) {
                await this.hycomLoader.init();
            }

            // Initialize EKE loader
            if (this.ekeLoader && !this.ekeLoader.metadata) {
                await this.ekeLoader.init();
            }

            console.log('✅ Loaders ready');
            return true;
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            return false;
        }
    }

    initializeParticlePool(numParticles) {
        console.log(`📦 Creating pool of ${numParticles} particles`);

        for (let i = 0; i < numParticles; i++) {
            this.particlePool.push({
                id: i,
                active: false,
                isotope: 'Cs137',
                x: 0,           // km east of Fukushima
                y: 0,           // km north of Fukushima
                age: 0,         // days
                mass: 1.0,      // normalized activity
                history: []     // position trail
            });
        }
    }


    startSimulation() {
        if (this.isRunning) {
            console.warn('Simulation already running');
            return;
        }

        console.log('🚀 Starting simulation');
        this.isRunning = true;
        this.lastUpdateTime = Date.now();

        // Only reset the clock if this is a fresh start (no particles released yet)
        if (this.stats.totalReleased === 0) {
            this.currentSimulationTime = new Date(this.simulationStartTime);
            this.stats.simulationDays = 0;

            // Release initial particles for first 10 days (March 11-21, 2011)
            const initialActivityPBq = 2.0;
            const initialParticles = Math.floor(initialActivityPBq * 1e6 * this.activityToParticleScale);

            if (initialParticles > 0) {
                const released = this.releaseParticles(initialParticles);
                console.log(`📈 Released ${released} particles for early March (11-21, 2011)`);
            }
        }
    }

    pauseSimulation() {
        if (!this.isRunning) {
            console.warn('Simulation already paused');
            return;
        }

        console.log('⏸️ Pausing simulation');
        this.isRunning = false;
        // Time continues from here when resumed
    }

    resumeSimulation() {
        if (this.isRunning) {
            console.warn('Simulation already running');
            return;
        }

        console.log('▶️ Resuming simulation');
        this.isRunning = true;
        this.lastUpdateTime = Date.now(); // Reset timer for delta calculation
        // currentSimulationTime stays as-is
    }

    stopSimulation() {
        console.log('⏹️ Stopping simulation (pause)');
        this.isRunning = false;
        // Don't reset time - this is just a pause
    }

    resetSimulation() {
        console.log('🔄 Resetting simulation');

        this.isRunning = false;
        this.currentSimulationTime = new Date(this.simulationStartTime);
        this.stats.simulationDays = 0;

        // Reset all particles
        for (const p of this.particlePool) {
            p.active = false;
            p.x = 0;
            p.y = 0;
            p.age = 0;
            p.mass = 1.0;
            p.history = [];
        }

        // Reset stats
        this.resetStats();
    }
    resetStats() {
        this.stats = {
            totalReleased: 0,
            totalDecayed: 0,
            simulationDays: 0,
            activeParticles: 0
        };
    }

    releaseParticles(count) {
        let released = 0;

        // === ACCURATE RELEASE PARAMETERS ===
        // Based on Rossi et al. (2013) "non-local source function"
        const RELEASE_CENTER = {
            lon: 141.31,  // Approx. Fukushima Daiichi location
            lat: 37.42
        };

        // Gaussian decay length-scale: 30 km (from Rossi paper)
        // Convert to degrees (approx. at 37°N)
        const SIGMA_LON = 30.0 / this.LON_SCALE;  // ~0.338 degrees
        const SIGMA_LAT = 30.0 / this.LAT_SCALE;  // ~0.270 degrees

        // Max spread: ±3 sigma covers 99.7% of particles
        const MAX_SPREAD = 3.0;

        for (const p of this.particlePool) {
            if (!p.active && released < count) {
                let lon, lat;
                let attempts = 0;
                const MAX_ATTEMPTS = 50; // Prevent infinite loop

                // === GAUSSIAN DISTRIBUTION WITH OCEAN CHECK ===
                do {
                    // Generate random position from 2D Gaussian
                    // Using Box-Muller transform for normal distribution
                    const u1 = Math.random();
                    const u2 = Math.random();
                    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
                    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

                    lon = RELEASE_CENTER.lon + z0 * SIGMA_LON;
                    lat = RELEASE_CENTER.lat + z1 * SIGMA_LAT;

                    attempts++;

                    // Constrain to reasonable bounds
                    lon = Math.max(RELEASE_CENTER.lon - MAX_SPREAD * SIGMA_LON,
                                 Math.min(RELEASE_CENTER.lon + MAX_SPREAD * SIGMA_LON, lon));
                    lat = Math.max(RELEASE_CENTER.lat - MAX_SPREAD * SIGMA_LAT,
                                 Math.min(RELEASE_CENTER.lat + MAX_SPREAD * SIGMA_LAT, lat));

                } while (attempts < MAX_ATTEMPTS &&
                        (lon < 141.0 || lon > 142.0 || lat < 37.0 || lat > 38.0)); // Broad geographic sanity check

                // === OCEAN VALIDATION ===
                // Check if position is actually in ocean
                const isInOcean = this.isPositionInOcean(lon, lat);

                if (!isInOcean) {
                    // Fallback to original ocean box method
                    const OCEAN_BOX = {
                        minLon: 141.21,
                        maxLon: 141.41,
                        minLat: 37.4,
                        maxLat: 37.6
                    };
                    lon = OCEAN_BOX.minLon + Math.random() * (OCEAN_BOX.maxLon - OCEAN_BOX.minLon);
                    lat = OCEAN_BOX.minLat + Math.random() * (OCEAN_BOX.maxLat - OCEAN_BOX.minLat);
                }

                // Convert to km offsets from Fukushima
                p.x = (lon - this.FUKUSHIMA_LON) * this.LON_SCALE;
                p.y = (lat - this.FUKUSHIMA_LAT) * this.LAT_SCALE;

                p.active = true;
                p.age = 0;
                p.mass = 1.0;
                p.history = [{x: p.x, y: p.y}];

                // Store actual release location for diagnostics
                p.releaseLon = lon;
                p.releaseLat = lat;

                released++;
            }
        }

        this.stats.totalReleased += released;

        if (released > 0) {
            console.log(`🎯 Released ${released} particles (Gaussian σ=30km)`);
            this.logReleaseStats();
        }

        return released;
    }

    // === HELPER METHOD FOR OCEAN VALIDATION ===
    async isPositionInOcean(lon, lat) {
        if (!this.hycomLoader) return false;

        try {
            // Use the HYCOM loader's land mask check
            // simulationDay = 0 for initial release (March 2011)
            return await this.hycomLoader.isOcean(lon, lat, 0);
        } catch (error) {
            console.warn('Ocean check failed, assuming ocean:', error);
            return true; // Optimistic fallback
        }
    }

    // === DIAGNOSTICS ===
    logReleaseStats() {
        const releasedParticles = this.particlePool.filter(p => p.active && p.releaseLon);

        if (releasedParticles.length === 0) return;

        const lons = releasedParticles.map(p => p.releaseLon);
        const lats = releasedParticles.map(p => p.releaseLat);

        console.log(`   Release area stats:`);
        console.log(`     Lon: ${Math.min(...lons).toFixed(3)}° to ${Math.max(...lons).toFixed(3)}°`);
        console.log(`     Lat: ${Math.min(...lats).toFixed(3)}° to ${Math.max(...lats).toFixed(3)}°`);

        // Calculate approximate 30km radius coverage
        const centerLon = lons.reduce((a, b) => a + b) / lons.length;
        const centerLat = lats.reduce((a, b) => a + b) / lats.length;
        console.log(`     Center: ${centerLon.toFixed(3)}°E, ${centerLat.toFixed(3)}°N`);
    }
    // ==================== CONTINUOUS RELEASE ====================

    executeContinuousRelease(deltaDays) {
        if (!this.isRunning) return;

        const currentSimDay = this.stats.simulationDays;
        let totalParticlesToRelease = 0;

        // Check each release phase
        for (const phase of this.releasePhases) {
            if (currentSimDay >= phase.startDay && currentSimDay <= phase.endDay) {
                const particlesThisStep = phase.dailyRateGBq * this.activityToParticleScale * deltaDays;
                totalParticlesToRelease += particlesThisStep;
            }
        }

        // Release particles
        if (totalParticlesToRelease > 0) {
            const count = Math.floor(totalParticlesToRelease);
            this.releaseParticles(count);
        }
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

        // 1. Continuous release
        this.executeContinuousRelease(deltaDays);

        // 2. Update particles
        this.updateParticles(deltaDays);
    }

    async updateParticles(deltaDays) {
        if (!this.isRunning) return;

        const activeParticles = this.getActiveParticles();
        if (activeParticles.length === 0) return;

        const currentSimDay = this.stats.simulationDays;
        const positions = [];
        const particleIndices = [];

        // 1. Collect current positions
        for (let i = 0; i < activeParticles.length; i++) {
            const p = activeParticles[i];
            const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
            const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);
            positions.push({ lon, lat });
            particleIndices.push(i);
        }

        // 2. Get HYCOM velocities (batch call) - USE simulationDay NOT dayIndex
        const velocities = await this.hycomLoader.getVelocitiesAtMultiple(
            positions,
            currentSimDay  // Pass simulation day directly
        );

        // 3. Get EKE diffusivities if available
        const diffusivities = [];
        if (this.ekeLoader) {
            try {
                const dateKey = await this.ekeLoader.setSimulationDay(currentSimDay);
                const diffResults = await this.ekeLoader.getDiffusivitiesAtMultiple(
                    positions,
                    dateKey
                );

                // Apply user's diffusion scale slider
                const scaledResults = diffResults.map(result => ({
                    K: result.found ? result.K * this.params.diffusivityScale : 0,
                    found: result.found
                }));

                diffusivities.push(...scaledResults);
            } catch (error) {
                console.warn('EKE lookup failed:', error);
                // Fill with zeros if EKE fails
                for (let i = 0; i < positions.length; i++) {
                    diffusivities.push({ K: 0, found: false });
                }
            }
        } else {
            // No EKE loader - all zeros
            for (let i = 0; i < positions.length; i++) {
                diffusivities.push({ K: 0, found: false });
            }
        }

        // 4. Apply physics to each particle
        let updatedCount = 0;
        let decayedCount = 0;

        for (let i = 0; i < velocities.length; i++) {
            const p = activeParticles[particleIndices[i]];
            const velocity = velocities[i];
            const diffusivity = diffusivities[i];

            // STORE PREVIOUS POSITION BEFORE MODIFICATION
            const prevX = p.x;
            const prevY = p.y;

            // HYCOM advection
            if (velocity.found) {
                p.x += velocity.u * 86.4 * deltaDays;
                p.y += velocity.v * 86.4 * deltaDays;
                updatedCount++;
            }

            // EKE diffusion (if available)
            const K_m2_s = diffusivity?.K ?? 0;
            if (K_m2_s > 0) {
                const K_km2_day = K_m2_s * 86.4;
                const stepSize = Math.sqrt(2 * K_km2_day * deltaDays);

                // Random walk diffusion
                p.x += (Math.random() - 0.5) * stepSize * 2.0;
                p.y += (Math.random() - 0.5) * stepSize * 2.0;
            }

            // LAND CHECK - AFTER movement
            const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
            const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);

            // Check if particle is on land - use currentSimDay
            try {
                const isOcean = await this.hycomLoader.isOcean(lon, lat, currentSimDay);

                if (!isOcean) {
                    // Particle moved onto land - revert to previous position
                    p.x = prevX;
                    p.y = prevY;

                    // Try to find nearest ocean cell and push toward it
                    const oceanCell = await this.hycomLoader.findNearestOceanCell(lon, lat, currentSimDay, 10);
                    if (oceanCell && oceanCell.distance < 50.0) {
                        const oceanLon = oceanCell.lon;
                        const oceanLat = oceanCell.lat;

                        // Calculate direction vector toward ocean
                        const dx = (oceanLon - lon) * this.LON_SCALE;
                        const dy = (oceanLat - lat) * this.LAT_SCALE;
                        const dist = Math.sqrt(dx*dx + dy*dy);

                        if (dist > 0) {
                            // Add small push toward ocean
                            const pushStrength = 3.0; // km/day
                            p.x += (dx / dist) * pushStrength * deltaDays;
                            p.y += (dy / dist) * pushStrength * deltaDays;
                        }
                    }
                }
            } catch (error) {
                console.warn('Land check error:', error);
                // If check fails, revert to previous position
                p.x = prevX;
                p.y = prevY;
            }

            // Radioactive decay
            p.age += deltaDays;
            if (this.params.decayEnabled) {
                p.mass *= Math.pow(0.5, deltaDays / (30.17 * 365.25));
                if (p.mass < 0.001) {
                    p.active = false;
                    decayedCount++;
                    continue;
                }
            }

            // Update position trail (only if particle moved significantly)
            if (Math.abs(p.x - prevX) > 0.1 || Math.abs(p.y - prevY) > 0.1) {
                p.history.push({ x: p.x, y: p.y });
                if (p.history.length > 8) {
                    p.history.shift();
                }
            }
        }

        // Update statistics
        this.stats.activeParticles = activeParticles.length - decayedCount;
        this.stats.totalDecayed += decayedCount;

        if (decayedCount > 0) {
            console.log(`💀 ${decayedCount} particles decayed`);
        }
    }
    getCurrentDayIndex() {
        // Just return the simulation day (not divided by 30.44)
        return Math.floor(this.stats.simulationDays);
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

    getDataSourceInfo() {
        if (!this.hycomLoader) return { source: 'None' };

        const hycomInfo = this.hycomLoader.getCurrentDayInfo();
        return {
            source: 'HYCOM Daily',
            date: hycomInfo?.date || 'Unknown',
            daysLoaded: hycomInfo?.daysLoaded || 0,
            memoryUsage: hycomInfo?.memoryUsage || 'Unknown',
            hasEKE: !!this.ekeLoader
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
            dataSource: this.getDataSourceInfo().source
        };
    }

    setParameter(name, value) {
        if (name in this.params) {
            console.log(`🔧 Parameter ${name}: ${this.params[name]} → ${value}`);
            this.params[name] = value;
            return true;
        }
        console.warn(`⚠️ Unknown parameter: ${name}`);
        return false;
    }
}

// Export to global scope
if (typeof window !== 'undefined') {
    window.ParticleEngine = ParticleEngine;
    console.log('✅ Clean ParticleEngine loaded');
}

console.log('=== ParticleEngine script complete ===');
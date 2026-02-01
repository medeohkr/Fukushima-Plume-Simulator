// web/particleEngine.js - CLEAN VERSION WITH HYCOM + EKE
console.log('=== Loading ParticleEngine (Clean Version) ===');

class ParticleEngine {
    constructor(numParticles = 10000) {
        console.log('🚀 Creating ParticleEngine');

        // Loaders
        this.hycomLoader = window.streamingHycomLoader;
        this.ekeLoader = window.streamingEkeLoader;

        // Fukushima location
        this.FUKUSHIMA_LON = 140.6;
        this.FUKUSHIMA_LAT = 37.4;

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

    // ==================== SIMULATION CONTROL ====================

    startSimulation() {
        if (this.isRunning) {
            console.warn('Simulation already running');
            return;
        }

        console.log('🚀 Starting simulation');
        this.isRunning = true;
        this.lastUpdateTime = Date.now();
        this.currentSimulationTime = new Date(this.simulationStartTime);

        // Reset stats
        this.resetStats();

        // Release initial particles for first 10 days (March 11-21, 2011)
        const initialActivityPBq = 2.0;
        const initialParticles = Math.floor(initialActivityPBq * 1e6 * this.activityToParticleScale);

        if (initialParticles > 0) {
            const released = this.releaseParticles(initialParticles);
            console.log(`📈 Released ${released} particles for early March (11-21, 2011)`);
        }
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

        // Ocean-only release box (east of Fukushima)
        const OCEAN_BOX = {
            minLon: 142.0,  // Further east - in open ocean
            maxLon: 142.5,
            minLat: 36.5,
            maxLat: 37.5
        };

        for (const p of this.particlePool) {
            if (!p.active && released < count) {
                // Random position within ocean box
                const lon = OCEAN_BOX.minLon + Math.random() * (OCEAN_BOX.maxLon - OCEAN_BOX.minLon);
                const lat = OCEAN_BOX.minLat + Math.random() * (OCEAN_BOX.maxLat - OCEAN_BOX.minLat);

                // Convert to km offsets from Fukushima
                p.x = (lon - this.FUKUSHIMA_LON) * this.LON_SCALE;
                p.y = (lat - this.FUKUSHIMA_LAT) * this.LAT_SCALE;

                p.active = true;
                p.age = 0;
                p.mass = 1.0;
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

        const monthIndex = this.getCurrentMonthIndex();
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

        // 2. Get HYCOM velocities (batch call)
        const velocities = await this.hycomLoader.getVelocitiesAtMultiple(
            positions,
            monthIndex
        );

        // 3. Get EKE diffusivities if available
        const diffusivities = [];
        if (this.ekeLoader) {
            try {
                const simulationDay = this.stats.simulationDays;
                const dateKey = await this.ekeLoader.setSimulationDay(simulationDay);
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

            // Update position trail
            p.history.push({ x: p.x, y: p.y });
            if (p.history.length > 8) {
                p.history.shift();
            }
        }

        // Update statistics
        this.stats.activeParticles = activeParticles.length - decayedCount;
        this.stats.totalDecayed += decayedCount;

        if (decayedCount > 0) {
            console.log(`💀 ${decayedCount} particles decayed`);
        }
    }

    getCurrentMonthIndex() {
        const monthsElapsed = Math.floor(this.stats.simulationDays / 30.44);
        return Math.min(23, Math.max(0, monthsElapsed));
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

        const hycomInfo = this.hycomLoader.getCurrentMonthInfo();
        return {
            source: 'HYCOM',
            year: hycomInfo?.year || 'Unknown',
            month: hycomInfo?.month || 'Unknown',
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
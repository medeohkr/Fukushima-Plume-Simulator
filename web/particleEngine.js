// particleEngine3D_final.js - COMPLETE REWRITE WITH MULTI-TRACER SUPPORT
console.log('=== Loading ParticleEngine3D (Multi-Tracer Version) ===');

// ==================== TRACER LIBRARY ====================

const TracerLibrary = {
    // ===== RADIONUCLIDES =====
    cs137: {
        id: 'cs137',
        name: 'Cesium-137',
        type: 'radionuclide',
        halfLife: 11000, // days (30.1 years)
        units: 'Bq',
        defaultTotal: 16.2e15, // 16.2 PBq
        color: '#ff6b6b',
        description: 'Fukushima signature isotope',
        behavior: {
            diffusivityScale: 1.0,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 10000,
            sigmaV: 50
        }
    },

    cs134: {
        id: 'cs134',
        name: 'Cesium-134',
        type: 'radionuclide',
        halfLife: 750, // days (~2 years)
        units: 'Bq',
        defaultTotal: 1.8e15, // ~1.8 PBq
        color: '#ff9f6b',
        description: 'Shorter-lived cesium isotope',
        behavior: {
            diffusivityScale: 1.0,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 10000,
            sigmaV: 50
        }
    },

    i131: {
        id: 'i131',
        name: 'Iodine-131',
        type: 'radionuclide',
        halfLife: 8, // days
        units: 'Bq',
        defaultTotal: 10.0e15, // ~10 PBq
        color: '#9f6bff',
        description: 'Short-lived but biologically significant',
        behavior: {
            diffusivityScale: 1.1,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 12000,
            sigmaV: 60
        }
    },

    sr90: {
        id: 'sr90',
        name: 'Strontium-90',
        type: 'radionuclide',
        halfLife: 10500, // days (~29 years)
        units: 'Bq',
        defaultTotal: 0.2e15, // ~0.2 PBq
        color: '#6b9fff',
        description: 'Bone-seeking radionuclide',
        behavior: {
            diffusivityScale: 0.9,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 9000,
            sigmaV: 45
        }
    },

    h3: {
        id: 'h3',
        name: 'Tritium (H-3)',
        type: 'radionuclide',
        halfLife: 4500, // days (~12.3 years)
        units: 'Bq',
        defaultTotal: 1.0e15, // ~1 PBq
        color: '#6bff9f',
        description: 'Forms HTO (tritiated water)',
        behavior: {
            diffusivityScale: 1.1,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 11000,
            sigmaV: 55
        }
    },

    // ===== HYDROCARBONS =====
    lightOil: {
        id: 'lightOil',
        name: 'Light Crude Oil',
        type: 'hydrocarbon',
        density: 850, // kg/m³ (floats)
        units: 'tons',
        defaultTotal: 10000, // 10,000 tons
        color: '#8B7355',
        description: 'Floating oil slick, evaporates',
        behavior: {
            diffusivityScale: 1.2,
            settlingVelocity: -0.2, // rises (m/day)
            beaching: 0.9,
            evaporation: 0.1, // per day
            sigmaH: 15000,
            sigmaV: 20 // stays near surface
        }
    },

    heavyOil: {
        id: 'heavyOil',
        name: 'Heavy Fuel Oil',
        type: 'hydrocarbon',
        density: 980, // kg/m³ (near neutral)
        units: 'tons',
        defaultTotal: 5000,
        color: '#4A3C31',
        description: 'Sinks and persists',
        behavior: {
            diffusivityScale: 0.7,
            settlingVelocity: 0.1, // slowly sinks
            beaching: 0.95,
            evaporation: 0.02,
            sigmaH: 8000,
            sigmaV: 30
        }
    },
};

// ==================== RELEASE PHASE MANAGER ====================

class ReleasePhase {
    constructor(start = 0, end = 30, total = 1000, unit = 'GBq') {
        this.start = start;
        this.end = end;
        this.total = total;      // Now it's TOTAL, not rate!
        this.unit = unit;
    }

    getDuration() {
        return this.end - this.start;
    }

    getRate() {
        // Calculate rate from total and duration
        // This returns in the ORIGINAL units (GBq, TBq, PBq, etc.)
        return this.total / this.getDuration();
    }

    getRateWithUnit() {
        const rate = this.getRate();
        if (rate >= 1e6) return `${(rate/1e6).toFixed(2)} PBq/day`;
        if (rate >= 1e3) return `${(rate/1e3).toFixed(2)} TBq/day`;
        return `${rate.toFixed(2)} GBq/day`;
    }
}

class ReleaseManager {
    constructor(tracerId = 'cs137') {
        this.tracerId = tracerId;
        this.tracer = TracerLibrary[tracerId] || TracerLibrary.cs137;
        this.phases = [];
        this.addDefaultPhase();
    }

    setTracer(tracerId) {
        this.tracerId = tracerId;
        this.tracer = TracerLibrary[tracerId] || TracerLibrary.cs137;
    }

    addDefaultPhase() {
        // Create a default phase with TOTAL, not rate
        let defaultTotal, defaultUnit;

        switch(this.tracer.type) {
            case 'radionuclide':
                defaultTotal = this.tracer.defaultTotal / 1e9; // Convert to GBq
                defaultUnit = 'GBq';
                break;
            case 'hydrocarbon':
            case 'particulate':
                defaultTotal = this.tracer.defaultTotal;
                defaultUnit = 'tons';
                break;
            default:
                defaultTotal = this.tracer.defaultTotal;
                defaultUnit = 'kg';
        }

        this.phases = [new ReleasePhase(0, 30, defaultTotal, defaultUnit)];
    }

    addPhase(start, end, total, unit) {
        this.phases.push(new ReleasePhase(start, end, total, unit));
        this.sortPhases();
    }

    removePhase(index) {
        if (this.phases.length > 1) {
            this.phases.splice(index, 1);
        }
    }

    sortPhases() {
        this.phases.sort((a, b) => a.start - b.start);
    }

    convertToBaseUnit(amount, fromUnit) {
        const conversions = {
            'Bq': 1e-9,
            'kBq': 1e-6,
            'MBq': 1e-3,
            'GBq': 1,
            'TBq': 1000,
            'PBq': 1e6,
            'kg': 1,
            'tons': 1000,
            'organisms': 1
        };
        return amount * (conversions[fromUnit] || 1);
    }

    getRateAtDay(day) {
        for (const phase of this.phases) {
            if (day >= phase.start && day <= phase.end) {
                return phase.getRate();
            }
        }
        return 0;
    }

    getTotalRelease() {
        let total = 0;
        this.phases.forEach(phase => {
            total += phase.total * this.convertToBaseUnit(1, phase.unit);
        });
        return total;
    }

    getParticleActivity(totalParticles) {
        const totalInBaseUnit = this.getTotalRelease();
        return totalInBaseUnit / totalParticles;
    }

    // New method for UI display
    getCurrentStats(currentSimDay) {
        let activePhase = null;
        for (const phase of this.phases) {
            if (currentSimDay >= phase.start && currentSimDay <= phase.end) {
                activePhase = phase;
                break;
            }
        }

        if (!activePhase) {
            return {
                hasActivePhase: false,
                currentRate: 0,
                currentRateDisplay: 'No active release',
                particlesPerDay: 0,
                totalRelease: this.getTotalRelease(),
                totalDisplay: this.formatTotal(this.getTotalRelease())
            };
        }

        const rateInBase = activePhase.getRate();
        const particlesPerDay = rateInBase / this.getParticleActivity(10000); // Need particle count

        return {
            hasActivePhase: true,
            phaseStart: activePhase.start,
            phaseEnd: activePhase.end,
            currentRate: rateInBase,
            currentRateDisplay: this.formatRate(rateInBase, activePhase.unit),
            particlesPerDay: particlesPerDay,
            totalRelease: this.getTotalRelease(),
            totalDisplay: this.formatTotal(this.getTotalRelease())
        };
    }

    formatRate(rate, unit) {
        // Convert rate to appropriate unit for display
        if (unit.includes('Bq')) {
            if (rate >= 1e6) return `${(rate/1e6).toFixed(2)} PBq/day`;
            if (rate >= 1e3) return `${(rate/1e3).toFixed(2)} TBq/day`;
            return `${rate.toFixed(2)} GBq/day`;
        }
        if (unit === 'tons') {
            return `${rate.toFixed(2)} tons/day`;
        }
        return `${rate.toFixed(2)} kg/day`;
    }

    formatTotal(total) {
        if (total > 1e12) return `${(total/1e12).toFixed(2)} PBq`;
        if (total > 1e9) return `${(total/1e9).toFixed(2)} TBq`;
        if (total > 1e6) return `${(total/1e6).toFixed(2)} GBq`;
        if (total > 1000) return `${(total/1000).toFixed(2)} tons`;
        return `${total.toFixed(2)} kg`;
    }
}

// ==================== PARTICLE ENGINE 3D ====================

class ParticleEngine3D {
    constructor(numParticles = 10000, tracerId = 'cs137', startLocation = null) {
        console.log('🚀 Creating ParticleEngine3D with Multi-Tracer Support');

        // ===== LOADERS =====
        this.hycomLoader = window.streamingHycomLoader3D;
        this.ekeLoader = window.streamingEkeLoader;

        // ===== COORDINATE SYSTEM =====
        // Use provided location or default to Fukushima
        if (startLocation) {
            this.REFERENCE_LON = startLocation.lon;
            this.REFERENCE_LAT = startLocation.lat;
        } else {
            this.REFERENCE_LON = 142.03;  // Default Fukushima longitude
            this.REFERENCE_LAT = 37.42;   // Default Fukushima latitude
        }

        this.LON_SCALE = 88.8;        // km/degree at reference latitude
        this.LAT_SCALE = 111.0;       // km/degree

        // ===== TRACER CONFIGURATION =====
        this.tracerId = tracerId;
        this.tracer = TracerLibrary[tracerId] || TracerLibrary.cs137;
        this.releaseManager = new ReleaseManager(tracerId);

        // ===== PARTICLE COUNT =====
        this.particleCount = numParticles;
        this.calculateParticleCalibration();

        console.log(`🧪 Tracer: ${this.tracer.name} (${this.tracer.type})`);
        console.log(`📊 Each particle = ${this.UNITS_PER_PARTICLE?.toExponential(2) || 'N/A'} ${this.tracer.units}`);

        // ===== LAND INTERACTION =====
        this.landSettings = {
            enabled: true,
            coastalPushStrength: 3.0,
            maxLandSearchRadius: 10.0,
            revertOnLand: true
        };

        // ===== RK4 SETTINGS =====
        this.rk4Enabled = false;
        this.rk4Settings = {
            enabled: false,
            timeStepSafety: 0.5,
            maxStepsPerDay: 100,
            adaptiveStepSize: true,
            minStepSize: 0.01,
            maxStepSize: 0.25
        };

        // ===== PHYSICS PARAMETERS =====
        this.params = {
            diffusivityScale: 1.0,
            simulationSpeed: 1.0,
            verticalMixing: true,
            ekmanPumping: 5e-6,
            convectiveMixing: 2e-6
        };

        // ===== VERTICAL DIFFUSIVITY PROFILE =====
        this.kzProfile = {
            mixedLayer: { depth: 50, kz: 0.01 },
            upperOcean: { depth: 200, kz: 0.0001 },
            deepOcean: { depth: 1000, kz: 0.00005 }
        };

        // ===== SIMULATION STATE =====
        this.isRunning = false;
        this.lastUpdateTime = Date.now();
        this.simulationStartTime = new Date('2011-03-11T00:00:00Z');
        this.currentSimulationTime = new Date(this.simulationStartTime);

        // ===== STATISTICS =====
        this.stats = {
            totalReleased: 0,
            totalDecayed: 0,
            simulationDays: 0,
            activeParticles: 0,
            particlesOnLand: 0,
            maxDepthReached: 0,
            totalConcentration: 0,
            maxConcentration: 0
        };

        // ===== PARTICLE POOL =====
        this.particlePool = [];
        this.initializeParticlePool(numParticles);

        console.log('✅ ParticleEngine3D initialized');
    }

    calculateParticleCalibration() {
        const totalRelease = this.releaseManager.getTotalRelease();

        if (totalRelease > 0) {
            this.UNITS_PER_PARTICLE = this.releaseManager.getParticleActivity(this.particleCount);
        } else {
            this.UNITS_PER_PARTICLE = 1;
        }
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing ParticleEngine3D...');

        try {
            if (this.hycomLoader && !this.hycomLoader.metadata) {
                await this.hycomLoader.init();
                console.log('✅ HYCOM loader ready');
            }

            if (this.ekeLoader && !this.ekeLoader.metadata) {
                await this.ekeLoader.init();
                console.log('✅ EKE loader ready');
            }

            await this.hycomLoader.loadDayByOffset(0);
            console.log('✅ All loaders ready');
            return true;

        } catch (error) {
            console.error('❌ Initialization failed:', error);
            return false;
        }
    }
    setReleaseLocation(lat, lon) {
        this.REFERENCE_LAT = lat;
        this.REFERENCE_LON = lon;
        console.log(`📍 Release location updated to: ${lat}°N, ${lon}°E`);

        // Optional: Reset simulation if needed
        // this.resetSimulation();
    }

    initializeParticlePool(numParticles) {
        console.log(`📦 Creating pool of ${numParticles} particles`);

        for (let i = 0; i < numParticles; i++) {
            this.particlePool.push({
                id: i,
                active: false,
                tracerId: this.tracerId,
                x: 0,
                y: 0,
                depth: 0,
                concentration: 0,
                age: 0,
                mass: this.UNITS_PER_PARTICLE || 1.0,
                history: [],
                velocityU: 0,
                velocityV: 0,
                lastIntegration: 'none'
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

        if (this.stats.totalReleased === 0) {
            this.currentSimulationTime = new Date(this.simulationStartTime);
            this.stats.simulationDays = 0;
        }
    }

    pauseSimulation() {
        if (!this.isRunning) return;
        console.log('⏸️ Pausing simulation');
        this.isRunning = false;
    }

    resumeSimulation() {
        if (this.isRunning) return;
        console.log('▶️ Resuming simulation');
        this.isRunning = true;
        this.lastUpdateTime = Date.now();
    }

    resetSimulation() {
        console.log('🔄 Resetting simulation');
        this.isRunning = false;
        this.currentSimulationTime = new Date(this.simulationStartTime);
        this.stats = {
            totalReleased: 0,
            totalDecayed: 0,
            simulationDays: 0,
            activeParticles: 0,
            particlesOnLand: 0,
            maxDepthReached: 0,
            totalConcentration: 0,
            maxConcentration: 0
        };

        for (const p of this.particlePool) {
            p.active = false;
            p.x = 0;
            p.y = 0;
            p.depth = 0;
            p.age = 0;
            p.mass = this.UNITS_PER_PARTICLE || 1.0;
            p.concentration = 0;
            p.history = [];
            p.velocityU = 0;
            p.velocityV = 0;
        }
    }

    // ==================== PARTICLE RELEASE ====================

    async releaseParticles(count) {
        let released = 0;
        const RELEASE_CENTER = {
            lon: this.REFERENCE_LON,
            lat: this.REFERENCE_LAT
        };
        const SIGMA = 30.0 / this.LON_SCALE;
        const MAX_ATTEMPTS = 1000; // Prevent infinite loops
        const MIN_DISTANCE_FROM_LAND_KM = 10; // 10km minimum distance

        for (const p of this.particlePool) {
            if (!p.active && released < count) {
                let lon, lat;
                let attempts = 0;
                let isOcean = false;
                let distanceFromLand = 0;

                do {
                    attempts++;
                    if (attempts > MAX_ATTEMPTS) {
                        console.warn(`⚠️ Could not find ocean location after ${MAX_ATTEMPTS} attempts`);
                        return released;
                    }

                    const u1 = Math.random();
                    const u2 = Math.random();
                    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
                    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

                    lon = RELEASE_CENTER.lon + z0 * SIGMA;
                    lat = RELEASE_CENTER.lat + z1 * SIGMA;

                    lon = Math.max(RELEASE_CENTER.lon - SIGMA * 3,
                                 Math.min(RELEASE_CENTER.lon + SIGMA * 3, lon));
                    lat = Math.max(RELEASE_CENTER.lat - SIGMA * 3,
                                 Math.min(RELEASE_CENTER.lat + SIGMA * 3, lat));

                    // Check if in ocean
                    if (this.hycomLoader) {
                        try {
                            // Use isOcean method with current simulation day
                            isOcean = await this.hycomLoader.isOcean(lon, lat, 0, this.stats.simulationDays);

                            // If it's ocean, check distance from land (simplified)
                            if (isOcean) {
                                // Find nearest ocean cell to check distance
                                const oceanCell = await this.hycomLoader.findNearestOceanCell(
                                    lon, lat, 0, this.stats.simulationDays, 5
                                );

                                if (oceanCell && oceanCell.distance) {
                                    // Convert distance from degrees to km (approx)
                                    // 1 degree lat ≈ 111 km, 1 degree lon ≈ 88.8 km at 37°N
                                    const latKmPerDegree = 111;
                                    const lonKmPerDegree = 88.8;

                                    // Approximate distance in km
                                    distanceFromLand = Math.sqrt(
                                        Math.pow(oceanCell.distance * latKmPerDegree, 2) +
                                        Math.pow(oceanCell.distance * lonKmPerDegree, 2)
                                    );

                                    if (distanceFromLand < MIN_DISTANCE_FROM_LAND_KM) {
                                        isOcean = false; // Too close to land
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('Ocean check failed:', e);
                            isOcean = true; // Default to true if check fails
                        }
                    } else {
                        isOcean = true; // No loader, assume ocean
                    }

                } while (!isOcean);

                p.x = (lon - this.REFERENCE_LON) * this.LON_SCALE;
                p.y = (lat - this.REFERENCE_LAT) * this.LAT_SCALE;
                p.depth = 0;
                p.active = true;
                p.age = 0;
                p.mass = this.UNITS_PER_PARTICLE || 1.0;
                p.tracerId = this.tracerId;
                p.concentration = this.calculateConcentration(p);
                p.releaseDay = this.stats.simulationDays;
                p.history = [{x: p.x, y: p.y, depth: p.depth}];

                released++;
            }
        }

        this.stats.totalReleased += released;
        if (released > 0) {
            console.log(`🎯 Released ${released} particles at ${RELEASE_CENTER.lat}°N, ${RELEASE_CENTER.lon}°E (${MIN_DISTANCE_FROM_LAND_KM}km from land)`);
        }

        return released;
    }

    isPositionInOcean(lon, lat, depthMeters = 0) {
        // Simplified - actual land checking happens in hycomLoader
        return true;
    }

    // ==================== CONTINUOUS RELEASE ====================

    executeContinuousRelease(deltaDays) {
        if (!this.isRunning) return;

        const currentSimDay = this.stats.simulationDays;

        // Find active phase
        let activePhase = null;
        for (const phase of this.releaseManager.phases) {
            if (currentSimDay >= phase.start && currentSimDay <= phase.end) {
                activePhase = phase;
                break;
            }
        }

        if (activePhase && this.UNITS_PER_PARTICLE) {
            const rate = activePhase.getRate();

            // CRITICAL: Convert rate to base units (GBq)
            let rateInBase = rate;
            if (activePhase.unit === 'PBq') {
                rateInBase = rate * 1e6;  // PBq/day → GBq/day
                console.log('🔄 Converting PBq to GBq:', { original: rate, converted: rateInBase });
            } else if (activePhase.unit === 'TBq') {
                rateInBase = rate * 1000;   // TBq/day → GBq/day
            }
            // GBq stays as-is

            const particlesPerDay = rateInBase / this.UNITS_PER_PARTICLE;
            const particlesThisStep = particlesPerDay * deltaDays;

            console.log('📊 Release calculation:', {
                phaseUnit: activePhase.unit,
                originalRate: rate,
                rateInBase,
                unitsPerParticle: this.UNITS_PER_PARTICLE,
                particlesPerDay,
                particlesThisStep,
                deltaDays
            });

            // Accumulate fractional particles
            if (!this.particleFraction) this.particleFraction = 0;
            this.particleFraction += particlesThisStep;

            const wholeParticles = Math.floor(this.particleFraction);
            if (wholeParticles >= 1) {
                this.particleFraction -= wholeParticles;
                console.log(`🎯 Releasing ${wholeParticles} particles at day ${currentSimDay.toFixed(2)}`);
                this.releaseParticles(wholeParticles);
            }
        }
    }

    // ==================== LAND INTERACTION ====================

    async checkLandInteraction(p, prevX, prevY, prevDepth, currentSimDay) {
        if (!this.landSettings.enabled || !this.hycomLoader) return false;

        const lon = this.REFERENCE_LON + (p.x / this.LON_SCALE);
        const lat = this.REFERENCE_LAT + (p.y / this.LAT_SCALE);
        const depthMeters = p.depth * 1000;

        try {
            const isOcean = await this.hycomLoader.isOcean(lon, lat, depthMeters, currentSimDay);

            if (!isOcean) {
                p.x = prevX;
                p.y = prevY;
                p.depth = prevDepth;

                const oceanCell = await this.hycomLoader.findNearestOceanCell(
                    lon, lat, depthMeters, currentSimDay, this.landSettings.maxLandSearchRadius
                );

                if (oceanCell) {
                    const targetX = (oceanCell.lon - this.REFERENCE_LON) * this.LON_SCALE;
                    const targetY = (oceanCell.lat - this.REFERENCE_LAT) * this.LAT_SCALE;

                    const dx = targetX - prevX;
                    const dy = targetY - prevY;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist > 0) {
                        const moveFraction = 0.5;
                        p.x = prevX + dx * moveFraction;
                        p.y = prevY + dy * moveFraction;
                    }
                }
                return true;
            }
            return false;

        } catch (error) {
            p.x = prevX;
            p.y = prevY;
            p.depth = prevDepth;
            return true;
        }
    }

    async _checkPathToOcean(startX, startY, endX, endY, depth, currentSimDay) {
        const steps = 2;
        const stepX = (endX - startX) / steps;
        const stepY = (endY - startY) / steps;

        for (let s = 1; s <= steps; s++) {
            const testX = startX + stepX * s;
            const testY = startY + stepY * s;
            const testLon = this.REFERENCE_LON + (testX / this.LON_SCALE);
            const testLat = this.REFERENCE_LAT + (testY / this.LAT_SCALE);
            const isOcean = await this.hycomLoader.isOcean(testLon, testLat, depth * 1000, currentSimDay);

            if (!isOcean) {
                const safeX = startX + stepX * (s - 1);
                const safeY = startY + stepY * (s - 1);
                return { safe: false, lastValidX: safeX, lastValidY: safeY };
            }
        }
        return { safe: true, lastValidX: endX, lastValidY: endY };
    }

    // ==================== DIFFUSION ====================

    async applyDiffusion(p, deltaDays, currentSimDay) {
        try {
            const lon = this.REFERENCE_LON + (p.x / this.LON_SCALE);
            const lat = this.REFERENCE_LAT + (p.y / this.LAT_SCALE);
            const ekeResult = await this.ekeLoader.getDiffusivityAt(lon, lat, currentSimDay);

            let K_m2_s = ekeResult.found ?
                ekeResult.K * this.params.diffusivityScale * (this.tracer.behavior.diffusivityScale || 1.0) :
                20 * this.params.diffusivityScale;

            const dtSeconds = deltaDays * 86400;
            const stepScale_m = Math.sqrt(2 * K_m2_s * dtSeconds);
            const stepScale_km = stepScale_m / 1000;

            p.x += stepScale_km * this.gaussianRandom();
            p.y += stepScale_km * this.gaussianRandom();

        } catch (error) {
            console.error(`❌ Diffusion error:`, error);
        }
    }

    // ==================== VERTICAL MOTION ====================

    applyVerticalMotion(p, dtSeconds) {
        const settling = this.tracer.behavior.settlingVelocity || 0;
        const depthM = p.depth * 1000;
        const kz = this.getVerticalDiffusivity(depthM);

        const verticalStdDev = Math.sqrt(2 * kz * dtSeconds);
        const randomDz = verticalStdDev * this.gaussianRandom();

        // Deterministic settling/buoyancy
        const settlingDz = settling * dtSeconds / 86400; // Convert to per second

        p.depth += (randomDz + settlingDz) / 1000;
        p.depth = Math.max(0, Math.min(p.depth, 1.0));

        const currentDepthM = p.depth * 1000;
        if (currentDepthM > this.stats.maxDepthReached) {
            this.stats.maxDepthReached = currentDepthM;
        }
    }

    getVerticalDiffusivity(depthMeters) {
        if (depthMeters < this.kzProfile.mixedLayer.depth) {
            return this.kzProfile.mixedLayer.kz;
        } else if (depthMeters < this.kzProfile.upperOcean.depth) {
            return this.kzProfile.upperOcean.kz;
        } else {
            return this.kzProfile.deepOcean.kz;
        }
    }

    // ==================== CONCENTRATION CALCULATIONS ====================

    calculateConcentration(p) {
        if (!p.tracerId) return 0;

        const tracer = TracerLibrary[p.tracerId] || this.tracer;
        const sigmaH = tracer.behavior.sigmaH || 10000;
        const sigmaV = tracer.behavior.sigmaV || 50;

        const volume = Math.pow(2 * Math.PI, 1.5) * sigmaH * sigmaH * sigmaV;

        switch(tracer.type) {
            case 'radionuclide':
                return this.calcRadionuclideConcentration(p, tracer, volume);
            case 'hydrocarbon':
                return this.calcHydrocarbonConcentration(p, tracer, volume);
            case 'particulate':
                return this.calcParticulateConcentration(p, tracer, volume);
            case 'pollutant':
                return this.calcPollutantConcentration(p, tracer, volume);
            case 'biological':
                return this.calcBiologicalConcentration(p, tracer, volume);
            default:
                return p.mass / Math.max(volume, 1e9);
        }
        console.log('🔬 Concentration debug:', {
            mass: p.mass,
            massUnits: 'Bq?',
            sigmaH: sigmaH,
            sigmaV: sigmaV,
            volume: volume,
            rawConc: mass / volume,
            formatted: formatConcentration(mass / volume)
        });
    }

    calcRadionuclideConcentration(p, tracer, volume) {
        let mass = p.mass;
        if (tracer.behavior.decay && tracer.halfLife) {
            mass *= Math.pow(0.5, p.age / tracer.halfLife);
        }

        const concentration = mass / Math.max(volume, 1e9);

        // ===== ADD THIS DEBUG =====
        if (p.id < 5) {
            console.log('🔬 RADIONUCLIDE:', {
                mass,
                volume: volume.toExponential(2),
                concentration: concentration.toExponential(4)
            });
        }

        return concentration;
    }

    calcHydrocarbonConcentration(p, tracer, volume) {
        let mass = p.mass;
        if (tracer.behavior.evaporation) {
            mass *= Math.exp(-tracer.behavior.evaporation * p.age / 30); // Monthly decay
        }

        if (p.depth < 0.01) { // Surface slick
            const slickThickness = 0.001; // 1mm
            const area = volume / slickThickness;
            return mass / area; // kg/m²
        } else {
            const concentration = mass / volume; // kg/m³
            const waterDensity = 1000;
            return (concentration / waterDensity) * 1e6; // ppm
        }
    }

    calcParticulateConcentration(p, tracer, volume) {
        const concentration = p.mass / volume; // kg/m³
        return concentration * 1000; // mg/L
    }

    calcPollutantConcentration(p, tracer, volume) {
        const waterMass = volume * 1000; // kg
        return (p.mass / waterMass) * 1e9; // ppb
    }

    calcBiologicalConcentration(p, tracer, volume) {
        return p.mass / volume; // organisms/m³
    }

    // ==================== MAIN UPDATE LOOP ====================

    async update() {
        if (!this.isRunning) return;

        const now = Date.now();
        const realElapsedSeconds = (now - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = now;

        const deltaDays = realElapsedSeconds * this.params.simulationSpeed;

        this.currentSimulationTime.setTime(
            this.currentSimulationTime.getTime() + deltaDays * 86400000
        );
        this.stats.simulationDays += deltaDays;

        this.executeContinuousRelease(deltaDays);
        await this.updateParticles(deltaDays);
    }

    async updateParticles(deltaDays) {
        if (!this.isRunning) return;
        const activeParticles = this.getActiveParticles();
        if (activeParticles.length === 0) return;

        this.stats.particlesOnLand = 0;
        const currentSimDay = this.stats.simulationDays;
        const dtSeconds = deltaDays * 86400;

        const depthGroups = this.groupParticlesByDepth(activeParticles);

        for (const [depthStr, particles] of Object.entries(depthGroups)) {
            const targetDepth = parseFloat(depthStr);
            const velocities = await this.getVelocitiesForGroup(particles, targetDepth, currentSimDay);

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                const velocity = velocities[i];

                const prevX = p.x;
                const prevY = p.y;
                const prevDepth = p.depth;

                // ===== 1. ADVECTION =====
                if (this.rk4Enabled && this.rk4Settings.enabled) {
                    const rk4Result = await this.rk4Integrate(p, deltaDays, currentSimDay);

                    const pathCheck = await this._checkPathToOcean(
                        prevX, prevY, rk4Result.x, rk4Result.y,
                        p.depth, currentSimDay, 5
                    );

                    if (pathCheck.safe) {
                        p.x = rk4Result.x;
                        p.y = rk4Result.y;
                        p.depth = rk4Result.depth;
                        p.velocityU = rk4Result.u_avg || 0;
                        p.velocityV = rk4Result.v_avg || 0;
                        p.lastIntegration = 'rk4';
                    } else {
                        p.x = pathCheck.lastValidX;
                        p.y = pathCheck.lastValidY;
                        p.velocityU = 0;
                        p.velocityV = 0;
                    }
                } else if (velocity.found) {
                    // Euler integration (your existing code)
                    const newX = p.x + velocity.u * 86.4 * deltaDays;
                    const newY = p.y + velocity.v * 86.4 * deltaDays;

                    const pathCheck = await this._checkPathToOcean(
                        prevX, prevY, newX, newY, p.depth, currentSimDay, 5
                    );

                    if (pathCheck.safe) {
                        p.x = newX;
                        p.y = newY;
                        p.velocityU = velocity.u;
                        p.velocityV = velocity.v;
                    } else {
                        p.x = pathCheck.lastValidX;
                        p.y = pathCheck.lastValidY;
                    }
                }
                // ===== 2. DIFFUSION =====
                if (this.ekeLoader && this.params.diffusivityScale > 0.01) {
                    const beforeDiffX = p.x;
                    const beforeDiffY = p.y;
                    await this.applyDiffusion(p, deltaDays, currentSimDay);

                    const diffPathCheck = await this._checkPathToOcean(
                        beforeDiffX, beforeDiffY, p.x, p.y, p.depth, currentSimDay
                    );

                    if (!diffPathCheck.safe) {
                        p.x = beforeDiffX;
                        p.y = beforeDiffY;
                    }
                }

                // ===== 3. LAND CHECK =====
                const wasOnLand = await this.checkLandInteraction(p, prevX, prevY, prevDepth, currentSimDay);
                if (wasOnLand) {
                    this.stats.particlesOnLand++;
                    continue;
                }

                // ===== 4. VERTICAL MOTION =====
                if (this.params.verticalMixing) {
                    this.applyVerticalMotion(p, dtSeconds);
                }

                // ===== 5. DECAY/AGING =====
                p.age += deltaDays;

                // Tracer-specific mass loss (evaporation, etc.)
                if (this.tracer.behavior.evaporation && this.tracer.type !== 'radionuclide') {
                    p.mass *= Math.exp(-this.tracer.behavior.evaporation * deltaDays / 30);
                }

                // ===== 6. UPDATE CONCENTRATION =====
                p.concentration = this.calculateConcentration(p);
                if (p.concentration > this.stats.maxConcentration) {
                    this.stats.maxConcentration = p.concentration;
                }

                // ===== 7. UPDATE HISTORY =====
                if (Math.abs(p.x - prevX) > 1 || Math.abs(p.y - prevY) > 1) {
                    p.history.push({ x: p.x, y: p.y, depth: p.depth });
                    if (p.history.length > 8) {
                        p.history.shift();
                    }
                }
            }
        }

        this.stats.activeParticles = this.getActiveParticles().length;
    }

    // ==================== VELOCITY METHODS ====================

    async rk4Integrate(p, deltaDays, currentSimDay) {
        const h = this.calculateOptimalStepSize(p, deltaDays);
        const steps = Math.ceil(deltaDays / h);
        const actualStep = deltaDays / steps;

        let x = p.x;
        let y = p.y;
        let depth = p.depth;
        let totalU = 0;
        let totalV = 0;

        for (let step = 0; step < steps; step++) {
            const stepTime = currentSimDay + step * actualStep;
            const result = await this.rk4Step(x, y, depth, actualStep, stepTime);

            if (!result.success) {
                return await this.eulerIntegrate(p, deltaDays, currentSimDay);
            }

            x = result.x;
            y = result.y;
            depth = result.depth;
            totalU += result.u_avg;
            totalV += result.v_avg;
        }

        return {
            x, y, depth,
            u_avg: totalU / steps,
            v_avg: totalV / steps,
            stepsTaken: steps
        };
    }

    async rk4Step(x, y, depth, h, currentTime) {
        try {
            const depthMeters = depth * 1000;

            const lon1 = this.REFERENCE_LON + (x / this.LON_SCALE);
            const lat1 = this.REFERENCE_LAT + (y / this.LAT_SCALE);
            const k1 = await this.getVelocityAt(lon1, lat1, depthMeters, currentTime);

            if (!k1.found) return { success: false };

            const x2 = x + h/2 * k1.u * 86.4;
            const y2 = y + h/2 * k1.v * 86.4;
            const lon2 = this.REFERENCE_LON + (x2 / this.LON_SCALE);
            const lat2 = this.REFERENCE_LAT + (y2 / this.LAT_SCALE);
            const k2 = await this.getVelocityAt(lon2, lat2, depthMeters, currentTime + h/2);

            const x3 = x + h/2 * (k2.found ? k2.u : k1.u) * 86.4;
            const y3 = y + h/2 * (k2.found ? k2.v : k1.v) * 86.4;
            const lon3 = this.REFERENCE_LON + (x3 / this.LON_SCALE);
            const lat3 = this.REFERENCE_LAT + (y3 / this.LAT_SCALE);
            const k3 = await this.getVelocityAt(lon3, lat3, depthMeters, currentTime + h/2);

            const x4 = x + h * (k3.found ? k3.u : k1.u) * 86.4;
            const y4 = y + h * (k3.found ? k3.v : k1.v) * 86.4;
            const lon4 = this.REFERENCE_LON + (x4 / this.LON_SCALE);
            const lat4 = this.REFERENCE_LAT + (y4 / this.LAT_SCALE);
            const k4 = await this.getVelocityAt(lon4, lat4, depthMeters, currentTime + h);

            const u_avg = (1/6) * (
                k1.u +
                2 * (k2.found ? k2.u : k1.u) +
                2 * (k3.found ? k3.u : k1.u) +
                (k4.found ? k4.u : k1.u)
            );

            const v_avg = (1/6) * (
                k1.v +
                2 * (k2.found ? k2.v : k1.v) +
                2 * (k3.found ? k3.v : k1.v) +
                (k4.found ? k4.v : k1.v)
            );

            return {
                success: true,
                x: x + h * u_avg * 86.4,
                y: y + h * v_avg * 86.4,
                depth: depth,
                u_avg, v_avg
            };

        } catch (error) {
            return { success: false };
        }
    }

    calculateOptimalStepSize(p, totalDeltaDays) {
        if (!this.rk4Settings.adaptiveStepSize) {
            return Math.min(totalDeltaDays, this.rk4Settings.maxStepSize);
        }

        const speed = Math.sqrt(p.velocityU * p.velocityU + p.velocityV * p.velocityV);
        const characteristicTime = 1.0 / (speed + 0.001);

        let optimalStep = Math.min(
            characteristicTime * this.rk4Settings.timeStepSafety,
            this.rk4Settings.maxStepSize
        );

        optimalStep = Math.max(optimalStep, this.rk4Settings.minStepSize);
        optimalStep = Math.min(optimalStep, totalDeltaDays);

        return optimalStep;
    }

    async eulerIntegrate(p, deltaDays, currentSimDay) {
        const lon = this.REFERENCE_LON + (p.x / this.LON_SCALE);
        const lat = this.REFERENCE_LAT + (p.y / this.LAT_SCALE);
        const depthMeters = p.depth * 1000;

        const velocity = await this.getVelocityAt(lon, lat, depthMeters, currentSimDay);

        if (velocity.found) {
            return {
                x: p.x + deltaDays * velocity.u * 86.4,
                y: p.y + deltaDays * velocity.v * 86.4,
                depth: p.depth,
                u_avg: velocity.u,
                v_avg: velocity.v
            };
        }

        return {
            x: p.x,
            y: p.y,
            depth: p.depth,
            u_avg: 0,
            v_avg: 0
        };
    }

    // ==================== ENHANCED VELOCITY METHODS ====================
    async getVelocitiesForGroup(particles, targetDepth, simulationDay) {
        if (!this.hycomLoader) {
            return particles.map(() => ({ u: 0, v: 0, found: false }));
        }

        const positions = particles.map(p => ({
            lon: this.REFERENCE_LON + (p.x / this.LON_SCALE),  // <-- FIXED
            lat: this.REFERENCE_LAT + (p.y / this.LAT_SCALE)   // <-- FIXED
        }));

        try {
            return await this.hycomLoader.getVelocitiesAtMultiple(
                positions,
                targetDepth,
                simulationDay
            );
        } catch (error) {
            console.warn(`Velocity lookup failed:`, error);
            return particles.map(() => ({ u: 0, v: 0, found: false }));
        }
    }
    async getVelocityAt(lon, lat, depthMeters, simDay) {
        if (!this.hycomLoader) {
            return { u: 0, v: 0, found: false };
        }

        try {
            const availableDepths = this.hycomLoader.getAvailableDepths();
            let targetDepth = availableDepths[0];
            let minDiff = Math.abs(depthMeters - availableDepths[0]);

            for (const availDepth of availableDepths) {
                const diff = Math.abs(depthMeters - availDepth);
                if (diff < minDiff) {
                    minDiff = diff;
                    targetDepth = availDepth;
                }
            }

            return await this.hycomLoader.getVelocityAt(lon, lat, targetDepth, simDay);
        } catch (error) {
            return { u: 0, v: 0, found: false };
        }
    }

    // ==================== ENHANCED VERTICAL MOTION ====================

    applyVerticalMotion(p, dtSeconds, currentSimDay) {
        const settling = this.tracer.behavior.settlingVelocity || 0;
        const depthM = p.depth * 1000;
        const kz = this.getVerticalDiffusivity(depthM);

        const verticalStdDev = Math.sqrt(2 * kz * dtSeconds);
        const randomDz = verticalStdDev * this.gaussianRandom();

        // Deterministic settling/buoyancy
        const settlingDz = settling * dtSeconds / 86400; // Convert to per second

        // RESTORED: Ekman pumping and convective mixing
        let deterministicDz = 0;
        deterministicDz += this.params.ekmanPumping * dtSeconds;

        const dayOfYear = this.getDayOfYear();
        const isWinter = dayOfYear < 90 || dayOfYear > 335;
        if (isWinter && depthM < 100) {
            deterministicDz += this.params.convectiveMixing * dtSeconds;
        }

        p.depth += (randomDz + settlingDz + deterministicDz) / 1000;
        p.depth = Math.max(0, Math.min(p.depth, 1.0));

        const currentDepthM = p.depth * 1000;
        if (currentDepthM > this.stats.maxDepthReached) {
            this.stats.maxDepthReached = currentDepthM;
        }
    }

    // ==================== STATISTICS (RESTORED) ====================

    logStatistics() {
        const activeParticles = this.getActiveParticles();
        if (activeParticles.length === 0) return;

        const distances = activeParticles.map(p => Math.sqrt(p.x * p.x + p.y * p.y));
        const meanDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
        const maxDistance = Math.max(...distances);

        const depthBuckets = { surface: 0, upper: 0, intermediate: 0, deep: 0 };
        for (const p of activeParticles) {
            const depthMeters = p.depth * 1000;
            if (depthMeters < 50) depthBuckets.surface++;
            else if (depthMeters < 200) depthBuckets.upper++;
            else if (depthMeters < 500) depthBuckets.intermediate++;
            else depthBuckets.deep++;
        }

        console.log(`📊 PLUME STATISTICS - Day ${this.stats.simulationDays.toFixed(1)}:`);
        console.log(`   Tracer: ${this.tracer.name}`);
        console.log(`   Active particles: ${activeParticles.length}`);
        console.log(`   Mean distance: ${meanDistance.toFixed(1)} km`);
        console.log(`   Max distance: ${maxDistance.toFixed(1)} km`);
        console.log(`   Depth distribution: S:${depthBuckets.surface} U:${depthBuckets.upper} I:${depthBuckets.intermediate} D:${depthBuckets.deep}`);
        console.log(`   Max depth: ${this.stats.maxDepthReached.toFixed(0)} m`);
        console.log(`   On land: ${this.stats.particlesOnLand}`);
        console.log(`   Max concentration: ${this.stats.maxConcentration.toExponential(2)} ${this.tracer.units}/m³`);
    }

    getStats() {
        const activeParticles = this.getActiveParticles();
        const distances = activeParticles.map(p => Math.sqrt(p.x * p.x + p.y * p.y));
        const meanDistance = distances.length > 0 ?
            distances.reduce((a, b) => a + b, 0) / distances.length : 0;

        return {
            isRunning: this.isRunning,
            daysElapsed: this.stats.simulationDays.toFixed(2),
            totalParticles: this.stats.totalReleased,
            activeParticles: activeParticles.length,
            decayedParticles: this.stats.totalDecayed,
            meanDistance: meanDistance.toFixed(1),
            maxDepth: this.stats.maxDepthReached.toFixed(0),
            particlesOnLand: this.stats.particlesOnLand,
            maxConcentration: this.stats.maxConcentration.toExponential(2),
            tracerName: this.tracer.name,
            tracerUnits: this.tracer.units
        };
    }

    // ==================== CONFIGURABLE PATH CHECKING ====================

    async _checkPathToOcean(startX, startY, endX, endY, depth, currentSimDay, steps = 5) {
        const stepX = (endX - startX) / steps;
        const stepY = (endY - startY) / steps;

        for (let s = 1; s <= steps; s++) {
            const testX = startX + stepX * s;
            const testY = startY + stepY * s;
            const testLon = this.REFERENCE_LON + (testX / this.LON_SCALE);
            const testLat = this.REFERENCE_LAT + (testY / this.LAT_SCALE);
            const isOcean = await this.hycomLoader.isOcean(testLon, testLat, depth * 1000, currentSimDay);

            if (!isOcean) {
                const safeX = startX + stepX * (s - 1);
                const safeY = startY + stepY * (s - 1);
                return { safe: false, lastValidX: safeX, lastValidY: safeY };
            }
        }
        return { safe: true, lastValidX: endX, lastValidY: endY };
    }

    groupParticlesByDepth(particles) {
        if (!this.hycomLoader) {
            return { '0': particles };
        }

        const availableDepths = this.hycomLoader.getAvailableDepths();
        const groups = {};

        for (const p of particles) {
            const depthMeters = p.depth * 1000;
            let closestDepth = availableDepths[0];
            let minDiff = Math.abs(depthMeters - availableDepths[0]);

            for (const availDepth of availableDepths) {
                const diff = Math.abs(depthMeters - availDepth);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestDepth = availDepth;
                }
            }

            if (!groups[closestDepth]) {
                groups[closestDepth] = [];
            }
            groups[closestDepth].push(p);
        }

        return groups;
    }

    // ==================== RK4 METHODS ====================

    enableRK4(enable = true) {
        this.rk4Enabled = enable;
        this.rk4Settings.enabled = enable;
        console.log(`🔧 RK4 ${enable ? 'enabled' : 'disabled'}`);
    }

    // ==================== UTILITY METHODS ====================

    getActiveParticles() {
        return this.particlePool.filter(p => p.active);
    }

    gaussianRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    getDayOfYear() {
        const start = new Date(this.currentSimulationTime.getFullYear(), 0, 0);
        const diff = this.currentSimulationTime - start;
        return Math.floor(diff / 86400000);
    }

    getFormattedTime() {
        return {
            year: this.currentSimulationTime.getUTCFullYear(),
            month: this.currentSimulationTime.getUTCMonth() + 1,
            day: this.currentSimulationTime.getUTCDate()
        };
    }

    // ==================== PARAMETER CONTROL ====================

    setParameter(name, value) {
        if (name in this.params) {
            this.params[name] = value;
            return true;
        }
        return false;
    }

    setTracer(tracerId) {
        this.tracerId = tracerId;
        this.tracer = TracerLibrary[tracerId] || TracerLibrary.cs137;
        this.releaseManager.setTracer(tracerId);
        this.calculateParticleCalibration();

        // Update existing particles? Only new ones will use new tracer
        console.log(`🧪 Switched to tracer: ${this.tracer.name}`);
    }

    setReleasePhases(phases) {
        if (!this.releaseManager) {
            console.warn('⚠️ No releaseManager available');
            return;
        }

        // Replace the phases in releaseManager
        this.releaseManager.phases = phases;

        // Recalculate particle calibration
        this.calculateParticleCalibration();

        console.log(`📋 Release phases updated: ${phases.length} phases`);
        phases.forEach((phase, i) => {
            console.log(`   Phase ${i+1}: days ${phase.start}-${phase.end}, ${phase.total} ${phase.unit} (rate: ${phase.getRate().toFixed(2)} ${phase.unit}/day)`);
        });
    }
}

// Export to global scope
if (typeof window !== 'undefined') {
    window.TracerLibrary = TracerLibrary;
    window.ReleasePhase = ReleasePhase;
    window.ReleaseManager = ReleaseManager;
    window.ParticleEngine3D = ParticleEngine3D;
    window.ParticleEngine = ParticleEngine3D;
    console.log('✅ Multi-Tracer ParticleEngine3D loaded');
}

console.log('=== ParticleEngine3D script complete ===');
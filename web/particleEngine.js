// particleEngine3D_final.js - ORIGINAL WORKING VERSION + 16.2 PBq calibration
console.log('=== Loading ParticleEngine3D (Original Working Version) ===');

class ParticleEngine3D {
    constructor(numParticles = 10000) {
        console.log('🚀 Creating ParticleEngine3D 3D Physics');

        // ===== LOADERS =====
        this.hycomLoader = window.streamingHycomLoader3D;
        this.ekeLoader = window.streamingEkeLoader;

        // ===== FUKUSHIMA & GRID =====
        this.FUKUSHIMA_LON = 141.31;
        this.FUKUSHIMA_LAT = 37.42;
        this.LON_SCALE = 88.8;   // km/degree longitude at ~37°N
        this.LAT_SCALE = 111.0;  // km/degree latitude

        // ===== SCIENTIFIC CALIBRATION (16.2 PBq) =====
        this.TOTAL_RELEASED_PBq = 16.2;
        this.TOTAL_RELEASED_Bq = this.TOTAL_RELEASED_PBq * 1e15;
        this.particleCount = numParticles;
        this.Bq_PER_PARTICLE = this.TOTAL_RELEASED_Bq / this.particleCount;
        this.GBq_PER_PARTICLE = this.Bq_PER_PARTICLE / 1e9;

        console.log(`📊 CALIBRATION: Each particle = ${this.GBq_PER_PARTICLE.toFixed(1)} GBq`);

        // ===== LAND INTERACTION SETTINGS =====
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
            decayEnabled: true,
            lagrangianTimescale: 7,
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

        // ===== ISOTOPE DATA =====
        this.isotopes = {
            'Cs137': {
                name: 'Cesium-137',
                halfLifeDays: 30.17 * 365.25,
                color: '#FF6B6B',
                initialMass: 1.0
            }
        };

        // ===== RELEASE PHASES (adjusted for 16.2 PBq) =====
        this.releasePhases = [
            {
                startDay: 10,
                endDay: 80,
                label: 'Major Leak Events (Mar-May 2011)',
                totalActivityPBq: 13.77, // 85% of 16.2
            },
            {
                startDay: 81,
                endDay: 172,
                label: 'Steady Continuous Release (Summer 2011)',
                dailyRateGBq: 17800, // Adjusted for 1.62 PBq
            },
            {
                startDay: 173,
                endDay: 385,
                label: 'Declining Continuous Release',
                dailyRateGBq: 3060, // Adjusted for 0.648 PBq
            },
            {
                startDay: 386,
                endDay: 568,
                label: 'Low-Level Continuous Release (2012)',
                dailyRateGBq: 890, // Adjusted for 0.162 PBq
            }
        ];

        // Calculate Phase 1 daily rate
        const phase1 = this.releasePhases[0];
        phase1.dailyRateGBq = (phase1.totalActivityPBq * 1e6) / (phase1.endDay - phase1.startDay);

        // ===== CONCENTRATION PARAMETERS (YOUR ORIGINAL WORKING VALUES) =====
        this.concentrationScale = 1000;
        this.activityToParticleScale = 0.001;
        this.constantSigma = {
            horizontal: 10000,
            vertical: 50
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

        console.log('✅ ParticleEngine3D initialized (Original Working Version)');
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

    initializeParticlePool(numParticles) {
        console.log(`📦 Creating pool of ${numParticles} particles`);

        for (let i = 0; i < numParticles; i++) {
            this.particlePool.push({
                id: i,
                active: false,
                isotope: 'Cs137',
                x: 0,
                y: 0,
                depth: 0,
                sigma_h: 100,
                sigma_v: 10,
                concentration: 0,
                age: 0,
                mass: 1.0,
                releaseDepth: 0,
                history: [],
                velocityU: 0,
                velocityV: 0,
                lastIntegration: 'none',
                integrationSteps: 0
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

            const initialActivityPBq = 2.0;
            const initialParticles = Math.floor(initialActivityPBq * 1e6 * this.activityToParticleScale);

            if (initialParticles > 0) {
                const released = this.releaseParticles(initialParticles);
                console.log(`📈 Released ${released} particles for early March (11-21, 2011)`);
            }
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

    stopSimulation() {
        console.log('⏹️ Stopping simulation');
        this.isRunning = false;
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
            p.mass = 1.0;
            p.concentration = 0;
            p.history = [];
            p.velocityU = 0;
            p.velocityV = 0;
            p.lastIntegration = 'none';
            p.integrationSteps = 0;
        }
    }

    // ==================== PARTICLE RELEASE ====================

    releaseParticles(count) {
        let released = 0;
        const RELEASE_CENTER = { lon: 142.31, lat: 37.42 };
        const SIGMA = 30.0 / this.LON_SCALE;

        for (const p of this.particlePool) {
            if (!p.active && released < count) {
                let lon, lat;
                do {
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

                } while (!this.isPositionInOcean(lon, lat));

                p.x = (lon - this.FUKUSHIMA_LON) * this.LON_SCALE;
                p.y = (lat - this.FUKUSHIMA_LAT) * this.LAT_SCALE;
                p.depth = 0;
                p.sigma_h = this.constantSigma.horizontal;
                p.sigma_v = this.constantSigma.vertical;
                p.active = true;
                p.age = 0;
                p.mass = 1.0;
                p.concentration = this.calculateConcentration(p);
                p.releaseDay = this.stats.simulationDays;
                p.history = [{x: p.x, y: p.y, depth: p.depth}];

                released++;
            }
        }

        this.stats.totalReleased += released;
        if (released > 0) {
            console.log(`🎯 Released ${released} particles`);
        }

        return released;
    }

    isPositionInOcean(lon, lat, depthMeters = 0) {
        return true;
    }

    // ==================== CONTINUOUS RELEASE ====================

    executeContinuousRelease(deltaDays) {
        if (!this.isRunning) return;

        const currentSimDay = this.stats.simulationDays;
        let totalParticlesToRelease = 0;

        for (const phase of this.releasePhases) {
            if (currentSimDay >= phase.startDay && currentSimDay <= phase.endDay) {
                const particlesThisStep = phase.dailyRateGBq * this.activityToParticleScale * deltaDays;
                totalParticlesToRelease += particlesThisStep;
            }
        }

        if (totalParticlesToRelease > 0) {
            const count = Math.floor(totalParticlesToRelease);
            this.releaseParticles(count);
        }
    }

    // ==================== LAND INTERACTION ====================

    async checkLandInteraction(p, prevX, prevY, prevDepth, currentSimDay) {
        if (!this.landSettings.enabled || !this.hycomLoader) return false;

        const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
        const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);

        try {
            const isOcean = await this.hycomLoader.isOcean(lon, lat, 0, currentSimDay);

            if (!isOcean) {
                p.x = prevX;
                p.y = prevY;
                p.depth = prevDepth;

                const oceanCell = await this.hycomLoader.findNearestOceanCell(
                    lon, lat, 0, currentSimDay, this.landSettings.maxLandSearchRadius
                );

                if (oceanCell) {
                    const dx = (oceanCell.lon - lon) * this.LON_SCALE;
                    const dy = (oceanCell.lat - lat) * this.LAT_SCALE;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist > 0) {
                        p.x += (dx / dist) * this.landSettings.coastalPushStrength;
                        p.y += (dy / dist) * this.landSettings.coastalPushStrength;
                    }
                }

                return true;
            }
        } catch (error) {
            p.x = prevX;
            p.y = prevY;
            p.depth = prevDepth;
            return true;
        }

        return false;
    }

    // ==================== DIFFUSION ====================

    async applyDiffusion(p, deltaDays, currentSimDay) {
        try {
            const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
            const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);

            const ekeResult = await this.ekeLoader.getDiffusivityAt(lon, lat, currentSimDay);

            let K_m2_s;
            if (ekeResult.found) {
                K_m2_s = ekeResult.K * this.params.diffusivityScale;
            } else {
                K_m2_s = 20 * this.params.diffusivityScale;
            }

            // Convert time step to seconds
            const dtSeconds = deltaDays * 86400;

            // Calculate displacement in meters (standard random walk formula)
            const stepScale_m = Math.sqrt(2 * K_m2_s * dtSeconds);

            // Convert to kilometers for your coordinate system
            const stepScale_km = stepScale_m / 1000;

            // Generate random displacements
            const randX = this.gaussianRandom();
            const randY = this.gaussianRandom();
            const dx = stepScale_km * randX;
            const dy = stepScale_km * randY;
            const distance = Math.sqrt(dx*dx + dy*dy);

            // Store pre-move position
            const prevX = p.x;
            const prevY = p.y;

            // Apply movement
            p.x += dx;
            p.y += dy;

            // Optional debug logging (remove or comment out for production)
            if (p.id % 1000 === 0 || distance > 20) {
                const newLon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
                const newLat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);
                console.log(`🔬 Particle ${p.id}: K=${K_m2_s.toFixed(1)} m²/s, step=${stepScale_km.toFixed(2)} km, move=${distance.toFixed(1)} km`);
            }

        } catch (error) {
            console.error(`❌ Diffusion error for particle ${p.id}:`, error);
        }
    }

    // ==================== VERTICAL MOTION ====================

    applyVerticalMotion(p, dtSeconds, currentSimDay) {
        const depthM = p.depth * 1000;
        const kz = this.getVerticalDiffusivity(depthM);

        const verticalStdDev = Math.sqrt(2 * kz * dtSeconds);
        const randomDz = verticalStdDev * this.gaussianRandom();

        let deterministicDz = 0;
        deterministicDz += this.params.ekmanPumping * dtSeconds;

        const dayOfYear = this.getDayOfYear();
        const isWinter = dayOfYear < 90 || dayOfYear > 335;
        if (isWinter && depthM < 100) {
            deterministicDz += this.params.convectiveMixing * dtSeconds;
        }

        p.depth += (randomDz + deterministicDz) / 1000;
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

    // ==================== CONCENTRATION CALCULATION (YOUR ORIGINAL) ====================

    calculateConcentration(p) {
        const M = p.mass * 1e9;
        const volume = Math.pow(2 * Math.PI, 1.5) *
                       this.constantSigma.horizontal *
                       this.constantSigma.horizontal *
                       this.constantSigma.vertical;

        let concentration = M / Math.max(volume, 1e9);
        concentration *= this.concentrationScale;
        concentration = Math.max(concentration, 1e-6);
        concentration = Math.min(concentration, 1e6);

        return concentration;
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
        this.stats.particlesOnLand = 0;  // Reset each frame
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
                    p.x = rk4Result.x;
                    p.y = rk4Result.y;
                    p.depth = rk4Result.depth;
                    p.velocityU = rk4Result.u_avg || 0;
                    p.velocityV = rk4Result.v_avg || 0;
                    p.lastIntegration = 'rk4';
                } else {
                    if (velocity.found) {
                        p.velocityU = velocity.u;
                        p.velocityV = velocity.v;
                        p.x += velocity.u * 86.4 * deltaDays;
                        p.y += velocity.v * 86.4 * deltaDays;
                    }
                    p.lastIntegration = 'euler';
                }

                // ===== 2. DIFFUSION =====
                if (this.ekeLoader && this.params.diffusivityScale > 0.01) {
                    await this.applyDiffusion(p, deltaDays, currentSimDay);
                }

                // ===== 3. LAND CHECK =====
                const wasOnLand = await this.checkLandInteraction(p, prevX, prevY, prevDepth, currentSimDay);
                if (wasOnLand) {
                    this.stats.particlesOnLand++;
                    continue;
                }

                // ===== 4. VERTICAL MOTION =====
                if (this.params.verticalMixing) {
                    this.applyVerticalMotion(p, dtSeconds, currentSimDay);
                }

                // ===== 5. RADIOACTIVE DECAY =====
                p.age += deltaDays;
                if (this.params.decayEnabled) {
                    const halfLife = this.isotopes.Cs137.halfLifeDays;
                    p.mass *= Math.pow(0.5, deltaDays / halfLife);

                    if (p.mass < 0.001) {
                        p.active = false;
                        this.stats.totalDecayed++;
                        continue;
                    }
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

        if (Math.floor(this.stats.simulationDays) !== Math.floor(this.stats.simulationDays - deltaDays)) {
            this.logStatistics();
        }
    }

    // ==================== VELOCITY METHODS ====================

    async getVelocitiesForGroup(particles, targetDepth, simulationDay) {
        if (!this.hycomLoader) {
            return particles.map(() => ({ u: 0, v: 0, found: false }));
        }

        const positions = particles.map(p => ({
            lon: this.FUKUSHIMA_LON + (p.x / this.LON_SCALE),
            lat: this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE)
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

    async rk4Step(x, y, depth, h, currentTime) {
        try {
            const depthMeters = depth * 1000;

            const lon1 = this.FUKUSHIMA_LON + (x / this.LON_SCALE);
            const lat1 = this.FUKUSHIMA_LAT + (y / this.LAT_SCALE);
            const k1 = await this.getVelocityAt(lon1, lat1, depthMeters, currentTime);

            if (!k1.found) return { success: false };

            const x2 = x + h/2 * k1.u * 86.4;
            const y2 = y + h/2 * k1.v * 86.4;
            const lon2 = this.FUKUSHIMA_LON + (x2 / this.LON_SCALE);
            const lat2 = this.FUKUSHIMA_LAT + (y2 / this.LAT_SCALE);
            const k2 = await this.getVelocityAt(lon2, lat2, depthMeters, currentTime + h/2);

            const x3 = x + h/2 * (k2.found ? k2.u : k1.u) * 86.4;
            const y3 = y + h/2 * (k2.found ? k2.v : k1.v) * 86.4;
            const lon3 = this.FUKUSHIMA_LON + (x3 / this.LON_SCALE);
            const lat3 = this.FUKUSHIMA_LAT + (y3 / this.LAT_SCALE);
            const k3 = await this.getVelocityAt(lon3, lat3, depthMeters, currentTime + h/2);

            const x4 = x + h * (k3.found ? k3.u : k1.u) * 86.4;
            const y4 = y + h * (k3.found ? k3.v : k1.v) * 86.4;
            const lon4 = this.FUKUSHIMA_LON + (x4 / this.LON_SCALE);
            const lat4 = this.FUKUSHIMA_LAT + (y4 / this.LAT_SCALE);
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

    async eulerIntegrate(p, deltaDays, currentSimDay) {
        const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
        const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);
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
        const oneDay = 86400000;
        return Math.floor(diff / oneDay);
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

    // ==================== STATISTICS ====================

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
        console.log(`   Active particles: ${activeParticles.length}`);
        console.log(`   Mean distance: ${meanDistance.toFixed(1)} km`);
        console.log(`   Max distance: ${maxDistance.toFixed(1)} km`);
        console.log(`   Depth distribution: S:${depthBuckets.surface} U:${depthBuckets.upper} I:${depthBuckets.intermediate} D:${depthBuckets.deep}`);
        console.log(`   Max depth: ${this.stats.maxDepthReached.toFixed(0)} m`);
        console.log(`   On land: ${this.stats.particlesOnLand}`);
        console.log(`   Max concentration: ${this.stats.maxConcentration.toExponential(2)} Bq/m³`);
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
        };
    }

    // ==================== PARAMETER CONTROL ====================

    setParameter(name, value) {
        if (name in this.params) {
            console.log(`🔧 Parameter ${name}: ${this.params[name]} → ${value}`);
            this.params[name] = value;
            return true;
        }
        console.warn(`⚠️ Unknown parameter: ${name}`);
        return false;
    }

    // ==================== EXPORT METHODS ====================

    getParticleData() {
        return this.getActiveParticles().map(p => ({
            x: p.x,
            y: p.y,
            depth: p.depth,
            concentration: p.concentration,
            age: p.age,
            mass: p.mass,
            velocityU: p.velocityU,
            velocityV: p.velocityV
        }));
    }
}

// Export to global scope
if (typeof window !== 'undefined') {
    window.ParticleEngine3D = ParticleEngine3D;
    window.ParticleEngine = ParticleEngine3D;
    console.log('✅ ParticleEngine3D loaded with proper land checking');
}

console.log('=== ParticleEngine3D script complete ===');
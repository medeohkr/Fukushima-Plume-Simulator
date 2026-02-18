// bakeSystem.js - Fixed Version
console.log('=== Bake System Loading ===');

class BakeSystem {
    constructor() {
        this.snapshots = [];
        this.currentSnapshotIndex = 0;
        this.interpolationFactor = 0;
        this.isPlaying = false;
        this.playbackSpeed = 1.0;
        this.animationFrame = null;
        this.bakeInProgress = false;
        this.currentBakeJob = null;
        this.callbacks = {
            onFrame: null,
            onBakeProgress: null,
            onBakeComplete: null
        };
    }

    // ==================== BAKING ====================

    async bake(config) {
        this.bakeInProgress = true;
        this.currentBakeJob = {
            config,
            startTime: Date.now(),
            snapshots: []
        };

        console.log('🔥 Starting bake with config:', config);

        try {
            // Step 1: Initialize engine with config
            this.updateProgress(0, 'Initializing simulation...');

            // Create new engine with the provided location
            const engine = new ParticleEngine3D(
                config.numParticles,
                'cs137',
                config.location || { lat: 37.42, lon: 141.31 }
            );

            // ===== GET PHASES FROM CONFIG =====
            if (config.phases && config.phases.length > 0) {
                console.log('📋 Using custom phases from config:', config.phases);

                const phasesToCopy = config.phases.map(p =>
                    new ReleasePhase(p.start, p.end, p.total, p.unit)
                );

                engine.setReleasePhases(phasesToCopy);

                console.log('✅ Custom phases applied:', phasesToCopy.map(p =>
                    `${p.start}-${p.end}, ${p.total}${p.unit}`
                ));
            } else {
                console.log('⚠️ No phases in config, using default 30-day release');
            }
            // Apply settings from config
            engine.setParameter('diffusivityScale', config.ekeDiffusivity);
            if (config.rk4Enabled) {
                engine.enableRK4(true);
            }


            // Set start date if provided
            if (config.startDate) {
                engine.simulationStartTime = new Date(config.startDate);
                engine.currentSimulationTime = new Date(config.startDate);
            }

            // Force recalculation of particle calibration with new phases
            engine.calculateParticleCalibration();

            // Step 2: Start simulation
            engine.startSimulation();

            // Step 3: Calculate snapshot days based on config
            const snapshotDays = [];
            for (let day = 0; day <= config.durationDays; day += 1) { // Always daily
                snapshotDays.push(day);
            }
            console.log(`📅 Will capture ${snapshotDays.length} snapshots at days:`, snapshotDays);

            // Step 4: Run and capture snapshots
            for (let i = 0; i < snapshotDays.length; i++) {
                const targetDay = snapshotDays[i];

                // Update progress
                const baseProgress = 0;
                const progressRange = 100;
                const snapshotProgress = baseProgress + Math.floor((i / snapshotDays.length) * progressRange);

                this.updateProgress(snapshotProgress,
                    `Simulating day ${targetDay} (${i+1}/${snapshotDays.length})...`);

                // Run simulation to this day
                while (engine.stats.simulationDays < targetDay - 0.01) {
                    const remaining = targetDay - engine.stats.simulationDays;
                    const step = Math.min(1.0, remaining);

                    await this.runSimulationStep(engine, step);

                    // Small delay to keep UI responsive
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                // Capture snapshot
                const snapshot = this.captureSnapshot(engine, targetDay);
                this.currentBakeJob.snapshots.push(snapshot);

                console.log(`✅ Captured day ${targetDay} with ${snapshot.particleCount} particles`);

                // Log current phase status
                const activePhase = engine.releaseManager.phases.find(p =>
                    targetDay >= p.start && targetDay <= p.end
                );
                if (activePhase) {
                    console.log(`   Active phase: ${activePhase.start}-${activePhase.end}, rate: ${activePhase.getRate().toFixed(2)} ${activePhase.unit}/day`);
                }
            }

            // Step 5: Finalize
            this.updateProgress(100, 'Bake complete! Processing results...');

            // Store the baked data
            this.snapshots = this.currentBakeJob.snapshots;

            // Notify completion
            if (this.callbacks.onBakeComplete) {
                console.log('📢 Triggering bake complete callback');
                this.callbacks.onBakeComplete({
                    snapshotCount: this.snapshots.length,
                    durationDays: config.durationDays,
                    particleCount: config.numParticles,
                    phases: engine.releaseManager.phases
                });
            }

            this.bakeInProgress = false;
            return this.snapshots;

        } catch (error) {
            console.error('❌ Bake failed:', error);
            this.bakeInProgress = false;
            throw error;
        }
    }
    async runSimulationStep(engine, deltaDays) {
        // Store original running state
        const wasRunning = engine.isRunning;

        // Make sure engine thinks it's running
        if (!wasRunning) {
            engine.startSimulation();
        }

        // Set lastUpdateTime to now to avoid huge delta
        engine.lastUpdateTime = Date.now();

        // Calculate how many update cycles we need
        const targetDay = engine.stats.simulationDays + deltaDays;

        while (engine.stats.simulationDays < targetDay - 0.01) {
            // Let engine.update() handle the timing
            await engine.update();

            // Small delay to keep UI responsive
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Restore original running state if needed
        if (!wasRunning) {
            engine.pauseSimulation();
        }
    }

    captureSnapshot(engine, day) {
        const particles = engine.getActiveParticles();

        // Format particles for visualization
        const particleData = particles.map(p => {
            // Store minimal history for trails
            const history = p.history ? p.history.slice(-5).map(h => ({
                x: h.x,
                y: h.y
            })) : [];

            return {
                x: p.x,
                y: p.y,
                depth: p.depth,
                concentration: p.concentration,
                mass: p.mass,
                age: p.age,
                history: history,
                active: true
            };
        });

        // Create a lightweight snapshot
        return {
            day: day,
            timestamp: Date.now(),
            particleCount: particles.length,
            stats: {
                ...engine.stats,
                maxConcentration: engine.stats.maxConcentration
            },
            particles: particleData
        };
    }

    updateProgress(percent, message) {
        console.log(`📊 updateProgress called: ${percent}% - ${message}`);

        // Check multiple possible callback names
        const callback = this.callbacks.onBakeProgress || this.callbacks.bakeProgress;

        if (callback) {
            console.log('✅ Found progress callback, calling it...');
            callback({
                percent,
                message,
                timeRemaining: this.estimateTimeRemaining(percent)
            });
        } else {
            console.warn('⚠️ No progress callback registered! Available:', Object.keys(this.callbacks));
        }
    }

    estimateTimeRemaining(percent) {
        if (percent < 5 || !this.currentBakeJob) return null;

        const elapsed = (Date.now() - this.currentBakeJob.startTime) / 1000;
        const total = elapsed * (100 / percent);
        const remaining = total - elapsed;

        return Math.round(remaining);
    }

    // ==================== PLAYBACK ====================

    loadSnapshots(snapshots) {
        this.snapshots = snapshots;
        this.currentSnapshotIndex = 0;
        this.interpolationFactor = 0;
        console.log(`📀 Loaded ${snapshots.length} snapshots for playback`);

        // Trigger first frame
        if (this.callbacks.onFrame && snapshots.length > 0) {
            this.callbacks.onFrame({
                day: snapshots[0].day,
                particles: snapshots[0].particles,
                snapshot1: 0,
                snapshot2: 0,
                factor: 0
            });
        }

        return true;
    }

    play() {
        if (this.isPlaying || this.snapshots.length === 0) return;

        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.animate();
    }

    pause() {
        this.isPlaying = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    seek(day) {
        if (this.snapshots.length === 0) return;

        // Find the two snapshots surrounding this day
        let index1 = 0;
        let index2 = 0;

        for (let i = 0; i < this.snapshots.length - 1; i++) {
            if (this.snapshots[i].day <= day && this.snapshots[i + 1].day >= day) {
                index1 = i;
                index2 = i + 1;
                break;
            }
        }

        // If day is outside range, clamp to ends
        if (day <= this.snapshots[0].day) {
            index1 = index2 = 0;
            this.interpolationFactor = 0;
        } else if (day >= this.snapshots[this.snapshots.length - 1].day) {
            index1 = index2 = this.snapshots.length - 1;
            this.interpolationFactor = 0;
        } else {
            // Calculate interpolation factor
            const day1 = this.snapshots[index1].day;
            const day2 = this.snapshots[index2].day;
            this.interpolationFactor = (day - day1) / (day2 - day1);
        }

        this.currentSnapshotIndex = index1;

        // Generate interpolated particles
        const particles = this.interpolateParticles();

        // Trigger frame callback
        if (this.callbacks.onFrame) {
            this.callbacks.onFrame({
                day: day,
                particles: particles,
                snapshot1: index1,
                snapshot2: index2,
                factor: this.interpolationFactor
            });
        }
    }

    animate() {
        if (!this.isPlaying) return;

        const now = performance.now();
        const deltaTime = (now - this.lastFrameTime) / 1000; // seconds

        // Calculate new day based on playback speed
        const currentDay = this.getCurrentDay();
        const newDay = currentDay + (deltaTime * this.playbackSpeed);

        // Check if we've reached the end
        const lastDay = this.snapshots[this.snapshots.length - 1].day;
        if (newDay >= lastDay) {
            this.seek(lastDay);
            this.pause();
            return;
        }

        // Seek to new day (this handles interpolation automatically)
        this.seek(newDay);

        this.lastFrameTime = now;
        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    interpolateParticles() {
        if (this.snapshots.length === 0) return [];

        const snapshot1 = this.snapshots[this.currentSnapshotIndex];

        // If we're at the last snapshot or interpolation factor is 0, return first snapshot
        if (this.currentSnapshotIndex >= this.snapshots.length - 1 ||
            this.interpolationFactor === 0) {
            return snapshot1.particles;
        }

        const snapshot2 = this.snapshots[this.currentSnapshotIndex + 1];
        const t = this.interpolationFactor;

        // Interpolate between snapshots
        const interpolated = [];
        const count = Math.min(snapshot1.particles.length, snapshot2.particles.length);

        for (let i = 0; i < count; i++) {
            const p1 = snapshot1.particles[i];
            const p2 = snapshot2.particles[i];

            if (!p1 || !p2) continue;

            // Linear interpolation for position
            const x = p1.x + t * (p2.x - p1.x);
            const y = p1.y + t * (p2.y - p1.y);

            // Log interpolation for concentration (better visual)
            let concentration;
            if (p1.concentration > 0 && p2.concentration > 0) {
                concentration = Math.pow(10,
                    Math.log10(p1.concentration) +
                    t * (Math.log10(p2.concentration) - Math.log10(p1.concentration))
                );
            } else {
                concentration = p1.concentration + t * (p2.concentration - p1.concentration);
            }

            // Combine history
            let history = [];
            if (t < 0.5 && p1.history) {
                history = p1.history;
            } else if (p2.history) {
                history = p2.history;
            }

            interpolated.push({
                x: x,
                y: y,
                depth: p1.depth + t * (p2.depth - p1.depth),
                concentration: concentration,
                mass: p1.mass + t * (p2.mass - p1.mass),
                age: p1.age + t * (p2.age - p1.age),
                history: history,
                active: true
            });
        }

        return interpolated;
    }

    getCurrentDay() {
        if (this.snapshots.length === 0) return 0;

        const snapshot = this.snapshots[this.currentSnapshotIndex];
        if (this.currentSnapshotIndex >= this.snapshots.length - 1) {
            return snapshot.day;
        }

        const nextSnapshot = this.snapshots[this.currentSnapshotIndex + 1];
        return snapshot.day + this.interpolationFactor * (nextSnapshot.day - snapshot.day);
    }

    // ==================== CALLBACKS ====================


    on(event, callback) {
        console.log(`📢 Registering callback for: ${event}`);

        // Store with both naming conventions to be safe
        this.callbacks[event] = callback;           // Store as-is (e.g., 'frame')
        this.callbacks['on' + event.charAt(0).toUpperCase() + event.slice(1)] = callback; // Store as onFrame

        console.log('Current callbacks:', Object.keys(this.callbacks));
        return this;
    }

    // ==================== UTILITY ====================

    getStats() {
        return {
            snapshotsLoaded: this.snapshots.length,
            currentDay: this.getCurrentDay(),
            isPlaying: this.isPlaying,
            playbackSpeed: this.playbackSpeed,
            snapshotIndex: this.currentSnapshotIndex,
            interpolationFactor: this.interpolationFactor
        };
    }
}

// Export to global
window.BakeSystem = BakeSystem;
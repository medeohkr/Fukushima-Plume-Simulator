# 🌊 Fukushima Radioactive Plume Simulator

**Real-time simulation of Cs-137 transport from the 2011 Fukushima disaster**

[Live Demo] • [Interactive Visualization] • [Scientific Documentation]

## 🎯 Features
- **Real HYCOM ocean currents** (2011-2013, 0.04° resolution)
- **Physics-based EKE diffusion** from CMEMS/AVISO satellite data
- **WebGL-accelerated heatmap visualization**
- **Time-accurate release schedule** based on Kanda (2013)
- **Radioactive decay physics** (Cs-137 half-life: 30.17 years)

## 🧪 Science Behind It
- Advection: HYCOM ocean model currents
- Diffusion: K = C × (α × EKE) × Tₗ where EKE = 0.5×(ugosa² + vgosa²)
- Tuned α = 0.1 to match observed mean diffusivity of ~130 m²/s
- Realistic range: 0-3000 m²/s (calm seas to Kuroshio eddies)

## 🚀 Tech Stack
- Frontend: JavaScript, Leaflet, deck.gl (WebGL)
- Data processing: Python, xarray, numpy
- Visualization: Canvas 2D + WebGL heatmaps

## 📊 Results
The simulation shows:
- Plume reaches Alaska coast by ~April 2012 (13 months)
- Crosses 180° longitude by late 2012
- Matches published transport timescales
- Demonstrates Kuroshio's role in rapid Pacific crossing

## 🎓 About
Built by Leo Ying, 15-year-old aspiring nuclear engineer.
This project combines satellite data, ocean physics, and interactive visualization
to help understand one of history's largest ocean pollution events.
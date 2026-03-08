import numpy as np
import struct

def trace_one_point(date_str="20110311", lat_idx=420, lon_idx=636):
    """Trace full K calculation for one point."""
    
    # Load 3-year means (you need to save these first!)
    means = np.load("D:/PROTEUS/data/3yr_means.npz")
    u_mean = means['u_mean']  # (32,781,1921)
    v_mean = means['v_mean']
    
    # Load daily GLORYS
    with open(f"D:/PROTEUS/data/glorys_3yr_bin/glorys_{date_str}.bin", 'rb') as f:
        header = struct.unpack('7i', f.read(28))
        version, n_lat, n_lon, n_depth, year, month, day = header
        f.read(n_lat * n_lon * 8)  # skip coords
        
        if version == 1:
            u = np.frombuffer(f.read(n_depth * n_lat * n_lon * 4), dtype=np.float32)
            v = np.frombuffer(f.read(n_depth * n_lat * n_lon * 4), dtype=np.float32)
        else:
            u = np.frombuffer(f.read(n_depth * n_lat * n_lon * 2), dtype=np.float16)
            v = np.frombuffer(f.read(n_depth * n_lat * n_lon * 2), dtype=np.float16)
        
        u = u.reshape((n_depth, n_lat, n_lon)).astype(np.float32)
        v = v.reshape((n_depth, n_lat, n_lon)).astype(np.float32)
    
    # Load eddy data
    with open(f"D:/PROTEUS/data/eddy_radii_grid_glorys/daily/eddy_{date_str}.bin", 'rb') as f:
        header = struct.unpack('4i', f.read(16))
        version, year, month, day = header
        data = np.frombuffer(f.read(), dtype=np.float32)
        half = len(data)//2
        radius = data[:half].reshape((n_lat, n_lon))
        speed = data[half:].reshape((n_lat, n_lon))
    
    # Parameters
    C = 0.35
    G_OVER_K = 0.03
    
    print("\n" + "="*70)
    print(f"🔍 TRACING K FOR ONE POINT")
    print(f"   Date: {date_str}, Location: lat_idx={lat_idx}, lon_idx={lon_idx}")
    print("="*70)
    
    for depth_idx in [0, 10, 20, 31]:
        # Get values
        u_d = u[depth_idx, lat_idx, lon_idx]
        v_d = v[depth_idx, lat_idx, lon_idx]
        u_m = u_mean[depth_idx, lat_idx, lon_idx]
        v_m = v_mean[depth_idx, lat_idx, lon_idx]
        L = radius[lat_idx, lon_idx]
        cw = speed[lat_idx, lon_idx]
        
        print(f"\n📏 Depth {depth_idx} ({depth_idx*20}m):")
        print(f"  u_daily = {u_d:.3f}, u_mean = {u_m:.3f}")
        print(f"  v_daily = {v_d:.3f}, v_mean = {v_m:.3f}")
        
        # Step 1: Anomalies
        u_prime = u_d - u_m
        v_prime = v_d - v_m
        print(f"  u' = {u_prime:.3f}, v' = {v_prime:.3f}")
        
        # Step 2: EKE
        eke = 0.5 * (u_prime**2 + v_prime**2)
        print(f"  EKE = {eke:.6f} m²/s²")
        
        # Step 3: Mean flow speed U
        U = np.sqrt(u_m**2 + v_m**2)
        print(f"  U = {U:.3f} m/s")
        print(f"  c_w = {cw:.3f} m/s")
        print(f"  |c_w - U| = {abs(cw - U):.3f} m/s")
        
        # Step 4: K0
        L_m = L * 1000
        K0 = C * np.sqrt(2 * eke) * L_m
        print(f"  K0 = {K0:.1f} m²/s")
        
        # Step 5: Suppression
        k = 2 * np.pi / L_m
        g = G_OVER_K * k
        rel_speed = abs(cw - U)
        term = (k**2 * rel_speed**2) / (g**2)
        suppression = 1 / (1 + term)
        print(f"  k = {k:.3e}, g = {g:.3e}")
        print(f"  term = {term:.3f}")
        print(f"  suppression factor = {suppression:.3f}")
        
        # Step 6: Final K
        K = K0 * suppression
        print(f"  → K = {K:.1f} m²/s")

trace_one_point()